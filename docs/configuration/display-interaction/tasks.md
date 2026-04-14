---
layout: default
title: 🖥️ Tasks
parent: 🖥️ Display & Interaction
grand_parent: ⚙️ Configuration
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Display & Interaction Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.tasks.sortingEnabled

{: .new }
v1.7.0: Added `workspaceTasks.tasks.sortingEnabled` setting to control whether tasks are sorted alphabetically or displayed in definition order.

**Type:** `boolean`
**Default:** `true`

Controls whether tasks are sorted alphabetically within their groups and type buckets. When enabled (the default), tasks are sorted alphabetically by label at every level of the tree. When disabled, tasks are displayed in the order they are defined in their source file (e.g. `package.json`, `Makefile`, `Taskfile.yml`) or discovered by the provider.

Disabling this setting is useful when the definition order carries semantic meaning — for example, a `Makefile` where the first target is the default build target, or a `package.json` script list that is kept in workflow order.

{: .note }
> This setting affects task items only. Special groups such as **Favorites**, **Recent Tasks**, and **Compound Tasks** are always sorted by their own rules regardless of this setting.

**Example — preserve definition order:**

```json
{
  "workspaceTasks.tasks.sortingEnabled": false
}
```

**Example — alphabetical order (default):**

```json
{
  "workspaceTasks.tasks.sortingEnabled": true
}
```

---

### workspaceTasks.task.singleClickAction

**Type:** `string`
**Default:** `"open"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

The action performed when a task item in the tree is single-clicked.

- **run** - Run the task immediately
- **runWithArgs** - Prompt for arguments and then run the task
- **open** - Open the source file that defines the task
- **none** - No action on single click

**Example:**

```json
{
  "workspaceTasks.task.singleClickAction": "open"
}
```

![Screenshot - Single Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/single-click.png)

---

### workspaceTasks.task.doubleClickAction

**Type:** `string`
**Default:** `"run"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

The action performed when a task item in the tree is double-clicked.

- **run** - Run the task immediately
- **runWithArgs** - Prompt for arguments and then run the task
- **open** - Open the source file that defines the task
- **none** - No action on double click

**Example:**

```json
{
  "workspaceTasks.task.doubleClickAction": "run"
}
```

![Screenshot - Double Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/double-click.png)

---

### workspaceTasks.task.statusResetDelay

**Type:** `number`
**Default:** `500`

The time in milliseconds to display a task's completion status indicator (✔ or ✖) in the tree view before resetting it to the idle state. Set to `0` to keep the status until the next action.

**Example:**

```json
{
  "workspaceTasks.task.statusResetDelay": 500
}
```

![Screenshot - Status Reset Delay](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/status-reset-delay.png)

---

### workspaceTasks.task.iconType

**Type:** `string`
**Default:** `"type"`
**Options:** `"type"`, `"file"`, `"gear"`, `"run"`, `"custom"`

The icon style to display next to each task in the tree view.

- **type** - The task-type icon representing the technology (npm, gradle, etc.)
- **file** - The VS Code file icon for the task's source file
- **gear** - A generic gear/settings icon
- **run** - A generic play/run icon
- **custom** - A user-defined icon (see `workspaceTasks.task.iconTypeCustom`)

**Example:**

```json
{
  "workspaceTasks.task.iconType": "run"
}
```

![Screenshot - Icon Type](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-type.png)

---

### workspaceTasks.task.iconTypeCustom

**Type:** `string`
**Default:** `""`

A custom icon to display for tasks when `workspaceTasks.task.iconType` is set to `"custom"`. This can be:

- A [ThemeIcon](https://code.visualstudio.com/api/references/icons-in-labels) identifier in the format `$(iconName)`
- A relative path to a `.png` or `.svg` file within the workspace

**Example — built-in ThemeIcon:**

```json
{
  "workspaceTasks.task.iconType": "custom",
  "workspaceTasks.task.iconTypeCustom": "$(rocket)"
}
```

![Screenshot - Custom Icon Built-In](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-builtin.png)

**Example — workspace file path:**

```json
{
  "workspaceTasks.task.iconType": "custom",
  "workspaceTasks.task.iconTypeCustom": ".vscode/icons/task-icon.svg"
}
```

![Screenshot - Custom Icon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-path.png)

---

### workspaceTasks.task.actionBar

**Type:** `object`
**Default:**

```jsonc
{
  "run": true,
  "runWithArgs": true,
  "openFile": true,
  "favorite": true,
  "queue": true,
  "hide": false,
  "unhide": true
}
```

Controls which buttons are shown in the inline action bar for each task in the tree view.

#### Properties

- **run** - Run Task
- **runWithArgs** - Run Task with Arguments
- **openFile** - Open the task's source file
- **favorite** - Add to / remove from Favorites
- **queue** - Add to a Compound Task (Queue)
- **hide** - Hide the task
- **unhide** - Unhide the task

**Example:**

```jsonc
{
  "workspaceTasks.task.actionBar": {
    "run": true,
    "runWithArgs": false,
    "openFile": true,
    "favorite": true,
    "queue": false,
    "hide": false,
    "unhide": true
  }
}
```

![Screenshot - Task Action Bar](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/action-bar.png)

---

### workspaceTasks.recentTasks.maxItems

**Type:** `number`
**Default:** `20`
**Minimum:** `0`

The maximum number of recently executed tasks to track and display in the Recent Tasks group. Setting this to `0` effectively disables recent-task tracking.

**Example:**

```json
{
  "workspaceTasks.recentTasks.maxItems": 10
}
```

![Screenshot - Max Recent Tasks](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/max-recent.png)

---

## Related

- [Favorites](../../features/favorites)
- [Recent Tasks](../../features/recents)
- [Hide Tasks](../../features/hide-tasks)
- [Compound Tasks](../../features/task-queues)
