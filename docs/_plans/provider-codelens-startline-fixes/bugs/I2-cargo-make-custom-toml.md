# Bug Report: cargo-make custom.toml Has No CodeLens or Editor Action Bar Items

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Editor Action Bar, cargo-make provider

---

## Bug Description

When using `cargo-make` with a `custom.toml` configuration file (a valid cargo-make override file), neither CodeLens items nor editor action bar buttons appear in the editor. Tasks defined in `custom.toml` are not discovered by the extension.

---

## Steps to Reproduce

1. Open a workspace that uses cargo-make with a `custom.toml` file defining task overrides.
2. Open `custom.toml` in the editor.
3. Observe that no CodeLens items (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) appear.
4. Observe that the editor title bar shows no run action buttons.
5. Verify that tasks from `custom.toml` do not appear in the Workspace Tasks tree view.

---

## Expected Behavior

`custom.toml` files should be discovered and treated as cargo-make task files. Tasks defined in `custom.toml` should appear in the task tree, and CodeLens/editor action bar items should appear when the file is open.

---

## Actual Behavior

`custom.toml` is completely ignored by the extension. No tasks are discovered, no CodeLens items appear, and no editor action bar buttons are shown.

---

## Task Type

- [x] Cargo-Make (cargo-make)

---

## Root Cause

`CargoMakeTaskProvider.getGlobPatterns()` returns only `['**/[Mm]akefile.toml']`. The cargo-make tool also supports a `custom.toml` file for per-user or environment-specific task overrides. This file is never included in the glob patterns, so it is never discovered by `TaskFilesService.findFiles()`.

---

## Environment

- Extension: Workspace Tasks
- Provider: `cargoMakeTaskProvider.ts`
- File: `custom.toml`

---

## Additional Context

Cargo-make documentation states that `custom.toml` is an accepted configuration file. The glob pattern `'**/custom.toml'` should be added to `CargoMakeTaskProvider.getGlobPatterns()`. Note that `custom.toml` is a fairly common filename — the fix should consider whether this glob is too broad or should be scoped to prevent matching unrelated `custom.toml` files in other projects.
