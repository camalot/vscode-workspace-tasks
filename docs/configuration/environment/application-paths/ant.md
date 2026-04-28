---
layout: default
title: 🐜 Ant
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 2
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

### workspaceTasks.applicationPath.ant

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"ant"` |
| **Scope:** | `resource` |

Path to the Ant executable. On Windows, `.bat` is appended automatically when the path ends with `ant`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ant": "ant"
}
```

![Screenshot - Ant Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ant-path.png)

---

### workspaceTasks.ant.ansicon.enabled

| | |
| --- | --- |
| **Type:** | `boolean` |
| **Default:** | `true` |
| **Scope:** | `resource` |

When `true`, ANSICON is used to provide colored output for Ant tasks in the Windows terminal. Requires the ANSICON executable to be available — see [`workspaceTasks.applicationPath.ansicon`](../index#workspacetasksapplicationpathansicon).

**Example:**

```json
{
  "workspaceTasks.ant.ansicon.enabled": true
}
```

![Screenshot - Ansicon Enabled](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ansicon-enabled.png)

---

## Related

- [Ant task type](../../../task-types/scripts)
