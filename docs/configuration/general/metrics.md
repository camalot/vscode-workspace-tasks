---
layout: default
title: 📊 Metrics
parent: ⚙️ General
grand_parent: ⚙️ Configuration
nav_order: 2
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

{: .new }
v1.7: Task execution metrics collection and configuration options.

### workspaceTasks.metrics.scope

**Type:** `string`
**Default:** `"workspace"`
**Options:** `"workspace"`, `"global"`, `"both"`, `"disabled"`

Controls where task execution metrics are stored.

- **workspace** - Metrics are stored in the workspace storage only
- **global** - Metrics are stored in global storage only (shared across workspaces)
- **both** - Metrics are stored in both workspace and global storage
- **disabled** - Metrics collection is disabled entirely

**Example:**

```json
{
  "workspaceTasks.metrics.scope": "workspace"
}
```

### workspaceTasks.metrics.maxDurationSamples

**Type:** `number`
**Default:** `100`
**Minimum:** `10`
**Maximum:** `1000`

The maximum number of duration samples to store per task. Once this limit is reached, the oldest samples are removed as new ones are added. Higher values give more accurate long-term statistics at the cost of slightly more storage.

**Example:**

```json
{
  "workspaceTasks.metrics.maxDurationSamples": 100
}
```

### workspaceTasks.metrics.retentionDays

**Type:** `number`
**Default:** `0`
**Minimum:** `0`

The number of days to retain task execution metrics. Set to `0` to retain metrics indefinitely. When set to a positive value, metrics older than the specified number of days are automatically removed.

**Example:**

```json
{
  "workspaceTasks.metrics.retentionDays": 30
}
```

---

## Related

- [Task History](../../features/task-history)
