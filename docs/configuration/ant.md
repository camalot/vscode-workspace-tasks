---
layout: default
title: ⚙️ Ant
parent: ⚙️ Configuration
nav_order: 11
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Ant Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.ant.ansicon.enabled

**Type:** `boolean`
**Default:** `true`

When enabled, ANSICON will be used for Ant tasks to provide colored output in the terminal.

**Example:**

```json
{
	"workspaceTasks.ant.ansicon.enabled": true
}
```

![Screenshot - Ansicon Enabled](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ansicon-enabled.png)
