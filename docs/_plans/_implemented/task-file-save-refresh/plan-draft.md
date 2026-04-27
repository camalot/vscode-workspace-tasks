# Plan: Task File Save → State Refresh (I6)

**Status:** Draft (pre rubber-duck review)
**Area:** Task Discovery / File Watchers

---

## 1. Overview

When a task file is saved (edited and written to disk), the extension does not refresh task discovery or CodeLens for that file. Only `Taskfile.yml` triggers a provider refresh on save. All other providers rely on file create/delete/rename events for cache invalidation.

**Scope:** `TaskFilesService.onDidSaveTextDocument` handler.

---

## 2. Root Cause

In `src/services/taskFilesService.ts`, the `fileEventsWatcher` listener:

```typescript
vscode.workspace.onDidSaveTextDocument((document) => {
  if (!this.isTaskfileUri(document.uri)) {
    return;
  }
  TaskCacheService.getInstance().refreshProvider('taskfile')...
})
```

Only Taskfile URIs are handled. All other providers are not refreshed on save.

---

## 3. Proposed Fix

### 3.1 Approach: Full Cache Invalidation on Matching Save

The simplest correct approach is to extend the `onDidSaveTextDocument` handler to call `this.invalidateCache()` when the saved file matches any registered task file glob pattern.

```typescript
vscode.workspace.onDidSaveTextDocument((document) => {
  const uri = document.uri;

  // Existing taskfile-specific refresh
  if (this.isTaskfileUri(uri)) {
    TaskCacheService.getInstance().refreshProvider('taskfile').catch(...);
    return;
  }

  // General: invalidate cache if the saved file is a known task file
  if (this.anyFileMatchesRegisteredPatterns([uri])) {
    this.invalidateCache();
  }
})
```

`anyFileMatchesRegisteredPatterns` already exists in `TaskFilesService` and checks against all registered provider glob patterns.

### 3.2 Alternative: Per-Provider Refresh

A more targeted approach would identify which provider(s) own the saved file and refresh only those providers. This reduces unnecessary re-scanning. However:
- `TaskCacheService` doesn't currently have a way to look up providers by file URI.
- The implementation complexity is higher.
- Full cache invalidation is the existing pattern for file create/delete/rename events.

**Decision:** Use full `invalidateCache()` for consistency with the existing pattern. Per-provider refresh can be a follow-on optimization.

### 3.3 Taskfile-Specific Refresh

The current `refreshProvider('taskfile')` call (which does a hot-reload without full re-scan) should be preserved as-is, since `Taskfile.yml` has a special hot-reload mechanism. The new general invalidation only runs for non-taskfile URIs.

---

## 4. Implementation

**File:** `src/services/taskFilesService.ts`

**Change:** In the `fileEventsWatcher` setup (around line 587), update the `onDidSaveTextDocument` handler:

```typescript
vscode.workspace.onDidSaveTextDocument((document) => {
  const uri = document.uri;
  if (this.isTaskfileUri(uri)) {
    TaskCacheService.getInstance().refreshProvider('taskfile').catch((e) => {
      this.logger.error('[TaskFilesService] Failed to refresh taskfile provider after Taskfile save', e);
    });
    return;
  }
  if (this.anyFileMatchesRegisteredPatterns([uri])) {
    this.logger.debug(`[TaskFilesService] Task file saved, invalidating cache: ${uri.fsPath}`);
    this.invalidateCache();
  }
}),
```

---

## 5. Testing Plan

**File:** `src/test/suite/taskFilesService.test.ts` (or create if not present)

| Test | Description |
|---|---|
| T01 | Saving a file matching a registered pattern calls `invalidateCache()` |
| T02 | Saving a file NOT matching any registered pattern does NOT call `invalidateCache()` |
| T03 | Saving a `Taskfile.yml` calls `refreshProvider('taskfile')` and NOT `invalidateCache()` |
| T04 | Saving a `package.json` triggers cache invalidation |
| T05 | Saving an unrelated file (e.g., `README.md`) does not trigger invalidation |

---

## 6. Documentation Plan

This is a fix for behavior that should already be working. No user-visible documentation changes are required.

---

## 7. Risks

- **Performance:** `invalidateCache()` triggers a full re-scan of all task files. For large workspaces, this could be expensive. However, this is the same behavior triggered by file create/delete/rename events, so it is already the accepted performance trade-off.
- **Debounce:** Rapid saves (e.g., auto-save with short delay) could trigger multiple cache invalidations. The existing `invalidateCache()` implementation should be checked for any existing debounce or concurrency guard. If none exists, a simple debounce (e.g., 200ms) should be added.
