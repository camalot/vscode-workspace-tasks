---
layout: default
title: Task Queues
parent: Features
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Queues
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Create and manage multiple named queues to run sequences of tasks in order. Task Queues are perfect for complex workflows like CI/CD pipelines, multi-step builds, or deployment sequences.

![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)

---

## How to Use

1. Click the **list icon** next to any task to add it to a queue
2. Choose an **existing queue** or **create a new one**
3. **Drag and drop** tasks to reorder them within the queue
4. Click the **run button** on the queue to execute all tasks in sequence, or start from a specific task

---

## Features

- **Multiple Queues** — Create separate queues for different workflows (e.g., "Build", "Deploy", "CI Pipeline")
- **Drag & Drop Reordering** — Easily reorder tasks within and across queues
- **Visual Context** — Each queue item shows the task icon, label, workspace name, and file path
- **Queue Controls** — Run the entire queue, start from a specific task, or stop execution
- **Queue Management** — Rename queues, clear all tasks, or delete empty queues
- **Persistent Storage** — Queues are saved and restored between sessions
- **Status Indicators** — Real-time visual feedback with running/success/failure icons
- **Settings Sync** — Queues automatically sync across all your machines when VS Code Settings Sync is enabled

---

## Example Workflow

```text
CI Pipeline Queue:
1. Install Dependencies  (npm install)
2. Lint Code             (npm run lint)
3. Run Tests             (npm test)
4. Build Production      (npm run build)
5. Deploy to Staging     (deploy.sh)
```

Run all tasks in sequence by clicking the run button on the queue — Workspace Tasks executes each one automatically and stops if any task fails.

---

## Queue Management

Use the actions in the queue's title bar to:

- **Run All** — Execute all tasks in the queue from the beginning
- **Rename** — Give the queue a descriptive name (e.g., "Full CI Build")
- **Clear** — Remove all tasks from the queue
- **Delete** — Remove an empty queue entirely

---

## Tips

- Add the same task to multiple queues for different workflows
- Start a queue from a specific task by clicking the play icon next to that item
- Stop a running queue with the stop button in the queue's title bar
- Drag tasks between queues to reorganize your workflows

---

## See Also

- [Favorites & Recent Tasks](favorites) — Pin and track frequently used tasks
- [Configuration](../configuration) — Full settings reference
