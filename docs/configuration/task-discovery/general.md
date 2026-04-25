---
layout: default
title: 🔍 General
parent: 🔍 Task Discovery
grand_parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Discovery — General Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.exclude

| | |
| --- | --- |
| **Type:** | `string[]` |
| **Default:** | `[]` |
| **Scope:** | `resource` |

Glob patterns for files and directories to exclude from task discovery. Any file matching one of these patterns is ignored by all task providers. This is useful for excluding large or generated directories that do not contain tasks.

**Example:**

```json
{
  "workspaceTasks.exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/.git/**"
  ]
}
```

![Screenshot - Exclude Patterns](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/exclude-patterns.png)

### workspaceTasks.taskDiscovery.fetchDepth

| | |
| --- | --- |
| **Type:** | `number \| null` |
| **Default:** | `null` |
| **Scope:** | `resource` |

Controls how deep (in folder levels) the extension will search for tasks below the workspace root. A value of `null` (the default) means the search is unbounded — the extension scans all subdirectories recursively. A positive integer limits the search to that many levels deep, which can significantly improve performance in large monorepos or complex folder hierarchies.

| Value | Behavior |
| --- | --- |
| `null` | Full recursive search (no limit) |
| `1` | Workspace root only |
| `2` | Root + one level of subdirectories |
| `N` | Root + N−1 levels of subdirectories |

**Example:**

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

![Screenshot - Fetch Depth](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/fetch-depth.png)

---

## Related

- [Task Filtering](../../features/task-filtering)
- [`.tasksignore`](../../features/tasksignore)
