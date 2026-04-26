# Plan: CodeLens Bug Fixes & Enhancements

**Status:** Final (post rubber-duck review)
**Branch:** v1.10.2
**Area:** Editor / CodeLens

---

## 1. Rubber-Duck Review Summary

The initial draft was reviewed by a sub-agent which identified 13 issues incorporated
into this revised plan:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** Test suite stub lacks `onDidChangeFavorites` — all 33+ existing CodeLens tests crash | Critical | Stub updated to include `onDidChangeFavorites` handler array; new handler array `_onDidFavChangeHandlers` added in test setup |
| **C2** Fire event in `save()` once rather than duplicating across three callers | High | Adopted — `_onDidChangeFavorites.fire()` moved into `save()` |
| **C3** `FavoritesService` singleton never disposes its `EventEmitter` | High | Adopted — `dispose()` added to `FavoritesService`; service registered with `context.subscriptions` in `extension.ts` |
| **C4** Deduplication applied after visible/hidden split allows cross-partition duplicates | High | Adopted — dedup applied to `locatedTasks` *before* split |
| **C5** "First provider in alphabetical order" claim is incorrect — actual order is registration order | Medium | Adopted — documentation corrected to "first-registered provider" |
| **C6** GitLab CI scan pattern `^name\s*:` collides with reserved top-level YAML keys (`image`, `stages`, etc.) | High | Adopted — reserved key exclusion set added; keys matching reserved names return `undefined` |
| **C7** Second `startLine = 0` occurrence belongs to `BunTaskProvider`, not `NpmTaskProvider` | Medium | Adopted — both class boundaries explicitly identified in §2.3 |
| **C8** `githubActionsTaskProvider.ts` line 230 `workflowItem.startLine = 0` silently ignored by I3 | Medium | Adopted — explicitly excluded in §2.3 with documented rationale |
| **C9** Inner-loop no-match path in npm is already correct but untested | Low | Adopted — test N03 added |
| **C10** Right-click limitation has an extension-side partial mitigation that the draft dismisses | Medium | Partially adopted — plan now acknowledges the workaround and explains the design choice to reject it for this version |
| **C11** `createRecipeTaskItem` `arguments: [file, line]` must be `[file, line ?? 0]` — exact location not cited | High | Adopted — explicit file/line reference added to §2.5 |
| **C12** Group `TaskItem` `onOpenActionCommand` also receives raw `line` (`undefined` possible after fix) | Medium | Adopted — documented in §2.5; implementation must guard `line ?? 0` |
| **C13** I3 is a prerequisite for I2; applying I2 alone collapses genuine line-0 tasks with fallback-0 tasks | High | Adopted — sequencing requirement added to §5; implementation order: I3 → I2 → I1 |

---

## 2. Overview of Issues

This plan addresses five issues discovered after the initial CodeLens implementation
(see [`docs/_plans/codelens-provider/plan.md`](../codelens-provider/plan.md)):

| # | Issue | Severity |
|---|---|---|
| I1 | `"Remove from Favorites"` CodeLens does not refresh after the action executes | High |
| I2 | Multiple enabled providers (npm/bun/pnpm/yarn) each emit duplicate CodeLens buttons for the same task definition in a shared file | High |
| I3 | Providers that cannot determine task line positions set `startLine = 0`, causing all their tasks to stack at the top of the file in CodeLens | High |
| I4 | Right-clicking a CodeLens action triggers the action (VS Code platform behavior) | Low |
| I5 | `justfileTaskProvider` falls back to line 0 for recipes not found in the current file scan (e.g., imported recipes) | Medium |

**Implementation sequence:** I3 → I5 → I2 → I1. I3 and I5 must land before I2 to
avoid the deduplication incorrectly collapsing a genuine line-0 task with a
fallback-0 task from another provider. See §5.

---

## 3. Background

### 3.1 Relation to the Prior CodeLens Plan

The original CodeLens plan (v1.10.1) correctly filtered tasks using
`t.startLine !== undefined`. However several providers fell through this check by
setting `startLine = 0` as a sentinel instead of leaving it `undefined`. The correct
convention is: `undefined` means "line not known"; `0` means "first line of file".
This plan enforces that convention.

### 3.2 FavoritesService Has No Change Event

`FavoritesService` was designed before CodeLens and has no `EventEmitter`. The tree
view triggers its own refresh via `TaskTreeDataProvider.refreshLocal()` after every
favorite mutation; the CodeLens has no equivalent trigger, causing stale labels.

---

## 4. Issue Analysis

### 4.1 I1 — Favorites CodeLens Not Refreshing

**Root cause:** `TaskCodeLensProvider` subscribes to `TaskCacheService.onDidUpdate`,
`FilteredTaskService.onDidChange`, `vscode.workspace.onDidChangeConfiguration`, and
`TaskStateManager.onDidStateChange`. It does **not** subscribe to any
`FavoritesService` signal.

When a task is added or removed from favorites (via either the CodeLens command or the
tree view), `FavoritesService.save()` persists the change but no
`_onDidChangeCodeLenses` event is fired. The lens keeps showing the stale label.

Note (confirmed **not** a bug): The `TaskItem` argument passed from CodeLens to the
`removeFromFavorites` command is passed by reference within the extension host. The
`item.id` string survives; `getTaskId(item)` returns the correct portable ID and the
deletion succeeds. The problem is purely the missing invalidation signal.

**Fix:**

1. Add `private readonly _onDidChangeFavorites = new vscode.EventEmitter<void>()`
   and `public readonly onDidChangeFavorites = this._onDidChangeFavorites.event` to
   `FavoritesService`.

2. Move the fire call into `save()` (C2 fix — centralised, future-proof):
   ```typescript
   private save() {
     this.context?.workspaceState.update(this.STORAGE_KEY, Array.from(this.favorites));
     this._onDidChangeFavorites.fire();
   }
   ```
   *`save()` is the single code path that writes to storage; firing here guarantees
   the event is emitted exactly when and only when persistence happens.*

3. Add `dispose(): void { this._onDidChangeFavorites.dispose(); }` to
   `FavoritesService` (C3 fix). Register the singleton with context subscriptions in
   `extension.ts`:
   ```typescript
   context.subscriptions.push(FavoritesService.getInstance());
   ```

4. Subscribe in `TaskCodeLensProvider` constructor:
   ```typescript
   FavoritesService.getInstance().onDidChangeFavorites(() =>
     this._onDidChangeCodeLenses.fire()
   ),
   ```

5. Update the `FavoritesService` stub in `taskCodeLensProvider.test.ts` to include
   the `onDidChangeFavorites` handler (C1 fix):
   ```typescript
   let _onDidFavChangeHandlers: Array<() => void> = [];
   // inside setup():
   (FavoritesService as any).instance = {
     isFavorite: (id: string | TaskItem) => stubIsFavorite(id),
     onDidChangeFavorites: (handler: () => void) => {
       _onDidFavChangeHandlers.push(handler);
       return { dispose: () => {} };
     },
   };
   ```

---

### 4.2 I2 — Duplicate CodeLens Buttons from Multiple Providers

**Root cause:** `TaskCacheService.fileTaskMap` accumulates tasks from **all** enabled
providers for a given file URI. A `package.json` with npm, bun, pnpm, and yarn all
enabled produces 4 × (number of scripts) `TaskItem` entries, all at the same
`startLine` values. `provideCodeLenses` iterates all entries without deduplication,
producing one lens row per `TaskItem` per line.

**Prerequisite:** I3 and I5 must land first (C13 fix). Without them, tasks with fake
`startLine = 0` from some providers would be wrongly merged with genuine first-line
tasks from other providers during deduplication, silently replacing the correct `TaskItem`
with an incorrectly-located one.

**Fix:** Apply deduplication to `locatedTasks` *before* the visible/hidden split
(C4 fix) using a `(startLine, label)` key:

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

Applied as:

```typescript
// Deduplicate before split: multiple providers (e.g. npm, bun, pnpm, yarn) all
// index the same file and emit tasks with identical (startLine, label) tuples.
// Keep the first occurrence, which comes from the first-registered provider (C5 fix).
const locatedUnique = this._deduplicateByLine(
  allTasks.filter((t) => isLeafTask(t) && t.startLine !== undefined),
);

const visibleTasks = locatedUnique.filter(
  (t) => !filteredService.isFilteredOrHasFilteredParent(t),
);
const hiddenTasks = showHidden
  ? locatedUnique.filter((t) => filteredService.isFilteredOrHasFilteredParent(t))
  : [];
```

*The retained task is from the **first-registered provider** in `TaskProviderRegistry`
insertion order, not alphabetical order (C5 correction).*

---

### 4.3 I3 — Line-0 Tasks Polluting CodeLens

**Root cause:** Several providers explicitly set `startLine = 0` as a fallback when
the actual line number cannot be determined. The convention should be: use `undefined`
for "unknown" and reserve `0` for "confirmed first line of file."

Providers and occurrences:

| Provider | Location | Context |
|---|---|---|
| `gitlabCiTaskProvider.ts` | ~line 149 | `jobItem.startLine = 0; // --list-json does not emit line numbers` |
| `npmTaskProvider.ts` | ~line 114 | `NpmTaskProvider.getSystemTasks()` else branch |
| `npmTaskProvider.ts` | ~line 406 | `BunTaskProvider.getSystemTasks()` else branch (C7 fix) |

Excluded:
- **`githubActionsTaskProvider.ts` line 230** `workflowItem.startLine = 0`: This is
  the workflow-level *group* `TaskItem` with `TreeItemCollapsibleState.Collapsed`.
  `isLeafTask()` returns `false` for it, so it is already excluded from CodeLens by
  the `locatedTasks` filter. No change is needed (C8 fix).

**Fix — `gitlabCiTaskProvider.ts`:**

Remove `jobItem.startLine = 0;`. Add a text-scan helper to locate job names at column
0 in the YAML file:

```typescript
// Known GitLab CI reserved top-level YAML keys (never job names)
private static readonly GITLAB_RESERVED_KEYS = new Set([
  'image', 'services', 'stages', 'types', 'before_script', 'after_script',
  'variables', 'cache', 'default', 'workflow', 'include',
]);

private findJobLineNumber(lines: string[], jobName: string): number | undefined {
  if (GitlabCiTaskProvider.GITLAB_RESERVED_KEYS.has(jobName)) {
    return undefined; // C6 fix: reserved key cannot be a job definition line
  }
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) { return i; }
  }
  return undefined;
}
```

Read the file content once per file (not per job) and pass lines in:

```typescript
const content = (await vscode.workspace.openTextDocument(fileUri)).getText();
const lines = content.split(/\r?\n/);
// ...
for (const entry of entries) {
  // ...
  jobItem.startLine = this.findJobLineNumber(lines, entry.name);
  // startLine is undefined when not found → no CodeLens for this job
  jobItem.onOpenActionCommand = {
    command: 'workspaceTasks.openFileAtLine',
    title: 'Open File',
    arguments: [fileUri, jobItem.startLine ?? 0],
  };
}
```

**Fix — `npmTaskProvider.ts`:**

In `NpmTaskProvider.getSystemTasks()` (around line ~110–115):
- Remove `item.startLine = 0;` from the `else` branch
  (script not found in content/JSON → `startLine` stays `undefined`)

In `BunTaskProvider.getSystemTasks()` (around line ~400–410):
- Remove `item.startLine = 0;` from the `else` branch
  (same: `startLine` stays `undefined`)

---

### 4.4 I4 — Right-Click Triggering CodeLens Action

**Finding:** In VS Code, the CodeLens renderer fires the attached command on any
`mousedown` event on the CodeLens widget, regardless of which mouse button is pressed.
This is a VS Code core behavior; the `vscode.CodeLensProvider` API has no mechanism to
filter by mouse button.

**Extension-side mitigation considered and rejected (C10):** It is technically possible
to register zero-argument wrapper commands that, when invoked without a `TaskItem`
argument (as would happen from a right-click context menu), read the active editor
cursor position and resolve the task from the cache or show a QuickPick. However:
- This changes the left-click UX as well (wrapping every action in an extra resolution
  step or QuickPick round-trip).
- The root cause is in VS Code's renderer, not in the extension.
- VS Code may fix this in a future release.

**Resolution:** Document as a VS Code platform limitation. File a VS Code issue at
https://github.com/microsoft/vscode/issues if one does not already exist. Update
`docs/features/codelens.md` with a Known Limitations section.

---

### 4.5 I5 — Justfile Recipe Line Detection Fallback

**Root cause:** `findRecipeLineNumber` returns `0` when a recipe name cannot be found
in the file's text lines. This occurs for recipes that originate from an `import`ed
file (e.g., `import 'shared.just'`), because `just --dump --dump-format json` merges
all imported recipes into the root namespace. The recipe body lives in `shared.just`,
not in the main `justfile`, so the text scan finds no match and silently falls back
to `0`.

The regex `^@?${escaped}(?:\s|:|$)` is otherwise correct for justfile syntax,
handling: `recipe-name:`, `@recipe-name:` (quiet prefix), `recipe-name param:` (with
parameters), and recipes preceded by `[attribute]` lines on prior lines.

**Fix:**

Change `findRecipeLineNumber` return type to `number | undefined`:

```typescript
private findRecipeLineNumber(lines: string[], recipeName: string): number | undefined {
  const escaped = recipeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^@?${escaped}(?:\\s|:|$)`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) { return i; }
  }
  return undefined; // Not found in this file (e.g., recipe lives in an imported file)
}
```

Update `createRecipeTaskItem` signature and body (C11 + C12 fix — explicit `?? 0` for
`openFileAtLine` argument):

```typescript
private createRecipeTaskItem(
  recipe: JustRecipe,
  file: vscode.Uri,
  iconPath: unknown,
  line: number | undefined,   // ← was: number
): TaskItem {
  // ...
  item.startLine = line;          // undefined → task excluded from CodeLens
  item.onOpenActionCommand = {
    command: 'workspaceTasks.openFileAtLine',
    title: 'Open File',
    arguments: [file, line ?? 0], // fallback to top-of-file for open action (C11/C12)
  };
```

Similarly, group-level `TaskItem`s built in the `groupsEnabled` path already use their
own `onOpenActionCommand` referencing the file only (no line). They have
`TreeItemCollapsibleState.Collapsed` and are excluded from CodeLens by `isLeafTask()`.
No change needed for group items (C12 confirmed benign).

---

## 5. Implementation Sequence

| Step | Issue | Rationale |
|---|---|---|
| 1 | I3 (gitlabCi, npm/bun providers) | Eliminates fake `startLine = 0` in providers; required before I2 |
| 2 | I5 (justfile provider) | Eliminates `findRecipeLineNumber` fallback `0`; required before I2 |
| 3 | I2 (dedup in CodeLens provider) | Safe after I3+I5: all `startLine = 0` values are now genuine |
| 4 | I1 (FavoritesService event) | Independent; last to minimise test-stub changes needed |
| 5 | I4 (docs only) | No code change |

---

## 6. File Changes

| File | Change |
|---|---|
| `src/services/favoritesService.ts` | Add `_onDidChangeFavorites` EventEmitter; fire in `save()`; add `dispose()` |
| `src/taskCodeLensProvider.ts` | Subscribe to `onDidChangeFavorites`; add `_deduplicateByLine`; apply dedup to `locatedTasks` before visible/hidden split |
| `src/providers/gitlabCiTaskProvider.ts` | Remove `startLine = 0`; add `findJobLineNumber` with reserved-key guard; update `onOpenActionCommand` to use `?? 0` |
| `src/providers/npmTaskProvider.ts` | Remove `startLine = 0` fallback in `NpmTaskProvider.getSystemTasks()` and `BunTaskProvider.getSystemTasks()` |
| `src/providers/justfileTaskProvider.ts` | Change `findRecipeLineNumber` return type; update `createRecipeTaskItem` |
| `src/extension.ts` | Register `FavoritesService.getInstance()` with `context.subscriptions` |
| `src/test/suite/favoritesService.test.ts` | Add tests F01–F05 for `onDidChangeFavorites` event; add `dispose()` coverage |
| `src/test/suite/taskCodeLensProvider.test.ts` | Add `onDidChangeFavorites` stub; add tests T35–T39 |
| `src/test/suite/gitlabCiTaskProvider.test.ts` | Add tests GL01–GL04 |
| `src/test/suite/justfileTaskProvider.test.ts` | Add tests J01–J06 |
| `src/test/suite/npmTaskProvider.test.ts` | Add tests N01–N03 |
| `docs/features/codelens.md` | Add **Known Limitations** section; update supported providers table |

---

## 7. Test Plan

All new code targets **100% line and branch coverage**.

### 7.1 `FavoritesService` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| F01 | `addToFavorites` → `save()` fires `onDidChangeFavorites` | Event emitted |
| F02 | `removeFromFavorites` on a favorited task fires `onDidChangeFavorites` | Event emitted |
| F03 | `removeFromFavorites` on a non-favorited task does NOT fire event (no save) | Event NOT emitted |
| F04 | `updateFavoriteId` with known old ID fires `onDidChangeFavorites` | Event emitted |
| F05 | `updateFavoriteId` with unknown old ID does NOT fire event | Event NOT emitted |
| F06 | `dispose()` disposes the `_onDidChangeFavorites` emitter | Emitter disposed |

### 7.2 `TaskCodeLensProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| T35 | `onDidChangeFavorites` fires → `_onDidChangeCodeLenses` fires | Invalidation emitted |
| T36 | Two tasks with same label and startLine (different taskType) → only one lens row at that line | Single deduplicated row |
| T37 | Two tasks with same startLine, different labels → two separate lens rows | Two rows |
| T38 | Task has `startLine = undefined` → not included in CodeLens | Returns `[]` |
| T39 | Deduplication applied before visible/hidden split: one task visible, its duplicate filtered (hidden) → only the visible task gets a lens row | Single row (visible) |

### 7.3 `gitlabCiTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| GL01 | Job name found at column 0 in YAML content | `startLine` matches line index |
| GL02 | Job name not found in content | `startLine === undefined` |
| GL03 | Job name matches a reserved key (e.g., a job named `"image"`) | Returns `undefined` (reserved key guard) |
| GL04 | Job name found inside nested YAML (indented, not column-0) | NOT matched; returns `undefined` |

### 7.4 `justfileTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| J01 | Recipe found in file → returns correct line index | Correct line |
| J02 | Recipe not in file (e.g., from import) → returns `undefined` | `undefined` |
| J03 | Recipe with `@` quiet prefix (`@build:`) → found | Correct line |
| J04 | Recipe with parameters (`build target:`) → found | Correct line |
| J05 | `createRecipeTaskItem` with `line = undefined` → `item.startLine` is `undefined` | `undefined` |
| J06 | `createRecipeTaskItem` with `line = undefined` → `onOpenActionCommand` arg uses `0` | `0` as fallback |

### 7.5 `npmTaskProvider` tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| N01 | `NpmTaskProvider`: script JSON key not found in content → `startLine` is `undefined` | `undefined` |
| N02 | `BunTaskProvider`: same scenario | `undefined` |
| N03 | `NpmTaskProvider`: script found in JSON but label not found by substring scan (inner-loop no-match) → `startLine` is `undefined` (already correct, new test to confirm) | `undefined` |

---

## 8. Documentation

### 8.1 `docs/features/codelens.md` — additions

Add a **Known Limitations** section:

> **Right-click behavior:** Due to a VS Code platform constraint, right-clicking on a
> CodeLens action item may trigger the action in addition to opening the context menu.
> The `vscode.CodeLensProvider` API provides no way to distinguish which mouse button
> was pressed. An extension-side workaround (zero-argument command + QuickPick
> resolution from cursor position) was considered but not implemented in this version
> because it would also change the left-click experience. This will be reconsidered if
> VS Code exposes mouse-button information in a future API revision.

Update the **Supported task types** table:
- `gitlabCiTaskProvider`: change from "❌ Missing" to "⚠️ Partial — text scan; reserved-key names return `undefined`"

### 8.2 `docs/configuration/general.md` — no changes required

---

## 9. Resolved Design Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where to fire `onDidChangeFavorites`? | Inside `save()` — single authoritative code path |
| D2 | Should `FavoritesService` get `dispose()`? | Yes — registered with `context.subscriptions` in `extension.ts` to properly clean up the EventEmitter |
| D3 | Dedup before or after visible/hidden split? | Before — eliminates cross-partition duplicates |
| D4 | What is the dedup key? | `${startLine}\|${label}` — sufficient within a single document; `taskFileUri` is redundant (scoped per document) |
| D5 | I4 right-click: fix or document? | Document — no API surface to intercept; wrapper-command workaround rejected as it alters left-click UX |
| D6 | GitLab CI reserved keys: hardcoded list or heuristic? | Hardcoded set of well-known keys — stable, explicit, no runtime cost |
| D7 | Implementation order? | I3 → I5 → I2 → I1 — required sequencing per C13 |
