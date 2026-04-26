# Plan: Editor Title Bar "Run" and "Run with Arguments" Buttons

## Overview

When a user opens a file in the VS Code editor that corresponds to a discovered runnable task
(shell script or GitHub Actions workflow), display **"Run"** (`$(debug-start)`) and
**"Run with Arguments"** (`$(debug-continue)`) action buttons in the editor title bar (top-right
of the editor pane). Clicking either button executes the task associated with the open file,
reusing the existing `TaskRunner` infrastructure.

---

## Self-Critique / Rubber Duck Review Summary

This plan was reviewed against the codebase before writing. The following issues were identified
and incorporated below:

| Priority | Issue | Resolution |
|---|---|---|
| **Critical** | Simplified context keys — `config.workspaceTasks.task.actionBar.run` can be used directly in `when` clauses (same pattern as tree view) | Only one context key needed: `workspaceTasks.activeFileIsRunnableTask` |
| **Critical** | `onDidChangeActiveTextEditor` fires with the new editor as a parameter — reading `vscode.window.activeTextEditor` inside the callback creates a race condition | Pass the `editor` parameter through to `updateContext(editor?)` |
| **Critical** | NLS keys for new commands are required in `package.nls.json` | Explicitly added to implementation steps |
| **Critical** | `EditorTaskActionService.initialize()` must be called from `extension.ts` | Added as explicit step |
| **High** | `onDidUpdate` fires once per provider during startup (~30+ providers) — hammers `setContext` | Debounce `updateContext()` at 75 ms |
| **High** | Workspace trust reliance is implicit | Explicit `isTrusted` guard added + subscribe to `onDidGrantWorkspaceTrust` |
| **High** | `RUNNABLE_TASK_TYPES` defined in multiple places | Centralized in `src/libs/constants.ts` |
| **High** | Command constructors must call `super('editor.runTask', context)` — `loadCommands` only passes `context` | Constructors explicitly shown |
| **Medium** | Unused `activeFileRunnableTaskCount` context key | Removed |
| **Medium** | Non-`file:` scheme URIs (untitled, output, git diff) should be guarded | Early return for non-`file:` schemes added |
| **Medium** | `pickTask()` implementation sketch missing | Added |
| **Medium** | Test plan gaps | Expanded test case tables |
| **Low** | `category` field in commands creates duplicate palette entries | Dropped `category`; added `commandPalette` suppression entry |

---

## Requirements

1. When a file is open and it is a discovered **shell script** task (type `shell`), show both
   "Run" and "Run with Arguments" buttons in the editor title bar.
2. When a file is open and it is a discovered **GitHub Actions workflow** task (type
   `github-actions`), show both buttons in the editor title bar.
3. Buttons are hidden when the active file is not a runnable task.
4. Buttons honor the existing `workspaceTasks.task.actionBar` configuration — specifically the
   `run` and `runWithArgs` boolean flags.
5. Run guard (confirm-before-run) is respected, identical to tree-view behaviour.
6. Workspace trust: if the workspace is not trusted, no buttons appear (task cache is empty in
   untrusted workspaces anyway).
7. The feature reacts to cache updates — if a new file becomes a task after a refresh, the
   buttons appear without requiring the user to close and reopen the file.
8. If a file maps to **multiple tasks** (edge case: multi-job GitHub Actions, future providers),
   both buttons show; on click a QuickPick allows the user to choose which task to run.

---

## Architecture

### Key Insight

VS Code's `editor/title` menu `when` clauses support both **custom context keys** set via
`vscode.commands.executeCommand('setContext', ...)` AND **config values** referenced directly as
`config.<setting.name>`. The tree view already uses the config pattern:
```json
"when": "viewItem =~ /^task/ && config.workspaceTasks.task.actionBar.run"
```

For the editor title bar we follow the same approach — one custom context key
(`workspaceTasks.activeFileIsRunnableTask`) combined with the existing actionBar config in the
`when` clause. This eliminates the need for `activeFileShowRun` / `activeFileShowRunWithArgs`
context keys and fixes the "settings change needs an editor switch to take effect" issue
automatically (VS Code re-evaluates the `when` clause whenever the config changes).

### Components

```
EditorTaskActionService          (new service)
  ├── Subscribes to onDidChangeActiveTextEditor (passes editor param to avoid race)
  ├── Subscribes to TaskCacheService.onDidUpdate  (debounced 75 ms)
  ├── Subscribes to vscode.workspace.onDidGrantWorkspaceTrust
  ├── Calls TaskCacheService.getTasksForFile(uri)
  ├── Guards non-file: scheme URIs (untitled, output, git)
  ├── Guards untrusted workspaces explicitly
  └── Sets one context key:
        workspaceTasks.activeFileIsRunnableTask  (boolean)

RunActiveEditorTaskCommand       (new command: workspaceTasks.editor.runTask)
  ├── Gets active editor URI
  ├── Guards non-file: scheme
  ├── Calls TaskCacheService.getTasksForFile(uri)
  ├── Filters to constants.RUNNABLE_TASK_TYPES
  ├── If 1 task  → confirms run guard, calls TaskRunner.runTask(item)
  ├── If >1 task → QuickPick, confirms, runs selected
  └── If 0 tasks → returns (no-op)

RunActiveEditorTaskWithArgsCommand (new command: workspaceTasks.editor.runTaskWithArgs)
  ├── Gets active editor URI
  ├── Guards non-file: scheme
  ├── Calls TaskCacheService.getTasksForFile(uri)
  ├── Filters to constants.RUNNABLE_TASK_TYPES
  ├── If >1 task → QuickPick
  ├── Confirms run guard (BEFORE prompting for args)
  ├── Prompts for args via showInputBox
  └── Calls TaskRunner.runTask(item, args, true)

constants.ts
  └── RUNNABLE_TASK_TYPES: ReadonlySet<string>  (shared between all consumers)

package.json
  ├── contributes.commands: two new commands with icons (no category)
  ├── contributes.menus.editor/title: two entries with when clauses
  └── contributes.menus.commandPalette: suppress both commands (when: "false")
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/editorTaskActionService.ts` | Singleton service — watches active editor, sets context key |
| `src/commands/runActiveEditorTask.ts` | Command: run the task for the active file |
| `src/commands/runActiveEditorTaskWithArgs.ts` | Command: run with args for the active file |
| `src/test/suite/editorTaskActionService.test.ts` | Unit tests for the service (100% coverage) |
| `src/test/suite/runActiveEditorTask.test.ts` | Unit tests for the run command (100% coverage) |
| `src/test/suite/runActiveEditorTaskWithArgs.test.ts` | Unit tests for the run-with-args command (100% coverage) |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/libs/constants.ts` | Add `RUNNABLE_TASK_TYPES` exported constant |
| `src/commands/index.ts` | Import and register the two new commands |
| `src/extension.ts` | Initialize `EditorTaskActionService` in `activate()` after `loadCommands` |
| `package.json` | Command declarations + `editor/title` menu entries + commandPalette suppression |
| `package.nls.json` | NLS strings for the two new commands |

---

## Implementation Details

### 1. `src/libs/constants.ts`

Add near the other type-related constants:

```typescript
/** Task types that can be executed directly from the editor title bar. */
RUNNABLE_TASK_TYPES: Object.freeze(new Set(['shell', 'github-actions'])) as ReadonlySet<string>,
```

### 2. `src/services/editorTaskActionService.ts`

```typescript
import * as vscode from 'vscode';
import { TaskCacheService } from './taskCacheService';
import constants from '../libs/constants';

export class EditorTaskActionService {
  private static instance: EditorTaskActionService;
  private _updateTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor() {}

  public static getInstance(): EditorTaskActionService {
    if (!EditorTaskActionService.instance) {
      EditorTaskActionService.instance = new EditorTaskActionService();
    }
    return EditorTaskActionService.instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateContext(editor))
    );
    context.subscriptions.push(
      TaskCacheService.getInstance().onDidUpdate(() => this.scheduleUpdate())
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.updateContext())
    );
    // Set initial context immediately (not debounced) on activation
    this.updateContext(vscode.window.activeTextEditor);
  }

  /** Debounced update — used when reacting to cache updates to avoid burst on startup. */
  private scheduleUpdate(): void {
    clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => this.updateContext(vscode.window.activeTextEditor), 75);
  }

  /** Updates the editor title bar context key. */
  public updateContext(editor?: vscode.TextEditor): void {
    const uri = editor?.document.uri;
    const isRunnable = this.isRunnableFile(uri);
    vscode.commands.executeCommand(
      'setContext',
      'workspaceTasks.activeFileIsRunnableTask',
      isRunnable
    );
  }

  /** Returns true when the URI belongs to a workspace file that has at least one runnable task. */
  public isRunnableFile(uri: vscode.Uri | undefined): boolean {
    if (!uri || uri.scheme !== 'file') {
      return false;
    }
    if (!vscode.workspace.isTrusted) {
      return false;
    }
    const tasks = TaskCacheService.getInstance().getTasksForFile(uri);
    return tasks.some(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));
  }
}
```

**Key design points:**
- Only one context key (`workspaceTasks.activeFileIsRunnableTask`). The `run` / `runWithArgs`
  visibility is handled in `when` clauses using `config.workspaceTasks.task.actionBar.run` —
  VS Code re-evaluates automatically whenever the setting changes, so no subscription needed.
- `editor` parameter is passed from `onDidChangeActiveTextEditor` to avoid a race condition
  where `vscode.window.activeTextEditor` could reflect a different editor than the event target.
- Cache `onDidUpdate` is debounced (75 ms) to avoid 30+ `setContext` RPCs during startup
  when each of the ~30 providers fires the event.
- `isRunnableFile()` is public for direct unit testing.
- Non-`file:` schemes (untitled, output, git diff) are rejected early.
- Explicit `isTrusted` guard mirrors best practices; if trust is granted mid-session, the
  `onDidGrantWorkspaceTrust` subscription triggers a re-evaluation.

### 3. `src/commands/runActiveEditorTask.ts`

```typescript
import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskCacheService } from '../services/taskCacheService';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import constants from '../libs/constants';

export class RunActiveEditorTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('editor.runTask', context);
  }

  async run(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return;
    }

    const tasks = TaskCacheService.getInstance()
      .getTasksForFile(uri)
      .filter(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));

    if (tasks.length === 0) {
      return;
    }

    let item: TaskItem;
    if (tasks.length === 1) {
      item = tasks[0];
    } else {
      const picked = await this.pickTask(tasks, 'Select a task to run');
      if (!picked) {
        return;
      }
      item = picked;
    }

    // Resolve from cache to get fully-hydrated instance
    if (item.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }

    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) {
      return;
    }

    await TaskRunner.getInstance().runTask(item);
  }

  protected async pickTask(tasks: TaskItem[], placeHolder: string): Promise<TaskItem | undefined> {
    const picks = tasks.map(t => ({
      label: String(t.label),
      description: t.taskType,
      detail: t.taskFileUri?.fsPath,
      taskItem: t,
    }));
    const selected = await vscode.window.showQuickPick(picks, { placeHolder });
    return selected?.taskItem;
  }
}
```

### 4. `src/commands/runActiveEditorTaskWithArgs.ts`

```typescript
import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskCacheService } from '../services/taskCacheService';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import constants from '../libs/constants';

export class RunActiveEditorTaskWithArgsCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('editor.runTaskWithArgs', context);
  }

  async run(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return;
    }

    const tasks = TaskCacheService.getInstance()
      .getTasksForFile(uri)
      .filter(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));

    if (tasks.length === 0) {
      return;
    }

    let item: TaskItem;
    if (tasks.length === 1) {
      item = tasks[0];
    } else {
      const picked = await this.pickTask(tasks, 'Select a task to run with arguments');
      if (!picked) {
        return;
      }
      item = picked;
    }

    // Resolve from cache to get fully-hydrated instance
    if (item.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }

    // Confirm guard BEFORE prompting for arguments (mirrors RunTaskWithArgsCommand)
    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) {
      return;
    }

    const args = await vscode.window.showInputBox({
      prompt: `Enter arguments for task '${item.label}'`,
      placeHolder: 'Arguments',
    });
    if (args !== undefined) {
      await TaskRunner.getInstance().runTask(item, args, true);
    }
  }

  protected async pickTask(tasks: TaskItem[], placeHolder: string): Promise<TaskItem | undefined> {
    const picks = tasks.map(t => ({
      label: String(t.label),
      description: t.taskType,
      detail: t.taskFileUri?.fsPath,
      taskItem: t,
    }));
    const selected = await vscode.window.showQuickPick(picks, { placeHolder });
    return selected?.taskItem;
  }
}
```

### 5. `package.json` Changes

**Commands** (add inside `contributes.commands` array — no `category` to avoid duplicate palette
entries):

```json
{
  "command": "workspaceTasks.editor.runTask",
  "title": "%command.editor.runTask%",
  "icon": "$(debug-start)"
},
{
  "command": "workspaceTasks.editor.runTaskWithArgs",
  "title": "%command.editor.runTaskWithArgs%",
  "icon": "$(debug-continue)"
}
```

**Menus** — `editor/title` (add to `contributes.menus` object). The `when` clause references the
existing `config.workspaceTasks.task.actionBar.run` directly — VS Code re-evaluates these clauses
when settings change, so no extra subscription is needed:

```json
"editor/title": [
  {
    "command": "workspaceTasks.editor.runTask",
    "when": "workspaceTasks.activeFileIsRunnableTask && config.workspaceTasks.task.actionBar.run",
    "group": "navigation@1"
  },
  {
    "command": "workspaceTasks.editor.runTaskWithArgs",
    "when": "workspaceTasks.activeFileIsRunnableTask && config.workspaceTasks.task.actionBar.runWithArgs",
    "group": "navigation@2"
  }
]
```

**Menus** — suppress from command palette (add to `contributes.menus.commandPalette`):

```json
{
  "command": "workspaceTasks.editor.runTask",
  "when": "false"
},
{
  "command": "workspaceTasks.editor.runTaskWithArgs",
  "when": "false"
}
```

### 6. `package.nls.json` Changes

Add:
```json
"command.editor.runTask": "Run Task",
"command.editor.runTaskWithArgs": "Run Task with Arguments"
```

### 7. `src/commands/index.ts` Changes

Add alongside existing imports:
```typescript
import * as runActiveEditorTask from './runActiveEditorTask';
import * as runActiveEditorTaskWithArgs from './runActiveEditorTaskWithArgs';
```

Add both to the `modules` array in `loadCommands`.

### 8. `src/extension.ts` Changes

Add import at the top:
```typescript
import { EditorTaskActionService } from './services/editorTaskActionService';
```

After `loadCommands(context)`, add:
```typescript
EditorTaskActionService.getInstance().initialize(context);
```

---

## Test Coverage Plan (100% target for new code)

### `src/test/suite/editorTaskActionService.test.ts`

| Test | Scenario |
|------|---------|
| `isRunnableFile - undefined uri` | Returns false immediately |
| `isRunnableFile - untitled: scheme` | Returns false |
| `isRunnableFile - output:// scheme` | Returns false |
| `isRunnableFile - git: scheme` | Returns false |
| `isRunnableFile - workspace not trusted` | Returns false even when task in cache |
| `isRunnableFile - file not in cache` | Returns false |
| `isRunnableFile - only non-runnable task (npm)` | Returns false |
| `isRunnableFile - shell task present` | Returns true |
| `isRunnableFile - github-actions task present` | Returns true |
| `isRunnableFile - shell + npm tasks` | Returns true (any runnable is enough) |
| `updateContext - no editor arg → sets false` | `setContext` called with `false` |
| `updateContext - non-file scheme → sets false` | `setContext` called with `false` |
| `updateContext - runnable file → sets true` | `setContext` called with `true` |
| `updateContext - uses passed editor, not window.activeTextEditor` | Pass different editor objects; verify correct one used |
| `initialize - subscribes to onDidChangeActiveTextEditor` | `context.subscriptions` grows |
| `initialize - subscribes to TaskCacheService.onDidUpdate` | `context.subscriptions` grows |
| `initialize - subscribes to onDidGrantWorkspaceTrust` | `context.subscriptions` grows |
| `scheduleUpdate - debounces rapid calls` | Multiple calls within 75 ms produce one `updateContext` invocation |

### `src/test/suite/runActiveEditorTask.test.ts`

| Test | Scenario |
|------|---------|
| `no active editor` | Returns immediately; `TaskRunner.runTask` not called |
| `non-file scheme active editor` | Returns immediately; `TaskRunner.runTask` not called |
| `file not in cache` | Returns immediately; `TaskRunner.runTask` not called |
| `only non-runnable tasks in cache` | Returns immediately; `TaskRunner.runTask` not called |
| `single shell task - runs` | `TaskRunner.runTask` called with item |
| `single github-actions task - runs` | `TaskRunner.runTask` called with item |
| `single task - resolves from cache` | Fully-hydrated item used when `getTask` returns cached version |
| `run guard rejected` | `confirmIfNeeded` returns false; `runTask` not called |
| `multiple tasks - user picks one` | `showQuickPick` stub returns selection; task runs |
| `multiple tasks - user cancels quick pick` | `showQuickPick` returns undefined; `runTask` not called |
| `pickTask shows label, description, detail` | QuickPick items have correct fields |

### `src/test/suite/runActiveEditorTaskWithArgs.test.ts`

| Test | Scenario |
|------|---------|
| `no active editor` | Returns immediately; nothing called |
| `non-file scheme active editor` | Returns immediately |
| `file not in cache` | Returns immediately |
| `only non-runnable tasks in cache` | Returns immediately |
| `single task - prompts for args, runs with args` | `showInputBox` called; `runTask` called with `args, true` |
| `single task - user cancels args input (undefined)` | `showInputBox` returns `undefined`; `runTask` not called |
| `single task - empty string args passes through` | `runTask` called with `''` and `true` |
| `run guard rejected - no input prompt shown` | `confirmIfNeeded` returns false; `showInputBox` never called |
| `run guard order - fires before showInputBox` | Stub call order: guard first, then input box |
| `multiple tasks - pick then provide args` | QuickPick → run guard → InputBox → `runTask` (full flow) |
| `multiple tasks - cancel pick` | No input prompt; `runTask` not called |
| `single task - resolves from cache` | Fully-hydrated item used |

---

## Identified Limitations

### 1. Context Key Latency on Cold Start
On first launch, the task cache is populated asynchronously. If a user opens a shell script before
the cache is built, the editor title buttons will not appear immediately. They appear once
`TaskCacheService` fires `onDidUpdate` and the debounced `updateContext()` runs (≤75 ms after
the last provider finishes).

**Mitigation**: The service reacts to both `onDidChangeActiveTextEditor` AND `onDidUpdate`.

### 2. Non-Workspace Files
Files opened from outside the workspace will never match the task cache. No buttons appear.
This is correct — such files are not discovered tasks.

### 3. `act` Dependency for GitHub Actions
The "Run" button for GitHub Actions workflows requires the `act` CLI. If `act` is not present,
the button still appears but execution fails with a message from the existing `TaskRunner`.
This is consistent with tree-view behaviour.

### 4. GitHub Actions `workflow_dispatch` Inputs
"Run with Arguments" for GitHub Actions passes a free-text argument string to `act`, appended to
the command line. This bypasses the structured `workflow_dispatch` input collection. Users needing
structured inputs should run via the tree view.

### 5. No `editor/title` Ordering Guarantee Across Extensions
Button ordering within `navigation` is relative to contributions from other extensions. The two
buttons will appear adjacent to each other but may not be the leftmost items if other extensions
also contribute to `navigation`.

### 6. Multi-Root Workspace URI Matching
`TaskCacheService.getTasksForFile` normalizes and case-folds URIs on Windows. The service inherits
this behaviour — no special handling needed.

### 7. Debounce Timer and Disposal
The debounce timer (`_updateTimer`) is not explicitly cleared on extension deactivation. In practice
VS Code clears all extension resources on deactivation. A future improvement could add a `dispose()`
method that calls `clearTimeout(this._updateTimer)`.

---

## Documentation Plan

1. **New**: `docs/features/editor-title-run-buttons.md` — describes the feature, which file types
   trigger the buttons, and the relationship to `workspaceTasks.task.actionBar` settings.
2. **Update**: relevant actionBar config doc — note that `run` and `runWithArgs` flags now also
   control the editor title bar buttons.
3. **Update**: `README.md` — mention editor title bar buttons as a feature.

---

## Implementation Order

1. `src/libs/constants.ts` — add `RUNNABLE_TASK_TYPES`
2. `src/services/editorTaskActionService.ts` — service
3. `src/commands/runActiveEditorTask.ts` — run command
4. `src/commands/runActiveEditorTaskWithArgs.ts` — run-with-args command
5. `src/commands/index.ts` — register new commands
6. `src/extension.ts` — initialize service
7. `package.json` — command declarations + menu entries + commandPalette suppression
8. `package.nls.json` — NLS strings
9. Tests (3 new test files)
10. Documentation (1 new doc file + 2 updates)

---

## Open Questions

- Should the buttons also appear for other "file-based" task types beyond shell and github-actions
  (e.g., Makefiles, npm scripts)? The current requirement scope is shell + github-actions only.
  The architecture makes it trivial to extend by adding a type to `RUNNABLE_TASK_TYPES` in
  `constants.ts`.

- Should a "Stop" button also be added to the editor title bar when a task from the current file
  is running? This is deferred but the context-key infrastructure supports it (check
  `TaskStateManager.getStatus(taskId) === 'running'`).
