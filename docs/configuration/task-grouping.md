---
layout: default
title: ⚙️ Task Grouping
parent: ⚙️ ⚙️ Configuration
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Grouping Settings
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

Group tasks by type, folder, and custom separator. When enabled, tasks will be grouped based on the specified separator and other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.enabled": true
}
```

![Screenshot - Groups Enabled](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/groups-enabled.png)

### workspaceTasks.groups.useParentFolder

**Type:** `boolean`
**Default:** `false`

Group tasks by their parent folder. When enabled, tasks will be grouped based on their parent folder in addition to other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.useParentFolder": true
}
```

![Screenshot - Use Parent Folder](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/use-parent-folder.png)

### workspaceTasks.groups.taskSeparator

**Type:** `string`
**Default:** `""`

Separator used to split task name into groups. For example, a task named `build:frontend` with a separator of `:` would be grouped under `build`. An empty string means no grouping will be applied.

**Example:**

```json
{
  "workspaceTasks.groups.taskSeparator": ":"
}
```

![Screenshot - Task Separator](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/task-separator.png)

### workspaceTasks.groups.recentTasks.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, recent tasks will be grouped based on the specified separator and other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.recentTasks.enabled": true
}
```

![Screenshot - Recent Tasks Grouping](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/recent-groups.png)

### workspaceTasks.recentTasks.maxItems

**Type:** `number`
**Default:** `20`
**Minimum:** `0`

Maximum number of recent tasks to display in the Recent Tasks group. Once the limit is reached, the oldest tasks will drop off the list. Set to 0 to disable the Recent Tasks group.

**Example:**

```json
{
  "workspaceTasks.recentTasks.maxItems": 20
}
```

![Screenshot - Max Recent Tasks](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/max-recent.png)
