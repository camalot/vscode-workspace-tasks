# Plan: Task Execution Telemetry & Metrics

## TL;DR

Add a locally-stored `TaskMetricsService` that aggregates per-task execution statistics from `TaskHistoryService` events. Metric scope is user-configurable (per-workspace / global / both / disabled). Display is integrated into the existing history table webview via a Statistics mode toggle. No new external panels needed.

---

## Key Design Decisions

- **Scope**: User-configured via `workspaceTasks.metrics.scope`: `workspace` (workspaceState) | `global` (globalState) | `both` (write both, display combined) | `disabled`. Default: `workspace`.
- **Integration point**: Add `onDidRecordHistory` EventEmitter to `TaskHistoryService`; `TaskMetricsService` subscribes to avoid duplicating VS Code event logic.
- **Display**: Enrich existing `taskHistory.html` webview with a "Statistics" mode toggle (beside existing History mode).
- **Duration ring buffer**: Keep last N samples (configurable, default 100) per task for median/p95 computation; don't store raw timestamps for each run (too heavy).
- **No external telemetry**: Everything persisted locally in VS Code state only.

---

## Metrics to Track (ITaskMetrics)

Per-task:

- `totalExecutions` — all-time run count
- `successfulExecutions` — exitCode === 0
- `failedExecutions` — exitCode !== 0 and not terminated
- `terminatedExecutions` — forcefully stopped or SIGINT-terminated
- `totalDurationMs` — sum (excludes terminated runs with no recorded duration)
- `minDurationMs`, `maxDurationMs`
- `recentDurations: number[]` — ring buffer of last N durations (non-terminated)
- `firstRunAt`, `lastRunAt`, `lastSuccessAt`, `lastFailureAt`, `lastTerminatedAt` — epoch ms
- `lastExitCode` — most recent exit code
- `exitCodeCounts: Record<string, number>` — histogram of exit codes ("0" → 50, "1" → 3, etc.)
- `consecutiveFailures`, `consecutiveSuccesses` — streak tracking
- `hourlyRunCounts: number[]` — length 24, histogram of hour-of-day when task runs

Computed (not stored, derived at read time in `TaskMetricsAggregator`):

- `avgDurationMs`, `medianDurationMs`, `p95DurationMs`
- `successRate` — 0–100%
- `isFlaky` — consecutiveFailures >= 3
- `mostCommonExitCode`
- `peakHour` — 0–23 (most-run hour)
- `runFrequency` — avg runs per day since firstRunAt
- `durationTrend` — slope of last 10 recentDurations (positive = getting slower)

---

## Phases

### Phase 1: Core Data Model & Service

1. Create `src/services/taskMetricsTypes.ts` — define `ITaskMetrics`, `ITaskMetricsComputed` interfaces (no VS Code dependencies)
2. Create `src/services/taskMetricsAggregator.ts` — pure functions: `computeStats(metrics): ITaskMetricsComputed`; `updateMetricsFromRecord(existing, record): ITaskMetrics`; ring-buffer helper
3. Modify `src/services/taskHistoryService.ts` — add `private _onDidRecordHistory = new vscode.EventEmitter<ITaskExecutionRecord>()` and expose `onDidRecordHistory = this._onDidRecordHistory.event`; fire it after pushing a new record
4. Create `src/services/taskMetricsService.ts` — singleton; reads/writes `workspaceState` and/or `globalState` based on config; subscribes to `TaskHistoryService.onDidRecordHistory`; exposes `getMetrics()`, `getAllMetrics()`, `clearMetrics(taskId)`, `clearAllMetrics()`, `onDidChangeMetrics` event

### Phase 2: Configuration

1. Add to `package.json` `contributes.configuration.properties`:
   - `workspaceTasks.metrics.scope`: enum `workspace|global|both|disabled`, default `workspace`
   - `workspaceTasks.metrics.maxDurationSamples`: integer, default 100, min 10, max 1000
   - `workspaceTasks.metrics.retentionDays`: integer, default 0 (no limit), min 0
2. Handle `onDidChangeConfiguration` in `TaskMetricsService` to reload/migrate data if scope changes
3. When `retentionDays > 0`, prune records older than N days on service init

### Phase 3: Commands ✅ COMPLETE

**Implementation notes / changes from original plan:**

- `ITaskExecutionRecord` gained a required `scope: string` field (populated from `task.scope` in `handleTaskStart`), making the key derivation in `TaskMetricsService.getTaskKey()` simpler and explicit.
- `buildMetricsKey(item: TaskItem)` in the command uses `item.task?.name ?? item.label` (not just `item.label`) so it matches `task.name` even when the tree label strips a path suffix (e.g. NPM tasks).
- `src/taskTreeDataProvider.ts`: recent-task copies (both flat and grouped paths) and favorite-task copies now propagate `copy.task = t.task` / `favTask.task = item.task` so that `buildMetricsKey` has access to the underlying `vscode.Task`.
- Context menu `when` clause uses single-quoted string literal: `config.workspaceTasks.metrics.scope != 'disabled'`.
- Test file: `src/test/suite/clearTaskMetricsCommand.test.ts` (7 tests, all passing).

**Files changed:**

1. `src/services/taskHistoryService.ts` — added `scope` field to `ITaskExecutionRecord`; populate it in `handleTaskStart`
2. `src/services/taskMetricsService.ts` — simplified `getTaskKey()` to use `record.scope`
3. `src/commands/clearTaskMetricsCommand.ts` — new file with `MetricsClearTaskCommand` and `MetricsClearAllCommand`
4. `src/commands/index.ts` — import + register `clearTaskMetrics` module
5. `src/extension.ts` — import `TaskMetricsService`; call `TaskMetricsService.getInstance().initialize(context)` after history service init
6. `src/taskTreeDataProvider.ts` — propagate `task` field to recent-task and favorite-task copies
7. `package.json` — 2 new commands (`metrics.clearTask`, `metrics.clearAll`); 1 context menu entry
8. `package.nls.json` — 2 NLS strings for new commands
9. `src/test/suite/clearTaskMetricsCommand.test.ts` — new file with 7 tests
10. `src/test/suite/taskMetricsService.test.ts` — updated `makeRecord()` to include `scope` field; updated key derivation assertions
11. `src/test/suite/taskMetricsAggregator.test.ts` — updated `makeRecord()` to include `scope` field

### Phase 4: Display — Enrich History Webview ✅ COMPLETE

**Implementation notes / changes from original plan:**

- `taskHistoryTableViewProvider.ts`: `updateWebview()` is debounced via `setTimeout(0)` to coalesce the double-fire that occurs when a task completes (both `onDidChange` from `TaskHistoryService` and `onDidChangeMetrics` from `TaskMetricsService` fire in the same tick). This avoids sending two `loadData` payloads per task completion.
- `recentDurations` and `hourlyRunCounts` arrays are stripped before `postMessage` to avoid sending up to 1000 numbers per task over the webview message channel — they are not displayed.
- `onDidReceiveMessage` now returns a `Disposable` that is stored and disposed on view disposal (was previously leaked).
- `clearAllMetrics` is **not** routable from the webview message handler. The webview's ✕ button only clears a single task; "Clear All" requires the command palette (where the confirmation modal is shown). This matches the security intent of `MetricsClearAllCommand`.
- `this._view` is cleared to `undefined` on dispose to prevent stale-reference access.
- **CSP fix**: `onclick` inline handlers are blocked by the `nonce`-only `script-src` CSP. Tab buttons wire their click handlers via `addEventListener` in the `<script nonce>` block.
- **XSS fix**: The metrics-hint column in the history table now builds DOM nodes explicitly (`createElement`/`textContent`) rather than using `innerHTML` with interpolated values.
- **Sticky header fix**: Body is a flex column; `#history-panel` and `#stats-panel` are `flex: 1; overflow-y: auto`. The `<th>` elements use `position: sticky; top: 0` within the panel's own scroll container, so they never overlap the tab strip or summary bar.
- **State persistence**: `currentTab`, `sortKey`, and `sortDirection` are persisted via `vscode.getState()`/`setState()` and restored on page load. Tab selection survives webview recreation.

**Files changed:**

1. `src/taskHistoryTableViewProvider.ts` — added `TaskMetricsService` import; added `_updateTimer` field; debounced `updateWebview()`; extracted `_doUpdateWebview()`; strips `recentDurations`/`hourlyRunCounts`; stores and disposes `messageListener`; clears `this._view` on dispose; webview message handler only accepts per-task clear
2. `res/webviews/taskHistory.html` — completely revised: added tab strip, summary bar, Statistics card panel, per-row metrics hint column; all fixes from rubber duck review applied

### Phase 5: Tests ✅ COMPLETE

**Tests already created in earlier phases:**
- `src/test/suite/taskMetricsAggregator.test.ts` — Phase 1 (pure function tests; ring-buffer, updateMetricsFromRecord, computeStats)
- `src/test/suite/taskMetricsService.test.ts` — Phase 1 (scope variants, persistence, clear, config-change, onDidChangeMetrics)
- `src/test/suite/clearTaskMetricsCommand.test.ts` — Phase 3 (clear all + clear single; mock confirmation dialog)

**New in Phase 5:**
- `src/test/suite/taskHistoryTableViewProvider.test.ts` — 19 tests covering:
  - `resolveWebviewView` sets html and posts initial `loadData` after the debounce delay
  - Does not post when view is not visible
  - `onDidChange` from history service fires a new `loadData`
  - `onDidChangeMetrics` from metrics service fires a new `loadData`
  - Rapid back-to-back changes coalesce into a single `loadData` (debounce)
  - Becoming visible triggers an update
  - Row shape: status, type, task, source (path/cwd fallback), timestamp, exitCode, executionTime, durationRaw, metricsKey
  - `formatRecord` source: uses `path`, falls back to `cwd`, empty when absent
  - Duration formatting: sub-second in ms, seconds with 2dp, `undefined` → empty string
  - `recentDurations` and `hourlyRunCounts` are stripped before `postMessage`
  - Webview `clearMetrics` message with `taskId` calls `clearMetrics(taskId)`
  - Webview `clearMetrics` message without `taskId` does NOT call `clearAllMetrics`
  - Unrecognised message commands are ignored
  - After dispose, history and metrics changes do not post to the webview
  - `hasFilter` excludes non-passing-filter rows from history

**Test totals: 1101 passing, 5 pending (pre-existing), 0 failures**

### Phase 6: Documentation ✅ COMPLETE

**Files changed:**

1. `README.md` — added `🕰️ Task History & Statistics` bullet to Key Features; rewrote the Task History section (removed outdated Tree View subsection, updated Table View, added Statistics View subsection)
2. `docs/configuration/metrics.md` — new file documenting all 3 metrics settings (`scope`, `maxDurationSamples`, `retentionDays`) with types, defaults, options, usage examples, and cross-links
3. `docs/configuration/index.md` — added Metrics Settings row to the configuration table
4. `docs/features/task-history.md` — already updated in Phase 4 (Statistics View section, Metrics Storage table, link to metrics config)

---

## Relevant Files

### New Files

- `src/services/taskMetricsTypes.ts` — ITaskMetrics, ITaskMetricsComputed interfaces
- `src/services/taskMetricsAggregator.ts` — pure stat computation functions
- `src/services/taskMetricsService.ts` — singleton service (pattern: like `TaskHistoryService`)
- `src/commands/clearTaskMetricsCommand.ts` — clear commands
- `src/test/suite/services/taskMetricsAggregator.test.ts`
- `src/test/suite/services/taskMetricsService.test.ts`
- `src/test/suite/commands/clearTaskMetricsCommand.test.ts`
- `docs/features/task-metrics.md`
- `docs/configuration/metrics.md`

### Modified Files

- `src/services/taskHistoryService.ts` — add `onDidRecordHistory` EventEmitter + fire on record
- `src/taskHistoryTableViewProvider.ts` — inject TaskMetricsService, post metrics, handle clear msg
- `res/webviews/taskHistory.html` — add Statistics mode toggle + stats cards + summary bar
- `src/extension.ts` — init TaskMetricsService, register 2 new commands, wire onDidChangeMetrics
- `package.json` — 3 new config settings, 2 new commands, context menu entries
- `README.md`, `docs/features/task-history.md` — documentation updates

---

## Verification

1. Run `npm test` — all existing tests pass, new tests achieve >90% coverage on new files
2. Manual: run a task 3+ times, open history panel, switch to Statistics tab → see metrics populated
3. Manual: change `workspaceTasks.metrics.scope` to each of 4 values → verify data stored in expected location
4. Manual: right-click task → Clear Metrics → metrics reset to 0
5. Manual: run Clear All command → all metrics wiped with confirmation dialog
6. Manual: re-open VS Code (reload window) → metrics persist across sessions (workspaceState/globalState survive reload)
7. Manual: set `retentionDays = 1`, fake a record older than 1 day → verify pruned on init

---

## Explicitly Out of Scope

- Cross-workspace aggregated leaderboard or global metrics UI (tracked in globalState but UI shows per-workspace; global is used as backup when scope=global or both)
- Per-argument tracking (which args used when running with args)
- Compound task-level metrics (individual sub-tasks within compound tasks ARE tracked; the compound task itself is not tracked as an atomic unit)
- Export to CSV/JSON (future feature)
- Any remote/external telemetry
