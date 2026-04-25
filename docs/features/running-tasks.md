---
layout: default
title: ▶️ Running Tasks
parent: 🚀 Features
nav_order: 0
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Running Tasks
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Running a Task

There are several ways to run a task from the Workspace Tasks view.

### Action Bar

Each task row displays an action bar when hovered. Click the **Run** button (▶️) to execute the task immediately.

![Action Bar](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/action-bar.png)

### Double-Click

Double-clicking a task in the tree runs it immediately using the configured double-click action (default: `run`). You can change this behavior via the `workspaceTasks.task.doubleClickAction` setting.

### Right-Click Context Menu

Right-click any task and select **Run Task** from the context menu.

### Command Palette

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Workspace Tasks: Run Task**.

---

## Running a Task with Arguments

To pass additional arguments to a task at runtime:

1. **Hover** over the task to reveal the action bar
2. Click the **Run with Args** button (▶&#xFE0E;) in the action bar

   — or —

   **Right-click** the task and select **Run Task with Args**

3. An input box appears — type the arguments you want to pass to the task command
4. Press **Enter** to run (or **Escape** to cancel)

For most tasks, arguments are appended to the command when it executes. For custom workspace-task
commands that include `${args}`, the typed value is injected at that exact position (and for every
`${args}` occurrence).

Example:

```json
{
   "label": "Run Container",
   "type": "workspace",
   "command": "docker run ${args} ghcr.io/example/app:latest"
}
```

If you run with args `--rm -it`, the executed command becomes:

```sh
docker run --rm -it ghcr.io/example/app:latest
```

If `${args}` is not present, the value is appended to the end (backward-compatible behavior).
Pressing Escape without entering anything cancels the operation.

{: .note }
The `workspaceTasks.task.doubleClickAction` or `workspaceTasks.task.singleClickAction` settings can be set to `runWithArgs` to make clicking a task always prompt for arguments.

---

## Stopping a Task

While a task is running, the **Run** button in the action bar is replaced by a **Stop** button (⏹).

### Graceful Stop

Click the **Stop** button (⏹) once to send a graceful stop signal (`SIGINT`, equivalent to `Ctrl+C`) to the running process. The task gets up to **5 seconds** to shut down cleanly. After that, it is force-terminated automatically if still running.

### Force Stop

If the task does not respond to the graceful stop within the timeout, or if you need to terminate it immediately:

- Click the **Stop** button (⏹) **a second time** while the graceful stop is in progress

This force-terminates the process immediately and closes the task execution.

{: .tip }
You can also send `Ctrl+C` directly in the integrated terminal to interrupt the task process.

---

## Opening the Source File

Every task has an associated source file (e.g., `package.json`, `Makefile`, `Taskfile.yml`). You can navigate directly to where the task is defined:

1. **Hover** over the task to reveal the action bar
2. Click the **Open File** button (`$(file-code)`) in the action bar

   — or —

   **Right-click** the task and select **Open File at Line**

   — or —

   **Single-click** the task (when `workspaceTasks.task.singleClickAction` is set to `open`, which is the default)

The file opens in the editor, scrolled to and with the cursor placed at the exact line where the task is defined.

---

## Adding a Task to Favorites

Favorites pin frequently used tasks to the top of the task tree for quick access.

1. **Hover** over the task to reveal the action bar
2. Click the **star icon (☆)** in the action bar

   — or —

   **Right-click** the task and select **Add to Favorites**

The task appears in the **Favorites** group at the top of the task tree. The star icon fills in (⭐) to indicate the task is favorited.

To **remove** a task from favorites, click the filled star (⭐) in the action bar, or right-click and select **Remove from Favorites**.

See [Favorites](favorites) for more details on managing and configuring favorites.

---

## Adding a Task to a Compound Task

Compound Tasks (Queues) let you run multiple tasks in sequence.

1. **Hover** over the task to reveal the action bar
2. Click the **compound task icon** (`$(list-unordered)`) in the action bar

   — or —

   **Right-click** the task and select **Add to Compound Task**

3. If no compound tasks exist, you are prompted to enter a name for a new compound task
4. If compound tasks already exist, select an existing compound task from the list or choose **New Compound Task...** to create one

The task is added to the selected compound task group and appears in the **Compound Tasks** section of the task tree.

See [Compound Tasks](task-queues) for details on running, reordering, and managing compound tasks.
