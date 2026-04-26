# Bug Report: Dockerfile Editor Action Bar Run Button Shows Input Field / Triggers Twice

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** Editor Action Bar, Dockerfile

---

## Bug Description

When the **Run** button in the editor title action bar is clicked for a `Dockerfile`, an input field (argument prompt) unexpectedly appears. If the user presses Escape to dismiss the input field, the input field appears a second time. The task appears to be triggered twice, or the wrong command is being invoked for the run action.

---

## Steps to Reproduce

1. Open a workspace with a `Dockerfile` that is configured as a runnable task.
2. Open the `Dockerfile` in the editor.
3. Observe that the editor title bar shows the ▶️ Run and ⏯️ Run with Args buttons.
4. Click the **▶️ Run** button (not Run with Args).
5. Observe: an input field prompt appears asking for arguments.
6. Press **Escape** to dismiss the input field.
7. Observe: the input field appears a second time.

---

## Expected Behavior

Clicking the **▶️ Run** button should run the Dockerfile task immediately without showing an argument input prompt. Pressing Escape should dismiss any prompt without re-showing it.

---

## Actual Behavior

- The **▶️ Run** button incorrectly shows an argument input field (as if **⏯️ Run with Args** was clicked).
- Pressing Escape causes the input field to reappear, indicating the task is being triggered twice.

---

## Task Type

- [x] Docker/Docker Compose

---

## Error Messages / Logs

Please check the Output panel (View → Output → Workspace Tasks) for any error messages related to the Dockerfile task execution.

---

## Environment

- Extension: Workspace Tasks
- Provider: `taskFactory.ts` (dockerfile case), `workspaceTasksService.ts`
- File: `Dockerfile`

---

## Additional Context

This is suspected to be a double-invocation issue where:
1. The `editor.runTask` command is firing the correct run path, but the task execution for Dockerfile triggers `runTaskWithArgs` internally, OR
2. Two separate command handlers are being triggered for the same button click.

This issue requires investigation to determine the exact call chain for Dockerfile tasks through the action bar. The `taskFactory.ts` `'dockerfile'` case and the workspace tasks service should be audited for the root cause.
