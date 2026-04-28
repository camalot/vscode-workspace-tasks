---
layout: default
title: 📱 Supported Task Types
nav_order: 4
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Supported Task Types
{: .no_toc }

Workspace Tasks automatically discovers and organizes tasks from 25+ file types and build systems.

---

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

| Category | Description |
| --- | --- |
| [Package Managers & Build Tools](package-managers) | npm, Yarn, pnpm, Bun, Composer, Pipenv, Poetry, Ant, Maven, Gradle, MSBuild |
| [Task Runners](task-runners) | Gulp, Grunt, Cargo, cargo-make, Just, Make, mise, Cake Build |
| [DevOps & Containers](devops) | Docker, Docker Compose, GitHub Actions |
| [Scripts & Other](scripts) | Shell scripts, Python, Jupyter Notebooks, VS Code Tasks, Workspace Tasks |
| [GitHub Actions Integration](github-actions) | Run GitHub Actions workflows locally with act |

---

## Task Discovery Notes

> The extension **discovers** tasks regardless of whether tools are installed. **Execution** requires the respective tool to be available in your PATH.

- All patterns respect `.gitignore` and `.tasksignore` exclusions
- The following patterns are always ignored:
  - `**/node_modules/**`
  - `**/.git/**`
  - `**/.vscode-test/**`
  - `**/__pycache__/**`

### Discovery Patterns

{% include _glob_patterns.md %}

### Performance: Task Discovery Depth

Control how deep the extension searches for tasks using the `workspaceTasks.taskDiscovery.fetchDepth` setting:

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

Depth is measured from the workspace folder root:

``` tree
workspace-folder/          (depth 0)
├── package.json           ✅ depth 0
└── src/                   (depth 1)
    ├── Makefile           ✅ depth 1
    └── components/        (depth 2)
        └── package.json   ✅ depth 2 (if fetchDepth >= 2)
```

- **`null` (default)** — Full recursive search
- **Positive integer** — Limits search to that depth

---

## Enabling / Disabling Task Types

Use `workspaceTasks.enabledTaskTypes` in your `settings.json` to control which task types are active:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "npm": true,
    "gulp": true,
    "grunt": false,
    "ant": false,
    "gradle": false
  }
}
```

See the [Configuration Reference](../configuration) for the full list of available task type keys.

---

## Next Steps

- [Configuration Reference](../configuration) — Full settings reference including task type toggles
- [Task Filtering](../features/task-filtering) — Exclude specific files from task discovery
- [GitHub Actions Integration](github-actions) — Run workflows locally with act
- [Custom Workspace Tasks](../features/custom-workspace-tasks) — Define your own task templates
