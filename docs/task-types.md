---
layout: default
title: Supported Task Types
nav_order: 4
---

# Supported Task Types
{: .no_toc }

Workspace Tasks automatically discovers and organizes tasks from 20+ file types and build systems.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Package Managers & Build Tools

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/npm.png" width="32" alt="npm" title="npm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/yarn.png" width="32" alt="Yarn" title="Yarn"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pnpm.png" width="32" alt="pnpm" title="pnpm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/bun.png" width="32" alt="Bun" title="Bun"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/composer.png" width="32" alt="Composer" title="Composer"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pipenv.png" width="32" alt="Pipenv" title="Pipenv"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/poe.png" width="32" alt="Poe the Poet" title="Poe the Poet"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/poetry.png" width="32" alt="Poetry" title="Poetry"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/ant.png" width="32" alt="Ant" title="Ant"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/maven.png" width="32" alt="Maven" title="Maven"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/msbuild.png" width="32" alt="MSBuild" title="MSBuild"/>
</p>

| Tool | File Patterns | Notes |
|---|---|---|
| **[npm](https://www.npmjs.com/)** | `**/package.json` | Reads `scripts` section |
| **[Yarn](https://yarnpkg.com/)** | `**/package.json` | Reads `scripts` section |
| **[pnpm](https://pnpm.io/)** | `**/package.json` | Reads `scripts` section |
| **[Bun](https://bun.com/)** | `**/package.json` | Scripts via `bun run <script>`, plus built-in `bun:install`, `bun:build`, and `bun:test` |
| **[Composer](https://getcomposer.org/)** | `**/composer.json` | PHP dependency scripts |
| **[Pipenv](https://pipenv.pypa.io/)** | `**/Pipfile` | Python scripts |
| **[Poe the Poet](https://poethepoet.natn.io/)** | `**/pyproject.toml` | Python task runner |
| **[Poetry](https://python-poetry.org/)** | `**/pyproject.toml` | Python scripts |
| **[Apache Ant](https://ant.apache.org/)** | `**/*.xml` | Build file targets |
| **[Apache Maven](https://maven.apache.org/)** | `**/pom.xml` | Lifecycle goals |
| **[Gradle](https://gradle.org/)** | `**/*.gradle` | Java/Android build tasks |
| **[MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild)** | `**/*.{csproj,vbproj,sln}` | .NET project targets |

---

## Task Runners

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/gulp.png" width="32" alt="Gulp" title="Gulp"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/grunt.png" width="32" alt="Grunt" title="Grunt"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/justfile.png" width="32" alt="Just" title="Just"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/mise.png" width="32" alt="mise" title="mise"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo.png" width="32" alt="cargo" title="cargo"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo-make.png" width="32" alt="cargo-make" title="cargo-make"/>
</p>

| Tool | File Patterns | Notes |
|---|---|---|
| **[Gulp](https://gulpjs.com/)** | `**/gulpfile.{js,mjs}` | Exported tasks |
| **[Grunt](https://gruntjs.com/)** | `**/Gruntfile.js` | Registered tasks |
| **[Cargo](https://doc.rust-lang.org/cargo/)** | `**/Cargo.toml` | Rust build tasks |
| **[cargo-make](https://sagiegurari.github.io/cargo-make/)** | `**/{Makefile.toml,*.toml}` | Rust task runner (requires Cargo) |
| **[Just](https://github.com/casey/just)** | `**/{justfile,.justfile,*.just}` | Command recipes |
| **[Make](https://www.gnu.org/software/make/)** | `**/Makefile` | Build targets |
| **[mise](https://mise.jdx.dev/)** | `**/mise.toml`, `**/mise.*.toml`, `**/mise.*.local.toml` | TOML tasks and file tasks |

---

## DevOps & Containers

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/github-actions.png" width="32" alt="GitHub Actions" title="GitHub Actions"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/docker.png" width="32" alt="Docker" title="Docker"/>
</p>

| Tool | File Patterns | Notes |
|---|---|---|
| **[Docker](https://www.docker.com/)** | `**/Dockerfile*` | Container build tasks |
| **[Docker Compose](https://docs.docker.com/compose/)** | `**/docker-compose.yml` | Service orchestration |
| **[GitHub Actions](https://github.com/features/actions)** | `**/.github/workflows/*.yml` | CI/CD workflows via [act](https://github.com/nektos/act) |

See [GitHub Actions Integration](github-actions) for local workflow execution details.

---

## Scripts & Other

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/shell.png" width="32" alt="Shell Scripts" title="Shell Scripts"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/python.png" width="32" alt="Python" title="Python"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/jupyter.png" width="32" alt="Jupyter Notebook" title="Jupyter Notebook"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/vscode.png" width="32" alt="Visual Studio Code" title="Visual Studio Code"/>
</p>

| Tool | File Patterns | Notes |
|---|---|---|
| **Shell Scripts** | `**/*.{sh,bash,zsh,fish,ps1,bat,cmd}` | Executable scripts |
| **Python Virtual Environments** | `.venv/Scripts/` | Activation scripts |
| **[Jupyter Notebook](https://jupyter.org/)** | `**/*.ipynb` | Notebook cells (requires [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)) |
| **Visual Studio Code Tasks** | `**/.vscode/tasks.json`, user-level `tasks.json` | Native VS Code tasks |
| **Workspace Tasks** | `.workspace-tasks.json` | [Custom task templates](WorkspaceTasks) |

### Jupyter Notebook Details

- **Requirements:** The [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) must be installed and a Jupyter Server must be configured
- Notebooks appear as **parent tasks** with individual code cells as **child tasks**
- Click a task to open the notebook in VS Code's notebook editor
- Execute individual cells or entire notebooks
- Real-time cell execution status via the Jupyter Extension UI

---

## Task Discovery Notes

> The extension **discovers** tasks regardless of whether tools are installed. **Execution** requires the respective tool to be available in your PATH.

- All patterns respect `.gitignore` and `.tasksignore` exclusions
- The following patterns are always ignored:
  - `**/node_modules/**`
  - `**/.git/**`
  - `**/.vscode-test/**`
  - `**/__pycache__/**`

### Performance: Task Discovery Depth

Control how deep the extension searches for tasks using the `workspaceTasks.taskDiscovery.fetchDepth` setting:

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

Depth is measured from the workspace folder root:

```
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

See the [Configuration Reference](Configuration) for the full list of available task type keys.

---

## See Also

- [Configuration Reference](Configuration) — Full settings reference including task type toggles
- [Task Filtering](TaskFiltering) — Exclude specific files from task discovery
- [GitHub Actions Integration](github-actions) — Run workflows locally with act
- [Custom Workspace Tasks](WorkspaceTasks) — Define your own task templates
