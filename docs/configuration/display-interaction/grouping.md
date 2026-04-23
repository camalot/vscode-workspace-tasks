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

### workspaceTasks.groups.compoundTasks.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, a **Compound Tasks** group is shown at the top of the task tree, listing all defined compound task sequences for quick access. Has no effect if compound tasks are not configured.

**Example:**

```json
{
  "workspaceTasks.groups.compoundTasks.enabled": true
}
```

---

### workspaceTasks.groups.justfile.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, justfile recipes that carry a `[group('name')]` attribute are shown as
collapsible group nodes in the task tree rather than as a flat list. Recipes without
a group attribute are always shown at the top level, regardless of this setting.

{: .note }
> `[group()]` attribute support was added in just 1.13.0 (August 2023). On older versions
> of `just`, the `attributes` array is empty and all recipes are shown ungrouped, which
> is the correct and safe behaviour for those versions.

Group nodes are non-runnable — they have no action-bar buttons and cannot be executed
directly. They use the justfile icon and start collapsed.

**Example justfile:**

```just
[group('Build')]
build:
    cargo build --release

[group('Build')]
clean:
    rm -rf target/

[group('Test')]
test:
    cargo test

# No group — appears at the top level
fmt:
    cargo fmt
```

With `workspaceTasks.groups.justfile.enabled: true`, the tree shows:

```tree
justfile
├── fmt                  ← ungrouped, shown at top level
├── Build                ← collapsible group node
│   ├── build
│   └── clean
└── Test                 ← collapsible group node
    └── test
```

**Example:**

```json
{
  "workspaceTasks.groups.justfile.enabled": true
}
```

---

### workspaceTasks.groups.expanded

**Type:** `object`
**Default:** `{ "favorites": true, "compoundTask": true, "recent": true }`

Controls which special group headers are **expanded** by default when the task tree loads. Each property corresponds to one of the pinned groups at the top of the tree. Set a key to `false` to start that group collapsed.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `favorites` | `boolean` | `true` | Whether the **Favorites** group starts expanded |
| `compoundTask` | `boolean` | `true` | Whether the **Compound Tasks** group starts expanded |
| `recent` | `boolean` | `true` | Whether the **Recent Tasks** group starts expanded |
| `queue` | `boolean` | — | **Deprecated.** Use `compoundTask` instead |

> **Note:** The `queue` key is retained for backward compatibility only. Set `compoundTask` instead.

**Example — collapse Recent Tasks on startup:**

```json
{
  "workspaceTasks.groups.expanded": {
    "favorites": true,
    "compoundTask": true,
    "recent": false
  }
}
```

---

## Related

- [Recent Tasks](../../features/recents)
- [Task Filtering](../../features/task-filtering)
- [Just — Recipe Groups](../../task-types/task-runners/just#recipe-groups)
