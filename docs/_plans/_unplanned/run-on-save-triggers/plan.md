# Plan: Run-on-Save Task Triggers

## TL;DR

Add a `TaskTriggerService` that watches for `onDidSaveTextDocument` events and automatically
runs configured tasks when saved files match user-defined glob patterns. Triggers are configured
per-workspace in `.workspace-tasks.json` or `settings.json`, and can be globally enabled/disabled
with a status bar indicator showing the active trigger count.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Solves a genuine pain point: linters, formatters, test runners, and code generators are
  currently run manually even though they naturally belong on save.
- Fits neatly into existing infrastructure — `TaskTriggerService` subscribes to a VS Code built-in
  event (`onDidSaveTextDocument`) and delegates execution to the existing `TaskRunner` singleton.
- Does not alter any existing UX; fully opt-in via configuration.

**Risks / Weaknesses:**

- Cascading triggers: a task that writes files could trigger additional saves and create infinite
  loops. Must detect and break cycles (e.g. a "system save" vs. a "user save") using a suppress
  flag during task-initiated output.
- Multiple rapid saves (e.g. auto-save with a short delay) could queue many concurrent runs of the
  same task. Needs a debounce or "one-in-flight" guard per trigger key.
- Users may add slow tasks (full test suites) carelessly. The feature should warn when a task takes
  longer than a configurable threshold and suggest moving it to a manual queue.
- The UI for configuring triggers has no precedent in the extension. Inline JSON configuration is
  the least disruptive path but is less discoverable than a GUI.

**Verdict:** Viable, high-impact feature. Must ship the loop-prevention and debounce mechanisms
in Phase 1, not as a follow-up, or the feature will be too disruptive to use in practice.

---

## Key Design Decisions

- **Configuration location**: `workspaceTasks.triggers` array in `settings.json` (workspace or user)
  plus an additional optional `triggers` block at the top level of `.workspace-tasks.json`.
- **Debounce**: Default 500 ms per trigger key; configurable via
  `workspaceTasks.triggers.debounceMs`. The debounce resets on each save within the window.
- **Loop prevention**: Set a `_triggeredBySave` flag on `TaskRunner` before execution; skip
  `onDidSaveTextDocument` handling while flag is set and for 2 seconds afterward.
- **Execution mode**: Reuses `TaskRunner.runTask()` — no new terminal management.
- **Status bar**: Single item showing `$(zap) N triggers active` when triggers are registered and
  enabled; clicking opens the Triggers settings filter.
- **Global kill switch**: `workspaceTasks.triggers.enabled` boolean (default `true`). Setting to
  `false` disables all triggers without deleting configuration.

---

## Trigger Configuration Schema

```jsonc
// settings.json (workspace or user)
{
  "workspaceTasks.triggers": [
    {
      "on": "save",                        // Only "save" in v1; extendable to "create" / "delete"
      "match": "**/*.ts",                  // Glob pattern relative to workspace root
      "task": "compile",                   // Task label (must exist in VS Code task list)
      "debounceMs": 500,                   // Optional override; inherits global default
      "enabled": true                      // Per-trigger kill switch
    }
  ]
}
```

```jsonc
// .workspace-tasks.json — optional inline triggers block
{
  "shell": {
    "triggers": [
      { "on": "save", "match": "src/**/*.ts", "task": "Build TypeScript" }
    ],
    "tasks": [ ... ]
  }
}
```

---

## Phases

### Phase 1: Core Service & Loop Prevention

1. **`src/services/taskTriggerService.ts`** — New singleton:
   - `initialize(context)`: reads config; registers `vscode.workspace.onDidSaveTextDocument`;
     subscribes to `vscode.workspace.onDidChangeConfiguration` to reload triggers.
   - `_triggers: ITriggerConfig[]` — parsed trigger list from both config sources.
   - `_inFlight: Map<string, NodeJS.Timeout>` — debounce timers keyed by trigger key
     (`"${triggerIndex}:${workspaceFolderName}"`).
   - `_suppressUntil: number` — epoch ms; skip all trigger handling until this time has passed.
   - `handleSave(document)`:
     1. Return early if `Date.now() < _suppressUntil`.
     2. For each trigger, check `micromatch` (already a transitive dep) against `document.uri`.
     3. Schedule debounced run via `_inFlight` map.
   - `executeTrigger(trigger)`:
     1. Set `_suppressUntil = Date.now() + 2000`.
     2. Find matching `TaskItem` from `TaskCacheService`.
     3. Delegate to `TaskRunner.runTask(item)`.
   - `dispose()`: clear all `_inFlight` timers.

2. **`src/services/taskTriggerConfigLoader.ts`** — Utility that merges triggers from:
   - `vscode.workspace.getConfiguration('workspaceTasks').get('triggers')`
   - The `triggers` block from every `.workspace-tasks.json` found by `TaskFilesService`.
   Returns a flat `ITriggerConfig[]` with resolved absolute glob patterns.

3. **`package.json`** — Add configuration contributions:
   - `workspaceTasks.triggers.enabled`: boolean, default `true`
   - `workspaceTasks.triggers.debounceMs`: integer, default `500`, min `0`, max `30000`
   - `workspaceTasks.triggers`: array schema with per-trigger `on`, `match`, `task`,
     `debounceMs`, `enabled` properties.

4. **`src/extension.ts`** — Wire `TaskTriggerService.getInstance().initialize(context)` in
   `activate()`; add to subscriptions for disposal.

### Phase 2: Status Bar Indicator

1. **`src/providers/taskTriggerStatusBarProvider.ts`** — Creates a right-aligned status bar item:
   - Shows `$(zap) N triggers` when N > 0 and triggers are enabled.
   - Shows `$(zap-off) Triggers off` when `workspaceTasks.triggers.enabled` is `false`.
   - Hides when no triggers are configured.
   - `command`: `workspaceTasks.triggers.openSettings` (opens settings filter).
   - Updates on `TaskTriggerService.onDidChangeTriggersConfig` event.

2. **`src/commands/toggleTriggersCommand.ts`** — Registers
   `workspaceTasks.triggers.toggle` command; flips `workspaceTasks.triggers.enabled` via
   `vscode.workspace.getConfiguration('workspaceTasks').update(...)`.

3. **`package.json`** — Register both new commands in `contributes.commands`; add toggle to
   the task tree title menu (`view/title` contribution point).

### Phase 3: Trigger Discovery in Tree View

1. Modify `TaskItem` context value to include `triggered` flag when a task has at least one
   active trigger pointing at it. Tree asks `TaskTriggerService.isTriggered(taskKey)`.
2. Add a themed icon overlay (e.g. `$(zap)` badge in the description field) to tree items with
   active triggers so users can see which tasks are trigger-bound without opening settings.
3. Context menu entry: **"Remove Trigger"** (calls config update to remove the matching trigger).

### Phase 4: Trigger Feedback & Warnings

1. After `executeTrigger()`, compare `endTime - startTime` against a configurable
   `workspaceTasks.triggers.slowTaskThresholdMs` (default `5000`).
2. If exceeded on three consecutive fires, show a one-time information message:
   _"'Build TypeScript' triggered on save has averaged Xms. Consider moving it to a manual
   compound task."_ with a **"Don't remind me"** action.
3. Persist the "dismissed" state per trigger key in `workspaceState`.

### Phase 5: Tests

1. `src/test/suite/services/taskTriggerService.test.ts`
   - Unit: debounce fires only once per window; immediate fire when `debounceMs = 0`.
   - Unit: `_suppressUntil` blocks re-entrant saves.
   - Unit: glob patterns match and reject files correctly.
   - Integration (mock `TaskRunner`): verify `runTask` called once per debounce window.
2. `src/test/suite/services/taskTriggerConfigLoader.test.ts`
   - Merging settings.json and `.workspace-tasks.json` triggers with correct precedence.
   - Missing/malformed config entries are silently skipped (no throws).
3. `src/test/suite/commands/toggleTriggersCommand.test.ts`
   - Toggle flips config value; status bar provider receives change event.

### Phase 6: Documentation

1. **`docs/features/run-on-save.md`** — New page: overview, configuration examples (lint on
   save, compile on save, test subset on save), loop-prevention explanation, trigger status bar.
2. **`docs/configuration/triggers.md`** — Full settings reference for all `workspaceTasks.triggers.*`
   keys with examples.
3. **`README.md`** — Add **"⚡ Run on Save"** to the Key Features list.
4. **`docs/features/index.md`** — Add entry linking to the new page.
