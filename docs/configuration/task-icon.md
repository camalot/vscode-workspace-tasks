---
layout: default
title: Task Icon Settings
parent: Configuration
nav_order: 4
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Icon Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.iconType

**Type:** `string`
**Default:** `"type"`
**Options:** `"type"`, `"file"`, `"gear"`, `"run"`, `"custom"`

Select the type of icon to display for tasks.

- **type** - The task type icon used to represent the type of the task
- **file** - The `vscode` defined file icon for the task source file
- **gear** - A gear icon that usually represents settings or configuration
- **run** - A play icon that usually represents running or starting something
- **custom** - A custom icon defined by the user

**Example:**

```json
{
	"workspaceTasks.task.iconType": "run"
}
```

![Screenshot - Icon Type](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-type.png)

### workspaceTasks.task.iconTypeCustom

**Type:** `string`
**Default:** `""`

Specify a custom icon for the task. This can be a path to an png or svg file, or it can be a [ThemeIcon](https://code.visualstudio.com/api/references/icons-in-labels) in the format `$(iconName)`. `workspaceTasks.task.iconType` must be set to `custom` for this to take effect.

**Example:**

```json
{
	"workspaceTasks.task.iconType": "custom",
	"workspaceTasks.task.iconTypeCustom": "$(rocket)"
}
```

![Screenshot - Custom Icon Built-In](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-builtin.png)

Or with a file path:

```json
{
	"workspaceTasks.task.iconType": "custom",
	"workspaceTasks.task.iconTypeCustom": ".vscode/icons/task-icon.svg"
}
```

![Screenshot - Custom Icon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-path.png)
