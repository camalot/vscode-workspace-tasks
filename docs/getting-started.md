---
layout: default
title: Getting Started
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Getting Started
{: .no_toc }

<!-- markdownlint-disable-next-line MD025 MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Requirements

- **Visual Studio Code** 1.108.1 or later
- External tools must be installed for task execution (see [Requirements](requirements))

---

## Installation

### From Visual Studio Code Marketplace

1. Open Visual Studio Code
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Workspace Tasks"**
4. Click **Install**

[→ Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks){: .btn .btn-primary }

### From Open VSX Registry

For editors that use the Open VSX Registry (e.g., Cursor, VSCodium):

1. Open your editor
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Workspace Tasks"**
4. Click **Install**

[→ Open VSX Registry](https://open-vsx.org/extension/darthminos/workspace-tasks){: .btn }

### From Command Line

Choose the command based on your editor

{% highlight shell %}
code --install-extension darthminos.workspace-tasks
{% endhighlight %}

{% highlight shell %}
cursor --install-extension darthminos.workspace-tasks
{% endhighlight %}

{% highlight shell %}
codium --install-extension darthminos.workspace-tasks
{% endhighlight %}

{% highlight shell %}
antigravity --install-extension darthminos.workspace-tasks
{% endhighlight %}

{% highlight shell %}
kiro --install-extension darthminos.workspace-tasks
{% endhighlight %}

{% highlight shell %}
windsurf --install-extension darthminos.workspace-tasks
{% endhighlight %}

---

## Quick Start

Once installed, follow these steps to start using Workspace Tasks:

### 1. Open a Workspace

Open a folder or workspace in Visual Studio Code that contains supported task files such as `package.json`, `Makefile`, `build.gradle`, or any other [supported task type](task-types).

### 2. Open the Workspace Tasks View

You can view your tasks in two places:

- **Sidebar (Activity Bar):** Click the Workspace Tasks icon in the Activity Bar on the left
- **Explorer Panel:** Find "Workspace Tasks" in the Explorer panel; you can drag it to your preferred location

![Workspace-Tasks Sidebar](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png)

### 3. Browse and Run Tasks

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

### 4. Add to Favorites

Click the **star icon (☆)** next to any task to add it to your Favorites. Favorites appear at the top of the task tree for quick access.

### 5. Create a Task Queue

Click the **list icon** next to any task to add it to a queue. Queues let you run multiple tasks in sequence—perfect for build, test, and deploy pipelines.

---

## Tips for Getting the Most Out of Workspace Tasks

- **Single-click** a task to open its definition file (when applicable)
- **Use the collapse button (⊟)** to toggle view states:
  - First click: Collapse task type groups
  - Second click: Collapse workspace folders
  - Third click: Expand everything
- **Create `.tasksignore` files** to [exclude unwanted tasks](TaskFiltering) from your task list
- **Drag the Explorer view** to any panel location (sidebar, panel, or floating window)
- **Use Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) to search and run tasks by name
- **Configure task discovery depth** with `workspaceTasks.taskDiscovery.fetchDepth` to improve performance in large repos

---

## Next Steps

| | |
| --- | --- |
| [Supported Task Types](task-types) | See all 20+ supported build tools and frameworks |
| [Favorites & Recent Tasks](features/favorites) | Learn how to pin and track tasks |
| [Task Queues](features/task-queues) | Build and run workflow sequences |
| [Configuration](Configuration) | Customize the extension to your needs |
| [Task Filtering](TaskFiltering) | Exclude unwanted tasks with `.tasksignore` |
| [Requirements](requirements) | External tool requirements for task execution |
