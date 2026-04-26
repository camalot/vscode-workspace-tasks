# Plan: Dockerfile Editor Action Bar Double-Trigger Investigation (I3)

**Status:** Draft — Needs Investigation (pre rubber-duck review)
**Area:** Editor Action Bar / Dockerfile

---

## 1. Overview

When the **▶️ Run** editor action bar button is clicked for a `Dockerfile`, an argument input prompt unexpectedly appears. Pressing Escape causes the prompt to appear a second time, indicating the action is being triggered twice.

---

## 2. Known Facts

- The editor title bar `Run` button is bound to `workspaceTasks.editor.runTask` command.
- `RunActiveEditorTaskCommand` calls `TaskRunner.runTask(item, undefined, true)` — no `showInputBox`.
- The `Run with Args` button is bound to `workspaceTasks.editor.runTaskWithArgs` command.
- `RunActiveEditorTaskWithArgsCommand` calls `showInputBox` for args, then runs.
- `Dockerfile` tasks are handled via `workspaceTasksService.ts` and the `'dockerfile'` case in `taskFactory.ts`.

---

## 3. Hypotheses

### H1: Wrong Command Invoked (Run → Run with Args)
The `Dockerfile` task item's `onRunActionCommand` is incorrectly set to `workspaceTasks.editor.runTaskWithArgs` instead of `workspaceTasks.runTask`. This would cause the Run button to show the args dialog.

**Investigation:** Check `WorkspaceTasksService` and `TaskFactory` to see what `onRunActionCommand` is set to for Dockerfile items.

### H2: Double Command Registration
The `TaskItem` constructor auto-assigns `onRunActionCommand` for leaf nodes. If the dockerfile task creation also explicitly sets `onRunActionCommand`, there may be a conflict. The `command` property (tree item double-click) could be firing `onTreeItemClick`, which in turn fires `onRunActionCommand` — but the editor title bar button also fires a command. If both fire for the same click event, the task runs twice.

**Investigation:** Trace the command chain for a Dockerfile task item click.

### H3: Escape Behavior in `showInputBox`
If `showInputBox` is shown and the user presses Escape, `args` is `undefined`. The current code:
```typescript
if (args !== undefined) {
  await TaskRunner.getInstance().runTask(item, args, true);
}
```
This should return early on Escape. The re-appearance would indicate the handler is being called a second time.

### H4: `runActiveEditorTask` vs `runTask`
For Dockerfile tasks, it's possible that both the editor title bar button (`workspaceTasks.editor.runTask`) AND the tree item's `onRunActionCommand` (`workspaceTasks.runTask`) are both being triggered. If the editor action service's context key updates trigger additional event handling, this could cause double invocation.

---

## 4. Investigation Steps

1. Add debug logging to `RunActiveEditorTaskCommand.run()` and `RunActiveEditorTaskWithArgsCommand.run()` to trace invocations.
2. Inspect a Dockerfile `TaskItem` in the debugger to verify `onRunActionCommand` and `command` values.
3. Check if `WorkspaceTasksService` sets `onRunActionCommand` to `runTaskWithArgs` for Dockerfile items.
4. Add a call count to `showInputBox` to confirm it's called once or twice per button click.

---

## 5. Deferred Fix

**This plan is deferred pending investigation.** The fix cannot be reliably planned without knowing the exact root cause.

**Action items before planning the fix:**
1. Reproduce the issue with a sample `Dockerfile` workspace
2. Add the debug logging described above
3. Determine which hypothesis (H1-H4) is correct
4. Update this plan with the confirmed root cause and specific code changes

---

## 6. Potential Fixes (Hypothetical)

- **If H1 (wrong command):** Fix `onRunActionCommand` assignment in Dockerfile task item creation.
- **If H2 (double registration):** Guard against duplicate `command` + `onRunActionCommand` firing by checking if the `command` property's handler should call `onRunActionCommand` for non-leaf items only.
- **If H3 (Escape + re-show):** The `RunActiveEditorTaskWithArgsCommand` needs a guard flag to prevent re-entry if the command is called while the input box is already displayed.
- **If H4 (dual command):** Ensure only one command is registered per editor action bar button click.

---

## 7. Note to Reviewer

Additional information is needed to confirm the root cause. If you can reproduce the issue, please:
1. Check the Workspace Tasks output log for duplicate command invocations.
2. Note whether the Run button or the Run with Args button triggers the behavior.
3. Confirm whether only Dockerfile tasks exhibit this behavior, or if other single-task file types also show it.
