# Bug Report: Script Files (With or Without Shebang) Have No CodeLens Items

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Shell Script provider

---

## Bug Description

Script files (`.sh`, `.py`, `.ps1`, `.rb`, `.pl`, `.bat`, `.cmd`, `.fish`, `.zsh`, `.nu`, `.js`, `.mjs`) that are discovered as tasks by the `ShellTaskProvider` do not display any CodeLens items in the editor. This affects both files with and without a shebang line.

---

## Steps to Reproduce

1. Open a workspace containing script files (e.g., `deploy.sh`, `build.py`, `run.ps1`).
2. Ensure the scripts are configured or discoverable as shell tasks.
3. Open a script file in the editor.
4. Observe that no CodeLens items (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) appear at the top of the file.

---

## Expected Behavior

CodeLens items should appear at line 0 (the top of the file) for each script file that is registered as a runnable task. Since a script file represents a single task (the script itself), the CodeLens item should appear at line 0.

---

## Actual Behavior

No CodeLens items appear for script files in the editor.

---

## Task Type

- [x] Shell Scripts

---

## Root Cause

`ShellTaskProvider` creates `TaskItem` objects for each discovered script file but never sets `item.startLine`. The `TaskCodeLensProvider` requires `isLeafTask(t) && t.startLine !== undefined` to show CodeLens items. Since `startLine` is always `undefined` for shell task items, no CodeLens items are generated.

Because each script file represents exactly one task (the whole file), `startLine = 0` is the correct and only appropriate value — the CodeLens should appear at the top of the file.

---

## Environment

- Extension: Workspace Tasks
- Provider: `shellTaskProvider.ts`
- Files: `*.sh`, `*.py`, `*.ps1`, `*.rb`, `*.pl`, `*.bat`, `*.cmd`, etc.

---

## Additional Context

The fix is minimal: set `item.startLine = 0` in the `createShellTaskItem()` method (or equivalent item creation logic) within `shellTaskProvider.ts`.
