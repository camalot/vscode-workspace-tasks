---
layout: default
title: ⚙️ General
parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# General Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.exclude

**Type:** `array` of `string`
**Default:** `[]`

Glob patterns to exclude from tasks. For example, to ignore all tasks in `sample` folders, add `**/sample/**`. Note that the patterns follow the [glob syntax](https://github.com/micromatch/glob). `**/node_modules/**` and `**/.git/**` are always ignored.

**Example:**

```json
{
  "workspaceTasks.exclude": ["**/sample/**", "**/test/**", "**/build/**"]
}
```

{:.line-numbers}

![Screenshot - Exclude Patterns](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/exclude-patterns.png)

### workspaceTasks.taskDiscovery.fetchDepth

**Type:** `number` or `null`
**Default:** `null`

Specify the fetch depth when discovering tasks from within the workspace. A value of `null` means full fetch, while a positive integer limits the depth of the fetch operation. This can help improve performance when working with large repositories.

**Example:**

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

![Screenshot - Task Discovery Fetch Depth](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/fetch-depth.png)

### workspaceTasks.task.stopGracefulDelayMilliseconds

**Type:** `number`
**Default:** `5000`

The delay in **milliseconds** before forcefully stopping (SIGKILL) a task after requesting it to stop gracefully (SIGINT).

**Example:**

```json
{
  "workspaceTasks.task.stopGracefulDelayMilliseconds": 5000
}
```

![Screenshot - Stop Graceful Delay](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/stop-graceful-delay.png)
