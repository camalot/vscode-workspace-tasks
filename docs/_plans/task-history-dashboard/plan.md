# Plan: Task History Dashboard Tab

## TL;DR

Add a third "Dashboard" tab to the existing task history webview panel (`taskHistory.html`). The dashboard aggregates metrics across **all tracked tasks** and renders interactive Chart.js charts. No new VS Code views or panels are needed — the dashboard lives alongside the existing History and Statistics tabs.

---

## Goals

- Provide a visually rich, at-a-glance overview of task execution health across the workspace.
- Use [Chart.js](https://www.chartjs.org/) (v4) for all charts — it is lightweight, has no external runtime dependencies, and can be vendored into the extension.
- All charts adapt to the active VS Code color theme by reading CSS custom properties at render time.
- No external network requests. Chart.js is bundled as a local resource.

---

## Chart.js Integration Strategy

### Why Chart.js

Chart.js v4 ships a UMD bundle (~200 KB minified+gzipped ≈ ~60 KB). It has:
- No runtime CDN dependency
- Native canvas-based rendering (no SVG complexity)
- First-class support for doughnut, bar, line, radar, and scatter charts
- A plugin model for custom tooltips and annotations

### Bundling Approach

1. `npm install chart.js` — adds it as a `devDependency` (not shipped raw; only the built artefact is shipped).
2. Add a `package.json` `scripts.bundle-chartjs` step that copies `node_modules/chart.js/dist/chart.umd.min.js` → `res/webviews/lib/chart.umd.min.js`.
3. Run the copy step as part of `npm run compile` via a `prebundle-chartjs`/`postinstall` hook **or** a webpack `CopyPlugin` entry.
4. Add `res/webviews/lib/` to `.gitignore` (it is a generated artefact and should not be committed). Do NOT add it to `.vscodeignore` — omitting it from `.vscodeignore` is what allows it to ship in the VSIX.
5. In `TaskHistoryTableViewProvider._getHtmlForWebview()`, inject `{{chartJsUri}}` using `webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'res', 'webviews', 'lib', 'chart.umd.min.js'))`.
6. Update the HTML `<script nonce="{{nonce}}" src="{{chartJsUri}}"></script>`.

### Content Security Policy

The existing CSP is:
```
script-src 'nonce-{{nonce}}'
```

Extend to also allow resources served from VS Code's own resource scheme:

```
script-src 'nonce-{{nonce}}' {{cspSource}};
```

This is needed so the `<script src="{{chartJsUri}}">` element (which loads from a `vscode-resource:` URI) is permitted by the browser's CSP enforcement in the webview.

---

## Data Model Changes

### Problem

`TaskHistoryTableViewProvider._doUpdateWebview()` currently **strips** `recentDurations` and `hourlyRunCounts` from the metrics payload before `postMessage` because they are not used in the History or Statistics tabs. The dashboard needs both fields.

### Solution: Lazy Full-Metrics Request

Add a new webview→extension message command `requestDashboardData`. When the dashboard tab is activated, the webview sends `{ command: 'requestDashboardData' }`. The provider responds with a `loadDashboardData` message containing the **unstripped** full metrics (including `recentDurations` and `hourlyRunCounts`).

This avoids bloating the standard `loadData` payload for the History and Statistics tabs.

```
Webview                         Provider
  │                                │
  │  switchTab('dashboard')        │
  │──── requestDashboardData ─────▶│
  │◀─── loadDashboardData ─────────│  (full metrics incl. arrays)
```

The provider handles this in `onDidReceiveMessage`:

```typescript
if (message.command === 'requestDashboardData') {
  const rawMetrics = metricsService.getAllMetrics();
  // do NOT strip recentDurations / hourlyRunCounts
  this._view?.webview.postMessage({ command: 'loadDashboardData', data: { metrics: rawMetrics, history: ... } });
}
```

---

## Dashboard Layout

The dashboard panel (`#dashboard-panel`) is a scrollable flex-column container divided into distinct sections:

```
┌────────────────────────────────────────────────────────┐
│  [History]  [Statistics]  [Dashboard]                  │  ← tab strip (existing)
├────────────────────────────────────────────────────────┤
│  Today: 12  |  All-time: 340  |  Success: 87%  |  ...  │  ← summary bar (existing, always shown)
├────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────────────────┐│
│  │ Outcomes Donut   │  │ Hourly Activity Bar          ││  ← row 1 (2-column grid)
│  └──────────────────┘  └──────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────┤
│  │ Top Tasks by Run Count (horizontal bar)             ││  ← row 2 (full width)
│  └──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┤
│  │ Success Rate by Task (horizontal bar)               ││  ← row 3 (full width)
│  └──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┤
│  │ Duration Comparison: min / avg / p95 / max          ││  ← row 4 (full width, grouped bar)
│  └──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┤
│  │ Daily Activity — Last 14 Days (line chart)          ││  ← row 5
│  └──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┤
│  │ Duration Trends (sparklines, one per task)          ││  ← row 6 (small multiples)
│  └──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┤
│  │ Attention Required (flaky / zero-success tasks)     ││  ← row 7 (table widget, no chart)
│  └──────────────────────────────────────────────────────┘
```

---

## Charts

### 1 — Execution Outcomes (Doughnut)

**Type**: `doughnut`
**Data source**: Aggregate across all task metrics
| Segment          | Value                      | Colour              |
|------------------|----------------------------|---------------------|
| Successful       | Σ `successfulExecutions`   | `--vscode-charts-green` |
| Failed           | Σ `failedExecutions`       | `--vscode-charts-red`   |
| Terminated       | Σ `terminatedExecutions`   | `--vscode-charts-yellow`|

**Notes**: Centre label shows overall success percentage. Tooltip shows count and percentage.

---

### 2 — Hourly Activity Pattern (Bar)

**Type**: `bar`
**Data source**: Σ of `hourlyRunCounts[0..23]` across all tasks
**X-axis**: Hour of day (0 → "12 AM", 12 → "12 PM", etc.)
**Y-axis**: Execution count
**Colour**: `--vscode-charts-blue` with opacity, peak hour highlighted in `--vscode-charts-orange`
**Notes**: Shows when the workspace is most active. Requires `hourlyRunCounts` from `loadDashboardData`.

---

### 3 — Top Tasks by Run Count (Horizontal Bar)

**Type**: `bar` with `indexAxis: 'y'` (horizontal)
**Data source**: `totalExecutions` per task, sorted descending, capped at top 15 tasks
**X-axis**: Execution count
**Y-axis**: Task name (truncated to 30 chars with ellipsis)
**Colour**: Gradient from `--vscode-charts-blue` (≥ average) to `--vscode-charts-purple` (below average)
**Notes**: Clicking a bar zooms into that task's detail (future enhancement, out of scope here — bar is non-interactive in Phase 1).

---

### 4 — Success Rate by Task (Horizontal Bar)

**Type**: `bar` with `indexAxis: 'y'`
**Data source**: `successRate` per task, sorted by rate ascending (worst first)
**X-axis**: 0–100%
**Y-axis**: Task name (truncated)
**Colour per bar**: `--vscode-charts-red` if rate < 50%, `--vscode-charts-yellow` if 50–79%, `--vscode-charts-green` if ≥ 80%
**Notes**: Tasks with `successRate === undefined` (never ran to completion) are excluded.

---

### 5 — Duration Comparison (Grouped Bar)

**Type**: `bar` (grouped, vertical)
**Data source**: `minDurationMs`, `avgDurationMs`, `p95DurationMs`, `maxDurationMs` per task
**Top N**: Up to 10 tasks by `totalExecutions`
**X-axis**: Task names
**Y-axis**: Duration in ms (log scale optional if range is large)
**Datasets** (one per metric):
| Dataset | Colour |
|---------|--------|
| Min     | `--vscode-charts-green` |
| Avg     | `--vscode-charts-blue` |
| p95     | `--vscode-charts-orange` |
| Max     | `--vscode-charts-red` |

**Notes**: Tasks with `avgDurationMs === undefined` are excluded. Tooltip shows formatted duration (using existing `formatDuration()` helper).

---

### 6 — Daily Activity — Last 14 Days (Line Chart)

**Type**: `line`
**Data source**: `historyData` (the existing execution records array)
**Computation**: Group records by calendar day (using `timestampRaw`); count per day for the last 14 days. Days with no executions are plotted as 0.
**X-axis**: Date labels ("Apr 1", "Apr 2", …)
**Y-axis**: Execution count
**Colour**: `--vscode-charts-blue` fill with low opacity
**Notes**: Uses **existing** `historyData` (no new data needed). Respects the history filter (status filter already applied by the provider).

---

### 7 — Duration Trends (Sparklines)

**Type**: `line` (one chart per task, very small, no axes)
**Data source**: `recentDurations[]` per task (from `loadDashboardData`)
**Rendering**: 2-column grid of small canvas elements (≈ 160 × 60 px each)
**Colour**: Green if `durationTrend < 0` (getting faster), red if `durationTrend > 0` (getting slower), neutral otherwise
**Notes**: Skip tasks with fewer than 5 `recentDurations` samples. Requires `recentDurations` from `loadDashboardData`. Chart.js `line` chart with `tension: 0.3`, no point dots, no axes, no legend.

---

### 8 — Attention Required (Table Widget, No Chart)

**Type**: HTML table / card list (no Chart.js)
**Data source**: Tasks matching any of:
- `isFlaky === true` (i.e. `consecutiveFailures >= 3`)
- `successRate < 50` and `totalExecutions >= 5`
- `lastExitCode !== undefined && lastExitCode !== 0` and `lastRunAt` within last 24 h
**Columns**: Task name, Type, Last exit code, Consecutive failures, Success rate, Last run
**Style**: Red/orange accent left border, similar to the existing `task-card` style.
**Notes**: If no tasks match, display "All tasks are healthy 🎉".

---

## Theme Adaptation

Chart.js requires explicit hex/rgb colors — it cannot read CSS variables directly. Use a helper:

```javascript
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
```

Call `cssVar('--vscode-charts-blue')` etc. in a `getChartColors()` function called each time charts are rendered. This ensures the correct theme colors are used at render time.

**Theme change detection**: VS Code does not fire a `message` event into the webview when the theme changes, but it does update CSS variables. Register a `MutationObserver` on `document.documentElement` watching for `style` attribute changes to detect theme switches and re-render the dashboard:

```javascript
new MutationObserver(() => {
  if (currentTab === 'dashboard') { renderDashboard(); }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
```

---

## State Persistence

Extend the existing `vscode.getState()`/`setState()` calls to persist `tab: 'dashboard'` so the dashboard tab survives webview recreation (already handled by the current tab-persistence code — just add `'dashboard'` as a valid `currentTab` value).

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `res/webviews/lib/chart.umd.min.js` | Vendored Chart.js UMD build (copied from `node_modules/chart.js/dist/`) |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add `chart.js` devDependency; add `bundle-chartjs` script; add `postinstall` hook or update `compile` script to invoke copy |
| `res/webviews/taskHistory.html` | Add `#dashboard-panel` div; add Dashboard tab button; add Chart.js `<script>` tag; add `requestDashboardData` message handler; add all chart rendering functions; add theme MutationObserver |
| `src/taskHistoryTableViewProvider.ts` | Handle `requestDashboardData` message in `onDidReceiveMessage`; inject `{{chartJsUri}}` into HTML; update CSP to include `{{cspSource}}` for scripts |

---

## Phases

### Phase 1: Infrastructure ✅ COMPLETE

**Implementation notes / changes from original plan:**

- `chart.js` v4.5.1 was already present in `devDependencies` — no install step needed.
- `bundle-chartjs` script added to `package.json`; `compile` updated to run `bundle-chartjs && compile:webpack`. The script uses `path.join()` for cross-platform path handling and `fs.mkdirSync(..., { recursive: true })` to create `res/webviews/lib/` before copying.
- `res/webviews/lib/` added to `.gitignore` (generated artefact — should not be committed). It is intentionally NOT in `.vscodeignore` so it ships in the VSIX. *(The original plan wording "Add to `.vscodeignore` exclusions" was incorrect — it should have said do NOT add it.)*
- CSP updated: `script-src 'nonce-{{nonce}}' {{cspSource}}`. The `{{cspSource}}` allows the Chart.js file served from the `vscode-resource:` scheme. The `<script>` tag for Chart.js carries the nonce attribute as well.
- `#dashboard-panel` CSS added to the shared `#history-panel, #stats-panel, #dashboard-panel` rule so `flex: 1; overflow-y: auto` applies consistently. Padding added via the shared `#stats-panel, #dashboard-panel` rule.
- `applyTab()` uses `display = ''` consistently for all three panels (reverts to CSS default), not `'block'` for the dashboard (which would have been inconsistent).
- `renderDashboard()` stub checks `typeof Chart === 'undefined'` to surface any CSP load failure and shows `Chart.version` to confirm the correct version loaded. Full charts are Phase 3.
- Test coverage: no new tests added in Phase 1 (no new TypeScript logic). Coverage for `chartJsUri` injection will be added in Phase 2.

**Files changed:**

1. `package.json` — added `bundle-chartjs` script; updated `compile` to run it first
2. `.gitignore` — added `res/webviews/lib/` entry
3. `res/webviews/lib/chart.umd.min.js` — generated artefact (204 KB, gitignored)
4. `res/webviews/taskHistory.html` — updated CSP; added Chart.js `<script>` tag; added Dashboard tab button; added `#dashboard-panel` div; updated `applyTab()` and `switchTab()` for 3-tab support; added `renderDashboard()` stub; added `#dashboard-panel` CSS rules
5. `src/taskHistoryTableViewProvider.ts` — added `chartJsUri` generation and `{{chartJsUri}}` template replacement in `_getHtmlForWebview()`

1. `npm install chart.js` (devDependency).
2. Add `scripts.bundle-chartjs` in `package.json` that copies `node_modules/chart.js/dist/chart.umd.min.js` → `res/webviews/lib/chart.umd.min.js`. Hook into `compile`.
3. Verify the file exists at `res/webviews/lib/chart.umd.min.js` after `npm run compile`.
4. Update `TaskHistoryTableViewProvider._getHtmlForWebview()` to inject `{{chartJsUri}}` and update CSP.
5. Add a minimal test `<canvas>` in `taskHistory.html` to confirm Chart.js loads without CSP errors.

### Phase 2: Data Pipeline

1. Add `requestDashboardData` handler in `onDidReceiveMessage` (provider side).
2. Add `loadDashboardData` message handling in the webview `window.addEventListener('message', ...)`.
3. Add `switchTab('dashboard')` → fires `requestDashboardData` → stores result in `dashboardMetrics` local variable.
4. Write unit tests for the new message handler (extend `taskHistoryTableViewProvider.test.ts`).

### Phase 3: Charts

Implement charts in this order (simplest → most complex):

1. **Execution Outcomes doughnut** (uses summary data already in `metricsData`)
2. **Daily Activity line** (uses `historyData` already in scope)
3. **Top Tasks bar** (uses `metricsData`)
4. **Success Rate bar** (uses `metricsData`)
5. **Duration Comparison grouped bar** (uses `metricsData`)
6. **Hourly Activity bar** (uses `dashboardMetrics` — needs `loadDashboardData`)
7. **Duration Trend sparklines** (uses `dashboardMetrics.recentDurations`)
8. **Attention Required table** (no chart, uses `metricsData`)

### Phase 4: Polish & Tests

1. Add `renderDashboard()` call in `loadData` handler when `currentTab === 'dashboard'` (to keep charts updated after task runs).
2. Add MutationObserver for theme changes.
3. Handle empty state (no metrics yet) with a friendly placeholder.
4. Add / update tests:
   - `requestDashboardData` message handler sends unstripped metrics.
   - `loadDashboardData` message sets `dashboardMetrics` (hard to test inside webview; focus on the provider side).
5. Manual verification checklist (see below).

### Phase 5: Documentation

1. Update `docs/features/task-history.md` — add "Dashboard Tab" section with screenshot placeholder and feature list.
2. Update `README.md` — mention Dashboard in the Task History feature description.

---

## Verification Checklist

- [ ] `npm run compile` copies `chart.umd.min.js` to `res/webviews/lib/`.
- [ ] Dashboard tab renders without CSP errors (check DevTools console via `Developer: Open Webview Developer Tools`).
- [ ] Charts use VS Code theme colors (switch between light/dark themes — charts re-render correctly).
- [ ] Switching tabs preserves state on webview recreation (close/reopen sidebar panel).
- [ ] Execution Outcomes doughnut reflects actual success/fail/terminated counts.
- [ ] Hourly Activity bar peaks at the hour when most test tasks have been run.
- [ ] Duration Trend sparklines show correct direction for a task run intentionally faster then slower.
- [ ] Attention Required section lists a task whose `consecutiveFailures >= 3`.
- [ ] Empty state: opening Dashboard with no task history shows a helpful message, no JS errors.
- [ ] `npm test` passes with no regressions.

---

## Out of Scope

- Cross-workspace aggregated dashboard (metrics from multiple workspaces combined).
- User-configurable chart selection or ordering.
- Chart export (PNG/SVG) — future feature.
- Animation disabling for `prefers-reduced-motion` (Chart.js supports this; add as a follow-up).
- Zoom/pan interactions on individual charts.
- Per-task drilldown from a chart bar click (future feature).
