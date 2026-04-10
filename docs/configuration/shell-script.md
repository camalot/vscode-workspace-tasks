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

The configured interpreter is used when a script **does not** contain a shebang line (`#!`). When a script has a shebang and the shell type supports shebang execution (see [Shebang Behaviour](#shebang-behaviour)), the script is executed directly and the configured interpreter is not used.

**Example:**

```json
{
  "workspaceTasks.shellPaths": {
    "bash": "/usr/local/bin/bash",
    "pwsh": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "python": "python3"
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

---

## Shebang Behavior

The extension uses two independent concepts when processing shebang lines (`#!`):

| Property | Description |
| --- | --- |
| **`requireShebang`** | When `true`, **only** files that contain a shebang line are shown as tasks. Files without a shebang are silently ignored for that shell type. |
| **`useShebang`** | When `true`, files that **do** contain a shebang line are executed **directly** (e.g. `./script.py`), allowing the OS to invoke whichever interpreter is named in the shebang. Files without a shebang still use the configured interpreter. |

### Defaults per shell type

| Shell type | `requireShebang` | `useShebang` | Notes |
| --- | --- | --- | --- |
| `bash` | `false` | `true` | Scripts with shebangs run directly |
| `sh` | `false` | `true` | Scripts with shebangs run directly |
| `zsh` | `false` | `true` | Scripts with shebangs run directly |
| `python` | `false` | `true` | Scripts with shebangs run directly |
| `perl` | `false` | `true` | Scripts with shebangs run directly |
| `ruby` | `false` | `true` | Scripts with shebangs run directly |
| `fish` | `false` | `false` | Always uses the configured interpreter |
| `pwsh` | `false` | `false` | Always uses the configured interpreter |
| `batch` | `false` | `false` | Always uses the configured interpreter |
| `nushell` | `false` | `false` | Always uses the configured interpreter |

Because no built-in shell type sets `requireShebang: true`, **all script files with a matching extension are shown as tasks** regardless of whether they contain a shebang.

### How each execution mode works

**Interpreter mode** (no shebang, or shell type has `useShebang: false`):

```sh
python3 /path/to/script.py
```

The interpreter from `workspaceTasks.shellPaths` (or the built-in default) is used as the executable and the script path is passed as an argument.

**Direct execution mode** (file has a shebang and shell type has `useShebang: true`):

```sh
"/path/to/script.py"
```

The script is invoked directly. The OS reads the shebang line and launches the correct interpreter. For this to work on Unix-like systems the script must have the executable bit set (`chmod +x script.py`).

{: .note}
> If a script has a shebang but is not marked executable, direct execution will fail. Either make the script executable or configure `workspaceTasks.shellPaths` with the desired interpreter — the configured interpreter is always used when no shebang is present.
