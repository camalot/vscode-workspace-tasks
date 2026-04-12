---
layout: default
title: 🔍 Discovery
parent: 🔍 Task Discovery
grand_parent: ⚙️ Configuration
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Discovery Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.enabledTaskTypes

**Type:** `object`
**Default:**

```json
{
  "ant": true,
  "cake": true,
  "deno": true,
  "shell": true,
  "composer": true,
  "docker": true,
  "eslint": true,
  "github-actions": true,
  "gradle": true,
  "grunt": true,
  "gulp": true,
  "just": true,
  "make": true,
  "maven": true,
  "msbuild": true,
  "npm": true,
  "pipenv": true,
  "jupyter": true,
  "tsc": true,
  "webpack": true,
  "yarn": false,
  "pnpm": false,
  "venv": true,
  "vscode": true,
  "workspace": true
}
```

Select which task-type providers are active. Disabling a provider prevents the extension from scanning for tasks of that type, which can improve performance and reduce noise in the task tree.

#### Available Task Types

- **ant** - Ant
- **cake** - Cake Build
- **composer** - Composer
- **deno** - Deno
- **docker** - Docker (`dockerfile` and `docker-compose` task types)
- **eslint** - ESLint
- **github-actions** - GitHub Actions
- **gradle** - Gradle
- **grunt** - Grunt
- **gulp** - Gulp
- **jupyter** - Jupyter
- **just** - Just
- **make** - Makefile
- **maven** - Maven
- **msbuild** - MSBuild
- **npm** - NPM
- **pipenv** - Pipenv
- **pnpm** - PNPM
- **shell** - Shell scripts
- **tsc** - TypeScript Compiler
- **webpack** - Webpack
- **yarn** - Yarn
- **venv** - Virtual Environment
- **vscode** - Visual Studio Code tasks
- **workspace** - Custom Workspace Tasks

**Example:**

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "npm": true,
    "gulp": true,
    "grunt": true,
    "ant": false,
    "gradle": false,
    "maven": false,
    "shell": true,
    "vscode": true,
    "workspace": true
  }
}
```

![Screenshot - Enabled Task Types](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/task-types.png)

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

Enable or disable individual shell-script sub-types. This allows fine-grained control over which script file types are recognised as tasks when `workspaceTasks.enabledTaskTypes.shell` is `true`.

#### Supported Shell Types

- **bash** - Bash
- **batch** - Batch (`.bat` / `.cmd`)
- **fish** - Fish
- **nushell** - NuShell
- **perl** - Perl
- **pwsh** - PowerShell
- **python** - Python
- **ruby** - Ruby
- **sh** - POSIX Shell
- **zsh** - Zsh
- **other** - Any extension registered via `workspaceTasks.shellAdditionalExtensions`

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

---

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

Specify custom interpreter paths for shell script types. Each key is a shell type and the value is the path to the interpreter executable. The configured interpreter is used when a script **does not** contain a shebang line (`#!`), or when the shell type has `useShebang` set to `false`.

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

---

### workspaceTasks.shellAdditionalExtensions

**Type:** `object`
**Default:** `{}`

Register extra file extensions (beyond the built-in defaults) that should be treated as shell tasks. The key is a file extension **without** the leading dot and the value is the path to the interpreter to use for that extension.

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

## Shebang Behaviour

When the extension processes a shell-script file it applies two independent checks:

| Property | Description |
| --- | --- |
| **`requireShebang`** | When `true`, only files that contain a shebang line (`#!`) are shown as tasks. Files without a shebang are silently ignored for that shell type. |
| **`useShebang`** | When `true`, files that contain a shebang line are executed **directly** (e.g. `./script.py`), letting the OS invoke the interpreter named in the shebang. Files without a shebang still use the configured interpreter. |

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

{: .note}
> If a script has a shebang but is not marked executable, direct execution will fail. Either make the script executable or configure `workspaceTasks.shellPaths` with the desired interpreter — the configured interpreter is always used when no shebang is present.
