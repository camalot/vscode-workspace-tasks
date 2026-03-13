---
layout: default
title: Scripts & Other
parent: Supported Task Types
nav_order: 4
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Scripts & Other
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

<!-- markdownlint-disable MD033 -->
<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/shell.png" width="32" alt="Shell Scripts" title="Shell Scripts"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/python.png" width="32" alt="Python" title="Python"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/jupyter.png" width="32" alt="Jupyter Notebook" title="Jupyter Notebook"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/vscode.png" width="32" alt="Visual Studio Code" title="Visual Studio Code"/>
</p>
<!-- markdownlint-enable MD033 -->

| Tool | File Patterns | Notes |
| --- | --- | --- |
| **Shell Scripts** | `**/*.{sh,bash,zsh,fish,ps1,bat,cmd}` | Executable scripts |
| **Python Virtual Environments** | `.venv/Scripts/` | Activation scripts |
| **[Jupyter Notebook](https://jupyter.org/)** | `**/*.ipynb` | Notebook cells (requires [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)) |
| **Visual Studio Code Tasks** | `**/.vscode/tasks.json`, user-level `tasks.json` | Native VS Code tasks |
| **Workspace Tasks** | `.workspace-tasks.json` | [Custom task templates](../features/custom-workspace-tasks) |

---

## Jupyter Notebook Details

- **Requirements:** The [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) must be installed and a Jupyter Server must be configured
- Notebooks appear as **parent tasks** with individual code cells as **child tasks**
- Click a task to open the notebook in VS Code's notebook editor
- Execute individual cells or entire notebooks
- Real-time cell execution status via the Jupyter Extension UI

---

## See Also

- [Package Managers & Build Tools](package-managers) — npm, Yarn, pnpm, Bun, Composer, and more
- [Task Runners](task-runners) — Gulp, Grunt, Cargo, Just, Make, mise
- [DevOps & Containers](devops) — Docker, Docker Compose, GitHub Actions
- [Custom Workspace Tasks](../features/custom-workspace-tasks) — Define your own reusable task templates
- [Configuration Reference](../configuration) — Full settings reference including task type toggles
