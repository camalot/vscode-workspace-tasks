---
layout: default
title: Task Action Settings
parent: Configuration
nav_order: 5
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Action Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.actionBar

**Type:** `object`
**Default:**

```json
{
	"run": true,
	"runWithArgs": true,
	"openFile": true,
	"favorite": true,
	"queue": true,
	"hide:": false,
	"unhide": true
}
```

Select which items should be shown in the task action bar for each task. This allows you to customize the actions available for tasks in the workspace.

#### Properties

- **run** - Run Task
- **runWithArgs** - Run Task with Arguments
- **openFile** - Open File
- **favorite** - Add to Favorites
- **queue** - Add to Queue
- **hide** - Hide Task
- **unhide** - Unhide Task

**Example:**

```json
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
