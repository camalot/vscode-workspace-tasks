# Bug Report: Bitbucket Pipelines File Has No CodeLens or Editor Action Bar Items

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Editor Action Bar, Bitbucket Pipelines provider

---

## Bug Description

When a `bitbucket-pipelines.yml` file is open in the editor, neither CodeLens inline action items nor editor title bar run buttons (▶️ Run | ⏯️ Run with Args) are displayed. Tasks defined in the file are discoverable in the Workspace Tasks tree view, but cannot be run directly from the file editor.

---

## Steps to Reproduce

1. Open a workspace containing a `bitbucket-pipelines.yml` file with pipeline step definitions.
2. Open `bitbucket-pipelines.yml` in the editor.
3. Observe that no CodeLens items appear above any pipeline step definitions.
4. Observe that the editor title bar shows no run action buttons (▶️ or ⏯️).
5. Verify that tasks DO appear in the Workspace Tasks tree view (discovery works).

---

## Expected Behavior

- CodeLens items (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) should appear above each named pipeline step definition.
- The editor title bar should show ▶️ and ⏯️ action buttons when a `bitbucket-pipelines.yml` file is active.

---

## Actual Behavior

- No CodeLens items appear in the `bitbucket-pipelines.yml` editor.
- No editor action bar buttons appear.

---

## Task Type

- [x] Bitbucket Pipelines

---

## Root Cause

`BitbucketPipelinesTaskProvider` never sets `startLine` on any `TaskItem`. The `TaskCodeLensProvider` requires `isLeafTask(t) && t.startLine !== undefined` to show CodeLens items. Since `startLine` is always `undefined` for bitbucket tasks, no CodeLens items are generated. Similarly, since no tasks have `startLine` set and the editor action bar relies on tasks being discoverable as "runnable for file", the editor bar buttons do not appear.

The YAML is currently parsed without position/location tracking, so line numbers for step definitions are not available from the parsed object.

---

## Environment

- Extension: Workspace Tasks
- Provider: `bitbucketPipelinesTaskProvider.ts`
- File: `bitbucket-pipelines.yml`

---

## Additional Context

A fix requires setting `startLine` on step-level `TaskItem`s. Options include:
1. Using a YAML parser with location tracking (e.g. `yaml.parseDocument` with source tokens).
2. Performing a text-search fallback to find `name: <stepName>` lines in the raw file content.
3. As a minimal fix, setting `startLine = 0` for all steps would enable CodeLens at the top of the file.
