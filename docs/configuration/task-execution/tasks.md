---
layout: default
title: ▶️ Tasks
parent: ▶️ Task Execution
grand_parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Execution Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.presentationOptions

**Type:** `object`

Default terminal presentation options applied to every task run by the extension. These mirror the standard VS Code task `presentation` block. Individual tasks can still override these values in their own task definition.

#### workspaceTasks.task.presentationOptions.reveal

**Type:** `string`
**Default:** `"always"`
**Options:** `"always"`, `"silent"`, `"never"`

Controls whether the task output panel is revealed when the task starts.

- **always** - Always open and reveal the terminal panel
- **silent** - Reveal the panel only if the task fails
- **never** - Never reveal the panel automatically

#### workspaceTasks.task.presentationOptions.clear

**Type:** `boolean`
**Default:** `false`

When `true`, the terminal is cleared before executing the task.

#### workspaceTasks.task.presentationOptions.close

**Type:** `boolean`
**Default:** `false`

When `true`, the terminal is closed after the task completes.

#### workspaceTasks.task.presentationOptions.echo

**Type:** `boolean`
**Default:** `true`

When `true`, the command line is echoed in the terminal before execution.

#### workspaceTasks.task.presentationOptions.focus

**Type:** `boolean`
**Default:** `false`

When `true`, the terminal panel receives focus when the task starts.

#### workspaceTasks.task.presentationOptions.panel

**Type:** `string`
**Default:** `"shared"`
**Options:** `"dedicated"`, `"shared"`, `"new"`

Controls which terminal panel is used for the task.

- **shared** - Reuse the same terminal panel across tasks
- **dedicated** - Use a terminal panel dedicated to this task
- **new** - Create a new terminal panel every time the task runs

**Example:**

```json
{
  "workspaceTasks.task.presentationOptions": {
    "reveal": "always",
    "clear": false,
    "close": false,
    "echo": true,
    "focus": false,
    "panel": "shared"
  }
}
```

![Screenshot - Presentation Options](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/presentation.png)

---

### workspaceTasks.task.stopGracefulDelayMilliseconds

**Type:** `number`
**Default:** `5000`

The time in milliseconds to wait after sending a termination signal before forcibly killing the task process. During this window the process may perform clean-up work. Set to `0` to kill immediately without a grace period.

**Example:**

```json
{
  "workspaceTasks.task.stopGracefulDelayMilliseconds": 5000
}
```

![Screenshot - Stop Graceful Delay](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/stop-graceful-delay.png)

---

### workspaceTasks.task.stopCompoundDependencies

**Type:** `boolean`
**Default:** `true`

When `true`, stopping a compound task (queue) also stops all of its `dependsOn` child tasks that are currently running. When `false`, child tasks are allowed to continue running after the parent compound task is stopped.

**Example:**

```json
{
  "workspaceTasks.task.stopCompoundDependencies": true
}
```

---

## Related

- [Compound Tasks](../../features/task-queues)
- [Running Tasks](../../features/running-tasks)
