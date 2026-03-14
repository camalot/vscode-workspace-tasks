---
layout: default
title: 🚦 DevOps & Containers
parent: 📱 Supported Task Types
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# DevOps & Containers
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

<!-- markdownlint-disable MD033 -->
<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/github-actions.png" width="32" alt="GitHub Actions" title="GitHub Actions"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/docker.png" width="32" alt="Docker" title="Docker"/>
</p>
<!-- markdownlint-enable MD033 -->

| Tool | File Patterns | Notes |
| --- | --- | --- |
| **[Docker](https://www.docker.com/)** | `**/Dockerfile*` | Container build tasks |
| **[Docker Compose](https://docs.docker.com/compose/)** | `**/docker-compose.yml` | Service orchestration |
| **[GitHub Actions](https://github.com/features/actions)** | `**/.github/workflows/*.yml` | CI/CD workflows via [act](https://github.com/nektos/act) |

See [GitHub Actions Integration](github-actions) for local workflow execution details.

---

## Next Steps

- [Package Managers & Build Tools](package-managers) — npm, Yarn, pnpm, Bun, Composer, and more
- [Task Runners](task-runners) — Gulp, Grunt, Cargo, Just, Make, mise
- [GitHub Actions Integration](github-actions) — Run workflows locally with act
- [Configuration Reference](../configuration) — Full settings reference including task type toggles
- [Enabling / Disabling Task Types](../configuration/task-type) — Control which task types are active
