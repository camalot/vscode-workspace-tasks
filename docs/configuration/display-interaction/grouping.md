---
layout: default
title: 🖥️ Grouping
parent: 🖥️ Display & Interaction
grand_parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Grouping Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.groups.enabled

**Type:** `boolean`
**Default:** `true`

When enabled, tasks in the tree view are grouped by task type (e.g. npm, shell, vscode). When disabled, all tasks from all providers appear in a flat list.

**Example:**

```json
{
  "workspaceTasks.groups.enabled": true
}
```

![Screenshot - Groups Enabled](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/groups-enabled.png)

---

### workspaceTasks.groups.useParentFolder

**Type:** `boolean`
**Default:** `false`

When enabled, tasks are additionally sub-grouped by the folder that contains their source file, giving a workspace-folder > task-type > folder > task hierarchy. When disabled, tasks are grouped at workspace-folder > task-type > task level.

**Example:**

```json
{
  "workspaceTasks.groups.useParentFolder": true
}
```

![Screenshot - Use Parent Folder](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/use-parent-folder.png)

---

### workspaceTasks.groups.taskSeparator

**Type:** `string`
**Default:** `""`

A string that is inserted between the task-type group label and the task name when rendering tree items. Leave empty for no separator.

**Example:**

```json
{
  "workspaceTasks.groups.taskSeparator": " › "
}
```

![Screenshot - Task Separator](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/task-separator.png)

---

### workspaceTasks.groups.recentTasks.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, a **Recent Tasks** group is shown at the top of the task tree, surfacing the most recently executed tasks for quick access.

**Example:**

```json
{
  "workspaceTasks.groups.recentTasks.enabled": true
}
```

![Screenshot - Recent Groups](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/recent-groups.png)

---

## Related

- [Recent Tasks](../../features/recents)
- [Task Filtering](../../features/task-filtering)
