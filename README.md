# Workspace Tasks

<!-- markdownlint-disable-file MD033 -->

[![package_json version](https://img.shields.io/github/package-json/v/camalot/vscode-workspace-tasks.svg?logo=github)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)

<!-- [![Installs](https://img.shields.io/visual-studio-marketplace/i/darthminos.workspace-tasks.svg)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/darthminos.workspace-tasks.svg)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks) -->

[![VSCode Marketplace Ratings](https://img.shields.io/visual-studio-marketplace/r/darthminos.workspace-tasks.svg?label=vscode%20rating)](https://marketplace.visualstudio.com/items?itemName=darthminos.workspace-tasks) [![Open VSX Rating](https://img.shields.io/open-vsx/stars/darthminos/workspace-tasks?label=open%20vsx%20rating)](https://open-vsx.org/extension/darthminos/workspace-tasks)

A powerful Visual Studio Code extension that automatically discovers, organizes, and runs tasks from your workspace. Manage build scripts, run tests, execute workflows, and organize your development tasks with favorites and queues—all from a single, intuitive interface.

![Workspace-Tasks Sidebar Collapsed](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-collapsed.png) <!--![Workspace-Tasks Sidebar Expanded](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-expanded.png)--> ![Workspace-Tasks Sidebar Queues & Favorites](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/sidebar-queues-favorites.png)
 ![Workspace-Tasks / TaskExplorer Side By Side](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/wst-te-compare.gif)

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [📖 Documentation](#-documentation)
- [📥 Installation](#-installation)
- [🛠️ Supported Task Types](#️-supported-task-types)
- [🌱 Recent Tasks](#-recent-tasks)
- [⭐ Favorites](#-favorites)
- [📋 Task Queues](#-task-queues)
- [🙈 Hide Tasks & Groups](#-hide-tasks--groups)
- [⚙️ Configuration](#️-configuration)
  - [Custom Workspace Tasks](docs/WorkspaceTasks.md)
  - [GitHub Actions Integration](#github-actions-integration)
  - [Task Ignore Patterns](docs/TaskFiltering.md)
- [🔧 Advanced Features](#-advanced-features)
- [📋 Requirements](#-requirements)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ Key Features

- **🔍 Automatic Task Discovery** - Scans your workspace for tasks from 20+ file types and build systems
- **📍 Flexible Placement** - View tasks in the dedicated sidebar or as a dockable panel in the Explorer
- **⭐ Favorites** - Pin frequently used tasks for instant access
- **🌱 Recent Tasks** - Tracks the most recently executed tasks
- **📋 Multiple Task Queues** - Create and manage named sequences of tasks
- **▶️ Quick Execution** - Double-click tasks to run instantly, or use the play icon (▶️)
- **🎯 Smart Organization** - Hierarchical tree view organized by workspace, task type, and file
- **🔀 Drag & Drop** - Reorder tasks in queues with drag and drop
- **🎭 GitHub Actions Support** - Run GitHub Actions workflows locally with [act](https://github.com/nektos/act)
- **📝 Custom Tasks** - Define reusable task templates with dynamic inputs
- **🚫 Task Filtering** - Use `.tasksignore` files to exclude unwanted tasks
- **🙈 Hide Tasks & Groups** - Hide individual tasks or entire task groups from view
- **💾 Persistent State** - Favorites and queues are saved across Visual Studio Code sessions

## 📖 Documentation

- [Configuration Guide](docs/Configuration.md)
- [Task Filtering](docs/TaskFiltering.md)
- [Workspace Tasks](docs/WorkspaceTasks.md)

## 📥 Installation

### From Visual Studio Code Marketplace

1. Open Visual Studio Code
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Workspace Tasks"
4. Click **Install**

### From Command Line

```bash
code --install-extension darthminos.workspace-tasks
```

### Requirements

- **Visual Studio Code** 1.108.1 or later
- **External tools** must be installed for task execution (see [Requirements](#-requirements) section)

## 🛠️ Supported Task Types

Workspace Tasks automatically discovers and organizes tasks from a wide variety of tools and frameworks:

### Package Managers & Build Tools

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/npm.png" width="32" alt="npm" title="npm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/yarn.png" width="32" alt="Yarn" title="Yarn"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pnpm.png" width="32" alt="pnpm" title="pnpm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/composer.png" width="32" alt="Composer" title="Composer"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pipenv.png" width="32" alt="Pipenv" title="Pipenv"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/ant.png" width="32" alt="Ant" title="Ant"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/maven.png" width="32" alt="Maven" title="Maven"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/msbuild.png" width="32" alt="MSBuild" title="MSBuild"/>
</p>

- **[npm](https://www.npmjs.com/)** - Scripts from `package.json`
- **[Yarn](https://yarnpkg.com/)** - Scripts from `package.json`
- **[pnpm](https://pnpm.io/)** - Scripts from `package.json`
- **[Composer](https://getcomposer.org/)** - PHP scripts from `composer.json`
- **[Pipenv](https://pipenv.pypa.io/)** - Python scripts from `Pipfile`
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
</p>

- **[Gulp](https://gulpjs.com/)** - Tasks from `gulpfile.js` or `gulpfile.mjs`
- **[Grunt](https://gruntjs.com/)** - Tasks from `Gruntfile.js`
- **[Just](https://github.com/casey/just)** - Recipes from `justfile` or `*.just` files
- **[Make](https://www.gnu.org/software/make/)** - Targets from `Makefile`
- **[mise](https://mise.jdx.dev/)** - Tasks from `mise.toml` or `mise-tasks/` directory

### DevOps & Containers

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/github-actions.png" width="32" alt="GitHub Actions" title="GitHub Actions"/>
</p>

- **[Docker](https://www.docker.com/)** - Build tasks from `Dockerfile`
- **[Docker Compose](https://docs.docker.com/compose/)** - Services from `docker-compose.yml`
- **[GitHub Actions](https://github.com/features/actions)** - Workflows from `.github/workflows/*.yml` (via [act](https://github.com/nektos/act))

### Scripts & Other

<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/shell.png" width="32" alt="Shell Scripts" title="Shell Scripts"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/python.png" width="32" alt="Python" title="Python"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/jupyter.png" width="32" alt="Jupyter Notebook" title="Jupyter Notebook"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/vscode.png" width="32" alt="Visual Studio Code" title="Visual Studio Code"/>
</p>

- **Shell Scripts** - `.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd`
- **Python Virtual Environments** - Activation scripts in `.venv/Scripts/`
- **[Jupyter Notebook](https://jupyter.org/)** - Execute notebook cells from `*.ipynb` files
  - **Requirements:** [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) must be installed
  - **Setup:** Configure a Jupyter Server through the Jupyter extension
  - **Features:**
    - Notebooks appear as parent tasks with code cells as children
    - Click to open notebook in Visual Studio Code's notebook editor
    - Execute individual cells or entire notebooks
    - Real-time cell execution status via the Jupyter Extension UI
- **Visual Studio Code Tasks** - Tasks from `.vscode/tasks.json`
- **Workspace Tasks** - Custom tasks from `.workspace-tasks.json`

> [!Note]
> The extension discovers tasks regardless of whether tools are installed. Execution requires the respective tool to be available in your PATH. See [Requirements](#-requirements) for details.

## 🌱 Recent Tasks

As you run tasks they are tracked in a dedicated section at the top of the task tree to easily be able to access again. State of recent tasks will persist between VSCode sessions.

### Recent Tasks Configuration

#### Recent Tasks Item Grouping

When enabled, task items are grouped by the task type. Default is `false`.

![Recent Tasks - Grouping](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/settings-groups-recenttasks-enabled.png)

#### Maximum Recent Tasks

The maximum number of task items to track in the recent tasks. Default is `20`.
To disable tracking of recent tasks set to `0`.

![Recent Tasks - Max Items](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/settings-recenttasks-maxitems.png)

####

## ⭐ Favorites

Pin your most frequently used tasks for instant access. Favorites appear in a dedicated section at the top of the task tree, making your common operations just one click away.

**How to Use:**

1. Click the star icon (☆) next to any task to add it to favorites
2. Access all favorited tasks from the "Favorites" group at the top
3. Click the filled star (⭐) to remove from favorites

**Features:**

- **Quick Access** - All favorites in one place, organized by task type
- **Persistent** - Saved automatically across Visual Studio Code sessions
- **Workspace-Specific** - Each workspace maintains its own favorites list
- **Visual Indicators** - Star icons show in both favorites section and original location
- **Context Display** - Tasks show their workspace folder name in multi-root workspaces

**Perfect For:**

- Build, test, and deploy tasks you use daily
- Development scripts you run frequently
- Tasks from different workspace folders you need regularly

## 📋 Task Queues

Create and manage multiple named queues to run sequences of tasks in order. Perfect for complex workflows like CI/CD pipelines, multi-step builds, or deployment sequences.

**How to Use:**

1. Click the list icon next to any task
2. Choose an existing queue or create a new one
3. Drag and drop tasks to reorder them
4. Run the entire queue or start from a specific task

**Features:**

- **Multiple Queues** - Create separate queues for different workflows (e.g., "Build", "Deploy", "CI Pipeline")
- **Drag & Drop Reordering** - Easily reorder tasks within and across queues
- **Visual Context** - Each queue item shows the task icon, label, workspace name, and file path
- **Queue Controls** - Run entire queue, start from specific task, or stop execution
- **Queue Management** - Rename queues, clear all tasks, or delete empty queues
- **Persistent Storage** - Queues are saved and restored between sessions
- **Status Indicators** - Real-time visual feedback with running/success/failure icons

**Example Workflow:**

```text
CI Pipeline Queue:
1. Install Dependencies (npm install)
2. Lint Code (npm run lint)
3. Run Tests (npm test)
4. Build Production (npm run build)
5. Deploy to Staging (deploy.sh)
```

Click on the navigation items for the queue to run all tasks in sequence, rename the queue, or clear it.

## 🙈 Hide Tasks & Groups

Declutter your task view by temporarily hiding individual tasks or entire task groups you don't need to see. Hidden items are dimmed when shown and can be easily restored.

**How to Use:**

1. Right-click on any task or task group
2. Select "Hide Task" or "Hide Group" from the context menu
3. Hidden items are removed from the default view
4. Click "Show Hidden Tasks" button in the title bar to view all tasks including hidden ones
5. When in "Show Hidden" mode, hidden items appear dimmed with a badge (●)
6. Right-click a hidden item and select "Unhide" to restore it
7. Click "Clear Hidden Tasks" to unhide everything and return to normal view

**Features:**

- **Selective Hiding** - Hide individual tasks or entire task groups (npm, maven, etc.)
- **Hierarchical** - Hiding a group automatically hides all tasks within it
- **Visual Feedback** - Hidden items appear dimmed with a badge when viewing all tasks
- **Toggle Mode** - Quickly switch between filtered view and showing all tasks
- **Persistent** - Hidden state is saved across Visual Studio Code sessions
- **Easy Restore** - Unhide individual items or clear all hidden tasks at once

**Perfect For:**

- Hiding rarely-used task types in large monorepos
- Temporarily removing test or build tasks from view
- Focusing on specific task categories during development
- Cleaning up the task tree without permanently removing tasks

## 🚀 Quick Start

1. **Open a workspace** with supported task files (e.g., `package.json`, `Makefile`, shell scripts)
2. **Open the Workspace Tasks view** from the Activity Bar (sidebar) or Explorer panel
   - **Sidebar:** Click the Workspace Tasks icon in the Activity Bar
   - **Explorer:** Find "Workspace Tasks" in the Explorer panel, or drag it to your preferred location
3. **Browse tasks** organized by workspace folder and task type
4. **Run a task** by double-clicking it or clicking the play icon (▶️)
5. **Add to favorites** by clicking the star icon (☆)
6. **Create a queue** by clicking the list icon to organize task sequences

**Tips:**

- Double-click a task to execute it immediately
- Single-click a task to open its definition file (when applicable)
- Use the collapse button (⊟) to toggle view states
- Create `.tasksignore` files to exclude unwanted tasks
- Drag the Explorer view to any panel location (sidebar, panel, or as a floating window)

## ⚙️ Configuration

### GitHub Actions Integration

Run GitHub Actions workflows locally using [act](https://github.com/nektos/act) to test workflows without pushing to GitHub. Workspace Tasks provides a rich interface for executing workflows with full input support.

#### Features

- **Automatic Discovery** - Scans `.github/workflows/*.yml` files
- **Event Support** - Run workflows for `push`, `pull_request`, `workflow_dispatch`, and custom events
- **Job Execution** - Run individual jobs from multi-job workflows
- **Input Prompts** - Interactive prompts for `workflow_dispatch` inputs with validation
- **Status Indicators** - Real-time visual feedback during execution

#### Act Configuration

Configure act in your Visual Studio Code settings (`settings.json`):

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
    "VERSION": "1.0.0",
  },
}
```

#### Usage Example

Given a workflow `.github/workflows/build.yml`:

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

The task tree shows:

```text
GitHub Actions
└── Build & Test
    ├── Run Workflow (push)
    ├── Run Workflow (workflow_dispatch)  ← Shows input prompts
    └── Run Job: build
```

**Requirements:**

- [act](https://github.com/nektos/act) installed on your system
- [Docker](https://www.docker.com/) running (act uses containers)
- Configure `workspaceTasks.applicationPath.act` if act is not in PATH

**Tips:**

- Store secrets in a `.secrets` file and add to `.gitignore`
- Test `workflow_dispatch` inputs locally before pushing
- Run individual jobs to debug specific workflow steps

### Task Discovery Depth Control

Control how deep the extension searches for tasks in your workspace directory structure. This helps improve performance in large monorepos or complex folder hierarchies.

#### Configuration

Set the maximum folder depth for task discovery in `settings.json`:

```json
{
  "workspaceTasks.taskDiscovery.fetchDepth": 3
}
```

- **`null` (default)** - Full recursive search through all subdirectories
- **Positive integer (e.g., `1`, `2`, `4`)** - Limits search to specified depth below workspace root

#### Depth Calculation

Depth is measured from the workspace folder root:

```text
workspace-folder/          (depth 0)
├── package.json          ✅ Discovered at depth 0
└── src/                  (depth 1)
    ├── Makefile          ✅ Discovered at depth 1
    └── components/       (depth 2)
        └── package.json  ✅ Discovered at depth 2 (if fetchDepth >= 2)
```

**Example: `fetchDepth: 1`**

```text
workspace-folder/
├── package.json          ✅ Discovered (depth 0)
└── services/
    ├── api/
    │   └── package.json  ❌ Not discovered (depth 2)
    └── package.json      ✅ Discovered (depth 1)
```

#### When to Use

- **Large Monorepos** - Set to `2` or `3` to discover main project tasks while skipping deep vendor/dependency folders
- **Performance Issues** - Reduce depth if task discovery is slow
- **Focused Workflows** - Limit to top-level tasks when working on specific projects
- **Deep Structures** - Use `null` for full discovery in complex nested project layouts

## 🔧 Advanced Features

### View Placement and Layout

**Multiple View Options:**

- **Dedicated Sidebar** - Access Workspace Tasks from the Activity Bar for a dedicated panel
- **Explorer Integration** - View tasks alongside your files in the Explorer panel

  ![Explorer View](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/explorer-view.png)

- **Dockable Window** - Drag the Explorer view to any location (left, right, bottom panel, or floating)
- **Synchronized State** - Both views share the same state—actions in one view reflect in the other

**View Management:**

- Right-click on the Explorer view header to move it to different panels
- Drag the view to create a split layout with other views
- Use both views simultaneously for different workflows (e.g., sidebar for quick access, panel for detailed task management)

### Execution and Navigation

**Running Tasks:**

- **Single Click** - Click the play button (▶️) to run immediately
- **Terminal Output** - Task output appears in the integrated terminal with status indicators
- **Multiple Tasks** - Run multiple tasks simultaneously in separate terminals
- **Command Palette** - Use `Ctrl+Shift+P` / `Cmd+Shift+P` to search and run tasks by name

**Stopping & Restarting Tasks:**

- **Stop Button** - Click the stop button (⏹) next to running tasks to terminate a running or unresponsive task.
- **Restart Button** - Click the restart button (🔄️) next to running tasks to stop the currently executing task and run it again.
- **Status Tracking** - Visual indicators show running/success/failure states

**Navigation:**

- **Quick File Access** - Double-click tasks to jump to their definition in the source file
- **Line Precision** - Opens files at the exact line where tasks are defined
- **File Path Display** - Hover over tasks to see full paths and commands
- **Hierarchical Browsing** - Tree structure shows workspace → task type → individual tasks

**Additional Actions:**

- **Refresh Tasks** - Manually refresh to pick up changes without reloading Visual Studio Code
- **Collapse/Expand** - Use the collapse all button (⊟) to toggle view states:
  - First click: Collapse task type groups
  - Second click: Collapse workspace folders
  - Third click: Expand everything

### Supported File Patterns

Each task type watches specific file patterns:

| Task Type | Patterns | Notes |
| --- | --- | --- |
| npm/yarn/pnpm | `**/package.json` | Reads `scripts` section |
| Ant | `**/*.xml` | Parses build file targets |
| Composer | `**/composer.json` | PHP dependency scripts |
| Gradle | `**/*.gradle` | Java/Android build tasks |
| Grunt | `**/Gruntfile.js` | Registered tasks |
| Gulp | `**/gulpfile.{js,mjs}` | Exported tasks |
| Just | `**/{justfile,.justfile,*.just}` | Command recipes |
| Jupyter | `**/*.ipynb` | Notebook cells (requires [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)) |
| Make | `**/Makefile` | Build targets |
| Maven | `**/pom.xml` | Lifecycle goals |
| mise | `**/mise.toml`, `**/mise.*.toml`, `**/mise.*.local.toml` | TOML tasks and file tasks |
| MSBuild | `**/*.{csproj,vbproj,sln}` | .NET project targets |
| Pipenv | `**/Pipfile` | Python scripts |
| Shell | `**/*.{sh,bash,ps1,bat,cmd}` | Executable scripts |
| Docker | `**/Dockerfile*` | Container builds |
| Docker Compose | `**/docker-compose.yml` | Service orchestration |
| GitHub Actions | `**/.github/workflows/*.yml` | CI/CD workflows |
| Visual Studio Code | `**/.vscode/tasks.json` | Native Visual Studio Code tasks |
| Workspace | `.workspace-tasks.json` | Custom tasks |

All patterns respect `.gitignore` and `.tasksignore` exclusions.

## 📋 Requirements

### Visual Studio Code Version

- **Minimum:** Visual Studio Code 1.108.1 or later

### External Tools

The extension discovers tasks regardless of whether tools are installed, but **execution requires** the corresponding tool in your system PATH:

**Package Managers:**

- [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) for npm tasks
- [pnpm](https://pnpm.io/) for pnpm tasks
- [Yarn](https://yarnpkg.com/) for Yarn tasks
- [Composer](https://getcomposer.org/) for PHP Composer tasks
- [Pipenv](https://pipenv.pypa.io/) for Python Pipenv tasks

**Build Systems:**

- [Apache Ant](https://ant.apache.org/) for Ant tasks
- [Gradle](https://gradle.org/) for Gradle tasks
- [MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild) for .NET tasks
- [Make](https://www.gnu.org/software/make/) for Makefile tasks

**Task Runners:**

- [Grunt](https://gruntjs.com/) for Grunt tasks
- [Gulp](https://gulpjs.com/) for Gulp tasks
- [Just](https://github.com/casey/just) for Just tasks
- [mise](https://mise.jdx.dev/) for mise tasks

**DevOps:**

- [Docker](https://www.docker.com/) for Docker and Docker Compose tasks
- [act](https://github.com/nektos/act) and Docker for GitHub Actions workflows

**Data Science & Notebooks:**

- [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) for Jupyter Notebook tasks
  - The extension must be installed and a Jupyter Server must be configured
  - See the [Jupyter Extension documentation](https://code.visualstudio.com/docs/datascience/jupyter-notebooks) for setup instructions
  - Jupyter Notebooks (`.ipynb` files) appear as parent tasks with individual code cells as child tasks
  - Clicking on a task opens the notebook; running executes the selected cell

**Scripts:**

- Bash, Zsh, or other shell interpreters for shell scripts
- PowerShell for `.ps1` scripts
- Command Prompt for `.bat` and `.cmd` scripts

> **Installation Instructions:** Visit each tool's official website (linked above) for installation guides specific to your operating system.

## 🤝 Contributing

Contributions are welcome! If you'd like to improve Workspace Tasks, here's how:

### How to Contribute

1. **Report Issues** - Found a bug or have a feature request? [Open an issue](https://github.com/camalot/vscode-workspace-tasks/issues) on GitHub
2. **Submit Pull Requests** - Fork the repository, make your changes, and submit a PR
3. **Improve Documentation** - Help make the docs clearer or add examples
4. **Share Feedback** - Let us know how you use the extension and what could be better

### Development Setup

```bash
# Clone the repository
git clone https://github.com/camalot/vscode-workspace-tasks.git
cd vscode-workspace-tasks

# Install dependencies
npm install

# Open in Visual Studio Code
code .

# Start the watch task to compile TypeScript
npm run watch

# Press F5 to launch the Extension Development Host
```

### Guidelines

- Follow the existing code style and conventions
- Write clear commit messages
- Add tests for new features when applicable
- Update documentation for user-facing changes
- Ensure all tests pass before submitting

### Project Structure

- `src/` - TypeScript source code
  - `providers/` - Task providers for each task type
  - `services/` - Shared services (caching, configuration, etc.)
  - `libs/` - Utility libraries
- `res/` - Resources (icons, schemas, syntaxes)
- `sample/` - Sample workspaces for testing

## 📦 Contributors

<a href="https://github.com/camalot/vscode-workspace-tasks/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=camalot/vscode-workspace-tasks" alt="Contributors: Made with contrib.rocks" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## 📄 License

This project is licensed under the [Apache 2.0 License](LICENSE).

---

<!-- markdownlint-disable MD036 -->

**Made with ❤️ for the Visual Studio Code community**

<!-- markdownlint-enable MD036 -->
