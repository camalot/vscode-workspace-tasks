# Plan: CodeLens Bug Fixes & Enhancements — v1.10.2

**Status:** Draft (pre rubber-duck review)
**Branch:** v1.10.2
**Area:** Editor / CodeLens

---

## 1. Overview of Issues

This plan addresses five issues discovered after the initial CodeLens implementation
(see [`docs/_plans/codelens-provider/plan.md`](../codelens-provider/plan.md)):

| # | Issue | Severity |
|---|---|---|
| I1 | `"Remove from Favorites"` CodeLens does not refresh after action | High |
| I2 | Multiple enabled providers (npm/bun/pnpm/yarn) each emit duplicate CodeLens buttons for the same task definition | High |
| I3 | Providers that cannot identify task line positions set `startLine = 0`, causing all tasks to stack at the top of the file | High |
| I4 | Right-clicking a CodeLens action triggers the action (VS Code platform behavior) | Low |
| I5 | `justfileTaskProvider` falls back to line 0 for recipes not found in the current file (e.g., imported recipes) | Medium |

---

## 2. Issue Analysis

### 2.1 I1 — Favorites CodeLens not refreshing

**Root cause:** `FavoritesService` has no change event. The `TaskCodeLensProvider`
subscribes to `TaskCacheService.onDidUpdate`, `FilteredTaskService.onDidChange`,
`vscode.workspace.onDidChangeConfiguration`, and `TaskStateManager.onDidStateChange`
for invalidation, but **not** to any favorites-change signal.

When the user removes a task from favorites (either via the CodeLens itself or via the
tree view), the internal `FavoritesService.favorites` Set is updated and saved but no
`_onDidChangeCodeLenses` event is fired. The CodeLens keeps showing "Remove from
Favorites" because `provideCodeLenses` is not re-invoked.

Secondary concern (confirmed **not** a bug): Commands invoked from CodeLens items
receive their arguments by reference within the extension host process. The deserialized
`TaskItem` passed to `removeFromFavorites` retains the `id` string property. The
`getTaskId(item)` call uses `item.id` and the deletion succeeds — the problem is purely
the missing invalidation event.

**Fix:**
1. Add `_onDidChangeFavorites: vscode.EventEmitter<void>` to `FavoritesService`.
2. Expose `onDidChangeFavorites = this._onDidChangeFavorites.event`.
3. Call `this._onDidChangeFavorites.fire()` in `addToFavorites`, `removeFromFavorites`, and `updateFavoriteId`.
4. In `TaskCodeLensProvider` constructor, subscribe:
   ```typescript
   FavoritesService.getInstance().onDidChangeFavorites(() =>
     this._onDidChangeCodeLenses.fire()
   ),
   ```

---

### 2.2 I2 — Duplicate CodeLens buttons from multiple providers

**Root cause:** `TaskCacheService.fileTaskMap` accumulates tasks from **all** enabled
providers for a given file URI. A `package.json` with scripts `build` and `test` and
four enabled package-manager providers (npm, bun, pnpm, yarn) produces 8 `TaskItem`
entries in `fileTaskMap`, all at the same `startLine` values. `provideCodeLenses`
iterates all 8 without deduplication, producing 4 lens rows per script line.

The editor title bar avoids this by showing a QuickPick (via `runActiveEditorTask`)
when multiple tasks exist for a file. The CodeLens needs an in-provider deduplication
step instead.

**Fix:** After splitting into `visibleTasks` / `hiddenTasks`, deduplicate each list by
`(startLine, label)` — keeping only the **first** occurrence (which corresponds to the
first-registered provider in alphabetical-by-type order). Helper:

```typescript
private _deduplicateByLine(tasks: TaskItem[]): TaskItem[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const key = `${t.startLine}|${String(t.label)}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}
```

Applied before the lens-building loops:
```typescript
const dedupedVisible = this._deduplicateByLine(visibleTasks);
const dedupedHidden  = this._deduplicateByLine(hiddenTasks);
```

---

### 2.3 I3 — Line-0 tasks polluting CodeLens

**Root cause:** Several providers explicitly assign `startLine = 0` as a fallback when
the actual line number cannot be determined:

| Provider | Line | Fallback context |
|---|---|---|
| `gitlabCiTaskProvider.ts` | 149 | CLI `--list-json` emits no line numbers |
| `npmTaskProvider.ts` | ~114 | Script key not found in file JSON/content |
| `npmTaskProvider.ts` | ~406 | Same, in `BunTaskProvider.getSystemTasks` |
| `justfileTaskProvider.ts` | (return 0) | Recipe not found by text scan (see I5) |

`0` is not `undefined`, so the existing filter `t.startLine !== undefined` passes these
tasks through, causing them to stack at the top of each file.

**Fixes per provider:**

**`gitlabCiTaskProvider.ts`:** Remove `jobItem.startLine = 0;`. Additionally, add a
YAML text scan to locate job names at column 0 (the YAML key pattern `^job-name\s*:`
at the root level), returning `undefined` when not found:

```typescript
private findJobLineNumber(lines: string[], jobName: string): number | undefined {
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) { return i; }
  }
  return undefined;
}
```

**`npmTaskProvider.ts`:** In both fallback `else` branches, replace
`item.startLine = 0;` with no assignment (let `startLine` remain `undefined`):

Before: `item.startLine = 0;`
After: *(remove the line)*

**`justfileTaskProvider.ts`:** Fixed as part of I5 (§2.5).

---

### 2.4 I4 — Right-click triggers CodeLens action

**Finding:** This is a **VS Code platform behavior**. The `vscode.CodeLens` API renders
action items as inline hyperlinks. VS Code's CodeLens renderer fires the attached
command on any `mousedown` event on the CodeLens widget, regardless of which mouse
button was pressed. There is no API surface in `vscode.CodeLensProvider` to filter by
mouse button.

**Resolution:** No code change possible. Documenting as a VS Code platform
limitation. A feature request / bug report should be filed at
https://github.com/microsoft/vscode/issues if one does not already exist. The
extension documentation will note this limitation.

---

### 2.5 I5 — Justfile recipe line detection fallback

**Root cause:** `findRecipeLineNumber` returns `0` when a recipe name is not found in
the file's lines. This occurs for recipes that originate from an `import`ed file (e.g.,
`import 'shared.just'`) because `just --dump --dump-format json` merges imported recipes
into the root namespace. The recipe text is in `shared.just`, not in the main
`justfile`, so the text scan returns 0 (not found).

The pattern `^@?${escaped}(?:\s|:|$)` is otherwise correct for justfile recipe
declaration syntax, handling:

- `recipe-name:` and `@recipe-name:` (quiet prefix)
- `recipe-name param1 param2:` (with parameters)
- Recipes preceded by attributes (`[no-cd]`, `[group(...)]`, etc.) on prior lines

**Fix:** Change return type of `findRecipeLineNumber` to `number | undefined` and
return `undefined` (not `0`) when the recipe is not found:

```typescript
private findRecipeLineNumber(lines: string[], recipeName: string): number | undefined {
  const escaped = recipeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^@?${escaped}(?:\\s|:|$)`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) { return i; }
  }
  return undefined;
}
```

Update `createRecipeTaskItem` to accept `number | undefined` for `line` and use
`line ?? 0` for the `openFileAtLine` argument (the "Open File" command still works but
goes to line 0 if the exact position is unknown):

```typescript
private createRecipeTaskItem(
  recipe: JustRecipe,
  file: vscode.Uri,
  iconPath: unknown,
  line: number | undefined,
): TaskItem {
  // ...
  item.startLine = line;          // undefined → no CodeLens for this recipe
  item.onOpenActionCommand = {
    command: 'workspaceTasks.openFileAtLine',
    title: 'Open File',
    arguments: [file, line ?? 0], // fallback to top of file for open action
  };
```

---

## 3. File Changes

| File | Change |
|---|---|
| `src/services/favoritesService.ts` | Add `_onDidChangeFavorites` EventEmitter; fire in `addToFavorites`, `removeFromFavorites`, `updateFavoriteId` |
| `src/taskCodeLensProvider.ts` | Subscribe to `FavoritesService.onDidChangeFavorites`; add `_deduplicateByLine` helper; apply deduplication before lens-building loops |
| `src/providers/gitlabCiTaskProvider.ts` | Remove `jobItem.startLine = 0`; add `findJobLineNumber` text-scan helper; assign result (may be `undefined`) |
| `src/providers/npmTaskProvider.ts` | Remove two `item.startLine = 0` fallback assignments |
| `src/providers/justfileTaskProvider.ts` | Change `findRecipeLineNumber` return type to `number \| undefined`; update `createRecipeTaskItem` signature |
| `src/test/suite/favoritesService.test.ts` | Add tests for `onDidChangeFavorites` event |
| `src/test/suite/taskCodeLensProvider.test.ts` | Add tests for favorites invalidation; deduplication; no-lens for undefined startLine |
| `src/test/suite/gitlabCiTaskProvider.test.ts` | Add tests for `findJobLineNumber`; undefined startLine when job not found |
| `src/test/suite/justfileTaskProvider.test.ts` | Add tests for `findRecipeLineNumber` returning `undefined` |
| `src/test/suite/npmTaskProvider.test.ts` | Add test for startLine remaining undefined when script not in file |
| `docs/features/codelens.md` | Add note about right-click platform limitation; update supported providers table |

---

## 4. Test Plan

### 4.1 `FavoritesService` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| F01 | `addToFavorites` fires `onDidChangeFavorites` | Event is emitted |
| F02 | `removeFromFavorites` fires `onDidChangeFavorites` | Event is emitted |
| F03 | `removeFromFavorites` on non-favorite does not fire event | Event is NOT emitted |
| F04 | `updateFavoriteId` fires `onDidChangeFavorites` when old ID exists | Event is emitted |
| F05 | `updateFavoriteId` with non-existent old ID does not fire event | Event is NOT emitted |

### 4.2 `TaskCodeLensProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| T35 | `onDidChangeFavorites` fires → `_onDidChangeCodeLenses` fires | Invalidation emitted |
| T36 | Two tasks with same label and startLine (different taskType) → only one set of lenses | Single lens row generated |
| T37 | Two tasks with same startLine, different labels → two separate lens rows | Two lens rows generated |
| T38 | One visible task `startLine = undefined` → no lenses | Returns `[]` |
| T39 | Deduplication applies independently to visible and hidden tasks | Only first duplicate kept in each group |

### 4.3 `gitlabCiTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| GL01 | Job name found at column 0 in `.gitlab-ci.yml` | `startLine` matches line index |
| GL02 | Job name not found in file | `startLine === undefined` |
| GL03 | Job name found inside a nested YAML key (e.g., `script`) | NOT matched (pattern anchors to column 0) |

### 4.4 `justfileTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| J01 | Recipe name found in file → returns line index | Correct line returned |
| J02 | Recipe name not found in file → returns `undefined` | `undefined` returned |
| J03 | Recipe with `@` prefix in file → found correctly | Correct line returned |
| J04 | Recipe with parameters (`build target:`) → found | Correct line returned |
| J05 | `createRecipeTaskItem` with `line = undefined` → `item.startLine` is `undefined` | `undefined` set |
| J06 | `createRecipeTaskItem` with `line = undefined` → `openFileAtLine` arg uses `0` | Fallback `0` used |

### 4.5 `npmTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| N01 | Script not found in `package.json` content → `startLine` remains `undefined` | `undefined` |
| N02 | Script not in JSON at all → `startLine` remains `undefined` | `undefined` |

---

## 5. Documentation

### 5.1 `docs/features/codelens.md` — additions

- Add a **Known Limitations** section:
  > **Right-click behavior:** Due to a VS Code platform constraint, right-clicking
  > on a CodeLens action item triggers the action in addition to (or instead of)
  > showing the context menu. This cannot be changed from the extension side. Track
  > [microsoft/vscode#XXXXX](https://github.com/microsoft/vscode/issues) for updates.

- Update the **Supported task types** table to reflect improved coverage:
  - `gitlabCiTaskProvider`: mark as ✅ (text-scan, may be `undefined` for non-root keys)

### 5.2 `README.md` — no changes required (feature already documented)

---

## 6. Open Questions for Rubber Duck Review

- **OQ1**: Is the `(startLine, label)` deduplication key sufficient, or should we also
  include `taskFileUri` in the key? (Scoped to `provideCodeLenses` which is per-document,
  so different files are already impossible — `taskFileUri` is redundant.)

- **OQ2**: Should the GitLab CI text scan also handle YAML anchors/aliases
  (`&anchor: *alias`)? (Out of scope for this fix; the simple column-0 scan is a
  substantial improvement over always-0.)

- **OQ3**: For `FavoritesService.dispose()` — the emitter should be disposed when the
  service is torn down. The service is a singleton with no current `dispose()` method.
  Should we add one, or just let it be GC'd? (Suggest adding a `dispose()` method to
  avoid memory leaks in tests.)
