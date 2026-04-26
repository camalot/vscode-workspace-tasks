# Plan: Jupyter Notebook Task Discovery (I7)

**Status:** Draft (pre rubber-duck review)
**Area:** Task Discovery / Jupyter provider

---

## 1. Overview

Jupyter `.ipynb` notebook cell tasks are not discovered by the extension (or discovery conditionally fails), and the editor action bar cannot show for notebook files due to a VS Code platform limitation.

---

## 2. Known Platform Limitation

`.ipynb` files open as **VS Code Notebook documents** (`vscode.NotebookDocument`), not as `TextDocument`s. This means:

- `provideCodeLenses` is **never called** for notebook files — CodeLens is a text-editor concept.
- `vscode.window.onDidChangeActiveTextEditor` does **not** fire when a notebook file becomes active.
- `workspaceTasks.activeFileIsRunnableTask` context key is **never set** for notebook files.
- The editor title bar action buttons **cannot** appear for notebook documents.

**CodeLens and the editor action bar are structurally impossible for `.ipynb` files** with the current VS Code API surface. This is a platform limitation, not a code bug.

---

## 3. Actual Discovery Issue

The `JupyterTaskProvider.getTasks()` method returns `[]` if the command `jupyter.runcell` is not available:

```typescript
const command = await ExecutableService.getInstance().getVscodeCommand('jupyter.runcell', extensionId);
if (!command) {
  return [];
}
```

This guard requires the `ms-toolsai.jupyter` extension to be installed AND the `jupyter.runcell` command to be registered. If the extension is installed but not yet activated (e.g., on startup before the Jupyter extension initializes), tasks would not be discovered.

---

## 4. Proposed Fixes

### 4.1 Decouple Discovery from Jupyter Extension Availability

**Change:** Do not gate task discovery on the `jupyter.runcell` command being available at discovery time. Instead:
1. Always parse `.ipynb` files and build the task item tree.
2. Only block **execution** (via `createTask` in `taskFactory.ts`) if the Jupyter extension is not available.

This ensures tasks appear in the tree view regardless of Jupyter extension activation order.

**File:** `src/providers/jupyterTaskProvider.ts`

```typescript
// Remove or move the command availability check:
// const command = await ExecutableService.getInstance().getVscodeCommand('jupyter.runcell', extensionId);
// if (!command) { return []; }

// Instead, check during execution in taskFactory.ts 'jupyter' case
```

### 4.2 Document the Editor Action Bar Limitation

Since the editor action bar cannot work for `.ipynb` files (VS Code platform limitation), add a note to the documentation making it clear that Jupyter task execution is tree-view only.

### 4.3 Set `taskFileUri` on Notebook Items (Correctness)

Cell items in the provider already receive the notebook `uri` as the 4th constructor parameter (which sets `taskFileUri`). This is already correct but should be verified by tests.

---

## 5. Implementation Plan

**File:** `src/providers/jupyterTaskProvider.ts`

1. Remove the `getVscodeCommand` availability check from `getTasks()`.
2. Move the command availability check to the execution path in `taskFactory.ts` (the `'jupyter'` case already uses `CustomExecution` which will fail gracefully if the command is unavailable).
3. Ensure `item.startLine` is set to the cell's source position within the notebook. Since `.ipynb` is JSON, this would be line 0 for all cells (notebook editor doesn't use CodeLens anyway).

---

## 6. Testing Plan

| Test | Description |
|---|---|
| T01 | `parseNotebookFile` returns task items for all code cells |
| T02 | `parseNotebookFile` skips markdown cells |
| T03 | Task items have correct `taskFileUri` set to the notebook URI |
| T04 | `getTasks()` returns tasks even when `jupyter.runcell` command is unavailable |
| T05 | Task items have correct `cellIndex` in `metadata` |

---

## 7. Documentation Plan

Add a note to the Jupyter task type documentation explaining:
- Tasks are run from the Workspace Tasks tree view.
- The editor action bar is not available for `.ipynb` files (VS Code platform limitation).
- The `ms-toolsai.jupyter` extension must be installed for task execution to work.

**File:** `docs/task-types/jupyter.md` (create if not present)

---

## 8. Deferred Items

- **Notebook-specific action bar:** A future enhancement could use `vscode.window.onDidChangeActiveNotebookEditor` to set a separate context key (e.g., `workspaceTasks.activeNotebookIsRunnableTask`) and register separate editor title contributions with `when: workspaceTasks.activeNotebookIsRunnableTask`. This would require separate commands. Deferred to a future enhancement.
