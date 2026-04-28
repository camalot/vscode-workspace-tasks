# Plan: Dockerfile Editor Action Bar Double-Trigger Investigation (I3)

**Status:** Final — Deferred Pending Investigation (post rubber-duck review)
**Area:** Editor Action Bar / Dockerfile

---

## 1. Rubber-Duck Review Summary

The sub-agent confirmed that this issue requires investigation before a fix can be planned.

| Issue | Severity | Resolution |
|---|---|---|
| **C1** Duplicate file events from watcher backends could contribute | Medium | Noted — file watcher events and command execution are separate; focus investigation on command invocation path |
| **C2** Plan 2 (save refresh with debounce) should NOT land before this is investigated | High | Adopted — I3 investigation is a prerequisite for I6 merge approval |
| **C3** Reproduce across Linux/macOS/Windows to understand file-watch semantic differences | Medium | Adopted — investigation should include cross-platform reproduction |

**Decision:** Defer implementation. Create instrumentation steps to identify root cause. Do not merge Plan 2 (I6) until I3 root cause is confirmed.

---

## 2. Known Facts

| Component | Current Behavior |
|---|---|
| `workspaceTasks.editor.runTask` | Bound to `RunActiveEditorTaskCommand`; calls `TaskRunner.runTask(item, undefined, true)` — no `showInputBox` |
| `workspaceTasks.editor.runTaskWithArgs` | Bound to `RunActiveEditorTaskWithArgsCommand`; shows `showInputBox`, then runs |
| `Dockerfile` tasks | Created via `workspaceTasksService.ts`; built by `taskFactory.ts` `'dockerfile'` case |
| `TaskItem` constructor | Auto-assigns `onRunActionCommand = workspaceTasks.runTask` for `None` leaf items |

---

## 3. Hypotheses

### H1: Wrong Command Invoked (Run → Run with Args)
A Dockerfile task item's `onRunActionCommand` may be incorrectly set to `runTaskWithArgs` or the editor action bar button is bound to the wrong command.

### H2: Double Command Registration / Dual Invocation
The editor title bar click triggers `editor.runTask`. Simultaneously, the `TaskItem.command` (double-click handler) fires `onTreeItemClick → onRunActionCommand`. If both fire on a single click, the task runs twice.

### H3: Re-entry from Escape
If `showInputBox` is shown and Escape is pressed, the current guard `if (args !== undefined)` prevents running. But if the command is invoked twice, the second invocation shows the input box after the first is dismissed.

### H4: Execution Path in `workspaceTasksService`
The `WorkspaceTasksService.resolveTaskCommand` may be triggering a prompt for Dockerfile tasks when args are not supplied.

---

## 4. Investigation Steps

Before writing any code, perform these diagnostic steps:

1. **Add invocation logging** to `RunActiveEditorTaskCommand.run()` and `RunActiveEditorTaskWithArgsCommand.run()`:
   ```typescript
   this.logger.debug('[RunActiveEditorTaskCommand] invoked');
   this.logger.debug('[RunActiveEditorTaskWithArgsCommand] invoked');
   ```

2. **Log the task item** to confirm which command is set:
   ```typescript
   this.logger.debug(`[RunActiveEditorTaskCommand] item.onRunActionCommand: ${JSON.stringify(item.onRunActionCommand)}`);
   ```

3. **Check if two invocations occur** by examining the output log after a single button click.

4. **Inspect the Dockerfile TaskItem** in the debugger: confirm `collapsibleState`, `onRunActionCommand`, `command`, and `onRunWithArgsActionCommand`.

5. **Check `WorkspaceTasksService`** for Dockerfile-specific handling that might trigger `showInputBox`.

---

## 5. Fix Paths (Hypothetical — Pending Investigation)

| Hypothesis | Fix |
|---|---|
| H1 (wrong command) | Fix `onRunActionCommand` assignment for Dockerfile task items |
| H2 (dual invocation) | Guard against dual editor-title + tree-item-click invocation; or use `editor.runTask` exclusively without `onRunActionCommand` for file-level tasks |
| H3 (re-entry) | Add re-entry guard flag in `RunActiveEditorTaskWithArgsCommand`; check if the command is already in-progress |
| H4 (service prompting) | Audit `workspaceTasksService.resolveTaskCommand` for unexpected arg prompts |

---

## 6. Prerequisites for Implementation

- [ ] Confirm root cause via instrumentation
- [ ] Reproduce on macOS, Linux, and Windows
- [ ] Confirm whether ONLY Dockerfile exhibits this behavior or other single-task file types as well
- [ ] Review I6 (save refresh) plan before merging — broadening save invalidation may mask or worsen this issue

---

## 7. Update Log

_This plan should be updated with confirmed root cause and specific file/line changes once investigation is complete._
