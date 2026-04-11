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

### Phase 3: Commands

1. Create `src/commands/clearTaskMetricsCommand.ts` — two commands:
   - `workspaceTasks.metrics.clearAll` — prompts confirmation, clears all metrics data from active store(s)
   - `workspaceTasks.metrics.clearTask` — takes `TaskItem` argument from context menu, clears single task metrics
2. Register commands in `package.json` `contributes.commands` and `contributes.menus.view/item/context` (taskItem context menu group "metrics")
3. Wire both commands in `extension.ts` activate()

### Phase 4: Display — Enrich History Webview

1. Modify `src/taskHistoryTableViewProvider.ts`:
    - Inject `TaskMetricsService` dependency
    - Add `_updateView()` to post both history and metrics data: `{ command: 'loadData', data: { history, metrics, viewMode: 'history'|'stats' } }`
    - Subscribe to `TaskMetricsService.onDidChangeMetrics` to trigger view refresh
    - Handle `{ command: 'clearMetrics', taskId? }` message from webview
2. Modify `res/webviews/taskHistory.html`:
    - Add "History | Statistics" toggle tab strip above the existing table
    - **Statistics mode**: Card grid per task showing — total runs, success rate (colored), avg/min/max/p95 duration, last run, streak badge, peak hour, exit code histogram bar
    - **History mode**: existing table, unchanged in layout; add per-row "last run metrics" tooltip (streak, avg duration)
    - Summary bar at top of both modes: today's runs | all-time runs | overall success rate | total execution time

### Phase 5: Tests

1. Create `src/test/suite/services/taskMetricsTypes.test.ts` (if needed for type guards)
2. Create `src/test/suite/services/taskMetricsAggregator.test.ts` — pure function tests; cover avg, median, p95, successRate, flaky detection, empty/undefined cases, ring-buffer overflow
3. Create `src/test/suite/services/taskMetricsService.test.ts` — test scope variants (workspace/global/both/disabled), persistence, clear, config-change handling, onDidChangeMetrics event firing; use `createMockContext()` pattern + monkey-patch TaskHistoryService event
4. Create `src/test/suite/commands/clearTaskMetricsCommand.test.ts` — test clear all + clear single; mock confirmation dialog
5. Update `src/test/suite/taskHistoryTableViewProvider.test.ts` — ensure metrics injection doesn't break existing tests

### Phase 6: Documentation

1. Update `README.md` — add mention of task metrics / statistics in the feature list
2. Add `docs/features/task-metrics.md` — full documentation: storage scope, what metrics are tracked, how to view, how to clear
3. Update `docs/features/task-history.md` — note the Statistics mode toggle in the history panel
4. Add `docs/configuration/metrics.md` — document all 3 new settings with examples

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
