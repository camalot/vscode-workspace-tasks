---
layout: default
title: 📊 Metrics Settings
parent: ⚙️ Configuration
nav_order: 12
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Metrics Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

Task execution metrics are collected automatically as you run tasks and persist across VS Code sessions. The settings on this page control where metrics are stored, how many duration samples are retained per task, and when old metrics are pruned.

---

### workspaceTasks.metrics.scope

**Type:** `string`
**Default:** `"workspace"`
**Options:** `"workspace"`, `"global"`, `"both"`, `"disabled"`

Controls where task execution metrics are stored:

- **`workspace`** (default) — Metrics are stored per workspace (`workspaceState`). Each workspace maintains its own independent metrics.
- **`global`** — Metrics are stored globally across all workspaces (`globalState`). Useful when you want a single history across multiple repos.
- **`both`** — Metrics are written to both workspace and global storage. On read, workspace metrics take precedence, with global data used as a fallback.
- **`disabled`** — Metrics collection is turned off entirely. The **Statistics** tab will be empty and the **Clear Task Metrics** context menu entry will be hidden.

**Example:**

```json
{
  "workspaceTasks.metrics.scope": "workspace"
}
```

---

### workspaceTasks.metrics.maxDurationSamples

**Type:** `integer`
**Default:** `100`
**Minimum:** `10` · **Maximum:** `1000`

The maximum number of recent task duration samples to retain per task. Durations are stored in a ring buffer — once the limit is reached, the oldest sample is discarded when a new one is added.

These samples are used to compute `avg`, `median`, and `p95` duration values shown on the Statistics cards. A larger buffer gives more statistically accurate results at the cost of slightly more storage per task.

**Example:**

```json
{
  "workspaceTasks.metrics.maxDurationSamples": 50
}
```

---

### workspaceTasks.metrics.retentionDays

**Type:** `integer`
**Default:** `0`
**Minimum:** `0`

The number of days after which task metrics are automatically pruned. Metrics are evaluated against this limit on extension startup, using each task's `lastRunAt` timestamp.

- **`0`** (default) — No retention limit; metrics are kept indefinitely.
- **Positive integer** — Metrics for any task whose last run was more than N days ago are removed on startup.

**Example:**

```json
{
  "workspaceTasks.metrics.retentionDays": 30
}
```

---

## Related

- [Task History & Statistics](../features/task-history) — How to view and interact with collected metrics
- [Clear Task Metrics Commands](../features/task-history#statistics-view) — Right-click a task or use the Command Palette to clear metrics
