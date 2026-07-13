---
layout: default
title: ▶️ Tasks
parent: ▶️ Task Execution
grand_parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Execution Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.task.confirmPatterns

{: .new }
> **v1.8.0** — New setting

| | |
| --- | --- |
| **Type:** | `array` of `string` |
| **Default:** | `[]` |
| **Scope:** | `resource` |

Array of regular expression strings (case-insensitive) matched against task labels. Any task whose label matches at least one pattern will require confirmation before it runs. This is the _pattern-matching_ source for the [Run Guard](../../features/run-guard) feature.

Patterns are evaluated against the task's **original label** (before any grouping prefix is added). Invalid regex strings are silently skipped.

**Example:**

```json
{
  "workspaceTasks.task.confirmPatterns": [
    "deploy.*",
    "db:drop",
    "terraform apply",
    ".*:prod$"
  ]
}
```

| Pattern | Matches |
| --- | --- |
| `deploy.*` | `deploy`, `deploy-prod`, `deploy to staging` |
| `db:drop` | `db:drop` (exact) |
| `.*:prod$` | `deploy:prod`, `release:prod` |
| `terraform` | Any label containing `terraform` |

{: .tip }
Combine `confirmPatterns` with the [Manual Toggle](../../features/run-guard#manual-toggle) and the [Definition Flag](../../features/run-guard#definition-flag) for layered protection. All three sources may be active at once — the dialog only appears once per run regardless.

---

### workspaceTasks.task.presentationOptions

| | |
| --- | --- |
| **Type:** | `object` |
| **Default:** | `{}` |
| **Scope:** | `resource` |

Default terminal presentation options applied to every task run by the extension. These mirror the standard VS Code task `presentation` block. Individual tasks can still override these values in their own task definition.

#### workspaceTasks.task.presentationOptions.reveal

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"always"` |
| **Options:** | `"always"`, `"silent"`, `"never"` |
| **Scope:** | `resource` |

Controls whether the task output panel is revealed when the task starts.

- **always** - Always open and reveal the terminal panel
- **silent** - Reveal the panel only if the task fails
- **never** - Never reveal the panel automatically

#### workspaceTasks.task.presentationOptions.clear

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |
| **Scope:** | `resource` |

When `true`, the terminal is cleared before executing the task.

#### workspaceTasks.task.presentationOptions.close

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |
| **Scope:** | `resource` |

When `true`, the terminal is closed after the task completes.

#### workspaceTasks.task.presentationOptions.echo

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `true` |
| **Scope:** | `resource` |

When `true`, the command line is echoed in the terminal before execution.

#### workspaceTasks.task.presentationOptions.focus

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |
| **Scope:** | `resource` |

When `true`, the terminal panel receives focus when the task starts.

#### workspaceTasks.task.presentationOptions.panel

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"shared"` |
| **Options:** | `"dedicated"`, `"shared"`, `"new"` |
| **Scope:** | `resource` |

Controls which terminal panel is used for the task.

- **shared** - Reuse the same terminal panel across tasks
- **dedicated** - Use a terminal panel dedicated to this task
- **new** - Create a new terminal panel every time the task runs

**Example:**

```json
{
  "workspaceTasks.task.presentationOptions": {
    "reveal": "always",
    "clear": false,
    "close": false,
    "echo": true,
    "focus": false,
    "panel": "shared"
  }
}
```

![Screenshot - Presentation Options]({{ '/configuration/presentation.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.task.stopGracefulDelayMilliseconds

| | |
| --- | --- |
| **Type:** | `number` |
| **Default:** | `5000` |
| **Scope:** | `resource` |

The time in milliseconds to wait after sending a termination signal before forcibly killing the task process. During this window the process may perform clean-up work. Set to `0` to opt out of the force-kill entirely — only the graceful SIGINT is sent, and if the process does not respond the terminal remains open so the output is preserved.

**Example:**

```json
{
  "workspaceTasks.task.stopGracefulDelayMilliseconds": 5000
}
```

![Screenshot - Stop Graceful Delay]({{ '/configuration/stop-graceful-delay.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.task.stopCompoundDependencies

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `true` |
| **Scope:** | `resource` |

When `true`, stopping a compound task also stops all of its `dependsOn` child tasks that are currently running. When `false`, child tasks are allowed to continue running after the parent compound task is stopped.

**Example:**

```json
{
  "workspaceTasks.task.stopCompoundDependencies": true
}
```

---

## Related

- [Run Guard](../../features/run-guard)
- [Compound Tasks](../../features/task-queues)
- [Running Tasks](../../features/running-tasks)
