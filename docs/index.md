---
layout: home
title: Home
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Workspace Tasks

<!-- markdownlint-disable-file MD033 MD013-->

[![package_json version](https://img.shields.io/github/package-json/v/camalot/vscode-workspace-tasks.svg?logo=github)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks) [![VS Marketplace Ratings](https://img.shields.io/visual-studio-marketplace/r/darthminos.workspace-tasks.svg?label=vscode%20rating)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks) [![Open VSX Rating](https://img.shields.io/open-vsx/stars/darthminos/workspace-tasks?label=open%20vsx%20rating)](https://open-vsx.org/extension/darthminos/workspace-tasks) [![Codecov](https://img.shields.io/codecov/c/github/camalot/vscode-workspace-tasks)](https://app.codecov.io/gh/camalot/vscode-workspace-tasks/tree/develop)

[![VSCode Installs](https://img.shields.io/visual-studio-marketplace/i/darthminos.workspace-tasks.svg?label=vsm%20installs)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/darthminos.workspace-tasks.svg?label=vsm%20downloads)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/darthminos/workspace-tasks?label=ovsx%20downloads)](https://open-vsx.org/extension/darthminos/workspace-tasks)

A powerful Visual Studio Code extension that automatically discovers, organizes, and runs tasks from your workspace. Manage build scripts, run tests, execute workflows, and organize your development tasks with favorites and queues—all from a single, intuitive interface.

---

## Screenshots

![Workspace-Tasks Sidebar Collapsed](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png)
![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)
![Workspace-Tasks / TaskExplorer Side By Side](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-te-compare.gif)

---

## Key Features

- **🔍 Automatic Task Discovery** — Scans your workspace for tasks from 20+ file types and build systems
- **📍 Flexible Placement** — View tasks in the dedicated sidebar or as a dockable panel in the Explorer
- **⭐ Favorites** — Pin frequently used tasks for instant access
- **🌱 Recent Tasks** — Tracks the most recently executed tasks
- **📋 Multiple Task Queues** — Create and manage named sequences of tasks
- **▶️ Quick Execution** — Double-click tasks to run instantly, or use the play icon (▶️)
- **🎯 Smart Organization** — Hierarchical tree view organized by workspace, task type, and file
- **🔀 Drag & Drop** — Reorder tasks in queues with drag and drop
- **🎭 GitHub Actions Support** — Run GitHub Actions workflows locally with [act](https://github.com/nektos/act)
- **📝 Custom Tasks** — Define reusable task templates with dynamic inputs
- **🚫 Task Filtering** — Use `.tasksignore` files to exclude unwanted tasks
- **🙈 Hide Tasks & Groups** — Hide individual tasks or entire task groups from view
- **💾 Persistent State** — Favorites and queues are saved across Visual Studio Code sessions
- **☁️ Settings Sync** — Sync your favorites and queues across multiple machines via VS Code's Settings Sync

---

## Quick Start

1. **Open a workspace** with supported task files (e.g., `package.json`, `Makefile`, shell scripts)
2. **Open the Workspace Tasks view** from the Activity Bar (sidebar) or Explorer panel
3. **Browse tasks** organized by workspace folder and task type
4. **Run a task** by double-clicking it or clicking the play icon (▶️)
5. **Add to favorites** by clicking the star icon (☆)
6. **Create a queue** by clicking the list icon to organize task sequences

See the [Getting Started guide](getting-started) for full installation and setup instructions.

---

## Documentation

| Section | Description |
| --- | --- |
| [Getting Started](getting-started) | Installation and initial setup |
| [Supported Task Types](task-types) | All supported build tools and frameworks |
| [Favorites & Recent Tasks](features/favorites) | Pin and track frequently used tasks |
| [Task Queues](features/task-queues) | Create sequences of tasks to run in order |
| [Hide Tasks & Groups](features/hide-tasks) | Declutter your task view |
| [Task History](features/task-history) | Track and review all task executions |
| [GitHub Actions Integration](task-types/github-actions) | Run workflows locally with act |
| [Configuration](configuration) | Full settings reference |
| [Task Filtering](features/task-filtering) | Exclude files using `.tasksignore` |
| [.tasksignore Reference](features/tasksignore) | `.tasksignore` file format and syntax |
| [Custom Workspace Tasks](features/custom-workspace-tasks) | Define reusable task templates |
| [Requirements](requirements) | System requirements and tool dependencies |
| [Contributing](contributing) | How to contribute to the project |

---

## Installation

### From Visual Studio Code Marketplace

1. Open Supported Code Editor
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Workspace Tasks"**
4. Click **Install**

[→ Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks){: .btn .btn-primary }
[→ Open VSX Registry](https://open-vsx.org/extension/darthminos/workspace-tasks){: .btn .btn-secondary }

### From Command Line

Choose the command based on your editor

```shell
code --install-extension darthminos.workspace-tasks
```

```shell
cursor --install-extension darthminos.workspace-tasks
```

```shell
codium --install-extension darthminos.workspace-tasks
```

```shell
antigravity --install-extension darthminos.workspace-tasks
```

```shell
kiro --install-extension darthminos.workspace-tasks
```

```shell
windsurf --install-extension darthminos.workspace-tasks
```

See [Getting Started](getting-started) for more installation options.
