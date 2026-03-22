---
layout: default
title: 📚 Task History
parent: 🚀 Features
nav_order: 4
---
<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task History
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Track and review all task executions with comprehensive history views. Task History provides both a **tree view** and a **table panel** for monitoring task execution status, timing, and results.

---

## Tree View

The Task History tree view provides a hierarchical, filterable view of all executed tasks.

![Task History Tree View](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/features/task-history-treeview.png)

### Features

- **Status Filtering** — Filter by task status (Running, Success, Failed, Terminated)
- **Hierarchical Organization** — Tasks grouped for easy navigation
- **Task Details** — View task name, source, and execution time
- **Real-time Updates** — Automatically updates as tasks complete

### How to Use

1. Open the **Task History** in the Panel View
2. Use the **filter buttons** in the title bar to show/hide specific statuses
3. Click on any task item to view more details
4. Right-click for additional options (clear history, etc.)

---

## Table View

The Task History Table View provides a tabular, sortable view of all task executions with detailed information.

![Task History Table](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/features/task-history-webview.png)

### Features

- **Status Filtering** — Filter by task status (Running, Success, Failed, Terminated)
- **Sortable Columns** — Click any column header to sort tasks by that field
- **Comprehensive Details** — View status, type, task name, source path, timestamp, exit code, and execution time
- **Status Indicators** — Color-coded status labels/icons for quick identification:
  - 🟢 **Success** — Task completed successfully
  - 🔴 **Failed** — Task exited with an error
  - 🔵 **Running** — Task is currently executing
  - 🟠 **Terminated** — Task was stopped manually
- **Single-column Sorting** — Sort by any column in ascending or descending order, one column at a time
- **Real-time Updates** — Automatically updates as tasks complete

### How to Use

1. Open the **Task History** in the Panel View and choose **"View as Table"**
2. Click **column headers** to sort by that field (click again to reverse order)
3. Review detailed execution information including exact timestamps and durations
4. Use the scrollable view to review extensive task history

---

## Perfect For

- Debugging task failures by reviewing exit codes and execution times
- Monitoring build and deployment pipeline status
- Tracking task performance over time
- Auditing task executions in CI/CD workflows
- Identifying patterns in task failures or long-running tasks

---

## Next Steps

- [Task Queues](task-queues) — Run sequences of tasks
- [Configuration](../configuration) — Full settings reference
