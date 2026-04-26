# Bug Report: Jupyter .ipynb File Tasks Are Not Discovered

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** Task Discovery, Jupyter provider, Editor Action Bar

---

## Bug Description

Tasks (notebook cells) from Jupyter `.ipynb` files are not discovered by the extension, and the editor action bar (▶️ Run | ⏯️ Run with Args) does not appear when a notebook file is active. The Workspace Tasks tree view shows no Jupyter tasks even when `.ipynb` files are present in the workspace.

---

## Steps to Reproduce

1. Open a workspace containing one or more `.ipynb` Jupyter notebook files.
2. Verify the `ms-toolsai.jupyter` extension is installed in VS Code.
3. Open the Workspace Tasks panel and look for Jupyter tasks.
4. Observe that no Jupyter notebook cell tasks appear.
5. Open a `.ipynb` file in the editor.
6. Observe that the editor title bar shows no ▶️ or ⏯️ action buttons.

---

## Expected Behavior

- Code cells from `.ipynb` files should be discoverable as tasks in the Workspace Tasks tree view (when the Jupyter extension is installed).
- The editor action bar should show run buttons when a notebook's task file is active.

---

## Actual Behavior

- No Jupyter tasks are shown in the Workspace Tasks tree view.
- The editor action bar buttons do not appear.

---

## Task Type

- [x] Other/General (Jupyter)

---

## Error Messages / Logs

Please check the Output panel (View → Output → Workspace Tasks) for any messages related to Jupyter task discovery.

---

## Environment

- Extension: Workspace Tasks
- Provider: `jupyterTaskProvider.ts`
- File: `*.ipynb`

---

## Additional Context

**Known limitation:** `.ipynb` files open as VS Code Notebook documents (not `TextDocument`s). The `workspaceTasks.activeFileIsRunnableTask` context key and the `TaskCodeLensProvider` only work with `TextEditor` instances. Therefore:

- The editor title action bar buttons **cannot** appear when a notebook file is open in the notebook editor (VS Code platform limitation).
- CodeLens items **cannot** be provided for notebook documents via the `vscode.CodeLensProvider` API.

The root cause of task non-discovery likely relates to the provider's dependency on the `ms-toolsai.jupyter` extension. The provider returns `[]` if the command `jupyter.runcell` is not available (i.e., the extension is not installed or not activated).

Please confirm:
1. Is the `ms-toolsai.jupyter` extension installed and enabled?
2. Are the `.ipynb` files in the workspace root or a subdirectory?
3. Are there any error messages in the Workspace Tasks output log?
