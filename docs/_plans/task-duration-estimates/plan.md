# Plan: Task Duration Estimates

## TL;DR

Surface estimated task duration across three complementary locations using data already stored in
`TaskMetricsService`:

1. **Statistics tab** — a new "Typical Duration" row in each task's metrics card showing the EMA
   and a variability indicator.
2. **Running task tree description** — while a task is executing, its `description` field (which
   normally shows the file path) is replaced with `~Xs remaining`. When the task stops, the
   description returns to normal on the next render cycle.
3. **Pre-run tooltip** — for idle tasks with at least 3 completed runs, the hover tooltip shows
   `Estimated duration: ~Xs (based on N runs, variability: Low/Moderate/High)`.

No new data is collected. All computation is derived from `ITaskMetrics.recentDurations` already
stored per task.

---

## Self-Critique & Viability Assessment

*(See `docs/_plans/feature-ideas-2026/ideas.md` for the original idea. That entry has been removed
from the ideas document now that this full implementation plan exists.)*

This plan was rubber-duck reviewed by a second pass critic after the initial draft. Four blocking
issues and five advisory issues were identified and resolved below. The key resolved concerns were:

- **Description mutation safety** — The original draft mutated `element.description` directly in
  `getTreeItem()`. Since cached `TaskItem` objects persist across renders and
  `organizeTasks()` does not re-set descriptions on non-copied items, this caused stale ETA text
  after a task stops. **Fix:** `getTreeItem()` now returns a fresh `vscode.TreeItem` *projection*
  when any override applies, leaving the cached item untouched. VS Code uses the `element: T`
  reference for identity; the returned `TreeItem` is consumed only for rendering.
- **Description restoration** — Because the cache item is never mutated, there is nothing to
  restore. The ETA projection disappears automatically when the ETA entry is removed from the
  service map.
- **Tooltip regression** — The draft cleared `element.tooltip = undefined` for tasks with no
  estimate. This removed the existing tooltip from every non-estimated task. **Fix:** Only enrich
  the tooltip when data is available; otherwise preserve `element.tooltip` untouched.
- **Phase 9 redundancy** — `TaskCacheService.getTaskById(id)` already exists at O(1) via the
  internal `taskMap`. The phase adding a new O(n) linear scan was removed.
- **Interval guard** — `ensureInterval()` now guards with `if (this._interval) { return; }` to
  prevent multiple concurrent intervals when several tasks start in quick succession.
- **Pre-run scope resolution** — `getPreRunEstimate()` derives scope from
  `vscode.workspace.getWorkspaceFolder(item.taskFileUri)` rather than a bare string, matching
  the serialization used by `TaskHistoryService.getTaskKey()`.
- **`initialize()` subscription scope** — Explicitly only subscribes to terminal states
  (`'success'`, `'failure'`). `startTracking` is called only from `TaskRunner.runTask()`, never
  from the state-change handler, to prevent double-calling.
- **`recentDurations` includes failed runs** — Documented as a Phase 1 known limitation. The
  EMA can be dragged low by short failed runs. A follow-up plan should add
  `recentSuccessDurations` to `ITaskMetrics`.
- **`formatSeconds` duplication** — A shared `src/common/formatSeconds.ts` provides the canonical
  formatter used by all layers.

---

## Stats: EMA and Variability Formulas

**Exponential Moving Average (EMA):**

$$\text{EMA}_t = \alpha \cdot x_t + (1-\alpha) \cdot \text{EMA}_{t-1}$$

- `alpha = 0.3` (weights recent runs more heavily; tuneable)
- Seed with first observation: `EMA_0 = x_0`
- Applied in order of insertion (oldest → newest) to `recentDurations`
- Returns `undefined` when fewer than 3 samples

**Coefficient of Variation:**

$$\text{CV} = \frac{\sigma}{\mu}$$

- `Low`: CV < 0.15
- `Moderate`: CV < 0.40
- `High`: CV ≥ 0.40
- Threshold rationale: a CV below 15% means the task finishes predictably within ≈15% of its
  mean; above 40% makes the ETA practically unreliable.

---

## Phases

### Phase 1 — EMA helpers in `taskMetricsAggregator.ts`

**What:** Two pure functions (no I/O, easily unit-tested).

**`computeEma(durations: number[], alpha?: number): number | undefined`**
- Returns `undefined` if `durations.length < 3`.
- Iterates oldest-to-newest, applying the EMA formula.
- Default `alpha = 0.3`.

**`computeVariability(durations: number[]): 'Low' | 'Moderate' | 'High' | undefined`**
- Returns `undefined` if `durations.length < 3`.
- Computes population standard deviation and mean; returns a CV-based bucket.

Both functions are exported alongside the existing `computeStats` / `updateMetricsFromRecord`
helpers.

---

### Phase 2 — Extend `ITaskMetricsComputed` and `computeMetricsWithStats`

**File:** `src/services/taskMetricsTypes.ts`

Add two optional fields to `ITaskMetricsComputed`:

```ts
/** EMA of recentDurations (successful + failed, excludes terminated). undefined < 3 runs. */
typicalDurationMs: number | undefined;
/** Coefficient-of-variation bucket for recentDurations. undefined < 3 runs. */
durationVariability: 'Low' | 'Moderate' | 'High' | undefined;
```

**File:** `src/services/taskMetricsAggregator.ts` — `computeStats()`

Call the new helpers and populate the new fields.

---

### Phase 3 — Propagate `typicalDurationMs` / `durationVariability` to the webview

**File:** `src/taskHistoryTableViewProvider.ts` — `_doUpdateWebview()`

The existing strip loop removes `recentDurations` and `hourlyRunCounts`. Extend it to also
preserve the two new computed fields (which are already on the object after Phase 2):

```ts
const { recentDurations: _r, hourlyRunCounts: _h, ...rest } = v;
// rest now includes typicalDurationMs and durationVariability from computeMetricsWithStats
return [k, rest];
```

No other change needed — the new fields travel through the existing `loadData` message.

---

### Phase 4 — Statistics tab: "Typical Duration" stat cell

**File:** `res/webviews/taskHistory.html` — `buildTaskCard(key, m)`

Insert a new `makeStatCell` call after the existing "Avg Duration" cell:

```js
body.appendChild(makeStatCell('Typical Duration', () => {
  if (m.typicalDurationMs === undefined) { return { text: '—' }; }
  const varLabel = m.durationVariability ? ` (${m.durationVariability})` : '';
  return { text: `${formatDuration(m.typicalDurationMs)}${varLabel}` };
}));
```

The variability label `(Low)` / `(Moderate)` / `(High)` renders inline after the duration string.
No new CSS is required (the existing `stat-cell` / `stat-label` styles apply).

---

### Phase 5 — `TaskDurationEstimateService`

**File:** `src/services/taskDurationEstimateService.ts` *(new file)*

```ts
interface IRunningEstimate {
  item: TaskItem;
  startTime: number;       // Date.now() at task start
  estimatedMs: number;     // EMA at the moment tracking began
  // No originalDescription — the cached TaskItem is never mutated.
  // Restoration is automatic: getTreeItem() returns element unchanged once
  // stopTracking() removes the ID from the running map.
}
```

**Singleton pattern** matching existing services (`getInstance()` / constructor private).

**Public API:**

| Method | Description |
|---|---|
| `initialize(context)` | Subscribe to `TaskStateManager.onDidStateChange` for terminal states (`'success'`, `'failure'` only — never `'running'`; `startTracking` is called exclusively from `TaskRunner`). |
| `startTracking(item, task)` | Called by `TaskRunner` after the metrics key is known. Computes EMA; if ≥3 samples, records the estimate. Starts the interval if needed. Never modifies `item.description`. |
| `stopTracking(taskId)` | Removes from the map; fires `onDidUpdateEta` once for the final targeted refresh; clears interval if map is now empty. The cached `TaskItem` is never touched — `getTreeItem()` naturally returns the unmodified element on the next render. |
| `getEtaDescription(taskId)` | Returns `~Xs remaining` / `Longer than expected (~Xs est.)` / `undefined`. |
| `getPreRunEstimate(item)` | Returns `{ emaMs, variability, sampleCount }` or `undefined` based on best-effort metrics key lookup. Used for the pre-run tooltip. |
| `onDidUpdateEta` | `vscode.Event<string>` — fires the task ID on each 1 s tick for all running tracked tasks. |

**`startTracking(item: TaskItem, task: vscode.Task): void`**

```ts
const scope = typeof task.scope === 'object'
  ? (task.scope as vscode.WorkspaceFolder).name
  : (task.scope?.toString() ?? 'global');
const metricsKey = `${task.source}:${task.name}:${scope}`;
const metrics = TaskMetricsService.getInstance().getMetrics(metricsKey);
const ema = metrics ? computeEma(metrics.recentDurations) : undefined;
if (ema === undefined) { return; } // < 3 samples — no ETA

const id = TaskStateManager.getInstance().getTaskId(item);
this.running.set(id, {
  item,
  startTime: Date.now(),
  estimatedMs: ema,
});
this.ensureInterval();
```

**`ensureInterval()` (private):**

```ts
private ensureInterval(): void {
  if (this._interval) { return; }   // guard: only one interval at a time
  this._interval = setInterval(() => {
    for (const [id] of this.running) {
      this._onDidUpdateEta.fire(id);
    }
  }, 1000);
}

**`getEtaDescription(taskId: string): string | undefined`**

```ts
const est = this.running.get(taskId);
if (!est) { return undefined; }
const elapsed = Date.now() - est.startTime;
const remaining = est.estimatedMs - elapsed;
if (remaining > 0) {
  return `~${formatSeconds(remaining)} remaining`;
} else {
  return `Longer than expected (~${formatSeconds(est.estimatedMs)} est.)`;
}
```

**`getPreRunEstimate(item: TaskItem)`**

Best-effort metrics key from `TaskItem` properties:

```ts
const label = item.originalLabel || item.label;
const uri = item.taskFileUri || item.resourceUri;
const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
const scope = folder?.name ?? 'global';
const key = `${item.taskType}:${label}:${scope}`;
const metrics = TaskMetricsService.getInstance().getMetrics(key);
if (!metrics || metrics.recentDurations.length < 3) { return undefined; }
const emaMs = computeEma(metrics.recentDurations);
const variability = computeVariability(metrics.recentDurations);
if (emaMs === undefined) { return undefined; }
return { emaMs, variability, sampleCount: metrics.recentDurations.length };
```

**`formatSeconds(ms: number): string`** — private helper:
- `< 60_000` → `Xs` (rounded to nearest second)
- `< 3_600_000` → `Xm Ys`
- `≥ 3_600_000` → `XhYm`

---

### Phase 6 — `TaskRunner`: call `startTracking`

**File:** `src/taskRunner.ts` — `runTask()`

After the `task` object is resolved (post `createTaskForItem`) and just before `vscode.tasks.executeTask(task)`:

```ts
TaskDurationEstimateService.getInstance().startTracking(item, task);
// … existing executeTask call …
```

`runCompoundTask()` delegates to `runTask()` per item, so no separate change is needed there.

---

### Phase 7 — `TaskTreeDataProvider`: subscribe and apply ETA

**File:** `src/taskTreeDataProvider.ts`

**In the constructor**, subscribe to `TaskDurationEstimateService.onDidUpdateEta`:

```ts
TaskDurationEstimateService.getInstance().onDidUpdateEta((taskId) => {
  // Find the live TaskItem in the cache by its canonical ID and fire a targeted refresh.
  const cached = TaskCacheService.getInstance().getTaskById(taskId);
  if (cached) {
    this._onDidChangeTreeData.fire(cached);
  } else {
    // Fallback: fire a full refresh. Happens for tasks created outside the cache
    // (compound task items not in cache, etc.).
    this._onDidChangeTreeData.fire();
  }
});
```

**`getTreeItem(element: TaskItem): vscode.TreeItem`** — extend from the current `return element`.

The key design constraint here is **do not mutate cached `TaskItem` objects**. `TaskItem` instances
live inside `TaskCacheService` and are reused across renders. If we write `element.description =
'~45s remaining'` and the task then stops, the next call to `getTreeItem` (triggered by
`stopTracking`) returns `element` with the stale `'~45s remaining'` description still set, because
nothing restored it. Instead, `getTreeItem` returns a fresh, disposable `vscode.TreeItem`
*projection* when any override applies. VS Code uses the `element: T` reference for tree identity
(reveals, `getChildren`, drag-and-drop) and the returned `TreeItem` only for rendering; returning
a different object is safe.

```ts
getTreeItem(element: TaskItem): vscode.TreeItem {
  const etaDesc = TaskDurationEstimateService.getInstance().getEtaDescription(element.id ?? '');

  // Pre-run tooltip only for leaf items (non-collapsible)
  const estimate = element.collapsibleState === vscode.TreeItemCollapsibleState.None
    ? TaskDurationEstimateService.getInstance().getPreRunEstimate(element)
    : undefined;

  // Fast path: no overrides → return element directly (zero allocation)
  if (etaDesc === undefined && estimate === undefined) {
    return element;
  }

  // Return a lightweight projection — a plain vscode.TreeItem with overrides applied.
  // The cache object (element) is never modified.
  const view: vscode.TreeItem = {
    label:                   element.label,
    id:                      element.id,
    iconPath:                element.iconPath,
    description:             etaDesc ?? element.description,
    tooltip:                 estimate
      ? new vscode.MarkdownString(
          `Estimated duration: ~${formatSeconds(estimate.emaMs)}` +
          ` (based on ${estimate.sampleCount} runs` +
          (estimate.variability ? `, variability: ${estimate.variability}` : '') + ')'
        )
      : element.tooltip,   // preserve existing tooltip when no estimate available
    contextValue:            element.contextValue,
    command:                 element.command,
    collapsibleState:        element.collapsibleState,
    resourceUri:             element.resourceUri,
    accessibilityInformation: element.accessibilityInformation,
    checkboxState:           element.checkboxState,
  };
  return view;
}
```

> **Why not `Object.assign({}, element)`?** `TaskItem` extends `vscode.TreeItem` whose properties
> may use getter/setter patterns. An explicit property list is safer and avoids accidentally
> copying internal state.

**Subscribe to ETA events in the constructor:**

```ts
TaskDurationEstimateService.getInstance().onDidUpdateEta((taskId) => {
  const cached = TaskCacheService.getInstance().getTaskById(taskId);
  if (cached) {
    this._onDidChangeTreeData.fire(cached);
  } else {
    this._onDidChangeTreeData.fire(); // full refresh fallback
  }
});
```

`TaskCacheService.getTaskById(id)` already exists (O(1) via internal `taskMap`). No modification
to `TaskCacheService` is required.

---

### Phase 8 — `extension.ts`: initialize `TaskDurationEstimateService`

**File:** `src/extension.ts`

In `activate()`, after `TaskMetricsService.getInstance().initialize(context)`:

```ts
TaskDurationEstimateService.getInstance().initialize(context);
```

---

## File Summary

| Status | File | Change |
|---|---|---|
| **New** | `src/services/taskDurationEstimateService.ts` | New singleton service |
| **New** | `src/common/formatSeconds.ts` | Shared duration formatter helper |
| **Modified** | `src/services/taskMetricsAggregator.ts` | Add `computeEma`, `computeVariability` |
| **Modified** | `src/services/taskMetricsTypes.ts` | Add `typicalDurationMs`, `durationVariability` to `ITaskMetricsComputed` |
| **Modified** | `src/taskHistoryTableViewProvider.ts` | Include new computed fields in stripped payload |
| **Modified** | `res/webviews/taskHistory.html` | Add "Typical Duration" stat cell in `buildTaskCard` |
| **Modified** | `src/taskRunner.ts` | Call `startTracking(item, task)` in `runTask()` |
| **Modified** | `src/taskTreeDataProvider.ts` | Subscribe to ETA events; extend `getTreeItem()` with projection |
| **Modified** | `src/extension.ts` | Initialize `TaskDurationEstimateService` |

> `src/services/taskCacheService.ts` — **not modified**. `getTaskById(id)` already exists at O(1)
> via the internal `taskMap`.

---

## Test Plan

### New test file: `src/test/suite/taskDurationEstimateService.test.ts`

| Test | Assertion |
|---|---|
| `startTracking` with < 3 recentDurations | Does not add to running map; `getEtaDescription` returns `undefined` |
| `startTracking` with ≥ 3 samples | Adds to running map; `getEtaDescription` returns `~Xs remaining` |
| `getEtaDescription` while within estimate | Returns `~Xs remaining` string |
| `getEtaDescription` when elapsed > estimatedMs | Returns `Longer than expected (~Xs est.)` |
| `stopTracking` | Removes from map; restores `item.description`; clears interval if map empty |
| Multiple concurrent tasks | Each tracked independently; interval shared; all IDs fired per tick |
| `getPreRunEstimate` with < 3 samples | Returns `undefined` |
| `getPreRunEstimate` with ≥ 3 samples | Returns `{ emaMs, variability, sampleCount }` |

### Additions to `src/test/suite/taskMetricsAggregator.test.ts`

| Test | Assertion |
|---|---|
| `computeEma` — < 3 inputs | Returns `undefined` |
| `computeEma` — exactly 3 inputs | Returns correct EMA value |
| `computeEma` — large input | Converges toward most recent value |
| `computeVariability` — < 3 inputs | Returns `undefined` |
| `computeVariability` — stable inputs (all same) | Returns `'Low'` |
| `computeVariability` — high variance inputs | Returns `'High'` |

### Additions to `src/test/suite/taskHistoryTableViewProvider.test.ts`

| Test | Assertion |
|---|---|
| Stripped metrics include `typicalDurationMs` | New field is present in webview payload |
| Stripped metrics include `durationVariability` | New field is present in webview payload |
| `recentDurations` still absent from stripped payload | Not regressed |

### Additions to `src/test/suite/taskTreeDataProvider.test.ts`

| Test | Assertion |
|---|---|
| `getTreeItem` for running task with ETA | Returns element with ETA `description` |
| `getTreeItem` for idle task with ≥ 3 runs | Returns element with estimated-duration `tooltip` |
| `getTreeItem` for idle task with < 3 runs | Returns element with `tooltip = undefined` |

---

## Confidence Gates & Edge Cases

| Concern | Mitigation |
|---|---|
| High-variance tasks giving wrong ETAs | `durationVariability` label communicates uncertainty to user |
| Task with 0 historical runs | `getPreRunEstimate` returns `undefined`; tooltip falls back to `element.tooltip` (unchanged); nothing extra shown |
| ETA during first run of a task | `startTracking` exits early (< 3 samples); no projection override |
| Interval leak if extension deactivates | `initialize(context)` registers a `Disposable` that calls `stopAllTracking()` clearing the interval and the map |
| Multiple simultaneous running tasks | Each has its own `IRunningEstimate` entry in the map; single interval handles all |
| Stale ETA text after task stops | `stopTracking` removes the entry from the map and fires `onDidUpdateEta` once more. `getTreeItem` then takes the fast path (`etaDesc === undefined && estimate === undefined`) and returns the unmodified `element`. No stale text can persist because the cache object was never modified. |
| Task run from Quick Open (no cached item) | `TaskCacheService.getTaskById` returns `undefined`; the fallback `_onDidChangeTreeData.fire()` triggers a full tree refresh. |
| Compound task items (copies in Favorites section) | Copies share the same `id` as the original. Both the original and the copy receive the ETA projection independently (each `getTreeItem` call constructs a fresh projection). No shared mutable state. |
| `recentDurations` includes failed runs | Known Phase 1 limitation. Short-lived failed runs can drag EMA down. The `durationVariability` label provides a visible signal. A follow-up should add `recentSuccessDurations` to `ITaskMetrics`. |
| `recentDurations` mutated between `startTracking` and tick | EMA is computed once at `startTracking` time and frozen in `estimatedMs`. Subsequent metric updates do not affect the live ETA for the current run. |
| Pre-run key mismatch (`item.taskType` ≠ `task.source`) | Best-effort. For native VS Code tasks, `task.source` may differ. The pre-run estimate is advisory only; if the key misses, `getPreRunEstimate` returns `undefined` silently. |
