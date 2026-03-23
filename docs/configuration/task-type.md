---
layout: default
title: ⚙️ Task Type Settings
parent: ⚙️ Configuration
nav_order: 7
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Type Settings
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
- **cake** - Cake Build
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
