---
layout: default
title: 🐛 Debugging
parent: ⚙️ General
grand_parent: ⚙️ Configuration
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Debugging Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.debug

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `false` |
| **Scope:** | `window` |

Controls whether debug logging is enabled for the extension. When enabled, the extension will output additional information to the `Workspace Tasks` output channel, which can be useful for troubleshooting issues or understanding the extension's behavior.

Set this option in user or workspace settings. Workspace settings override user settings, and the
effective value applies to the whole window's output channel. Folder-level overrides in a multi-root
workspace are not supported. No settings or logging data are migrated automatically.

**Example:**

```json
{
  "workspaceTasks.debug": true
}
```
