---
layout: default
title: ⚙️ Shell Script
parent: ⚙️ Configuration
nav_order: 8
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Shell Script Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.shellEnabledTaskTypes

**Type:** `object`
**Default:**

```json
{
  "bash": true,
  "batch": true,
  "sh": true,
  "zsh": true,
  "fish": true,
  "nushell": true,
  "perl": true,
  "pwsh": true,
  "python": true,
  "ruby": true,
  "other": true
}
```

Enable support for specific shell script types. This allows the extension to recognize and run tasks defined in these shell scripts.

#### Supported Shell Types

- **bash** - Bash
- **batch** - Batch
- **fish** - Fish
- **nushell** - NuShell
- **perl** - Perl
- **pwsh** - PowerShell
- **python** - Python
- **ruby** - Ruby
- **sh** - Shell
- **zsh** - Zsh
- **other** - Other

**Example:**

```json
{
  "workspaceTasks.shellEnabledTaskTypes": {
    "bash": true,
    "pwsh": true,
    "batch": true,
    "python": false,
    "ruby": false,
    "perl": false
  }
}
```

![Screenshot - Shell Enabled Task Types](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/shell-types.png)

### workspaceTasks.shellPaths

**Type:** `object`
**Default:**

```json
{
  "bash": "bash",
  "batch": "cmd.exe",
  "fish": "fish",
  "nushell": "nu",
  "perl": "perl",
  "pwsh": "pwsh",
  "python": "python",
  "ruby": "ruby",
  "sh": "sh",
  "zsh": "zsh"
}
```

Specify custom paths for shell interpreters. Use a key-value format where the key is the shell type (e.g., `bash`, `pwsh`) and the value is the path to the shell executable (e.g., `/usr/local/bin/bash`). This allows you to customize which shell interpreters are used for running shell tasks.

**Example:**

```json
{
  "workspaceTasks.shellPaths": {
    "bash": "/usr/local/bin/bash",
    "pwsh": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "python": "C:\\Python39\\python.exe"
  }
}
```

![Screenshot - Shell Paths](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/shell-paths.png)

### workspaceTasks.shellAdditionalExtensions

**Type:** `object`
**Default:** `{}`

Add extra file extensions (beyond the default ones) that should be treated as shell tasks. Use a key-value format where the key is a file extension without the leading dot (e.g., `myscript`) and the value is the path to the shell interpreter (e.g., `/usr/local/bin/myshell`). This allows you to run custom script files as tasks within the extension.

**Example:**

```json
{
  "workspaceTasks.shellAdditionalExtensions": {
    "myext": "/usr/local/bin/myshell",
    "tool": "python"
  }
}
```

![Screenshot - Shell Additional Extensions](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/shell-extensions.png)
