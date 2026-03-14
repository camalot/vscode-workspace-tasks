---
layout: default
title: ⚙️ Task Presentation
parent: ⚙️ Configuration
nav_order: 6
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Presentation Options
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.presentationOptions

**Type:** `object`

Configure how tasks are presented when executed.

#### workspaceTasks.task.presentationOptions.reveal

**Type:** `string`
**Default:** `"always"`
**Options:** `"always"`, `"silent"`, `"never"`

Controls whether the task output is revealed in the user interface.

#### workspaceTasks.task.presentationOptions.clear

**Type:** `boolean`
**Default:** `false`

Controls whether the terminal is cleared before executing the task.

#### workspaceTasks.task.presentationOptions.close

**Type:** `boolean`
**Default:** `false`

Controls whether the terminal is closed after executing the task.

#### workspaceTasks.task.presentationOptions.echo

**Type:** `boolean`
**Default:** `true`

Controls whether the command associated with the task is echoed in the user interface.

#### workspaceTasks.task.presentationOptions.focus

**Type:** `boolean`
**Default:** `false`

Controls whether the panel showing the task output is taking focus.

#### workspaceTasks.task.presentationOptions.panel

**Type:** `string`
**Default:** `"shared"`
**Options:** `"dedicated"`, `"shared"`, `"new"`

Controls if the task panel is used for this task only (dedicated), shared between tasks (shared) or if a new panel is created on every task execution (new).

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
