# Bug Report: Poe Task Codelens Items Added at Line 0

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Poe provider

---

## Bug Description

Some Poe the Poet (`pyproject.toml`) task CodeLens items appear at line 0 (the top of the file) instead of above the actual task definition. This occurs for tasks where `findTaskLineInContent` returns `0` as a fallback value.

---

## Steps to Reproduce

1. Open a workspace with a `pyproject.toml` file containing `[tool.poe.tasks]` section.
2. Open `pyproject.toml` in the editor.
3. Observe that some (or all) CodeLens items appear at line 0 rather than next to the task definition.

---

## Expected Behavior

Each CodeLens item should appear immediately above the line where the task is defined in `pyproject.toml`.

---

## Actual Behavior

Some CodeLens items appear at line 0 (top of file) when the task definition line cannot be found or when the off-by-one error in `findTaskLineInContent` causes incorrect line calculation.

---

## Task Type

- [x] Other/General (Poe the Poet)

---

## Root Cause

`PoeTaskProvider.findTaskLineInContent()` returns `i + 1` (1-based line number) but VS Code's `Range` and `startLine` use **0-based** line numbers. This creates an off-by-one error where:
- A task on line index 2 (3rd line) gets `startLine = 3` → CodeLens appears on line 4 (index 3), one line below the actual task.

When a task is not found, the function returns `0`, which also applies when the `[tool.poe.tasks]` section header itself is never found.

---

## Environment

- Extension: Workspace Tasks
- Provider: `poeTaskProvider.ts`
- File: `pyproject.toml`

---

## Additional Context

This is related to I12 (wrong line) — both stem from the same off-by-one bug in `findTaskLineInContent`. The fix requires changing `return i + 1` to `return i` throughout the function.
