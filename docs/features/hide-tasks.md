---
layout: default
title: 🙈 Hide Tasks & Groups
parent: 🚀 Features
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Hide Tasks & Groups
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Declutter your task view by temporarily hiding individual tasks or entire task groups you don't need to see. Hidden items are dimmed when shown and can be easily restored at any time.

---

## How to Use

1. **Right-click** on any task or task group
2. Select **"Hide Task"** or **"Hide Group"** from the context menu
3. Hidden items are removed from the default view
4. Click the **"Show Hidden Tasks"** button in the title bar to view all tasks including hidden ones
5. When in "Show Hidden" mode, hidden items appear dimmed with a badge (●)
6. **Right-click** a hidden item and select **"Unhide"** to restore it
7. Click **"Clear Hidden Tasks"** to unhide everything and return to normal view

---

## Features

- **Selective Hiding** — Hide individual tasks or entire task groups (npm, maven, etc.)
- **Hierarchical** — Hiding a group automatically hides all tasks within it
- **Visual Feedback** — Hidden items appear dimmed with a badge when viewing all tasks
- **Toggle Mode** — Quickly switch between filtered view and showing all tasks
- **Persistent** — Hidden state is saved across Visual Studio Code sessions
- **Easy Restore** — Unhide individual items or clear all hidden tasks at once

---

## Perfect For

- Hiding rarely-used task types in large monorepos
- Temporarily removing test or build tasks from view
- Focusing on specific task categories during development
- Cleaning up the task tree without permanently removing tasks

---

## Difference from Task Filtering

| | Hide Tasks | `.tasksignore` / Exclude |
| --- | --- | --- |
| **Scope** | Per-task or per-group | File/pattern-based |
| **Reversibility** | Easily toggle back on | Edit ignore file |
| **Use case** | Temporary declutter | Permanently exclude task files |
| **Granularity** | Individual tasks within a type | Entire files or directories |

For permanently excluding files from task discovery, use [Task Filtering](task-filtering) with `.tasksignore`.

---

## See Also

- [Task Filtering](task-filtering) — Exclude files using `.tasksignore`
- [.tasksignore Reference](tasksignore) — `.tasksignore` syntax and examples
- [Configuration](../configuration) — Full settings reference
