---
layout: default
title: ▶️ Compound Tasks
parent: ▶️ Task Execution
grand_parent: ⚙️ Configuration
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Compound Tasks Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.compoundTasks.defaultExecutionType

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"sequential"` |
| **Options:** | `"sequential"`, `"parallel"` |
| **Scope:** | `application` |

The default execution mode for new compound tasks (queues).

- **sequential** - Tasks in the queue run one after the other, in order
- **parallel** - All tasks in the queue start simultaneously

This value is used when a compound task is created without an explicit execution type. Existing compound tasks that have an explicitly saved type are not affected.

**Example:**

```json
{
  "workspaceTasks.compoundTasks.defaultExecutionType": "sequential"
}
```

---

### workspaceTasks.compoundTasks.includeVsCodeCompoundTasks

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |
| **Scope:** | `application` |

When `true`, compound tasks defined in the workspace's `.vscode/tasks.json` file (tasks that use `dependsOn`) are also shown in the Compound Tasks tree. When `false`, only compound tasks managed by this extension are shown.

**Example:**

```json
{
  "workspaceTasks.compoundTasks.includeVsCodeCompoundTasks": true
}
```

---

## Related

- [Compound Tasks (Queues)](../../features/task-queues)
- [Running Tasks](../../features/running-tasks)
