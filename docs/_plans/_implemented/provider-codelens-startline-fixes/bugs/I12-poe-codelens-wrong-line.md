# Bug Report: Poe Task CodeLens Items Appear After the Task Definition Line

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Poe provider

---

## Bug Description

Poe the Poet task CodeLens items appear on the line **after** the task definition rather than above it. For example:

```toml
[tool.poe.tasks]
# Simple command tasks
test = "pytest tests/ -v"
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears on the NEXT line
test-quick = "pytest -m 'not slow'"
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears on the NEXT line
```

The CodeLens items should appear **above** `test = "pytest tests/ -v"`, not after it.

---

## Steps to Reproduce

1. Open a workspace with a `pyproject.toml` containing a `[tool.poe.tasks]` section with multiple tasks.
2. Open `pyproject.toml` in the editor.
3. Observe that CodeLens items appear **below** each task definition, not above it.

---

## Expected Behavior

```toml
[tool.poe.tasks]
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears ABOVE test
test = "pytest tests/ -v"
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears ABOVE test-quick
test-quick = "pytest -m 'not slow'"
```

---

## Actual Behavior

```toml
[tool.poe.tasks]
test = "pytest tests/ -v"
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears BELOW test (wrong)
test-quick = "pytest -m 'not slow'"
▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites    ← appears BELOW test-quick (wrong)
```

---

## Task Type

- [x] Other/General (Poe the Poet)

---

## Root Cause

`PoeTaskProvider.findTaskLineInContent()` returns `i + 1` (1-based line number) when the task definition is found at index `i`. However, VS Code's `Range` constructor uses **0-based** line numbers. This causes an off-by-one error where:

- Task at array index 2 → `startLine = 3` → CodeLens appears at line index 3 (the line AFTER the task definition).

The function should return `i` (0-based) instead of `i + 1`.

---

## Environment

- Extension: Workspace Tasks
- Provider: `poeTaskProvider.ts`
- File: `pyproject.toml`

---

## Additional Context

This is the same root cause as I11 (line 0 fallback issue). Both are fixed by changing `return i + 1` to `return i` throughout `findTaskLineInContent()`. The fix also applies to the table-header syntax check: `[tool.poe.tasks.taskname]`.
