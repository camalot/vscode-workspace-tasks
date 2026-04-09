---
layout: default
title: 🔗 VSCode Compound Tasks
parent: 🚀 Features
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# VSCode Compound Tasks
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Compound tasks are a native Visual Studio Code feature that let you wire multiple tasks together using the `dependsOn` property in your `tasks.json` file. Workspace Tasks fully supports compound tasks and adds smarter stop controls so that the entire task chain can be stopped with a single action.

A compound task itself has no execution (no `command`). Instead, it specifies one or more dependency tasks via `dependsOn`. When you run the compound task, VS Code automatically runs the listed dependencies — either in sequence or in parallel.

---

## Defining a Compound Task

Add a task entry to your `.vscode/tasks.json` that uses `dependsOn` instead of a `command`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Install",
      "type": "shell",
      "command": "npm install"
    },
    {
      "label": "Build",
      "type": "shell",
      "command": "npm run build"
    },
    {
      "label": "Test",
      "type": "shell",
      "command": "npm test"
    },
    {
      "label": "CI Pipeline",
      "dependsOn": ["Install", "Build", "Test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

Running `CI Pipeline` will execute `Install`, then `Build`, then `Test` — one at a time, in order.

---

## `dependsOn`

The `dependsOn` property accepts a single task label or an array of task labels:

```json
"dependsOn": "Build"
```

```json
"dependsOn": ["Install", "Build", "Test"]
```

You can also reference tasks by object notation:

```json
"dependsOn": [
  { "type": "npm", "script": "build" }
]
```

---

## `dependsOrder`

The `dependsOrder` property controls the execution mode of the dependency tasks.

| Value | Behaviour |
| --- | --- |
| `sequence` | Dependencies run one at a time, in the order they are listed. The next task starts only after the previous one completes. |
| `parallel` | All dependencies start at the same time. |

If `dependsOrder` is omitted, VS Code defaults to **parallel** execution.

### Sequential Example

```json
{
  "label": "Build and Test",
  "dependsOn": ["Build", "Test"],
  "dependsOrder": "sequence"
}
```

### Parallel Example

```json
{
  "label": "Lint and Type-Check",
  "dependsOn": ["Lint", "Type-Check"],
  "dependsOrder": "parallel"
}
```

---

## Stopping a Compound Task

When you click the **Stop** button (⏹) on a compound task in the Workspace Tasks view, the extension:

1. Terminates the compound task orchestration first — preventing the next dependency from starting.
2. Gracefully stops any currently running dependency tasks (sending `SIGINT`/`Ctrl+C`).
3. Force-terminates any dependency that does not stop within the graceful timeout.

This means a single stop action shuts down the entire task chain.

{: .note }
This behavior can be disabled via the `workspaceTasks.task.stopCompoundDependencies` setting. When disabled, only the orchestrating compound task is stopped; running dependencies continue until they finish on their own.

### Double-Click Force Stop

If the graceful stop is already in progress and you click **Stop** a second time, the extension immediately force-terminates all remaining tasks without waiting for the graceful timeout.

---

## Configuration

### `workspaceTasks.task.stopCompoundDependencies`

**Type:** `boolean`
**Default:** `true`

When enabled, stopping a compound task also stops all currently running `dependsOn` child tasks. See [Task Display Configuration](../configuration/task-display#workspacetaskstaskstopcompounddependencies) for full details.

```json
{
  "workspaceTasks.task.stopCompoundDependencies": true
}
```

---

## Compound Tasks in the Task Tree

Compound tasks appear in the Workspace Tasks tree alongside all other tasks. They are identified automatically — because they have no `command`, VS Code executes them natively by orchestrating their dependencies directly.

You can:

- **Favorite** a compound task for quick access
- **Add** a compound task to a Compound Task (Queue)
- **Stop** a compound task to terminate the full dependency chain

---

## Example: Multi-Stage Build Pipeline

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Clean",
      "type": "shell",
      "command": "rm -rf dist"
    },
    {
      "label": "Compile",
      "type": "shell",
      "command": "tsc -p tsconfig.json"
    },
    {
      "label": "Bundle",
      "type": "shell",
      "command": "webpack --mode production"
    },
    {
      "label": "Run Unit Tests",
      "type": "shell",
      "command": "jest"
    },
    {
      "label": "Full Build",
      "dependsOn": ["Clean", "Compile", "Bundle", "Run Unit Tests"],
      "dependsOrder": "sequence"
    }
  ]
}
```

Click **▶️** next to `Full Build` in the Workspace Tasks view to run the entire pipeline. Click ⏹ at any point to stop the pipeline and all running child tasks immediately.

---

## Related

- [Running Tasks](running-tasks)
- [Compound Tasks (Queues)](task-queues)
- [Task Display Configuration](../configuration/task-display)
