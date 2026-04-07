---
layout: default
title: 🚀 Features
nav_order: 3
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Features

Workspace Tasks provides a rich set of features to help you discover, organize, and execute tasks across your development workflow.

---

## Overview

| Feature | Description |
| --- | --- |
| [Running Tasks](running-tasks) | Run tasks, pass arguments, stop execution, and navigate to source files |
| [Favorites & Recent Tasks](favorites) | Pin frequently used tasks and track recently run tasks |
| [Task Queues](task-queues) | Create and run sequences of tasks in order |
| [Compound Tasks](compound-tasks) | Wire multiple tasks together with `dependsOn` for sequential or parallel execution |
| [Hide Tasks & Groups](hide-tasks) | Declutter your task view by hiding unused tasks |
| [Task History](task-history) | Track and review all task executions with status and timing |

---

## View Placement and Layout

Workspace Tasks supports flexible view placement:

- **Dedicated Sidebar** — Access tasks from the Activity Bar for a dedicated panel
- **Explorer Integration** — View tasks alongside your files in the Explorer panel

  ![Explorer View](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/explorer-view.png)

- **Dockable Window** — Drag the Explorer view to any location (left, right, bottom panel, or floating)
- **Synchronized State** — Both views share the same state; actions in one view reflect in the other

---

## Execution and Navigation

### Running Tasks

- **Single Click** — Click the play button (▶️) to run immediately
- **Terminal Output** — Task output appears in the integrated terminal with status indicators
- **Multiple Tasks** — Run multiple tasks simultaneously in separate terminals
- **Command Palette** — Use `Ctrl+Shift+P` / `Cmd+Shift+P` to search and run tasks by name

### Stopping & Restarting Tasks

- **Stop Button** — Click the stop button (⏹) next to running tasks to terminate execution
- **Restart Button** — Click the restart button (🔄️) to stop the current task and run it again
- **Status Tracking** — Visual indicators show running/success/failure states

### Navigation

- **Quick File Access** — Click tasks to jump to their definition in the source file
- **Line Precision** — Opens files at the exact line where tasks are defined
- **File Path Display** — Hover over tasks to see full paths and commands
- **Hierarchical Browsing** — Tree structure shows workspace → task type → individual tasks

---

## Refresh and Collapse Controls

- **Refresh Tasks** — Manually refresh to pick up changes without reloading Visual Studio Code
- **Collapse/Expand** — Use the collapse all button (⊟) to toggle view states:
  - First click: Collapse task type groups
  - Second click: Collapse workspace folders
  - Third click: Expand everything
