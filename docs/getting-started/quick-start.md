---
layout: default
title: Quick Start
nav_order: 3
parent: Getting Started
---
<!-- markdownlint-disable-next-line MD025 MD022 -->
# Quick Start

{: .no_toc }

Once installed, follow these steps to start using Workspace Tasks:

## 1. Open a Workspace

Open a folder or workspace in Visual Studio Code that contains supported task files such as `package.json`, `Makefile`, `build.gradle`, or any other [supported task type](task-types).

## 2. Open the Workspace Tasks View

You can view your tasks in two places:

- **Sidebar (Activity Bar):** Click the Workspace Tasks icon in the Activity Bar on the left
- **Explorer Panel:** Find "Workspace Tasks" in the Explorer panel; you can drag it to your preferred location

![Workspace-Tasks Sidebar](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png)

## 3. Browse and Run Tasks

Tasks are organized hierarchically:

``` text
Workspace Folder
└── Task Type (e.g., npm, Makefile, Docker)
    └── Task File (e.g., package.json)
        └── Individual Tasks
```

**To run a task:**

- **Double-click** the task to run it immediately
- **Click the play icon (▶️)** in the task action bar
- **Right-click** for additional options

## 4. Add to Favorites

Click the **star icon (☆)** next to any task to add it to your Favorites. Favorites appear at the top of the task tree for quick access.

## 5. Create a Task Queue

Click the **list icon** next to any task to add it to a queue. Queues let you run multiple tasks in sequence—perfect for build, test, and deploy pipelines.
