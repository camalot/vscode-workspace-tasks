# Plan: Watch Mode Integration

## TL;DR

`task --watch` keeps a task running and re-runs it whenever its source files change. This plan
adds a **Watch** action to Task task items, implemented as a dedicated VS Code command
`workspaceTasks.taskfile.watchTask`. The command spawns `task --watch <taskName>` in a VS Code
terminal (not as a `vscode.Task`), because watch mode is a long-lived, interactive process that
maps better to a terminal than to the Task API's one-shot execution model. The feature is
controlled by `workspaceTasks.taskfile.enableWatchMode` (boolean, default `true`). An icon button
appears in the tree item's inline action row alongside the existing Run button.

---

## Requirements

- A **Watch** command (`workspaceTasks.taskfile.watchTask`) runs `task --watch <taskName>` in a new
  VS Code integrated terminal.
- The terminal title is `task watch: <taskName>`.
- The terminal is created with `cwd` set to the directory of the task's Taskfile.
- The command is only registered in the context menu for `task`-type items (leaf items, not group
  nodes).
- The feature is controlled by `workspaceTasks.taskfile.enableWatchMode` (boolean, default `true`).
  When disabled, the command is registered but hidden from the context menu (guards via early
  return).
- Alias children (from `plan-aliases.md`) are also watchable if implemented.
- Achieve 100% test coverage for all new/changed code paths.

---

## Key Design Decisions

### Terminal vs `vscode.Task`

`vscode.Task` with `isBackground: true` and `problemMatchers` is the standard way to run
background tasks. However, for watch mode:

- `task --watch` does not emit output in a format that VS Code's problem matchers understand
  out of the box.
- The Task API terminates background tasks on re-run, which is not desirable for an always-on
  watcher.
- Using `vscode.window.createTerminal` gives the user full control: they can see the output,
  send input (e.g., Ctrl+C), and the terminal persists as a named pane.

This is consistent with how many extensions implement long-lived processes (e.g., `jest-runner`,
`cargo-watch`).

### No terminal reuse vs reuse

When the user clicks Watch on the same task multiple times, a new terminal is created each time.
This avoids complexity around detecting whether a terminal is still alive. The terminal title
includes the task name, so duplicates are visible. A more sophisticated implementation (future
work) could reuse and restart, but this is out of scope.

### Command registration location

The command is registered in `src/extension.ts` alongside other `workspaceTasks.*` commands. It
receives a `TaskItem` as its argument (passed from the tree view via `arguments: [item]` in the
`onRunActionCommand`-like pattern).

### Context value gate

The command is shown in the tree view context menu only for items with `contextValue` containing
`task` as the type. This is achieved via a `when` clause in `package.json`:

```json
"when": "viewItem =~ /^workspaceTasks/ && workspaceTasks.taskfile.enableWatchMode == true"
```

The exact `when` clause must match the `contextValue` format produced by `TaskItem.updateContextValue()`.

### `--watch` flag position

`task --watch <taskName>` is the correct syntax. The `--watch` flag must precede the task name.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Terminal approach is simpler and more user-friendly than a background `vscode.Task`.
- No changes to `taskFactory.ts` required (terminal creation is self-contained in the command
  handler).
- The feature is fully opt-out and does not affect existing task execution behavior.
- Terminal title makes it easy to identify watch sessions.

**Risks / Weaknesses:**

- **No terminal lifecycle management:** If the user repeatedly clicks Watch, multiple terminals
  are created. This is a known limitation, clearly documented.
- **Watch mode not available for all tasks:** Some tasks may not be compatible with `--watch`
  (e.g., tasks that read external state). The extension cannot know this in advance; the user
  is responsible for using Watch on appropriate tasks.
- **`workspaceTasks.taskfile.enableWatchMode` vs `workspaceTasks.enabledTaskTypes.taskfile`:** The watch
  setting is separate from the provider-enabled setting. If `enabledTaskTypes.taskfile` is `false`,
  tasks are not discovered at all, so the Watch command cannot be invoked anyway. No additional
  guard needed.
- **`when` clause complexity:** The context value format from `updateContextValue()` is complex.
  Care must be taken to match the exact pattern. Verify against the actual `contextValue` strings
  produced by the `TaskItem` class during testing.
- **Terminal disposal:** Terminals created by Watch are not tracked by the extension. They persist
  until the user closes them. This is the desired behavior for a watcher.

**Verdict:** Viable, medium complexity. The terminal approach sidesteps the complexity of
backgrounded `vscode.Task` lifecycle management. The main risk is the `when` clause precision,
which is mitigated by reading `TaskItem.updateContextValue()` carefully.

---

## Implementation

### Phase 1 — Configuration

#### `package.json` — configuration

```json
"workspaceTasks.taskfile.enableWatchMode": {
  "type": "boolean",
  "default": true,
  "description": "%config.workspaceTasks.taskfile.enableWatchMode%",
  "scope": "resource"
}
```

#### `package.json` — command contribution

```json
{
  "command": "workspaceTasks.taskfile.watchTask",
  "title": "%command.workspaceTasks.taskfile.watchTask%",
  "icon": "$(eye)"
}
```

#### `package.json` — menus contribution

Under `view/item/context` and `view/item/inline`:

```json
{
  "command": "workspaceTasks.taskfile.watchTask",
  "when": "view == workspaceTasks && viewItem =~ /taskType:taskfile/ && viewItem =~ /leaf/",
  "group": "inline@3"
}
```

> **Note:** The exact `when` clause depends on the contextValue format. Review
> `TaskItem.updateContextValue()` to get the exact strings for `taskType:taskfile` and leaf item
> patterns before finalizing.

#### `package.nls.json`

```json
"command.workspaceTasks.taskfile.watchTask": "Watch Task",
"config.workspaceTasks.taskfile.enableWatchMode": "Show a Watch button on Task (go-task) items to run them in watch mode (task --watch)."
```

### Phase 2 — Command Handler

#### `src/commands/watchTaskCommand.ts` (new file)

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { TaskfileTaskProvider } from '../providers/taskTaskProvider';
import { Configuration } from '../libs/configuration';

export async function watchTaskCommand(item: TaskItem): Promise<void> {
  if (!item || item.taskType !== 'taskfile') {
    return;
  }

  const config = Configuration.getInstance();
  const enabled = config.get<boolean>('taskfile.enableWatchMode') ?? true;
  if (!enabled) {
    return;
  }

  const taskName = item.originalLabel ?? item.label as string;
  const provider = new TaskfileTaskProvider();
  const { command, args } = provider.getCommand(item.taskFileUri);

  const terminalArgs = [...(args ?? []), '--watch', taskName];
  const cwd = item.taskFileUri ? path.dirname(item.taskFileUri.fsPath) : undefined;

  const terminal = vscode.window.createTerminal({
    name: `task watch: ${taskName}`,
    cwd,
  });
  terminal.show();
  terminal.sendText([command, ...terminalArgs].join(' '));
}
```

#### `src/extension.ts`

Register the command:

```typescript
import { watchTaskCommand } from './commands/watchTaskCommand';
// ...
context.subscriptions.push(
  vscode.commands.registerCommand('workspaceTasks.taskfile.watchTask', watchTaskCommand),
);
```

### Phase 3 — Tests

#### `src/test/suite/watchTaskCommand.test.ts` (new file)

| Test | Description |
|------|-------------|
| `returns early when item is undefined` | No terminal created |
| `returns early when item.taskType is not "taskfile"` | Non-task item ignored |
| `returns early when enableWatchMode is false` | Config disabled |
| `creates terminal with correct name` | `name === "task watch: <taskName>"` |
| `creates terminal with correct cwd` | `cwd === directory of taskFileUri` |
| `sends correct command to terminal` | `terminal.sendText` called with `task --watch <name>` |
| `sends args from getCommand` | Custom args included |
| `uses originalLabel when set` | `originalLabel` preferred over `label` |
| `cwd is undefined when taskFileUri is not set` | No crash |

**Mocking strategy:** Use `sinon` to stub `vscode.window.createTerminal` and capture the
returned `terminal` mock. Assert `terminal.show()` and `terminal.sendText()` call args.

### Phase 4 — Documentation

#### `docs/task-types/task.md`

Add a **Watch Mode** section:

> ### Watch Mode
>
> Task supports a watch mode (`task --watch`) that re-runs a task whenever its source files
> change. To start a task in watch mode, click the **Watch** (👁) button that appears next to a
> task item in the tree view, or right-click and select **Watch Task**.
>
> Watch mode opens a new integrated terminal named `task watch: <taskName>`. Close the terminal
> to stop watching.
>
> To disable the Watch button on task items:
>
> ```json
> { "workspaceTasks.taskfile.enableWatchMode": false }
> ```

---

## File Change Summary

| File | Change |
|------|--------|
| `src/commands/watchTaskCommand.ts` | **New** — command handler |
| `src/extension.ts` | Register `workspaceTasks.taskfile.watchTask` command |
| `package.json` | Add command, menu contribution, `enableWatchMode` setting |
| `package.nls.json` | Add NLS strings |
| `src/test/suite/watchTaskCommand.test.ts` | **New** — command tests |
| `docs/task-types/task.md` | Add Watch Mode section |

---

## Open Questions / Future Work

- **Terminal reuse / restart:** Detect existing watch terminals by name and offer to restart
  rather than creating a duplicate. Out of scope for v1.
- **`task --watch --interval <N>s`:** A future setting could expose the poll interval.
- **Watch all tasks:** A "Watch All" command that starts one terminal per watched task. Out of
  scope.
