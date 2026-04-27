# Bug Report: Task File Changes Do Not Refresh CodeLens

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Task Discovery, File Watchers

---

## Bug Description

When a task file (e.g., `package.json`, `pyproject.toml`, `Makefile`, `Taskfile.yml`) is edited and saved, the CodeLens items in the editor are not refreshed to reflect the new task definitions. Tasks that have been added, removed, or renamed in the file continue to show stale CodeLens items until the workspace is reloaded or a file create/delete/rename event occurs.

---

## Steps to Reproduce

1. Open a workspace with a task file (e.g., `package.json` with `scripts`).
2. Open the task file in the editor and observe the CodeLens items.
3. Add a new script entry to the file and save it (Ctrl+S / Cmd+S).
4. Observe that the new script's CodeLens item does NOT appear immediately.
5. Note that the Workspace Tasks tree view also does not update until the workspace is reloaded.

---

## Expected Behavior

When a task file is saved, the extension should:
1. Re-discover tasks for the affected file.
2. Refresh CodeLens items in the editor to reflect the updated task definitions.
3. Update the Workspace Tasks tree view with the new task list.

---

## Actual Behavior

Saving a task file (other than `Taskfile.yml`) does not trigger task rediscovery or CodeLens refresh. Changes are only reflected after:
- A file create, delete, or rename event (e.g., reopening the workspace).
- A manual refresh via the extension's refresh command.

---

## Task Type

- [x] npm/yarn/pnpm
- [x] Other/General

---

## Root Cause

In `taskFilesService.ts`, the `onDidSaveTextDocument` handler only refreshes the `taskfile` provider:

```typescript
vscode.workspace.onDidSaveTextDocument((document) => {
  if (!this.isTaskfileUri(document.uri)) {
    return;
  }
  TaskCacheService.getInstance().refreshProvider('taskfile')...
})
```

All other providers (npm, poetry, cargo-make, etc.) are not refreshed on save. The `onDidCreateFiles`, `onDidDeleteFiles`, and `onDidRenameFiles` events trigger a full `invalidateCache()`, but `onDidSaveTextDocument` with content changes does not.

---

## Environment

- Extension: Workspace Tasks
- Service: `taskFilesService.ts`

---

## Additional Context

The fix requires generalizing `onDidSaveTextDocument` to:
1. Check if the saved file matches any registered task file glob pattern across all providers.
2. Trigger a refresh for the matching provider(s) (or a full cache invalidation) when a task file is saved.
