---
layout: default
title: ⚙️ Task Display
parent: ⚙️ Configuration
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Display Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.singleClickAction

**Type:** `string`
**Default:** `"open"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

Action to perform when a task is single-clicked.

- **run** - Run the task
- **runWithArgs** - Run the task with arguments
- **open** - Open the task
- **none** - Do nothing

**Example:**

```json
{
  "workspaceTasks.task.singleClickAction": "open"
}
```

![Screenshot - Single Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/single-click.png)

### workspaceTasks.task.doubleClickAction

**Type:** `string`
**Default:** `"run"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

Action to perform when a task is double-clicked.

- **run** - Run the task
- **runWithArgs** - Run the task with arguments
- **open** - Open the task
- **none** - Do nothing

**Example:**

```json
{
  "workspaceTasks.task.doubleClickAction": "run"
}
```

![Screenshot - Double Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/double-click.png)

### workspaceTasks.task.statusResetDelay

**Type:** `number`
**Default:** `500`

The delay in **milliseconds** before resetting the task icon back to its original state after execution. Set to `0` to reset immediately.

**Example:**

```json
{
  "workspaceTasks.task.statusResetDelay": 1000
}
```

![Screenshot - Status Reset Delay](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/status-reset-delay.png)
