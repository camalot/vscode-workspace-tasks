# Plan: Task File Save → State Refresh (I6)

**Status:** Final (post rubber-duck review)
**Area:** Task Discovery / File Watchers

---

## 1. Rubber-Duck Review Summary

The draft proposed calling `invalidateCache()` (full rescan) on every save of a matching task file. The sub-agent identified significant issues with that approach:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** Full `invalidateCache()` on every save rescans all providers, even unrelated ones | High | Adopted — redesigned to use per-provider targeted refresh where possible; fall back to full invalidation only when provider mapping is unavailable |
| **C2** Rapid saves (format-on-save, auto-save) trigger multiple rescans with no debounce | High | Adopted — add a 300ms debounce before triggering invalidation; coalesce multiple rapid saves into one refresh |
| **C3** Taskfile-specific refresh and general invalidation could both fire for the same save | Medium | Adopted — preserve early-return after taskfile-specific refresh to prevent double-trigger |
| **C4** Untitled/virtual documents should not trigger scans | Medium | Adopted — add `document.uri.scheme !== 'file'` guard |
| **C5** No performance or debounce tests | Medium | Adopted — debounce behavior added to test plan |
| **C6** Plan 2 landing before Dockerfile investigation (Plan 6) may worsen the double-trigger bug | High | Acknowledged — I6 should be reviewed against I3 findings; document the risk |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Full per-provider targeted refresh (lookup file→provider mapping) | `TaskCacheService` does not currently expose a file→provider lookup API. The provider glob patterns are registered but not queryable by file URI at the cache level. Building this infrastructure is out of scope for this fix. The debounced `invalidateCache()` is acceptable given that the same pattern is used for file create/delete/rename events. |
| Defer implementation entirely | The fix is directionally correct and important for UX. The debounce mitigates the performance concern sufficiently for an initial implementation. |

---

## 2. Root Cause

In `src/services/taskFilesService.ts`, the `fileEventsWatcher` listener handles `onDidSaveTextDocument` only for `Taskfile.yml`:

```typescript
vscode.workspace.onDidSaveTextDocument((document) => {
  if (!this.isTaskfileUri(document.uri)) {
    return;  // ← All other providers ignored
  }
  TaskCacheService.getInstance().refreshProvider('taskfile')...
})
```

All other providers rely on file create/delete/rename events for cache invalidation.

---

## 3. Revised Fix

### 3.1 Debounced Cache Invalidation on Task File Save

Add a debounce timer and extend the `onDidSaveTextDocument` handler:

```typescript
private _saveDebounceTimer?: ReturnType<typeof setTimeout>;

// In initialize():
vscode.workspace.onDidSaveTextDocument((document) => {
  const uri = document.uri;

  // Only process real files
  if (uri.scheme !== 'file') {
    return;
  }

  // Taskfile-specific hot-reload (preserve existing behavior)
  if (this.isTaskfileUri(uri)) {
    TaskCacheService.getInstance().refreshProvider('taskfile').catch((e) => {
      this.logger.error('[TaskFilesService] Failed to refresh taskfile provider after Taskfile save', e);
    });
    return; // ← early return prevents double-trigger
  }

  // General: debounced full invalidation for other task files
  if (this.anyFileMatchesRegisteredPatterns([uri])) {
    this.logger.debug(`[TaskFilesService] Task file saved, scheduling cache invalidation: ${uri.fsPath}`);
    clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = setTimeout(() => {
      this.logger.debug('[TaskFilesService] Executing debounced cache invalidation after save');
      this.invalidateCache();
    }, 300);
  }
}),
```

### 3.2 Dispose the Timer

Add to `dispose()`:
```typescript
clearTimeout(this._saveDebounceTimer);
```

---

## 4. Implementation

**File:** `src/services/taskFilesService.ts`

1. Add `private _saveDebounceTimer?: ReturnType<typeof setTimeout>` field
2. Update `onDidSaveTextDocument` handler as shown above
3. Clear timer in `dispose()` method

---

## 5. Testing Plan

| Test | Description |
|---|---|
| T01 | Saving a `package.json` triggers `invalidateCache()` after debounce window |
| T02 | Saving a file NOT matching any registered pattern does NOT trigger `invalidateCache()` |
| T03 | Saving `Taskfile.yml` calls `refreshProvider('taskfile')` and NOT `invalidateCache()` |
| T04 | Three rapid saves of the same file trigger only ONE `invalidateCache()` call (debounce coalescing) |
| T05 | Saving an untitled document (`scheme !== 'file'`) does not trigger any refresh |
| T06 | After `dispose()`, saving a task file does not trigger invalidation (timer cleared) |

---

## 6. Documentation Plan

This is a fix for behavior that should already work. No user-visible documentation changes are required.

---

## 7. Risk Notes

- **Dockerfile double-trigger (I3):** Broadening save invalidation could exacerbate the I3 issue. The debounce window (300ms) reduces but does not eliminate risk. The I3 investigation should be completed before this change is merged to `develop`.
- **Performance:** 300ms debounce with `invalidateCache()` is consistent with the existing file-create/delete behavior. For very large workspaces, this may still cause visible latency. Acceptable for initial implementation; per-provider targeted refresh is a follow-on optimization.
