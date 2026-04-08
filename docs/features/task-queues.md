---
layout: default
title: 📊 Task Queues
parent: 🚀 Features
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

Create and manage multiple named queues to run tasks either **sequentially** (one after another) or **in parallel** (all at once). Task Queues are perfect for complex workflows like CI/CD pipelines, multi-step builds, or deployment sequences.

![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)

---

## Execution Modes

Each queue supports two execution modes:

| Mode | Icon | Behavior |
|---|---|---|
| **Sequential** | `sequential.svg` | Tasks run one at a time, in order. If a task fails, the queue stops. |
| **Parallel** | `parallel.svg` | All tasks launch simultaneously. A failure in one does not stop others. |

The queue group item in the tree displays the current mode via its icon — a **sequential** icon or a **parallel** icon.

### Changing the Execution Mode

Hover over a queue in the tree to reveal its action bar, then click the **Toggle Queue Execution Type** button (`$(arrow-swap)`). The queue icon updates immediately to reflect the new mode:

- Sequential → Parallel
- Parallel → Sequential

You can also right-click the queue and choose **Toggle Queue Execution Type** from the context menu.

---

## How to Add a Task to a Queue

1. **Hover** over any task in the tree to reveal the action bar
2. Click the **queue icon** (`$(list-unordered)`) in the action bar — or **right-click** the task and select **Add to Queue**
3. If no queues exist, enter a name for a new queue in the input box that appears
4. If queues already exist, select one from the list or choose **New Queue...** to create a new one
5. The task appears in the selected queue under the **Queues** group in the task tree

## How to Run a Queue

1. In the **Queues** group, hover over the queue name to reveal its action bar
2. Click the **Run All** button to execute all tasks in sequence from the beginning
3. To start from a specific task, hover over that item in the queue and click its **Run** button

## How to Use

1. Click the **list icon** next to any task to add it to a queue
2. Choose an **existing queue** or **create a new one**
3. **Drag and drop** tasks to reorder them within the queue
4. Click the **run button** on the queue to execute all tasks in sequence, or start from a specific task

---

## Features

- **Multiple Queues** — Create separate queues for different workflows (e.g., "Build", "Deploy", "CI Pipeline")
- **Sequential or Parallel Execution** — Toggle each queue between sequential (one-at-a-time, stops on failure) and parallel (all at once) modes
- **Execution Mode Icon** — The queue group icon shows the current mode: `sequential.svg` or `parallel.svg`
- **Drag & Drop Reordering** — Easily reorder tasks within and across queues
- **Visual Context** — Each queue item shows the task icon, label, workspace name, and file path
- **Queue Controls** — Run the entire queue, start from a specific task, or stop execution
- **Queue Management** — Rename queues, clear all tasks, or delete empty queues
- **Persistent Storage** — Queues and their execution modes are saved and restored between sessions
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
- **Toggle Execution Type** — Switch between sequential and parallel execution
- **Delete** — Remove an empty queue entirely

---

## Tips

- Add the same task to multiple queues for different workflows
- Start a queue from a specific task by clicking the play icon next to that item
- Stop a running queue with the stop button in the queue's title bar
- Drag tasks between queues to reorganize your workflows

---

## Next Steps

- [Favorites & Recent Tasks](favorites) — Pin and track frequently used tasks
- [Configuration](../configuration) — Full settings reference
