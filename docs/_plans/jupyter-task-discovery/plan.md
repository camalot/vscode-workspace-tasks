# Plan: Jupyter Notebook Task Discovery (I7)

**Status:** Final (post rubber-duck review)
**Area:** Task Discovery / Jupyter provider

---

## 1. Rubber-Duck Review Summary

The draft was reviewed by a sub-agent. The critique confirmed the core approach and clarified the platform limitation framing.

| Issue | Severity | Resolution |
|---|---|---|
| **C1** "Platform-impossible" framing is too absolute; should be "current architecture limitation" | Low | Adopted — documentation wording updated to "not supported with current VS Code API surface for text-based CodeLens" |
| **C2** Large `.ipynb` files could impact discovery performance | Low | Acknowledged — file size guard already present in `jupyterTaskProvider.ts`; no change needed |
| **C3** Malformed notebook JSON should fail gracefully | Medium | Reviewed — `parseNotebookFile` already wraps in try/catch; no change needed |
| **C4** Separate discovery capability from execution capability flags | Medium | Adopted — documented explicitly: discovery always runs; execution requires Jupyter extension |
| **C5** No tests for discovery without Jupyter extension | Medium | Adopted — added T04 to test plan |
| **C6** Deferred: notebook-level action surface | Informational | Confirmed deferred |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Add provider metadata "capability flags" for CodeLens vs. discovery | Out of scope for this fix; could be a future enhancement to the provider interface |

---

## 2. Platform Limitation

`.ipynb` files open as **VS Code Notebook documents** (`vscode.NotebookDocument`), not as `TextDocument`s. This means:

- `provideCodeLenses` is **never called** for notebook files — the `CodeLensProvider` API is text-editor specific.
- `vscode.window.onDidChangeActiveTextEditor` does **not** fire when a notebook becomes active.
- `workspaceTasks.activeFileIsRunnableTask` context key is **never set** for notebooks.
- The editor title bar action buttons **cannot** appear for notebook documents.

This is a limitation of the current VS Code API surface for text-based CodeLens and editor actions, not a fundamental impossibility. A future enhancement could use `vscode.window.onDidChangeActiveNotebookEditor` with a separate context key and editor contributions. See §7 (Deferred).

---

## 3. Discovery Issue

`JupyterTaskProvider.getTasks()` returns `[]` if `jupyter.runcell` is not available:

```typescript
const command = await ExecutableService.getInstance().getVscodeCommand('jupyter.runcell', extensionId);
if (!command) {
  return [];
}
```

This conflates **discovery** (parsing `.ipynb` files to find cells) with **execution** (needing the Jupyter extension to run them). If the Jupyter extension loads after the extension activates (or is not installed), no tasks are ever discovered.

---

## 4. Proposed Fix

### 4.1 Decouple Discovery from Extension Availability

Move the `jupyter.runcell` command availability check to the **execution** path, not the discovery path:

**File:** `src/providers/jupyterTaskProvider.ts`

```typescript
public async getTasks(): Promise<TaskItem[]> {
  if (!TaskConfigService.getInstance().isTaskTypeEnabled(this.type)) {
    return [];
  }

  // Discovery does not require the Jupyter extension.
  // Execution (createTask via taskFactory.ts) will check for the command at runtime.
  const tasks: TaskItem[] = [];
  const filesService = TaskFilesService.getInstance();
  const files = await filesService.findFiles([constants.GLOB_JUPYTER]);

  for (const file of files) {
    try {
      const content = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(content).toString('utf8');
      const fileTasks = this.parseNotebookFile(file, text);
      if (fileTasks) {
        tasks.push(fileTasks);
      }
    } catch (e) {
      this.logger.warn(`[JupyterTaskProvider] Error reading ${file.fsPath}:`, e);
    }
  }
  return tasks;
}
```

The `taskFactory.ts` `'jupyter'` case already uses `CustomExecution` which runs at execution time — it will call `jupyter.runcell` only when the user actually runs the task. If the extension is not installed at that point, the execution will fail with an appropriate error message.

### 4.2 Set `startLine` on Cell Items (Correctness)

Cell items already have `taskFileUri` set (via the 4th constructor parameter). Add `item.startLine = 0` for completeness — CodeLens won't fire for notebook files, but having `startLine` set is harmless and future-proof:

```typescript
item.startLine = 0; // Notebooks don't support text CodeLens; 0 is safe placeholder
```

---

## 5. Implementation

**File:** `src/providers/jupyterTaskProvider.ts`

1. Remove the `getVscodeCommand` guard from `getTasks()`.
2. Add per-file try/catch around file reads (if not already present).
3. Set `item.startLine = 0` in `parseNotebookFile` cell item creation.

---

## 6. Testing Plan

| Test | Description |
|---|---|
| T01 | `parseNotebookFile` returns a parent item + task items for each code cell |
| T02 | `parseNotebookFile` skips markdown cells |
| T03 | Cell items have correct `taskFileUri` set to the notebook URI |
| T04 | `getTasks()` returns tasks even when `jupyter.runcell` command is NOT available |
| T05 | Cell items have correct `cellIndex` in `metadata` |
| T06 | Cell items have `startLine = 0` |
| T07 | Malformed `.ipynb` JSON → `parseNotebookFile` returns `undefined` (no crash) |

---

## 7. Documentation Plan

Add a note to the Jupyter task type documentation (or update if it exists):

**File:** `docs/task-types/jupyter.md` (create if not present)

Content:
- Jupyter notebook cell tasks are discoverable in the Workspace Tasks tree view.
- Task execution requires the `ms-toolsai.jupyter` extension.
- The editor action bar buttons (▶️, ⏯️) are **not supported** for `.ipynb` files due to VS Code API limitations — use the tree view to run cells.
- CodeLens inline actions are **not supported** for `.ipynb` files (same reason).

---

## 8. Deferred: Notebook-Specific Action Surface

A future enhancement could add notebook-aware action buttons:
1. Subscribe to `vscode.window.onDidChangeActiveNotebookEditor`.
2. Set a new context key `workspaceTasks.activeNotebookIsRunnableTask`.
3. Register separate `editor/title` menu contributions for notebook context.
4. Map "run cell" at notebook cell level via `vscode.NotebookCellStatusBarItemProvider`.

This is deferred as a separate enhancement tracked separately.
