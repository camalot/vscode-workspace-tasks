---
layout: home
title: 🏠 Home
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Workspace Tasks

<!-- markdownlint-disable-file MD033 MD013-->

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version-short/darthminos.workspace-tasks.svg?style=for-the-badge&colorA=555555&colorB=007ec6&label=VERSION)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Rating](https://vsmarketplacebadges.dev/rating-short/darthminos.workspace-tasks.svg?style=for-the-badge&colorA=555555&colorB=007ec6&label=RATING)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/darthminos.workspace-tasks.svg?style=for-the-badge&colorA=555555&colorB=007ec6&label=DOWNLOADS)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/darthminos.workspace-tasks.svg?style=for-the-badge&colorA=555555&colorB=007ec6&label=INSTALLS)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)

[![Open VSX Version](https://img.shields.io/open-vsx/v/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=VERSION)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Rating](https://img.shields.io/open-vsx/rating/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=RATING)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=DOWNLOADS)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Release Date](https://img.shields.io/open-vsx/release-date/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=RELEASE%20DATE)](https://open-vsx.org/extension/darthminos/workspace-tasks)

[![Codecov](https://img.shields.io/codecov/c/github/camalot/vscode-workspace-tasks?style=for-the-badge&label=COVERAGE&logo=codecov&logoColor=white)](https://app.codecov.io/gh/camalot/vscode-workspace-tasks/tree/develop)
[![GitHub Build](https://img.shields.io/github/actions/workflow/status/camalot/vscode-workspace-tasks/.github%2Fworkflows%2Fci.yml?style=for-the-badge&logo=github&label=BUILD)](https://github.com/camalot/vscode-workspace-tasks/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/camalot/vscode-workspace-tasks/.github%2Fworkflows%2Fjekyll-gh-pages.yml?style=for-the-badge&logo=github&label=DOCS)](https://github.com/camalot/vscode-workspace-tasks/actions/workflows/jekyll-gh-pages.yml)
[![Issues](https://img.shields.io/github/issues/camalot/vscode-workspace-tasks?style=for-the-badge&logo=github&color=%2313773d)](https://github.com/camalot/vscode-workspace-tasks/issues)

---

A powerful Visual Studio Code extension that automatically discovers, organizes, and runs tasks from your workspace. Manage build scripts, run tests, execute workflows, and organize your development tasks with favorites and compound tasks — all from a single, intuitive interface.

---

## Screenshots

![Workspace-Tasks Sidebar Collapsed](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png){: .vat }
![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png){: .vat }
![Workspace-Tasks / TaskExplorer Side By Side](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-te-compare.gif){: .vat }
![Workspace-Tasks Load v1.6.0](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-load-v1.6.0.gif){: .vat }

---

## Key Features

- **🔍 Automatic Task Discovery** — Scans your workspace for tasks from 20+ file types and build systems
- **📍 Flexible Placement** — View tasks in the dedicated sidebar or as a dockable panel in the Explorer
- **⭐ Favorites** — Pin frequently used tasks for instant access
- **🌱 Recent Tasks** — Tracks the most recently executed tasks
- **📋 Multiple Compound Tasks (Queues)** — Create and manage named sequences of tasks
- **▶️ Quick Execution** — Double-click tasks to run instantly, or use the play icon (▶️)
- **🎯 Smart Organization** — Hierarchical tree view organized by workspace, task type, and file
- **🔀 Drag & Drop** — Reorder tasks in Compound Tasks (Queues) with drag and drop
- **🎭 GitHub Actions Support** — Run GitHub Actions workflows locally with [act](https://github.com/nektos/act)
- **📝 Custom Tasks** — Define reusable task templates with dynamic inputs
- **🚫 Task Filtering** — Use `.tasksignore` files to exclude unwanted tasks
- **🙈 Hide Tasks & Groups** — Hide individual tasks or entire task groups from view
- **[🕰️ Task History, Statistics & Dashboard](features/task-history)** - Track all task executions in a sortable history table, view per-task performance metrics (duration trends, success rates, failure streaks), and explore workspace-wide health in the interactive Dashboard with Chart.js charts
- **💾 Persistent State** - Favorites and Compound Tasks (queues) are saved across Visual Studio Code sessions
- **☁️ Settings Sync** - Sync your favorites and Compound Tasks (queues) across multiple machines via VS Code's Settings Sync
- **[🛡️ Run Guard](features/run-guard)** - Require confirmation before running destructive or sensitive tasks; guard via manual toggle, definition flag, or label pattern
- **[🕜 Estimated Task Duration](features/task-duration-estimates)** - View estimated duration for tasks based on historical execution data
- **🔒 Workspace Trust** - Respects [VS Code Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust): no tasks are discovered or displayed in untrusted workspaces

---

## Installation

{% include _installation.md %}

See [Getting Started](getting-started) for more installation options.

---

## Quick Start

1. **Open a workspace** with supported task files (e.g., `package.json`, `Makefile`, shell scripts)
2. **Open the Workspace Tasks view** from the Activity Bar (sidebar) or Explorer panel
3. **Browse tasks** organized by workspace folder and task type
4. **Run a task** by double-clicking it or clicking the play icon (▶️)
5. **Add to favorites** by clicking the star icon (☆)
6. **Create a Compound Task** by clicking the list icon to organize task sequences

See the [Getting Started guide](getting-started) for full installation and setup instructions.

---

## Documentation

| Section | Description |
| --- | --- |
| [Getting Started](getting-started) | Installation and initial setup |
| [Supported Task Types](task-types) | All supported build tools and frameworks |
| [Favorites & Recent Tasks](features/favorites) | Pin and track frequently used tasks |
| [Compound Tasks (Queues)](features/task-queues) | Create sequences of tasks to run in order |
| [Hide Tasks & Groups](features/hide-tasks) | Declutter your task view |
| [Task History](features/task-history) | Track and review all task executions |
| [GitHub Actions Integration](task-types/github-actions) | Run workflows locally with act |
| [Configuration](configuration) | Full settings reference |
| [Task Filtering](features/task-filtering) | Exclude files using `.tasksignore` |
| [.tasksignore Reference](features/tasksignore) | `.tasksignore` file format and syntax |
| [Custom Workspace Tasks](features/custom-workspace-tasks) | Define reusable task templates |
| [Requirements](getting-started/requirements) | System requirements and tool dependencies |
| [Contributing](contributing) | How to contribute to the project |
| [Troubleshooting](troubleshooting) | Diagnose and resolve common issues |
