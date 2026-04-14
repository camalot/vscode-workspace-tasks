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

**Type:** `boolean`
**Default:** `false`

Controls whether debug logging is enabled for the extension. When enabled, the extension will output additional information to the `Workspace Tasks` output channel, which can be useful for troubleshooting issues or understanding the extension's behaviour.

**Example:**

```json
{
  "workspaceTasks.debug": true
}
```
