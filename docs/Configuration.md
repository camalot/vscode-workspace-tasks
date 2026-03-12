---
layout: default
title: Configuration
nav_order: 5
---
<!-- markdownlint-disable-next-line MD025 MD022 -->
# Configuration Settings
{: .no_toc }

This document describes all the configuration settings available in the Workspace Tasks extension.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## General Settings

### workspaceTasks.exclude

**Type:** `array` of `string`
**Default:** `[]`

Glob patterns to exclude from tasks. For example, to ignore all tasks in `sample` folders, add `**/sample/**`. Note that the patterns follow the [glob syntax](https://github.com/micromatch/glob). `**/node_modules/**` and `**/.git/**` are always ignored.

**Example:**

```json
{
  "workspaceTasks.exclude": ["**/sample/**", "**/test/**", "**/build/**"]
}
```{:.line-numbers}

![Screenshot - Exclude Patterns](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/exclude-patterns.png)

### workspaceTasks.taskDiscovery.fetchDepth

**Type:** `number` or `null`
**Default:** `null`

Specify the fetch depth when discovering tasks from within the workspace. A value of `null` means full fetch, while a positive integer limits the depth of the fetch operation. This can help improve performance when working with large repositories.

**Example:**

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

![Screenshot - Task Discovery Fetch Depth](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/fetch-depth.png)

---

## Task Display Settings

### workspaceTasks.task.singleClickAction

**Type:** `string`
**Default:** `"open"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

Action to perform when a task is single-clicked.

- **run** - Run the task
- **runWithArgs** - Run the task with arguments
- **open** - Open the task
- **none** - Do nothing

**Example:**

```json
{
  "workspaceTasks.task.singleClickAction": "open"
}
```

![Screenshot - Single Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/single-click.png)

### workspaceTasks.task.doubleClickAction

**Type:** `string`
**Default:** `"run"`
**Options:** `"run"`, `"runWithArgs"`, `"open"`, `"none"`

Action to perform when a task is double-clicked.

- **run** - Run the task
- **runWithArgs** - Run the task with arguments
- **open** - Open the task
- **none** - Do nothing

**Example:**

```json
{
  "workspaceTasks.task.doubleClickAction": "run"
}
```

![Screenshot - Double Click Action](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/double-click.png)

### workspaceTasks.task.statusResetDelay

**Type:** `number`
**Default:** `500`

The delay in **milliseconds** before resetting the task icon back to its original state after execution. Set to `0` to reset immediately.

**Example:**

```json
{
  "workspaceTasks.task.statusResetDelay": 1000
}
```

![Screenshot - Status Reset Delay](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/status-reset-delay.png)

---

## Task Grouping Settings

### workspaceTasks.groups.enabled

**Type:** `boolean`
**Default:** `true`

Group tasks by type, folder, and custom separator. When enabled, tasks will be grouped based on the specified separator and other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.enabled": true
}
```

![Screenshot - Groups Enabled](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/groups-enabled.png)

### workspaceTasks.groups.useParentFolder

**Type:** `boolean`
**Default:** `false`

Group tasks by their parent folder. When enabled, tasks will be grouped based on their parent folder in addition to other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.useParentFolder": true
}
```

![Screenshot - Use Parent Folder](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/use-parent-folder.png)

### workspaceTasks.groups.taskSeparator

**Type:** `string`
**Default:** `""`

Separator used to split task name into groups. For example, a task named `build:frontend` with a separator of `:` would be grouped under `build`. An empty string means no grouping will be applied.

**Example:**

```json
{
  "workspaceTasks.groups.taskSeparator": ":"
}
```

![Screenshot - Task Separator](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/task-separator.png)

### workspaceTasks.groups.recentTasks.enabled

**Type:** `boolean`
**Default:** `false`

When enabled, recent tasks will be grouped based on the specified separator and other grouping rules.

**Example:**

```json
{
  "workspaceTasks.groups.recentTasks.enabled": true
}
```

![Screenshot - Recent Tasks Grouping](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/recent-groups.png)

### workspaceTasks.recentTasks.maxItems

**Type:** `number`
**Default:** `20`
**Minimum:** `0`

Maximum number of recent tasks to display in the Recent Tasks group. Once the limit is reached, the oldest tasks will drop off the list. Set to 0 to disable the Recent Tasks group.

**Example:**

```json
{
  "workspaceTasks.recentTasks.maxItems": 20
}
```

![Screenshot - Max Recent Tasks](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/max-recent.png)

---

## Task Icon Settings

### workspaceTasks.task.iconType

**Type:** `string`
**Default:** `"type"`
**Options:** `"type"`, `"file"`, `"gear"`, `"run"`, `"custom"`

Select the type of icon to display for tasks.

- **type** - The task type icon used to represent the type of the task
- **file** - The `vscode` defined file icon for the task source file
- **gear** - A gear icon that usually represents settings or configuration
- **run** - A play icon that usually represents running or starting something
- **custom** - A custom icon defined by the user

**Example:**

```json
{
  "workspaceTasks.task.iconType": "run"
}
```

![Screenshot - Icon Type](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-type.png)

### workspaceTasks.task.iconTypeCustom

**Type:** `string`
**Default:** `""`

Specify a custom icon for the task. This can be a path to an png or svg file, or it can be a [ThemeIcon](https://code.visualstudio.com/api/references/icons-in-labels) in the format `$(iconName)`. `workspaceTasks.task.iconType` must be set to `custom` for this to take effect.

**Example:**

```json
{
  "workspaceTasks.task.iconType": "custom",
  "workspaceTasks.task.iconTypeCustom": "$(rocket)"
}
```

![Screenshot - Custom Icon Built-In](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-builtin.png)

Or with a file path:

```json
{
  "workspaceTasks.task.iconType": "custom",
  "workspaceTasks.task.iconTypeCustom": ".vscode/icons/task-icon.svg"
}
```

![Screenshot - Custom Icon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/icon-custom-path.png)

---

## Task Action Settings

### workspaceTasks.task.actionBar

**Type:** `object`
**Default:**

```json
{
  "run": true,
  "runWithArgs": true,
  "openFile": true,
  "favorite": true,
  "queue": true,
  "hide:": false,
  "unhide": true
}
```

Select which items should be shown in the task action bar for each task. This allows you to customize the actions available for tasks in the workspace.

#### Properties

- **run** - Run Task
- **runWithArgs** - Run Task with Arguments
- **openFile** - Open File
- **favorite** - Add to Favorites
- **queue** - Add to Queue
- **hide** - Hide Task
- **unhide** - Unhide Task

**Example:**

```json
{
  "workspaceTasks.task.actionBar": {
    "run": true,
    "runWithArgs": false,
    "openFile": true,
    "favorite": true,
    "queue": false,
    "hide": false,
    "unhide": true
  }
}
```

![Screenshot - Task Action Bar](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/action-bar.png)

---

## Task Presentation Options

### workspaceTasks.task.presentationOptions

**Type:** `object`

Configure how tasks are presented when executed.

#### workspaceTasks.task.presentationOptions.reveal

**Type:** `string`
**Default:** `"always"`
**Options:** `"always"`, `"silent"`, `"never"`

Controls whether the task output is revealed in the user interface.

#### workspaceTasks.task.presentationOptions.clear

**Type:** `boolean`
**Default:** `false`

Controls whether the terminal is cleared before executing the task.

#### workspaceTasks.task.presentationOptions.close

**Type:** `boolean`
**Default:** `false`

Controls whether the terminal is closed after executing the task.

#### workspaceTasks.task.presentationOptions.echo

**Type:** `boolean`
**Default:** `true`

Controls whether the command associated with the task is echoed in the user interface.

#### workspaceTasks.task.presentationOptions.focus

**Type:** `boolean`
**Default:** `false`

Controls whether the panel showing the task output is taking focus.

#### workspaceTasks.task.presentationOptions.panel

**Type:** `string`
**Default:** `"shared"`
**Options:** `"dedicated"`, `"shared"`, `"new"`

Controls if the task panel is used for this task only (dedicated), shared between tasks (shared) or if a new panel is created on every task execution (new).

**Example:**

```json
{
  "workspaceTasks.task.presentationOptions": {
    "reveal": "always",
    "clear": false,
    "close": false,
    "echo": true,
    "focus": false,
    "panel": "shared"
  }
}
```

![Screenshot - Presentation Options](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/presentation.png)

---

## Task Type Settings

### workspaceTasks.enabledTaskTypes

**Type:** `object`
**Default:**

```json
{
  "ant": true,
  "deno": true,
  "shell": true,
  "composer": true,
  "docker": true,
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
  "yarn": false,
  "pnpm": false,
  "venv": true,
  "vscode": true,
  "workspace": true
}
```

Select the types of tasks that the extension should support and display in the task list. Choose the task types (e.g., npm, script, makefile) that the extension will recognize and show in the task list.

#### Available Task Types

- **ant** - Ant
- **composer** - Composer
- **deno** - Deno
- **docker** - Docker
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
- **shell** - Scripts
- **tsc** - TypeScript Compiler
- **yarn** - Yarn
- **venv** - Virtual Environment
- **vscode** - Visual Studio Code
- **workspace** - Workspace Tasks

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

## Shell Script Settings

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

---

## Application Path Settings

These settings allow you to specify custom paths for various build tools and task runners.

### workspaceTasks.applicationPath.act

**Type:** `string`
**Default:** `"act"`
**Scope:** `resource`

Act allows you to run GitHub Actions locally. Specify the path to the [Act](https://github.com/nektos/act) executable. On Windows, if the path ends with `act`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```jsonc
{
  // this will look for the executable within the project
  "workspaceTasks.applicationPath.act": "tools\\act\\act.exe",
}
```

![Screenshot - Act Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-path.png)

### workspaceTasks.applicationPath.ant

**Type:** `string`
**Default:** `"ant"`

Specify the path to the Ant executable. On Windows, if the path ends with `ant`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ant": "ant"
}
```

![Screenshot - Ant Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ant-path.png)

### workspaceTasks.applicationPath.ansicon

**Type:** `string`
**Default:** `"ansicon.exe"`

Specify the path to the ANSICON executable. This is used to enable colored output for Ant tasks in the terminal. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ansicon": "ansicon.exe"
}
```

![Screenshot - Ansicon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ansicon-path.png)

### workspaceTasks.applicationPath.composer

**Type:** `string`
**Default:** `"composer"`

Specify the path to the [Composer](https://getcomposer.org/) executable. On Windows, if the path ends with `composer`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.composer": "composer"
}
```

![Screenshot - Composer Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/composer-path.png)

### workspaceTasks.applicationPath.deno

**Type:** `string`
**Default:** `"~/.deno/bin/deno"`

Specify the path to the [Deno](https://deno.land/) executable. On Windows, if the path ends with `deno`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.deno": "~/.deno/bin/deno"
}
```

![Screenshot - Deno Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/deno-path.png)

### workspaceTasks.applicationPath.gradle

**Type:** `string`
**Default:** `"gradlew"`

Specify the path to the [Gradle](https://gradle.org/) executable. On Windows, if the path ends with `gradle`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.gradle": "gradlew"
}
```

![Screenshot - Gradle Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/gradle-path.png)

### workspaceTasks.applicationPath.just

**Type:** `string`
**Default:** `"just"`

Specify the path to the [Just](https://just.systems/) executable. On Windows, if the path ends with `just`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.just": "just"
}
```

![Screenshot - Just Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/just-path.png)

### workspaceTasks.applicationPath.make

**Type:** `string`
**Default:** `"make"`

Specify the path to the Make executable. On Windows, if the path ends with `make`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.make": "make"
}
```

![Screenshot - Make Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/make-path.png)

### workspaceTasks.applicationPath.maven

**Type:** `string`
**Default:** `"mvn"`

Specify the path to the [Maven](https://maven.apache.org/) executable. On Windows, if the path ends with `mvn`, `.cmd` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.maven": "mvn"
}
```

![Screenshot - Maven Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/maven-path.png)

### workspaceTasks.applicationPath.msbuild

**Type:** `string`
**Default:** `"msbuild"`

Specify the path to the MSBuild executable. On Windows, if the path ends with `msbuild`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.msbuild": "msbuild"
}
```

![Screenshot - MSBuild Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/msbuild-path.png)

### workspaceTasks.applicationPath.pipenv

**Type:** `string`
**Default:** `"pipenv"`

Specify the path to the [Pipenv](https://pipenv.pypa.io/en/latest/) executable. On Windows, if the path ends with `pipenv`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.pipenv": "pipenv"
}
```

![Screenshot - Pipenv Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/pipenv-path.png)

---

## GitHub Actions Settings (Act)

These settings configure how the extension runs GitHub Actions locally using Act.

### workspaceTasks.act.envFile

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Specify the path to a .env file containing environment variables for Act. This file will be used to provide environment variable values when running GitHub Actions locally with Act. For examples of the file format see the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure).

**Example:**

```json
{
  "workspaceTasks.act.envFile": ".env.act"
}
```

![Screenshot - Act Env File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-env.png)

### workspaceTasks.act.variablesFile

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Path to the variables file for `act`. The file format is the same as `.env` file format.

**Example:**

```json
{
  "workspaceTasks.act.variablesFile": ".vars"
}
```

![Screenshot - Act Variables File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-vars-file.png)

### workspaceTasks.act.variables

**Type:** `object`
**Default:** `{}`
**Scope:** `resource`

Variables to pass to 'act'. Each key-value pair represents a variable name and its corresponding value.

**Example:**

```json
{
  "workspaceTasks.act.variables": {
    "MY_VAR": "value",
    "BUILD_ENV": "development"
  }
}
```

![Screenshot - Act Variables](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-vars.png)

### workspaceTasks.act.secretsFile

**Type:** `string`
**Default:** `".secrets"`
**Scope:** `resource`

Specify the path to a .env file containing secrets for Act. This file will be used to provide secret values when running GitHub Actions locally with Act. For examples of the file format see the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure).

**Example:**

```json
{
  "workspaceTasks.act.secretsFile": ".secrets"
}
```

![Screenshot - Act Secrets File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-secrets.png)

---

## Ant Settings

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

---
