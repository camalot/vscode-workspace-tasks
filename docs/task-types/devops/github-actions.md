---
layout: default
title: 🧑‍💻 GitHub Actions
parent: 🚦 DevOps & Containers
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# GitHub Actions Integration
{: .no_toc }

Run GitHub Actions workflows locally using [act](https://github.com/nektos/act) to test workflows without pushing to GitHub. Workspace Tasks provides a rich interface for discovering and executing workflows with full input support.

<!-- markdownlint-disable-next-line MD025 MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Workspace Tasks automatically discovers all GitHub Actions workflow files in `.github/workflows/*.yml` and exposes them as runnable tasks. Each workflow appears with its individual jobs and supported trigger events.

### Task Tree Structure

``` text
GitHub Actions
└── Build & Test
    ├── Run Workflow (push)
    ├── Run Workflow (workflow_dispatch)  ← Shows input prompts
    └── Run Job: build
```

---

## Requirements

- **[act](https://github.com/nektos/act)** — Must be installed on your system
- **[Docker](https://www.docker.com/)** — Must be running (act uses containers)
- Configure `workspaceTasks.applicationPath.act` if act is not in your system `PATH`

---

## Features

- **Automatic Discovery** — Scans `.github/workflows/*.yml` files
- **Event Support** — Run workflows for `push`, `pull_request`, `workflow_dispatch`, and custom events
- **Job Execution** — Run individual jobs from multi-job workflows
- **Input Prompts** — Interactive prompts for `workflow_dispatch` inputs with validation
- **Status Indicators** — Real-time visual feedback during execution

---

## Configuration

Configure act in your VS Code `settings.json`:

```jsonc
{
  // Path to act executable
  "workspaceTasks.applicationPath.act": "act",

  // Environment files
  "workspaceTasks.act.envFile": ".env",
  "workspaceTasks.act.secretsFile": ".act.secrets",
  "workspaceTasks.act.variablesFile": ".act.vars",

  // Inline variables
  "workspaceTasks.act.variables": {
    "ENVIRONMENT": "development",
    "VERSION": "1.0.0"
  }
}
```

### workspaceTasks.applicationPath.act

**Type:** `string`
**Default:** `"act"`
**Scope:** `resource`

Path to the act executable. On Windows, if the path ends with `act`, `.exe` will be appended automatically. `~/` is expanded to the user's home directory.

```jsonc
{
  // Use an act binary bundled inside the project
  "workspaceTasks.applicationPath.act": "tools\\act\\act.exe"
}
```

### workspaceTasks.act.envFile

**Type:** `string`
**Default:** `""`

Path to a `.env` file containing environment variables for act. See the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure) for file format details.

### workspaceTasks.act.secretsFile

**Type:** `string`
**Default:** `""`

Path to a secrets file for act. Secrets are used to provide sensitive values to workflows without exposing them in configuration.

### workspaceTasks.act.variablesFile

**Type:** `string`
**Default:** `""`

Path to a variables file for act.

### workspaceTasks.act.variables

**Type:** `object`
**Default:** `{}`

Inline key/value pairs passed as variables to act runs.

---

## Usage Example

Given this workflow at `.github/workflows/build.yml`:

```yaml
name: Build & Test
on:
  push:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'staging'
        type: choice
        options: [development, staging, production]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm run build
```

Workspace Tasks will display:

```text
GitHub Actions
└── Build & Test
    ├── Run Workflow (push)
    ├── Run Workflow (workflow_dispatch)
    └── Run Job: build
```

When you run **"Run Workflow (workflow_dispatch)"**, Workspace Tasks will prompt you to fill in the `environment` input before executing.

---

## Tips

- Store secrets in a `.secrets` file and add it to `.gitignore` to keep credentials out of source control
- Test `workflow_dispatch` inputs locally before pushing to verify your workflow logic
- Run individual jobs to debug specific workflow steps without re-running the entire workflow
- Use the `workspaceTasks.act.variables` setting for environment-specific values that change between runs

---

## Next Steps

- [Supported Task Types](..) — All supported task types
- [DevOps & Containers](devops) — Docker, Docker Compose, and GitHub Actions overview
- [Configuration Reference](../configuration) — Full settings reference
- [GitHub Actions Settings (Act)](../configuration/github-actions) — Detailed act configuration reference
- [act Documentation](https://nektosact.com/) — Official act documentation
- [Enabling / Disabling Task Types](../configuration/task-type) — Control which task types are active
