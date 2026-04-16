---
layout: default
title: 🛡️ Run Guard
parent: 🚀 Features
nav_order: 9
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Run Guard
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
Added in v1.8.0

## Overview

Run Guard prevents accidental execution of destructive or sensitive tasks by requiring explicit confirmation before they run. A **🛡️ badge** appears on guarded tasks directly in the tree view, and a confirmation dialog is shown whenever a guarded task is triggered — whether from the tree, a compound task queue, or any other execution path.

---

## Guard Sources

There are three independent ways to mark a task as guarded. They can be combined freely; any one matching source is sufficient to require confirmation.

| Priority | Source | Best for |
| --- | --- | --- |
| **1 (highest)** | [Manual toggle](#manual-toggle) | Ad-hoc protection; per-user per-workspace; no file changes needed |
| **2** | [Definition flag](#definition-flag) | Source-controlled guard on custom workspace tasks |
| **3 (lowest)** | [Pattern matching](#pattern-matching) | Broad coverage of discovered tasks by name |

---

## Manual Toggle

Toggle a run guard on any task directly from the tree view without editing any file.

### Adding a Run Guard

1. **Right-click** any task in the tree
2. Select **Add Run Guard** from the context menu
3. The task immediately shows a **🛡️** badge

### Removing a Run Guard

1. **Right-click** any guarded task (shows the 🛡️ badge)
2. Select **Remove Run Guard** from the context menu
3. The badge is removed immediately

### Notes

- The guard state is stored in VS Code's workspace state — it persists across sessions but is **workspace-specific** and not committed to source control
- Applies to any task type: npm scripts, Makefile targets, Gradle tasks, custom workspace tasks, etc.
- The state is stored per canonical task ID, so it remains stable even if task labels change due to grouping

---

## Definition Flag

Declare a guard directly in your `.workspace-tasks.json` file with `"confirm": true`. This is source-controlled and applies to any developer who opens the workspace.

```json
{
  "tasks": [
    {
      "label": "Deploy to Production",
      "type": "shell",
      "command": "./deploy.sh --env prod",
      "confirm": true
    },
    {
      "label": "Drop Database",
      "type": "shell",
      "command": "npm run db:drop",
      "confirm": true
    }
  ]
}
```

### Notes

- Only applies to tasks defined in `.workspace-tasks.json` (custom workspace tasks)
- Committed to source control — guards shared with the whole team automatically
- The `"confirm"` field defaults to `false` and is optional

---

## Pattern Matching

Use the `workspaceTasks.task.confirmPatterns` setting to guard any task whose label matches a regular expression pattern. This works for **all task types**, including discovered tasks from `package.json`, `Makefile`, `build.gradle`, and others.

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

Patterns are matched case-insensitively against the task's original label (before any grouping prefix is applied).

### Settings Reference

#### workspaceTasks.task.confirmPatterns

**Type:** `array` of `string`
**Default:** `[]`
**Scope:** `resource`

Array of regular expression strings (case-insensitive) matched against task labels. Any task whose label matches at least one pattern will prompt for confirmation before running.

```json
{
  "workspaceTasks.task.confirmPatterns": [
    "deploy.*",
    "db:drop",
    "terraform apply"
  ]
}
```

**Examples:**

| Pattern | Matches |
| --- | --- |
| `deploy.*` | `deploy`, `deploy-prod`, `deploy to staging` |
| `db:drop` | `db:drop` (exact) |
| `.*:prod$` | `deploy:prod`, `release:prod` |
| `terraform` | Any label containing `terraform` |

**Invalid patterns** (bad regex syntax) are silently skipped — they do not throw errors or prevent other patterns from working.

---

## Confirmation Dialog

When a guarded task is triggered, a modal dialog appears before the task runs:

> **Run guarded task?**
>
> _Task name_ is marked as a guarded task. Are you sure you want to run it?
>
> [ Run Task ]  [ Cancel ]

- Clicking **Run Task** proceeds with execution
- Clicking **Cancel** or dismissing the dialog cancels execution entirely — no task state is changed
- For compound tasks in **sequential mode**, cancelling any step stops the entire sequence
- For compound tasks in **parallel mode**, cancelling one task's dialog skips only that task; other parallel tasks that were confirmed still run

---

## Visual Indicator

Guarded tasks show a **🛡️** badge in the tree view. The badge color uses the theme's `list.warningForeground` color so it integrates naturally with your active theme.

The badge appears on:

- Individual task items
- Favorite copies of guarded tasks
- Recent task copies of guarded tasks

The badge does **not** appear on compound task group headers — only on individual runnable items.

---

## Compound Task Integration

Run Guard integrates fully with [compound task queues](task-queues):

### Sequential Mode

If a user cancels the confirmation dialog for any task in a sequential compound run, the entire sequence stops at that point. Tasks that already ran are unaffected; the remaining tasks in the queue do not execute.

### Parallel Mode

Each guarded task in a parallel compound run shows its own confirmation dialog. Cancelling one dialog skips only that individual task; all other tasks in the parallel group continue normally.

### Restart Behavior

When a task is **restarted** (via the context menu Restart action), the guard dialog is **not** shown. A restart is an explicit user action, so the confirmation is considered implicit.

---

## Combining Guard Sources

All three guard sources are evaluated independently. A task is guarded if **any** source marks it:

```text
isGuarded = manualToggle OR definitionFlag OR patternMatch
```

For example, a task can be guarded by a `confirmPatterns` pattern in the team's shared `settings.json` **and** also have an individual team member override a manual toggle. Both sources arriving at the same task is harmless — the confirmation dialog only appears once.

---

## Next Steps

- [Running Tasks](running-tasks) — Full task execution options
- [Compound Tasks (Queues)](task-queues) — Sequential and parallel task sequences
- [Custom Workspace Tasks](custom-workspace-tasks) — `.workspace-tasks.json` reference including the `confirm` field
- [Configuration](../configuration) — Full settings reference
