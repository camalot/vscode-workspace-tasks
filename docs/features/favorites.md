---
layout: default
title: Favorites & Recent Tasks
parent: Features
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Favorites & Recent Tasks
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Favorites

Pin your most frequently used tasks for instant access. Favorites appear in a dedicated section at the top of the task tree, making your common operations just one click away.

![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)

### How to Use

1. Click the **star icon (☆)** next to any task to add it to favorites
2. Access all favorited tasks from the **"Favorites"** group at the top
3. Click the **filled star (⭐)** to remove from favorites

### Features

- **Quick Access** — All favorites in one place, organized by task type
- **Persistent** — Saved automatically across Visual Studio Code sessions
- **Workspace-Specific** — Each workspace maintains its own favorites list
- **Visual Indicators** — Star icons show in both the favorites section and original location
- **Context Display** — Tasks show their workspace folder name in multi-root workspaces
- **Settings Sync** — Favorites automatically sync across all your machines when VS Code Settings Sync is enabled

### Perfect For

- Build, test, and deploy tasks you use daily
- Development scripts you run frequently
- Tasks from different workspace folders you need regularly

---

## Recent Tasks

As you run tasks, they are tracked in a dedicated **Recent Tasks** section at the top of the task tree. This lets you quickly re-run the tasks you've been working with most recently.

### Configuration

#### workspaceTasks.recentTasks.maxItems

**Type:** `number`
**Default:** `20`
**Minimum:** `0`

The maximum number of task items to track in the Recent Tasks group. Once the limit is reached, the oldest tasks are dropped from the list. Set to `0` to disable Recent Tasks entirely.

```json
{
  "workspaceTasks.recentTasks.maxItems": 20
}
```

![Recent Tasks - Max Items](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/settings-recenttasks-maxitems.png)

#### workspaceTasks.groups.recentTasks.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, recent tasks will be grouped by task type in the same way as the main task tree.

```json
{
  "workspaceTasks.groups.recentTasks.enabled": true
}
```

![Recent Tasks - Grouping](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/settings-groups-recenttasks-enabled.png)

---

## See Also

- [Configuration Reference](../Configuration) — Full settings reference
- [Task Queues](task-queues) — Group tasks into runnable sequences
