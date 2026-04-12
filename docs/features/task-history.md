---
layout: default
title: 📚 Task History
parent: 🚀 Features
nav_order: 6
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

Track and review all task executions with comprehensive history and statistics. Task History provides a **table panel** for monitoring task execution status, timing, and results, and a **Statistics view** for aggregated per-task metrics.

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
- **Metrics Hint** — Each row shows the task's average duration and a flaky-streak badge (if the task has failed 3 or more times consecutively)
- **Single-column Sorting** — Sort by any column in ascending or descending order, one column at a time
- **Real-time Updates** — Automatically updates as tasks complete

### How to Use

1. Open the **Task History** panel
2. Click **column headers** to sort by that field (click again to reverse order)
3. Review detailed execution information including exact timestamps and durations
4. Use the scrollable view to review extensive task history

---

## Statistics View

The Statistics View provides aggregated per-task execution metrics, giving you a quick overview of how each task is performing over time.

![Task Statistics View](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/features/task-statistics-webview.png)

### Features

- **Summary Bar** — Shown at the top of both History and Statistics modes:
  - **Today** — Number of tasks run since midnight (from in-memory history)
  - **All-time** — Total task executions across all runs (from persisted metrics)
  - **Success rate** — Overall success percentage across all tracked tasks
  - **Total time** — Sum of all recorded execution durations
- **Per-task Cards** — One card per tracked task, sorted by most-run first, each showing:
  - **Success Rate** — Colour-coded: green ≥ 80%, amber ≥ 50%, red < 50%
  - **Total Runs** — All-time execution count
  - **Avg / Min / Max / p95 Duration** — Computed from the last N duration samples (configurable)
  - **Last Run** — Timestamp of the most recent execution
  - **Streak** — Consecutive failure or success count; consecutive failures ≥ 3 are highlighted in red
  - **Peak Hour** — Hour of day (0–23) when the task runs most often
  - **Trend** — Whether recent durations are getting slower (↑), faster (↓), or stable (→)
  - **Exit Codes** — Proportional bar chart of all recorded exit codes with tooltips; most-common exit code shown
- **Clear Metrics** — Click the **✕** button on any card to clear that task's metrics data

### How to Use

1. Open the **Task History** panel
2. Click the **Statistics** tab to switch to the metrics view
3. Review per-task cards for performance trends and failure patterns
4. Click **✕** on a card to reset metrics for that task
5. To clear all metrics at once, use the **Clear All Task Metrics** command from the Command Palette (`workspaceTasks.metrics.clearAll`)
6. Switch back to the **History** tab at any time

### Metrics Storage

Metrics are persisted across VS Code sessions. The storage location is controlled by the `workspaceTasks.metrics.scope` setting:

| Value | Storage |
|-------|---------|
| `workspace` (default) | Per-workspace (`workspaceState`) |
| `global` | Global across all workspaces (`globalState`) |
| `both` | Written to both; workspace takes precedence on read |
| `disabled` | Metrics collection is turned off entirely |

See the [Metrics Configuration](../configuration/metrics) page for all available settings.

---

## Perfect For

- Debugging task failures by reviewing exit codes and execution times
- Monitoring build and deployment pipeline status
- Tracking task performance over time with duration trends
- Identifying flaky tasks (consecutive failures) at a glance
- Auditing task executions in CI/CD workflows

---

## Next Steps

- [Compound Tasks (Queues)](task-queues) — Run sequences of tasks
- [Configuration](../configuration) — Full settings reference
- [Metrics Configuration](../configuration/metrics) — Configure metrics scope, sample size, and retention
