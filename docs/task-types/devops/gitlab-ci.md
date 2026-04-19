---
layout: default
title: 🦊 GitLab CI (gitlab-ci-local)
parent: 🚦 DevOps & Containers
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# GitLab CI (gitlab-ci-local)
{: .no_toc }

Run GitLab CI/CD pipeline jobs locally using [gitlab-ci-local](https://github.com/firecow/gitlab-ci-local). Workspace Tasks discovers your `.gitlab-ci.yml` files and exposes each job as a runnable task — without pushing to GitLab.

<!-- markdownlint-disable-next-line MD025 MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
> **New in v1.9.0**: GitLab CI support.

---

## Overview

Workspace Tasks automatically discovers `.gitlab-ci.yml` files in your workspace and uses `gitlab-ci-local --list-json` to enumerate available jobs. Each CI file appears as a collapsible parent item with its jobs listed as children.

Jobs with `when: never` are automatically filtered from the task tree — they are intentionally disabled and are never runnable.

### Task Tree Structure

```text
.gitlab-ci.yml
├── npm-install          (stage: build)
├── npm-outdated         (stage: test)
├── docker-compose-up    (stage: deploy)
├── docker-compose-down  (stage: .post, manual)
├── always-cleanup       (stage: .post, always)
└── notify-failure       (stage: .post, on_failure)
```

---

## Requirements

- **[gitlab-ci-local](https://github.com/firecow/gitlab-ci-local)** — Must be installed on your system (`npm install -g gitlab-ci-local`)
- **[Docker](https://www.docker.com/)** — Must be running (gitlab-ci-local uses containers for most jobs)
- Configure `workspaceTasks.applicationPath.gitlabCiLocal` if `gitlab-ci-local` is not in your system `PATH`

> **Note**: This task type is **disabled by default** because it requires both Docker and an external tool. Enable it via `workspaceTasks.enabledTaskTypes`.

---

## Features

- **Automatic Discovery** — Scans `**/.gitlab-ci.yml` across the workspace
- **Custom File Patterns** — Additional glob patterns via `gitlabCiLocal.additionalFilePatterns`
- **Job Filtering** — Jobs with `when: never` are automatically hidden
- **Stage Labels** — Each job shows its pipeline stage as a description
- **Rich Tooltips** — Stage, when condition, allow_failure, and needs are shown in hover tooltips
- **Variable Support** — Pass CI/CD variables via `gitlabCiLocal.variable` or a variables file
- **Multi-root Support** — Works correctly in multi-root workspaces

---

## Configuration

Configure GitLab CI Local in your VS Code `settings.json`:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "gitlab-ci": true
  },
  "workspaceTasks.applicationPath.gitlabCiLocal": "gitlab-ci-local",
  "workspaceTasks.gitlabCiLocal.variablesFile": ".variables.yml",
  "workspaceTasks.gitlabCiLocal.variable": [
    "DEPLOY_ENV=staging"
  ]
}
```

### Available Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `workspaceTasks.applicationPath.gitlabCiLocal` | `string` | `"gitlab-ci-local"` | Path to the `gitlab-ci-local` executable |
| `workspaceTasks.gitlabCiLocal.additionalFilePatterns` | `string[]` | `[]` | Extra glob patterns for non-standard CI file locations |
| `workspaceTasks.gitlabCiLocal.variablesFile` | `string` | `""` | Path to a YAML variables file (`--variables-file`) |
| `workspaceTasks.gitlabCiLocal.variable` | `string[]` | `[]` | Array of `KEY=VALUE` variables (`--variable`) |
| `workspaceTasks.gitlabCiLocal.unsetVariable` | `string[]` | `[]` | Variable names to unset (`--unset-variable`) |
| `workspaceTasks.gitlabCiLocal.remoteVariables` | `string[]` | `[]` | Remote variable sources (`--remote-variables`) |
| `workspaceTasks.gitlabCiLocal.home` | `string` | `""` | Override home directory (`--home`) |

---

## Custom File Patterns

By default, the extension discovers all `**/.gitlab-ci.yml` files. To include CI files with non-standard names, add extra glob patterns:

```json
{
  "workspaceTasks.gitlabCiLocal.additionalFilePatterns": [
    "**/.gitlab-ci.staging.yml",
    "**/ci/pipeline.yml"
  ]
}
```

These patterns are merged with the built-in `**/.gitlab-ci.yml` pattern.

---

## Variables

### Inline Variables

Pass variables directly in settings:

```json
{
  "workspaceTasks.gitlabCiLocal.variable": [
    "DEPLOY_ENV=staging",
    "APP_VERSION=1.2.3"
  ]
}
```

### Variables File

Point to a YAML file containing variables:

```json
{
  "workspaceTasks.gitlabCiLocal.variablesFile": ".local-variables.yml"
}
```

Example `.local-variables.yml`:

```yaml
DEPLOY_ENV: staging
APP_VERSION: 1.2.3
```

---

## Home

Override the home directory used by `gitlab-ci-local`:

```json
{
  "workspaceTasks.gitlabCiLocal.home": "/custom/home"
}
```

---

## Windows Support

`gitlab-ci-local` is not supported on Windows. This task type will not produce any tasks when running on Windows.

---

## See Also

- [gitlab-ci-local documentation](https://github.com/firecow/gitlab-ci-local)
- [Application Path Configuration](../configuration/environment/application-paths/gitlab-ci-local.html)
- [Enabled Task Types](../configuration/general.html#workspacetasksenabledtasktypes)
