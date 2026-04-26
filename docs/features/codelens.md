---
layout: default
title: 🔍 Inline CodeLens Actions
parent: 🚀 Features
nav_order: 9
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Inline CodeLens Actions
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Workspace Tasks adds **inline CodeLens action buttons** directly above each task definition in its source file. You can run, favorite, add to a compound task, or hide a task without ever leaving the editor.

The CodeLens row mirrors the action bar buttons in the task tree view and respects the same [`workspaceTasks.task.actionBar.*`](../configuration/display-interaction/tasks#workspacetaskstaskactionbar) visibility flags.

---

## Supported File Types

CodeLens actions appear in any file that Workspace Tasks can discover tasks from, including:

- `package.json` (npm/yarn/pnpm/bun scripts)
- `Taskfile.yml` / `Taskfile.yaml`
- `Makefile`
- `.github/workflows/*.yml` (GitHub Actions)
- `.gitlab-ci.yml` (GitLab CI)
- `Cargo.toml` (cargo-make)
- `pyproject.toml` / `Makefile` (Poetry/poe)
- `build.gradle` (Gradle)
- `pom.xml` (Maven)
- `*.sh` (shell scripts)
- …and all other supported task provider types

---

## Available Actions

Each visible task gets a row of CodeLens lenses positioned above its definition line:

| Lens | Command | Condition |
|------|---------|-----------|
| **$(debug-start) Run Task** | `workspaceTasks.runTask` | Task is idle |
| **$(debug-stop) Stop Task** | `workspaceTasks.stopTask` | Task is currently running |
| **$(debug-continue) Run with Args** | `workspaceTasks.runTaskWithArgs` | Task is idle |
| **$(star) Add to Favorites** | `workspaceTasks.addToFavorites` | Task is not a favorite |
| **$(star-full) Remove from Favorites** | `workspaceTasks.removeFromFavorites` | Task is a favorite |
| **$(list-unordered) Add to Compound Task** | `workspaceTasks.addToCompoundTask` | Task is not queued |
| **$(trash) Remove from Compound Task** | `workspaceTasks.removeFromCompoundTask` | Task is in a compound task |
| **$(eye-closed) Hide Task** | `workspaceTasks.hideTask` | Task is visible |
| **$(eye) Unhide Task** | `workspaceTasks.unhideTask` | Task is hidden (show-hidden mode) |

{: .note }
> The **Run with Args** and **Stop Task** lenses are mutually exclusive with **Run Task** — only the appropriate one is shown based on the task's current status.

---

## Configuration

### Enable / Disable All CodeLens Actions

Set [`workspaceTasks.codeLens.enabled`](../configuration/display-interaction/tasks#workspacetaskscodelens) to `false` to remove all CodeLens lenses from every file:

```json
{
  "workspaceTasks.codeLens.enabled": false
}
```

### Control Individual Actions

Individual lenses are controlled by the same [`workspaceTasks.task.actionBar`](../configuration/display-interaction/tasks#workspacetaskstaskactionbar) flags used by the tree view action bar:

```jsonc
{
  "workspaceTasks.task.actionBar": {
    "run": true,
    "runWithArgs": false,   // hides Run with Args lens
    "favorite": true,
    "queue": false,          // hides Add/Remove Compound Task lenses
    "hide": false,           // hides Hide Task lens
    "unhide": true
  }
}
```

---

## Behaviour Notes

- **Show Hidden Mode** — When show-hidden mode is active, hidden tasks display an **Unhide Task** lens instead of the standard visible-task lenses.
- **Running Tasks** — The **Run Task** lens is replaced by **Stop Task** while the task is executing. **Run with Args** is hidden while the task is running.
- **Workspace Trust** — CodeLens lenses are suppressed entirely in untrusted workspaces, consistent with all other extension features.
- **No-location Tasks** — Tasks that cannot be mapped to a specific line in their source file do not receive a CodeLens row.

---

## Related

- [Action Bar Configuration](../configuration/display-interaction/tasks#workspacetaskstaskactionbar)
- [CodeLens Enabled Setting](../configuration/display-interaction/tasks#workspacetaskscodelens)
- [Hide Tasks](hide-tasks)
- [Favorites](favorites)
- [Compound Tasks](task-queues)
