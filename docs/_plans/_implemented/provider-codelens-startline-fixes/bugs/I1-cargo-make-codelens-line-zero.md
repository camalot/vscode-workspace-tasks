# Bug Report: Cargo-Make Makefile.toml CodeLens Items All on Line 0

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, cargo-make provider

---

## Bug Description

All CodeLens items for `Cargo-Make` (`Makefile.toml`) tasks appear on line 0 (the first line of the file), regardless of where the actual task definitions are located in the file. When multiple tasks are defined in a `Makefile.toml`, every task's CodeLens actions (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) pile up at the top of the file rather than appearing above each individual task definition.

---

## Steps to Reproduce

1. Open a workspace containing a `Makefile.toml` file with multiple cargo-make task definitions.
2. Open `Makefile.toml` in the editor.
3. Observe that all CodeLens items appear at the top of the file (line 0) rather than above each task's `[tasks.task-name]` section header.

---

## Expected Behavior

Each task's CodeLens actions should appear immediately above the `[tasks.task-name]` table header that defines that task, mirroring the behavior of other TOML-based task providers.

---

## Actual Behavior

All CodeLens items are rendered on line 0 regardless of the actual location of task definitions in the file.

---

## Task Type

- [x] Cargo-Make (cargo-make)

---

## Root Cause

`CargoMakeTaskProvider` extends `TomlTaskProvider`. The line-finding logic in `TomlTaskProvider.findScriptLine()` uses the regex:

```
/^\s*("|')?scriptName("|')?\s*=/i
```

This matches `key = value` style TOML entries. Cargo-make tasks are defined as TOML table headers:

```toml
[tasks.my-task]
command = "echo hello"
```

The regex never matches `[tasks.my-task]` style headers, so `findScriptLine` returns `0` (the sentinel fallback) for every task → every CodeLens item is placed at line 0.

---

## Environment

- Extension: Workspace Tasks
- Provider: `cargoMakeTaskProvider.ts` / `tomlTaskProvider.ts`
- File: `Makefile.toml`

---

## Additional Context

The fix requires `TomlTaskProvider.findScriptLine()` (or an override in `CargoMakeTaskProvider`) to also match the TOML table header pattern `[tasks.taskName]` when looking up task line numbers.
