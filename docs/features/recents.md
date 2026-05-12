---
layout: default
title: 🕜 Recent Tasks
parent: 🚀 Features
nav_order: 4
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Recent Tasks
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

As you run tasks, they are tracked in a dedicated **Recent Tasks** section at the top of the task tree. This lets you quickly re-run the tasks you've been working with most recently.

### Configuration

#### workspaceTasks.recentTasks.maxItems

| | |
| --- | --- |
| **Type:** | `number` |
| **Default:** | `20` |
| **Minimum:** | `0` |

The maximum number of task items to track in the Recent Tasks group. Once the limit is reached, the oldest tasks are dropped from the list. Set to `0` to disable Recent Tasks entirely.

```json
{
  "workspaceTasks.recentTasks.maxItems": 20
}
```

![Recent Tasks - Max Items]({{ '/settings-recenttasks-maxitems.png' | prepend: site.github_images_url }})

#### workspaceTasks.groups.recentTasks.enabled

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |

When enabled, recent tasks will be grouped by task type in the same way as the main task tree.

```json
{
  "workspaceTasks.groups.recentTasks.enabled": true
}
```

![Recent Tasks - Grouping]({{ '/settings-groups-recenttasks-enabled.png' | prepend: site.github_images_url }})

---

## Next Steps

- [Configuration](../configuration) — Full settings reference
- [Compound Tasks](task-queues) — Group tasks into runnable sequences
