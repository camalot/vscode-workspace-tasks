# Plan: Universal File-Level Run Action

**Status:** Draft
**Branch:** v1.10.1
**Area:** Task Execution / Editor Title Bar

---

## 1. Objective

Extend the editor title bar **Run Task** / **Run Task with Args** buttons to work for **all**
discovered task file types — not just `shell` and `github-actions`. When the active editor file
has one or more non-hidden registered tasks, the title bar action buttons appear. If the file has
multiple tasks, a `QuickPick` selector lets the user choose which task to run.

Extract the shared task-selection logic into a reusable utility (`src/libs/taskQuickPick.ts`)
so both commands share one implementation and future consumers can import it.

---

## 2. Background

### 2.1 Current Behaviour

The extension currently shows editor title bar **Run** / **Run with Args** buttons only for
`shell` script files and `github-actions` workflow files. This restriction is enforced by:

```typescript
// src/libs/constants.ts
RUNNABLE_TASK_TYPES: Object.freeze(new Set(['shell', 'github-actions'])) as ReadonlySet<string>,
```

The constant is checked in three places:

| File | Usage |
|------|-------|
| `src/services/editorTaskActionService.ts` | `isRunnableFile()` — sets context key |
| `src/commands/runActiveEditorTask.ts` | Filters tasks before run/pick |
| `src/commands/runActiveEditorTaskWithArgs.ts` | Filters tasks before run/pick |

### 2.2 Problem

The extension now supports 30+ task types (npm, make, gradle, rake, taskfile, cmake, etc.). Users
must navigate to the task tree to run tasks for file types other than shell/github-actions. This
is poor UX: opening `package.json` should let you run any npm script directly from the title bar,
just as opening a `.sh` file lets you run it.

Additionally, the QuickPick task-selection logic is **duplicated** in both command files
(`pickTask()` protected method) and needs to be extracted.

### 2.3 How the Title Bar Currently Works

1. `EditorTaskActionService.initialize()` subscribes to editor change events.
2. On each editor change (debounced 75 ms), `isRunnableFile(uri)` is called.
3. `isRunnableFile()` calls `TaskCacheService.getTasksForFile(uri)`, filters by
   `RUNNABLE_TASK_TYPES`, and sets the `workspaceTasks.activeFileIsRunnableTask` context key.
4. `package.json` contributes two `editor/title` menu items gated on
   `workspaceTasks.activeFileIsRunnableTask`.
5. When clicked, `RunActiveEditorTaskCommand` / `RunActiveEditorTaskWithArgsCommand` calls
   `getTasksForFile()`, filters by `RUNNABLE_TASK_TYPES`, and either runs the single task or
   shows a `QuickPick` for multiple.

### 2.4 `TaskCacheService.getTasksForFile()` Structure

`getTasksForFile(uri)` returns **all items** registered to the given file URI from
`fileTaskMap`. This includes both parent/group items (from hierarchical providers like
`github-actions`) and leaf items. The `fileTaskMap` and `taskMap` hold the **same object
references** — items returned by `getTasksForFile()` are already the live cached objects, so no
secondary `getTask(id)` lookup is needed.

### 2.5 `isLeafTask()` Utility

`src/tools/taskToolsUtils.ts` exports:

```typescript
export function isLeafTask(item: TaskItem): boolean {
  return item.collapsibleState === vscode.TreeItemCollapsibleState.None || item.task !== undefined;
}
```

A node is a runnable leaf when it has no children (most common) **or** when it carries a native
`vscode.Task` (e.g. a compound task that also exposes an individual run target). This function
should be used — not a bare `collapsibleState === None` check — to correctly include runnable
compound task nodes.

---

## 3. Design

### 3.1 New Utility: `src/libs/taskQuickPick.ts`

Exports two functions. This is the single source of truth for file-level task selection.

#### `getRunnableTasksForFile(uri: vscode.Uri): TaskItem[]`

Returns all non-hidden, runnable leaf tasks for a given file URI.

```typescript
/**
 * Returns the runnable (non-hidden, leaf-level) tasks for a given file URI.
 * A task is considered runnable when isLeafTask() returns true and it is not
 * filtered (hidden) by the user.
 *
 * Returns [] when:
 *  - uri is undefined or scheme is not 'file'
 *  - workspace is not trusted
 *  - no tasks are registered for the file
 *  - all registered tasks are hidden
 */
export function getRunnableTasksForFile(uri: vscode.Uri | undefined): TaskItem[] {
  if (!uri || uri.scheme !== 'file') {
    return [];
  }
  if (!vscode.workspace.isTrusted) {
    return [];
  }
  const all = TaskCacheService.getInstance().getTasksForFile(uri);
  const filteredService = FilteredTaskService.getInstance();
  return all.filter(
    (t) => isLeafTask(t) && !filteredService.isFilteredOrHasFilteredParent(t),
  );
}
```

**Filtering notes:**
- `isLeafTask(t)` excludes group/folder/type container nodes returned by hierarchical providers.
- `isFilteredOrHasFilteredParent(t)` excludes tasks explicitly hidden by the user AND tasks whose
  provider-set parent is hidden. For flat providers (npm, make, etc.) task items have no `.parent`
  set, so this check only tests the task itself — see §9 (Known Limitations) for details.
- Both `fileTaskMap` and `taskMap` in `TaskCacheService` hold the same object references, so items
  returned here are already live cached objects; callers do **not** need a secondary `getTask(id)`
  lookup.

#### `pickTaskFromList(tasks: TaskItem[], options?: { placeHolder?: string }): Promise<TaskItem | undefined>`

Shows a `vscode.window.showQuickPick` and returns the selected task.

```typescript
/**
 * Shows a QuickPick for selecting among multiple tasks.
 *
 * @param tasks     Non-empty list of candidate TaskItems.
 * @param options   Optional display options. placeHolder defaults to 'Select a task to run'.
 * @returns         The selected TaskItem, or undefined if the user cancelled.
 */
export async function pickTaskFromList(
  tasks: TaskItem[],
  options?: { placeHolder?: string },
): Promise<TaskItem | undefined> {
  const picks: TaskQuickPickItem[] = tasks.map((t) => ({
    label: (t.originalLabel ?? t.label ?? '') as string,
    description: t.taskType,
    detail: t.taskFileUri?.fsPath,
    taskItem: t,
  }));
  const selection = await vscode.window.showQuickPick(picks, {
    placeHolder: options?.placeHolder ?? 'Select a task to run',
  });
  return selection?.taskItem;
}
```

### 3.2 Remove `RUNNABLE_TASK_TYPES` from `src/libs/constants.ts`

The constant is replaced by the `getRunnableTasksForFile()` utility, which makes the restriction
dynamic (all non-hidden leaf tasks for any registered file type). Remove it entirely — keeping it
as dead code would mislead future maintainers. The version bump in the changelog documents the
removal.

### 3.3 Modify `src/services/editorTaskActionService.ts`

Replace the `RUNNABLE_TASK_TYPES` filter with a call to `getRunnableTasksForFile()`:

**Before:**
```typescript
import constants from '../libs/constants';
// ...
public isRunnableFile(uri: vscode.Uri | undefined): boolean {
  if (!uri || uri.scheme !== 'file') { return false; }
  if (!vscode.workspace.isTrusted) { return false; }
  const tasks = TaskCacheService.getInstance().getTasksForFile(uri);
  return tasks.some(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));
}
```

**After:**
```typescript
import { getRunnableTasksForFile } from '../libs/taskQuickPick';
// ...
public isRunnableFile(uri: vscode.Uri | undefined): boolean {
  return getRunnableTasksForFile(uri).length > 0;
}
```

The workspace-trust check and URI scheme check are now inside `getRunnableTasksForFile()`, so the
outer guard is no longer needed. The `TaskCacheService` import is also no longer needed directly.

### 3.4 Modify `src/commands/runActiveEditorTask.ts`

**Changes:**
1. Replace inline `RUNNABLE_TASK_TYPES` filter with `getRunnableTasksForFile()`.
2. Remove secondary `getTask(item.id)` lookup (items from `getRunnableTasksForFile()` are already
   live cached objects).
3. Keep the `protected async pickTask()` method but delegate it to `pickTaskFromList()`, passing
   the filename as the `placeHolder`. This preserves the testable subclass pattern used by existing
   tests.
4. Remove the duplicated `TaskQuickPickItem` interface.

**Before (key sections):**
```typescript
const allTasks = TaskCacheService.getInstance().getTasksForFile(uri);
const tasks = allTasks.filter(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));
// ...
if (item.id) {
  const cached = TaskCacheService.getInstance().getTask(item.id);
  if (cached) { item = cached; }
}
// ...
protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
  // 10 lines of duplicate QuickPick code
}
```

**After:**
```typescript
import { getRunnableTasksForFile, pickTaskFromList } from '../libs/taskQuickPick';
// ...
const tasks = getRunnableTasksForFile(uri);
// No secondary getTask() lookup needed
// ...
protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
  const fileName = path.basename(uri.fsPath);
  return pickTaskFromList(tasks, { placeHolder: `Select a task to run from ${fileName}` });
}
```

### 3.5 Modify `src/commands/runActiveEditorTaskWithArgs.ts`

Same changes as §3.4. The `pickTask()` method delegates to `pickTaskFromList()` with an
appropriate placeholder.

---

## 4. Files to Modify

| File | Change |
|------|--------|
| `src/libs/constants.ts` | Remove `RUNNABLE_TASK_TYPES` |
| `src/libs/taskQuickPick.ts` | **Create** — new shared utility |
| `src/services/editorTaskActionService.ts` | Use `getRunnableTasksForFile()`; remove constants import |
| `src/commands/runActiveEditorTask.ts` | Use `getRunnableTasksForFile()`; delegate `pickTask()` to `pickTaskFromList()`; remove duplicate interface; remove secondary `getTask()` call |
| `src/commands/runActiveEditorTaskWithArgs.ts` | Same as above |

---

## 5. Files to Add / Update (Tests)

| File | Action | Description |
|------|--------|-------------|
| `src/test/suite/taskQuickPick.test.ts` | **Create** | 100% coverage of both exported functions |
| `src/test/suite/editorTaskActionService.test.ts` | **Update** | Replace shell-only assertions; add npm/hidden task assertions |
| `src/test/suite/runActiveEditorTask.test.ts` | **Update** | Update task-type assertions; remove secondary `getTask` expectations |
| `src/test/suite/runActiveEditorTaskWithArgs.test.ts` | **Update** | Same pattern |

---

## 6. Test Strategy

### 6.1 `taskQuickPick.test.ts` — `getRunnableTasksForFile()`

| Scenario | Input | Expected |
|----------|-------|----------|
| `undefined` URI | `undefined` | `[]` |
| Non-file:// URI | `workspace-tasks://foo` | `[]` |
| Workspace not trusted | `isTrusted = false` | `[]` |
| No tasks for file | `getTasksForFile → []` | `[]` |
| All tasks are parent/group items | 2 items with `collapsibleState === Collapsed` | `[]` |
| All tasks hidden | 2 leaf tasks, both `isFilteredOrHasFilteredParent → true` | `[]` |
| Single visible leaf | 1 leaf + 1 parent + 1 hidden leaf | `[visible leaf]` |
| Multiple visible leaves | 3 npm tasks, none hidden | `[task1, task2, task3]` |
| Compound task with `item.task` set | `collapsibleState === Collapsed` but `item.task !== undefined` | Included (isLeafTask returns true) |
| Parent hidden propagates to child via `.parent` chain | child.parent.id is in filtered set | `[]` |

### 6.2 `taskQuickPick.test.ts` — `pickTaskFromList()`

| Scenario | Setup | Expected |
|----------|-------|----------|
| User cancels | `showQuickPick → undefined` | `undefined` |
| User selects task | `showQuickPick → picks[1]` | `tasks[1]` |
| Label uses `originalLabel` when set | item has `originalLabel = 'My Task'` | Pick label is `'My Task'` |
| Label falls back to `label` | item has no `originalLabel` | Pick label is `item.label` |
| Description is `taskType` | item.taskType = `'npm'` | `description === 'npm'` |
| Detail is `taskFileUri.fsPath` | item has `taskFileUri` | `detail === uri.fsPath` |
| Detail is `undefined` when no `taskFileUri` | item has no `taskFileUri` | `detail === undefined` |
| Custom `placeHolder` is forwarded | options.placeHolder = `'Pick one'` | `showQuickPick` called with `{ placeHolder: 'Pick one' }` |
| Default `placeHolder` | no options | `showQuickPick` called with `{ placeHolder: 'Select a task to run' }` |

### 6.3 Updates to `editorTaskActionService.test.ts`

**Tests to remove or update:**
- Any test asserting `isRunnableFile` returns `false` solely because the task type is `npm` or
  `make` (these will now be runnable).

**Tests to add:**
| Scenario | Expected |
|----------|----------|
| npm task in package.json (not hidden) | `isRunnableFile → true` |
| Single task but it is hidden | `isRunnableFile → false` |
| Mixed: 1 hidden + 1 visible leaf | `isRunnableFile → true` |
| Parent-only items for file (no leaves) | `isRunnableFile → false` |

### 6.4 Updates to `runActiveEditorTask.test.ts`

**Tests to remove:**
- `'run — no matching tasks for file returns early'` — currently uses an npm task item and asserts
  `runTaskCalls.length === 0`. After this change, npm tasks ARE runnable. Either update the test
  to assert the npm task DOES run, or rename to test a genuinely empty scenario.
- `'run — only non-runnable task types returns early'` — asserts make and npm are not runnable.
  Replace with a test using only hidden tasks or parent-only items.

**Tests to add:**
| Scenario | Expected |
|----------|----------|
| npm task in package.json | Runs without QuickPick (single task) |
| make task in Makefile (hidden) | Returns early (no runnable tasks) |
| 3 npm tasks, user picks task 2 | `pickTask()` called, runs task 2 |
| No secondary `getTask()` call needed | `getTask` is NOT called after `getRunnableTasksForFile()` |

**Note on `TestableRunActiveEditorTaskCommand`:** This subclass is KEPT. The `protected pickTask()`
method now delegates to `pickTaskFromList()`, but the test subclass can still override it to inject
a preset result — preserving the existing test pattern.

### 6.5 Updates to `runActiveEditorTaskWithArgs.test.ts`

Same pattern as §6.4.

---

## 7. Rubber Duck Review — Feedback Summary and Decisions

The plan was reviewed by a sub-agent. Feedback items and decisions:

| # | Issue | Severity | Decision |
|---|-------|----------|----------|
| 1 | Use `isLeafTask()` instead of bare `collapsibleState === None` | HIGH | **Implement.** `isLeafTask()` already exists in `taskToolsUtils.ts` and correctly handles compound-task nodes that carry a `vscode.Task`. |
| 2 | Document that `getTasksForFile()` returns both parents and children | HIGH | **Document** in code comment inside `getRunnableTasksForFile()`. Tests explicitly verify parent exclusion. |
| 3 | Flat-provider hidden-parent gap | HIGH | **Document as known limitation** (§9). Fixing this would require architectural changes to either set `.parent` on flat items or add type-level filter tracking in `FilteredTaskService`. Out of scope. |
| 4 | Double `getTask()` lookup is redundant | HIGH | **Remove.** `fileTaskMap` and `taskMap` hold the same object references. No secondary lookup needed. |
| 5 | Workspace trust inside utility | MEDIUM | **Implement.** Move all validation (`uri`, `scheme`, `isTrusted`) into `getRunnableTasksForFile()`. Commands do not re-validate. |
| 6 | Missing test: empty input → empty output | MEDIUM | **Implement.** Explicitly listed in §6.1 test table. |
| 7 | URI validation redundancy in commands | MEDIUM | **Implement.** Commands remove their own URI/scheme check; defer entirely to `getRunnableTasksForFile()`. |
| 8 | VSCode type tasks may create duplicate execution paths | MEDIUM | **Accept and document.** The user's request says "all task files registered / discovered." `.vscode/tasks.json` is a registered file. Including these tasks is consistent with the goal. Risk noted in §9. |
| 9 | Performance: `isFilteredOrHasFilteredParent` per-item on editor change | MEDIUM | **Accept.** The 75 ms debounce limits frequency. Task counts per file are small in practice. No additional caching added in this plan. |
| 10 | Removing `protected pickTask()` breaks testable subclass pattern | MEDIUM | **Do not remove.** Keep `protected pickTask()` in both commands, delegating to `pickTaskFromList()`. The existing `TestableRunActiveEditorTaskCommand` pattern is preserved. |
| 11 | QuickPick placeholder lacks context | MEDIUM | **Implement.** Pass `placeHolder: \`Select a task to run from ${filename}\`` via `pickTaskFromList()`'s optional options parameter. |
| 12 | Test update sequence unspecified | MEDIUM | **Implement.** TDD sequence defined in §10. |
| 13 | Documentation: `hide-tasks.md` not mentioned | LOW | **Implement.** Add note to `hide-tasks.md` about the known limitation. |
| 14 | Keep `RUNNABLE_TASK_TYPES` as historical artifact | LOW | **Reject.** Dead constants mislead maintainers. The change is documented in the changelog. |
| 15 | Compound task test coverage | LOW | **Implement.** Explicit compound-task test case added to §6.1. |
| 16 | Workspace-task leaf inclusion | MEDIUM | **Include.** Workspace-task leaf items (from `.workspace-tasks.json`) should appear in the QuickPick — these are user-defined runnable tasks. |
| 17 | URI normalization edge case | LOW | **Accept.** `getTasksForFile()` uses `uri.toString()` as the key. Callers use the same normalization path. No additional tests needed. |

---

## 8. Documentation Updates

| File | Change |
|------|--------|
| `docs/features/running-tasks.md` | Update "Editor Title Bar" section: list all task types as supported; update QuickPick description to note file-specific placeholder |
| `docs/features/hide-tasks.md` | Add note: hiding a TYPE group in the tree view does not suppress the editor title bar buttons for files of that type (see §9) |

---

## 9. Known Limitations

### 9.1 Flat-Provider Hidden-Parent Gap

For task types that produce flat task lists (npm, make, gradle, rake, etc.), individual task items
have no `.parent` property set — the tree-level TYPE group is a UI construct, not a TaskItem
parent. Consequently, if a user hides the "npm" TYPE group in the tree view, individual npm tasks
in `package.json` will still be included by `getRunnableTasksForFile()` and the editor title bar
buttons will still appear.

Fixing this limitation would require either:
- Setting `.parent` on every flat task item to point to its type-group TaskItem (architectural
  change, cross-provider impact), or
- Adding type-level filter tracking to `FilteredTaskService` (separate feature).

This is documented in `hide-tasks.md`.

### 9.2 VSCode Native Task Duplicate Path

Tasks from `.vscode/tasks.json` (type `vscode`) can already be run via VS Code's own Command
Palette (`Tasks: Run Task`). Showing them in the extension's editor title bar QuickPick creates
a second path to the same execution. This is intentional — consistency outweighs the minor
duplication risk — but may surprise users who expect only "custom" tasks in the QuickPick.

---

## 10. Implementation Sequence (TDD)

> **Order matters:** constants.ts is changed last to avoid breaking existing tests
> before the replacement code is in place.

1. **Create `src/libs/taskQuickPick.ts`** with both functions.
2. **Create `src/test/suite/taskQuickPick.test.ts`** — all tests for `getRunnableTasksForFile()`
   and `pickTaskFromList()`. Run `npm test` — tests must **pass** (green from the start since
   the utility is already created).
3. **Update `src/test/suite/editorTaskActionService.test.ts`** — add npm-runnable and
   hidden-task assertions. Tests for the new assertions will **fail** until step 4.
4. **Update `src/services/editorTaskActionService.ts`** — use `getRunnableTasksForFile()`.
   Run `npm test` — new assertions pass.
5. **Update `src/test/suite/runActiveEditorTask.test.ts`** — update/remove task-type assertions,
   remove secondary `getTask()` expectations. Tests for new assertions will **fail** until step 6.
6. **Update `src/commands/runActiveEditorTask.ts`** — use `getRunnableTasksForFile()`, delegate
   `pickTask()` to `pickTaskFromList()`, remove secondary `getTask()`.
7. **Update `src/test/suite/runActiveEditorTaskWithArgs.test.ts`** — same as step 5.
8. **Update `src/commands/runActiveEditorTaskWithArgs.ts`** — same as step 6.
9. **Remove `RUNNABLE_TASK_TYPES` from `src/libs/constants.ts`**. Run `npm test` — all tests pass.
10. **Run full test suite** `npm test`. Verify 100% coverage on `taskQuickPick.ts` with
    `npm run vscode:test:coverage`.
11. **Update documentation** (`running-tasks.md`, `hide-tasks.md`).

---

## 11. Acceptance Criteria

- [ ] `taskQuickPick.ts` is created and exports `getRunnableTasksForFile` and `pickTaskFromList`.
- [ ] `getRunnableTasksForFile` uses `isLeafTask()` from `taskToolsUtils.ts`.
- [ ] `getRunnableTasksForFile` includes workspace-trust and URI scheme guards internally.
- [ ] `RUNNABLE_TASK_TYPES` is removed from `constants.ts`.
- [ ] `editorTaskActionService.ts` uses `getRunnableTasksForFile()` with no secondary filter.
- [ ] Both command files delegate `pickTask()` to `pickTaskFromList()` and remove the secondary
      `getTask()` lookup.
- [ ] Opening `package.json` in a workspace with npm tasks shows the title bar Run buttons.
- [ ] Opening `package.json` with 3 npm tasks shows a QuickPick with 3 items.
- [ ] Hidden tasks do not appear in the title bar or QuickPick.
- [ ] `taskQuickPick.test.ts` has 100% coverage of both exported functions.
- [ ] All existing tests continue to pass (`npm test`).
- [ ] `docs/features/running-tasks.md` and `docs/features/hide-tasks.md` are updated.
