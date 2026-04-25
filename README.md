# Workspace Tasks

<!-- markdownlint-disable-file MD033 -->

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version-short/darthminos.workspace-tasks.png?style=for-the-badge&colorA=555555&colorB=007ec6&label=VERSION)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Rating](https://vsmarketplacebadges.dev/rating-short/darthminos.workspace-tasks.png?style=for-the-badge&colorA=555555&colorB=007ec6&label=RATING)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/darthminos.workspace-tasks.png?style=for-the-badge&colorA=555555&colorB=007ec6&label=DOWNLOADS)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/darthminos.workspace-tasks.png?style=for-the-badge&colorA=555555&colorB=007ec6&label=INSTALLS)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)

[![Open VSX Version](https://img.shields.io/open-vsx/v/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=VERSION)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Rating](https://img.shields.io/open-vsx/rating/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=RATING)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=DOWNLOADS)](https://open-vsx.org/extension/darthminos/workspace-tasks)
[![Open VSX Release Date](https://img.shields.io/open-vsx/release-date/darthminos/workspace-tasks?style=for-the-badge&color=%23c260ef&label=RELEASE%20DATE)](https://open-vsx.org/extension/darthminos/workspace-tasks)

[![Codecov](https://img.shields.io/codecov/c/github/camalot/vscode-workspace-tasks?style=for-the-badge&label=COVERAGE&logo=codecov&logoColor=white)](https://app.codecov.io/gh/camalot/vscode-workspace-tasks/tree/develop)
[![GitHub Build](https://img.shields.io/github/actions/workflow/status/camalot/vscode-workspace-tasks/.github%2Fworkflows%2Fci.yml?style=for-the-badge&logo=github&label=BUILD)](https://github.com/camalot/vscode-workspace-tasks/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/camalot/vscode-workspace-tasks/.github%2Fworkflows%2Fjekyll-gh-pages.yml?style=for-the-badge&logo=github&label=DOCS)](https://github.com/camalot/vscode-workspace-tasks/actions/workflows/jekyll-gh-pages.yml)
[![Issues](https://img.shields.io/github/issues/camalot/vscode-workspace-tasks?style=for-the-badge&logo=github&color=%2313773d)](https://github.com/camalot/vscode-workspace-tasks/issues)

A powerful Visual Studio Code extension that automatically discovers, organizes, and runs tasks from your workspace. Manage build scripts, run tests, execute workflows, and organize your development tasks with favorites and queues—all from a single, intuitive interface.

---

**v1.6.0** 98.5% performance improvement of task discovery in large workspaces.

---

## 📑 Table of Contents

- [📥 Installation](#installation)
- [✔️ Requirements](#requirements)
- [📖 Documentation ↗](https://camalot.github.io/vscode-workspace-tasks/)
- [📷 Screenshots](#screenshots)
- [✨ Key Features](#key-features)
- [🤝 Contributing](#contributing)
- [📄 License](#license)

## 📷 Screenshots

<a id="screenshots"></a>

![Workspace-Tasks Sidebar Collapsed](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png) <!--![Workspace-Tasks Sidebar Expanded](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-expanded.png)--> ![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)
 ![Workspace-Tasks / TaskExplorer Side By Side](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-te-compare.gif)![Workspace-Tasks Load v1.6.0](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-load-v1.6.0.gif)

## ✨ Key Features

<a id="key-features"></a>

- **[🔍 Automatic Task Discovery ↗](https://camalot.github.io/vscode-workspace-tasks/task-types/)** - Scans your workspace for tasks from 20+ file types and build systems
- **📍 Flexible Placement** - View tasks in the dedicated sidebar or as a dockable panel in the Explorer
- **[⭐ Favorites ↗](https://camalot.github.io/vscode-workspace-tasks/features/favorites.html)** - Pin frequently used tasks for instant access
- **[🌱 Recent Tasks ↗](https://camalot.github.io/vscode-workspace-tasks/features/recents.html)** - Tracks the most recently executed tasks
- **[📋 Multiple Compound Tasks (Queues) ↗](https://camalot.github.io/vscode-workspace-tasks/features/task-queues.html)** - Create and manage named sequences of tasks with sequential or parallel execution
- **▶️ Quick Execution** - Double-click tasks to run instantly, or use the play icon (▶️)
- **⏹️ Smarter Stop Controls** - Optionally stop running `dependsOn` child tasks when stopping a compound task
- **🎯 Smart Organization** - Hierarchical tree view organized by workspace, task type, and file
- **🔀 Drag & Drop** - Reorder tasks in compound tasks (queues) with drag and drop
- **[🎭 GitHub Actions Support ↗](https://camalot.github.io/vscode-workspace-tasks/task-types/github-actions.html)** - Run GitHub Actions workflows locally with [act](https://github.com/nektos/act)
- **[⭕ CircleCI Support ↗](https://camalot.github.io/vscode-workspace-tasks/task-types/devops/circleci.html)** - Run CircleCI jobs locally and execute workflows sequentially via the CircleCI CLI
- **[🪣 Bitbucket Pipelines Support ↗](https://camalot.github.io/vscode-workspace-tasks/task-types/devops/bitbucket-pipelines.html)** - Run Bitbucket Pipelines locally via `pipeline-runner`
- **[📝 Custom Tasks ↗](https://camalot.github.io/vscode-workspace-tasks/features/custom-workspace-tasks.html)** - Define reusable task templates with dynamic inputs
- **[🔐 Environment Variable & Secrets Management ↗](https://camalot.github.io/vscode-workspace-tasks/features/task-environment-variables.html)** - Inject env vars and secrets into any task with fourteen-layer precedence; manage SecretStorage keys directly from the **Secrets** tree group (store, update, delete, copy key) or via the Command Palette; git-tracked env/secret files are flagged in the Problems panel to prevent accidental credential exposure
- **[🚫 Task Filtering ↗](https://camalot.github.io/vscode-workspace-tasks/features/task-filtering.html)** - Use `.tasksignore` files to exclude unwanted tasks
- **[🙈 Hide Tasks & Groups ↗](https://camalot.github.io/vscode-workspace-tasks/features/hide-tasks.html)** - Hide individual tasks or entire task groups from view
- **[🕰️ Task History, Statistics & Dashboard ↗](https://camalot.github.io/vscode-workspace-tasks/features/task-history.html)** - Track all task executions in a sortable history table, view per-task performance metrics (duration trends, success rates, failure streaks), and explore workspace-wide health in the interactive Dashboard with Chart.js charts
- **💾 Persistent State** - Favorites and Compound Tasks (queues) are saved across Visual Studio Code sessions
- **☁️ Settings Sync** - Sync your favorites and Compound Tasks (queues) across multiple machines via VS Code's Settings Sync
- **[🛡️ Run Guard ↗](https://camalot.github.io/vscode-workspace-tasks/features/run-guard.html)** - Require confirmation before running destructive or sensitive tasks; guard via manual toggle, definition flag, or label pattern
- **[🕜 Estimated Task Duration ↗](https://camalot.github.io/vscode-workspace-tasks/features/task-duration-estimates.html)** - View estimated duration for tasks based on historical execution data
- **[🤖 Language Model Tools ↗](https://camalot.github.io/vscode-workspace-tasks/features/lm-tool.html)** - Use `#wTasks` and `#runWTask` in GitHub Copilot chat to discover and run tasks without leaving the chat interface
- **🔒 Workspace Trust** - Respects [VS Code Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust): no tasks are discovered or displayed in untrusted workspaces

## 📥 Installation

<a id="installation"></a>

### From Visual Studio Code Marketplace

1. Open Visual Studio Code
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Workspace Tasks"
4. Click **Install**

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)

### From Open VSX

1. Open Editor (example: Cursor)
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Workspace Tasks"
4. Click **Install**

[Open VSX Registry](https://open-vsx.org/extension/darthminos/workspace-tasks)

### From Command Line

```shell
code --install-extension darthminos.workspace-tasks
```

```shell
cursor --install-extension darthminos.workspace-tasks
```

```shell
codium --install-extension darthminos.workspace-tasks
```

```shell
antigravity --install-extension darthminos.workspace-tasks
```

```shell
kiro --install-extension darthminos.workspace-tasks
```

```shell
windsurf --install-extension darthminos.workspace-tasks
```

<a id="requirements"></a>

### ✔️ Requirements

- **Visual Studio Code** 1.105.1 or later
- **External tools** must be installed for task execution (see [External Tools](https://camalot.github.io/vscode-workspace-tasks/getting-started/requirements.html#external-tool-requirements))

## 🛠️ Supported Task Types

<a id="supported-task-types"></a>
Workspace Tasks automatically discovers and organizes tasks from a wide variety of tools and frameworks:

### Package Managers & Build Tools

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

- **[npm](https://www.npmjs.com/)** - Scripts from `package.json`
- **[Yarn](https://yarnpkg.com/)** - Scripts from `package.json`
- **[pnpm](https://pnpm.io/)** - Scripts from `package.json`
- **[Bun](https://bun.com/)** - Scripts from `package.json` via `bun run <script>`, plus built-in `bun:install`, `bun:build`, and `bun:test`
- **[Composer](https://getcomposer.org/)** - PHP scripts from `composer.json`
- **[Pipenv](https://pipenv.pypa.io/)** - Python scripts from `Pipfile`
- **[Poe the Poet](https://poethepoet.natn.io/)** - Python task runner from `pyproject.toml`
- **[Poetry](https://python-poetry.org/)** - Python scripts from `pyproject.toml`
- **[Apache Ant](https://ant.apache.org/)** - Targets from `*.xml` build files
- **[Apache Maven](https://maven.apache.org/)** - Lifecycle goals from `pom.xml`
- **[Gradle](https://gradle.org/)** - Tasks from `*.gradle` files
- **[MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild)** - .NET project targets

### Task Runners

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/gulp.png" width="32" alt="Gulp" title="Gulp"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/grunt.png" width="32" alt="Grunt" title="Grunt"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/justfile.png" width="32" alt="Just" title="Just"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/mise.png" width="32" alt="mise" title="mise"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo.png" width="32" alt="cargo" title="cargo"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo-make.png" width="32" alt="cargo-make" title="cargo-make"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cake.png" width="32" alt="Cake Build" title="Cake Build"/>
</p>

- **[Gulp](https://gulpjs.com/)** - Tasks from `gulpfile.js` or `gulpfile.mjs`
- **[Grunt](https://gruntjs.com/)** - Tasks from `Gruntfile.js`
- **[Cargo](https://doc.rust-lang.org/cargo/)** - Tasks for `Cargo.toml`
- **[cargo-make](https://sagiegurari.github.io/cargo-make/)** - Rust task runner from `Makefile.toml` or `*.toml` files (requires [Cargo](https://doc.rust-lang.org/cargo/))
- **[Just](https://github.com/casey/just)** - Recipes from `justfile` or `*.just` files
- **[Make](https://www.gnu.org/software/make/)** - Targets from `Makefile`
- **[mise](https://mise.jdx.dev/)** - Tasks from active mise TOML config files (for example `mise.toml`, `.mise.toml`, and `.config/mise/config.toml`)
- **[Task (go-task)](https://taskfile.dev/)** - Tasks from `Taskfile.yml` (CLI-based discovery)
- **[Cake Build](https://cakebuild.net/)** - Tasks from `*.cake` scripts via `Task("...")`

### DevOps & Containers

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/docker.png" width="32" alt="Docker" title="Docker"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/github-actions.png" width="32" alt="GitHub Actions" title="GitHub Actions"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/circleci.png" width="32" alt="CircleCI" title="CircleCI"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/gitlab-ci.png" width="32" alt="GitLab CI" title="GitLab CI"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/bitbucket.png" width="32" alt="Bitbucket Pipelines" title="Bitbucket Pipelines"/>
</p>

- **[Docker](https://www.docker.com/)** - Build tasks from `Dockerfile`
- **[Docker Compose](https://docs.docker.com/compose/)** - Services from `docker-compose.yml`
- **[GitHub Actions](https://github.com/features/actions)** - Workflows from `.github/workflows/*.yml` (via [act](https://github.com/nektos/act))
- **[CircleCI](https://circleci.com/docs/)** - Jobs and workflows from `.circleci/config.yml` (via [CircleCI CLI](https://circleci.com/docs/guides/toolkit/local-cli/); workflows run sequentially locally) - **New in v1.9.0** - Possible issues running. see [CircleCI Task Type](https://camalot.github.io/vscode-workspace-tasks/task-types/devops/circleci.html) for details
- **[GitLab CI](https://docs.gitlab.com/ee/ci/)** - Jobs from `.gitlab-ci.yml` (via [gitlab-ci-local](https://github.com/firecow/gitlab-ci-local)) - **New in v1.9.0**
- **[Bitbucket Pipelines](https://support.atlassian.com/bitbucket-cloud/docs/get-started-with-bitbucket-pipelines/)** - Pipelines, stages, and steps from `bitbucket-pipelines.yml` (via [pipeline-runner](https://github.com/bitbucket-pipeline-runner/pipeline-runner)) - **New in v1.9.0**

### Scripts & Other

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/shell.png" width="32" alt="Shell Scripts" title="Shell Scripts"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/python.png" width="32" alt="Python" title="Python"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/jupyter.png" width="32" alt="Jupyter Notebook" title="Jupyter Notebook"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/vscode.png" width="32" alt="Visual Studio Code" title="Visual Studio Code"/>
</p>

- **Shell Scripts** - `.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd`; extensionless scripts (shebang + executable bit, opt-in via `shellEnabledTaskTypes.extensionless`)
- **[Jupyter Notebook](https://jupyter.org/)** - Execute notebook cells from `*.ipynb` files
  - **Requirements:** [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) must be installed
  - **Setup:** Configure a Jupyter Server through the Jupyter extension
  - **Features:**
    - Notebooks appear as parent tasks with code cells as children
    - Click to open notebook in Visual Studio Code's notebook editor
    - Execute individual cells or entire notebooks
    - Real-time cell execution status via the Jupyter Extension UI
- **Visual Studio Code Tasks** - Tasks from `.vscode/tasks.json` and the user-level `tasks.json` (`%APPDATA%\Code\User\tasks.json` on Windows, `~/.config/Code/User/tasks.json` on Linux, `~/Library/Application Support/Code/User/tasks.json` on macOS)
- **Workspace Tasks** - Custom tasks from `.workspace-tasks.json`
  - Supports positional run-time args via `${args}` in `command`
  - Supports command context tokens like `${workspaceFolder}`, `${file}`, and `${env.VAR}`

> The extension discovers tasks regardless of whether tools are installed. Execution requires the respective tool to be available in your PATH. See [Requirements](#requirements) for details.

## 🚀 Quick Start

<a id="quick-start"></a>

1. **Open a workspace** with supported task files (e.g., `package.json`, `Makefile`, shell scripts)
2. **Open the Workspace Tasks view** from the Activity Bar (sidebar) or Explorer panel
   - **Sidebar:** Click the Workspace Tasks icon in the Activity Bar
   - **Explorer:** Find "Workspace Tasks" in the Explorer panel, or drag it to your preferred location
3. **Browse tasks** organized by workspace folder and task type
4. **Run a task** by double-clicking it or clicking the play icon (▶️)
5. **Add to favorites** by clicking the star icon (☆)
6. **Create a Compound Task** by clicking the list icon to organize task sequences

**Tips:**

- Double-click a task to execute it immediately
- Single-click a task to open its definition file (when applicable)
- Use the collapse button (⊟) to toggle view states
- Create `.tasksignore` files to exclude unwanted tasks
- Drag the Explorer view to any panel location (sidebar, panel, or as a floating window)

<a id="configuration"></a>

## ⚙️ Configuration

All settings are grouped into five categories. See the [full configuration reference](https://camalot.github.io/vscode-workspace-tasks/configuration/) for details.

| Group | Description |
| --- | --- |
| [⚙️ General ↗](https://camalot.github.io/vscode-workspace-tasks/configuration/general/) | Debug logging and task execution metrics |
| [🔍 Task Discovery ↗](https://camalot.github.io/vscode-workspace-tasks/configuration/task-discovery/) | Exclusion patterns, discovery depth, enabled task types, and shell-script detection |
| [🖥️ Display & Interaction ↗](https://camalot.github.io/vscode-workspace-tasks/configuration/display-interaction/) | Tree view grouping, click behavior, action bar, icons, and recent-tasks |
| [▶️ Task Execution ↗](https://camalot.github.io/vscode-workspace-tasks/configuration/task-execution/) | Terminal presentation, graceful stop delay, and compound-task execution modes |
| [🌐 Environment ↗](https://camalot.github.io/vscode-workspace-tasks/configuration/environment/) | Executable paths for build tools and tool-specific settings |

---

<a id="contributing"></a>

## 🤝 Contributing

[Full Contributing Guide ↗](https://camalot.github.io/vscode-workspace-tasks/contributing/)

Contributions are welcome! If you'd like to improve Workspace Tasks, here's how:

### How to Contribute

1. **Report Issues** - Found a bug or have a feature request? [Open an issue](https://github.com/camalot/vscode-workspace-tasks/issues) on GitHub
2. **Submit Pull Requests** - Fork the repository, make your changes, and submit a PR
3. **Improve Documentation** - Help make the docs clearer or add examples
4. **Share Feedback** - Let us know how you use the extension and what could be better

### Development Setup

1. **Fork the repository**: `gh repo fork camalot/vscode-workspace-tasks`
2. **Open in Visual Studio Code**: `code vscode-workspace-tasks`
3. **Reopen in Dev Container**: When prompted, reopen the project in the recommended dev container for a consistent development environment
4. **Install dependencies**: `npm install`
5. **Run the extension**: Press `F5` to launch a new Extension Development Host instance with the extension loaded
6. **Run tests**: `npm test` to run unit tests and `npm run test:coverage` for coverage reports

### Guidelines

- Follow the existing code style and conventions
- Write clear commit messages
- Add tests for new features when applicable
- Update documentation for user-facing changes
- Ensure all tests pass before submitting

## 📦 Contributors

<a href="https://github.com/camalot/vscode-workspace-tasks/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=camalot/vscode-workspace-tasks" alt="Contributors: Made with contrib.rocks" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

<a id="license"></a>

## 📄 License

This project is licensed under the [Apache 2.0 License](LICENSE).

---

<!-- markdownlint-disable MD036 -->

**Made with ❤️ for the Visual Studio Code community**

<!-- markdownlint-enable MD036 -->
