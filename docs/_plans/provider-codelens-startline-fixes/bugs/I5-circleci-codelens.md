# Bug Report: CircleCI Config File Has No CodeLens or Editor Action Bar Items

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Editor Action Bar, CircleCI provider

---

## Bug Description

When a CircleCI configuration file (`.circleci/config.yml` or `.circleci/config.yaml`) is open in the editor, neither CodeLens inline action items nor editor title bar run buttons (▶️ Run | ⏯️ Run with Args) are displayed. Tasks defined in the file may be discoverable in the Workspace Tasks tree view, but cannot be run directly from the file editor.

---

## Steps to Reproduce

1. Open a workspace containing a `.circleci/config.yml` file with job definitions.
2. Open `.circleci/config.yml` in the editor.
3. Observe that no CodeLens items appear above job definitions.
4. Observe that the editor title bar shows no run action buttons (▶️ or ⏯️).

---

## Expected Behavior

- CodeLens items (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) should appear above each job definition in the CircleCI config file.
- The editor title bar should show ▶️ and ⏯️ action buttons when a `.circleci/config.yml` file is active.

---

## Actual Behavior

- No CodeLens items appear in the CircleCI config file editor.
- No editor action bar buttons appear.

---

## Task Type

- [x] CircleCI

---

## Root Cause

Investigation needed. The `circleCiTaskProvider.ts` does set `startLine` on job items via `this.findKeyLine(lines, jobName)`. However, the editor action bar and CodeLens are not displaying. Possible root causes include:

1. Job items are nested under workflow and jobs-group items in the provider's tree structure. It needs to be verified that these nested items are correctly processed into `TaskCacheService.fileTaskMap` with the correct `taskFileUri`.
2. The `findKeyLine` helper finds the **first** occurrence of `${jobName}:` in the entire file. A job name may appear in multiple places (e.g., in the `jobs:` definitions section AND in workflow `jobs:` reference lists), so the first match may be the wrong location.
3. The `workspaceTasks.activeFileIsRunnableTask` context key may not be set correctly for CircleCI files.

---

## Environment

- Extension: Workspace Tasks
- Provider: `circleCiTaskProvider.ts`
- File: `.circleci/config.yml` or `.circleci/config.yaml`

---

## Additional Context

Additional information may be needed to confirm the exact failure mode. Please provide:
- The Output panel log (View → Output → Workspace Tasks) when opening a CircleCI config file
- Whether tasks DO appear in the Workspace Tasks tree view (to confirm discovery works)
- The VS Code version and OS
