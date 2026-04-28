---
layout: default
title: 🤖 Language Model Tools
parent: 🚀 Features
nav_order: 10
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Language Model Tools (`#wTasks` / `#runWTask`)
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

Workspace Tasks exposes two language model tools that let GitHub Copilot (and other VS Code
LM-powered agents) discover and run tasks directly from the chat interface — no manual browsing
of the task tree required.

| Tool | Reference name | Purpose |
| --- | --- | --- |
| `workspaceTasks_getTasks` | `#wTasks` | List all runnable tasks in the workspace |
| `workspaceTasks_runTask` | `#runWTask` | Execute a specific workspace task |

---

## Overview

### `#wTasks` — Get Workspace Tasks

Returns a JSON array of every runnable task discovered by Workspace Tasks, including tasks found
in `package.json`, `Taskfile.yml`, GitHub Actions workflows, shell scripts, and every other
supported task type. Each entry contains:

- `id` — stable portable identifier (use this with `#runWTask`)
- `label` — human-readable task name
- `type` — task type (e.g. `npm`, `shell`, `github-actions`)
- `source` — relative path to the source file (or `null` for global tasks)
- `workspaceFolder` — name of the workspace folder (multi-root workspaces only)

Optional input parameters allow the model to filter results before they are returned:

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | `string` | Case-insensitive label substring filter |
| `taskType` | `string` | Task type filter (e.g. `npm`, `shell`) |

### `#runWTask` — Run Workspace Task

Executes a workspace task. The tool shows a confirmation dialog before running any task, so you
remain in control. When the task is marked as [guarded](run-guard), the confirmation message
includes a warning.

> ⚠️ **Asynchronous execution**: The tool returns immediately after starting the task. It does
> not wait for the task to finish and does not report completion status.

Required inputs (at least one of `id` or `label` must be provided):

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string` | Stable task ID from `#wTasks`. **Preferred** — avoids ambiguity. |
| `label` | `string` | Task label. May match multiple tasks. |
| `taskType` | `string` | Narrows label-based matches to a specific type. |

---

## Typical Workflow

1. Ask Copilot to list your tasks: *"What tasks are available in this workspace?"*
2. Copilot invokes `#wTasks` and returns a structured list with IDs.
3. Ask Copilot to run a specific task: *"Run the `build` npm task."*
4. Copilot invokes `#runWTask` with the stable `id` from step 2.
5. VS Code shows a confirmation dialog. After you approve, the task starts.

---

## Example Prompts

```text
Which tasks are available in this workspace?
```

```text
Run the build task.
```

```text
Find all npm tasks in the project.
```

```text
Run the deploy task in the my-app workspace folder.
```

```text
What shell script tasks do I have?
```

---

## Response Schemas

### `#wTasks` response

```json
{
  "isTrusted": true,
  "isLoading": false,
  "tasks": [
    {
      "id": "npm:build:package.json",
      "label": "build",
      "type": "npm",
      "source": "package.json",
      "workspaceFolder": "my-app"
    }
  ],
  "truncated": false,
  "totalBeforeTruncation": 1
}
```

When `isLoading` is `true`, the task cache is still being populated — re-invoke after a short
delay. When `truncated` is `true`, apply `query` or `taskType` filters to narrow results (the
maximum returned is 500 tasks).

### `#runWTask` response

```json
{
  "started": true,
  "message": "Task 'build' has been started. It runs asynchronously; completion is not reported here.",
  "task": {
    "id": "npm:build:package.json",
    "label": "build",
    "type": "npm",
    "source": "package.json"
  }
}
```

When `started` is `false`, the `message` field explains why (e.g. guarded task declined,
ambiguous label match, task not found). A `candidates` array is included when multiple tasks
match the provided label.

---

## Task Lookup Priority

When calling `#runWTask`, the tool resolves the target task in this order:

1. **By `id`** (exact, O(1) lookup) — preferred and most reliable.
2. **By `label`** (exact case-insensitive match) — narrowed by `taskType` if provided.
3. If no exact match, the tool returns a `candidates` list with a *"Did you mean...?"* message
   rather than running an unintended task.

Always use `#wTasks` first to obtain a stable `id`, then pass that `id` to `#runWTask`.

---

## Guarded Tasks

Tasks protected by a [Run Guard](run-guard) are handled safely:

- The confirmation dialog shown before execution includes a ⚠️ warning when the task is guarded.
- The user must explicitly confirm before the task runs.
- If the tool is invoked programmatically (without a prior confirmation dialog), the run-guard
  modal is triggered automatically.

---

## Limitations

- **Asynchronous execution**: `#runWTask` returns immediately after starting the task. There
  is no way to query task completion status through the LM tool interface.
- **500-task cap**: `#wTasks` returns at most 500 tasks per invocation. Use `query` and
  `taskType` filters to retrieve a focused list.
- **Untrusted workspaces**: Both tools are disabled in
  [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust). The tools
  return an explanatory message and take no action.
- **Task ID stability**: Task IDs encode the type, label, and source file path. They remain
  stable as long as the source file is not moved or renamed.
- **`taskType` with `id`**: When a task is located by `id`, the `taskType` parameter is ignored.
  It is only used to disambiguate label-based matches.
