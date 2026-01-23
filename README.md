# Workspace Tasks

A powerful VS Code extension that provides a comprehensive task explorer for your workspace. It automatically discovers and organizes tasks from various file types, allowing you to run, queue, and manage them efficiently.

## Features

### Screenshots

![Workspace-Tasks Sidebar Collapsed](assets\images\workspace-tasks-sidebar-collapse.png)

### Task Discovery

Workspace Tasks automatically scans your workspace for the following types of task files:

- **[npm](https://www.npmjs.com/)**: Scripts defined in `package.json` files
- **[Ant](https://ant.apache.org/)**: Targets defined in Apache Ant build files (`*.xml`)
- **[Composer](https://getcomposer.org/)**: PHP scripts defined in `composer.json` files
- **[Gradle](https://gradle.org/)**: Tasks defined in Gradle build files (`*.gradle`)
- **[Grunt](https://gruntjs.com/)**: Tasks registered in `Gruntfile.js`
- **[Gulp](https://gulpjs.com/)**: Tasks defined in `gulpfile.js` or `gulpfile.mjs`
- **[Just](https://github.com/casey/just)**: Command runner recipes in `justfile`, `.justfile`, or `*.just` files
- **[Make](https://www.gnu.org/software/make/)**: Targets defined in `Makefile` files
- **[MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild)**: Targets in .NET project files (`*.csproj`, `*.vbproj`, `*.sln`, etc.)
- **[Pipenv](https://pipenv.pypa.io/)**: Python scripts defined in `Pipfile`
- **VS Code Tasks**: Tasks defined in `.vscode/tasks.json` files
- **Shell Scripts**: Executable scripts (`.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd`)
- **Python Virtual Environments**: Activation/deactivation scripts in `.venv/Scripts/` directories
- **[Docker](https://www.docker.com/)**: Docker container build tasks from Dockerfiles
- **[Docker Compose](https://docs.docker.com/compose/)**: Multi-container orchestration tasks from `docker-compose.yml` files
- **Workspace Tasks**: Custom tasks defined in `.workspace-tasks.json` files (see below)

Tasks are organized hierarchically by workspace folder, task type, and individual tasks.

### Custom Workspace Tasks

Create a `.workspace-tasks.json` file in your workspace to define custom tasks that can be associated with specific file patterns or defined globally. This powerful feature allows you to:

- Define reusable task templates with variable inputs
- Create tasks that work across multiple file types
- Build custom workflows without modifying VS Code's `tasks.json`

#### Example: Dockerfile Tasks

```json
{
  "dockerfile": {
    "version": "2.0.0",
    "globs": {
      "include": ["{**/Dockerfile,**/dockerfile,**/*.dockerfile,**/Dockerfile.*}"],
      "exclude": ["**/node_modules/**", "**/.git/**"]
    },
    "inputs": [
      {
        "id": "Name",
        "type": "promptString",
        "description": "Enter the name for the Docker image",
        "default": "${workspaceFolderBasename}"
      },
      {
        "id": "Tag",
        "type": "promptString",
        "description": "Enter the tag for the Docker image",
        "default": "latest"
      }
    ],
    "tasks": [
      {
        "label": "Build Docker Image",
        "type": "workspace",
        "command": "docker build -t {{ .Name }}:{{ .Tag }} .",
        "group": "build"
      }
    ]
  }
}
```

#### Example: Global Workspace Tasks

Tasks without file associations (no `globs` defined) appear under the workspace folder:

```json
{
  "shell": {
    "version": "2.0.0",
    "inputs": [],
    "tasks": [
      {
        "label": "Clean Build Artifacts",
        "type": "workspace",
        "command": "rm -rf dist build out",
        "group": "build"
      },
      {
        "label": "Install Dependencies",
        "type": "workspace",
        "command": "npm install && pip install -r requirements.txt",
        "group": "build"
      }
    ]
  }
}
```

#### Configuration Schema

- **Top-level keys**: Define task types (e.g., `dockerfile`, `shell`, `python`)
- **version**: Schema version (currently "2.0.0")
- **globs** (optional): File patterns to associate tasks with
  - **include**: Array of glob patterns to match files
  - **exclude**: Array of glob patterns to ignore
- **inputs**: Array of input definitions for dynamic values
  - **id**: Unique identifier for the input
  - **type**: Input type (`promptString` or `pickString`)
  - **description**: User-facing prompt
  - **default**: Default value (supports `${workspaceFolderBasename}`)
  - **options**: Array of choices (for `pickString` type)
- **tasks**: Array of task definitions
  - **label**: Display name for the task
  - **type**: Must be "workspace"
  - **command**: Shell command to execute (use `{{ .InputId }}` for variable substitution)
  - **group**: Optional task group (e.g., "build", "test")

### Queue System

The queue system now supports multiple named queues so you can maintain separate sequences of tasks (for example: "Build", "CI Pipeline", "Deploy"). Each queue is persisted and restored between VS Code sessions.

**Key Features:**

- **Multiple Named Queues**: Create and manage more than one queue. Each queue appears as its own group in the tree with an ordered list icon.
- **Add Tasks to Queue**: Click the list icon (or right-click and select "Add to Queue") on any task. If no queues exist you'll be prompted to name the new queue (the prompt defaults to "Queue"). If one or more queues exist you will be shown a choice of existing queues or a "New Queue..." option (the new queue prompt defaults to "Queue").
- **Queue Details**: Queue items show the task icon, label, workspace name and relative file path (e.g., `MyProject • package.json`) so you get the same context as in the main task view.
- **Drag & Drop Reordering**: Drag and drop tasks within a queue to change execution order. Reordering across queues is supported where applicable.
- **Run & Control**: Run a specific queue from the queue group's context menu or use the "Run Queue" command. If multiple queues exist you'll be prompted to select which queue to run. You can also start from a specific task or stop execution.
- **Rename & Clear**: Right-click a queue group to rename it or clear all tasks from that queue. When all tasks are removed from a queue it is automatically deleted and its persisted data is removed.
- **Persistent Storage**: Each queue and its tasks are saved to global storage and restored when the extension starts.
- **Status Indicators**: Tasks in queues display the same running/success/failure icons and state as normal task entries.

**Example Workflow:**

1. Add tasks to a queue named "CI Pipeline"
2. Reorder tasks as needed
3. Run the "CI Pipeline" queue or start from a single queued task
4. Clear or rename the queue when desired

### Favorites

Mark frequently used tasks as favorites for instant access. Favorites appear in a dedicated section at the top of the task tree, separate from the main task hierarchy.

**Key Features:**

- **Easy Management**: Click the star icon (☆) next to any task to add it to favorites. Click the filled star (⭐) to remove it.
- **Quick Access**: All favorited tasks appear in the "Favorites" group, organized by task type.
- **Persistent Storage**: Your favorites are automatically saved and restored across VS Code sessions.
- **Cross-Workspace**: Each workspace maintains its own list of favorite tasks.
- **Visual Indicators**: Favorited tasks show a star icon in both the Favorites section and their original location.
- **Workspace Context**: Tasks in the Favorites section display their workspace folder name for multi-root workspaces.

**Use Cases:**

- Pin your most-used build, test, or deploy tasks
- Keep development tasks separate from deployment tasks
- Quick access to tasks across multiple workspace folders
- Create a personal "quick launch" menu of common operations

### Task Ignore

Control which files and directories are excluded from task discovery using `.tasksignore` files. This works similarly to `.gitignore` and helps keep your task list clean and focused.

**How It Works:**

- **Per-Directory Control**: Place a `.tasksignore` file in any directory to exclude files from that directory and its subdirectories.
- **Gitignore Syntax**: Uses the same pattern syntax as `.gitignore` files:
  - `*.tmp` - Ignore all files ending with .tmp
  - `build/` - Ignore the build directory
  - `**/test/**` - Ignore all test directories
  - `!important.sh` - Exception: don't ignore this file
- **Global Exclusions**: Configure workspace-wide exclusions in VS Code settings using `workspaceTasks.exclude` array.
- **Smart Defaults**: `**/node_modules/**` is automatically excluded for all task types to improve performance.

**Example `.tasksignore` file:**

```
# Ignore all test scripts
**/test/**
**/*.test.sh

# Ignore build output directories
build/
dist/
out/

# Ignore temporary files
*.tmp
*.bak
```

**Configuration in settings.json:**

```json
"workspaceTasks.exclude": [
  "**/.git/**",
  "**/vendor/**",
  "**/__pycache__/**"
]
```

> [!NOTE]
> `**/node_modules/**` is automatically added to the exclusion list for all task types by default.

### Execution and Navigation

Interact with your tasks through an intuitive interface with multiple execution and navigation options.

**Running Tasks:**

- **Single Click Execution**: Click the play button (▶) next to any task to run it immediately.
- **Context Menu**: Right-click any task for additional options like "Run Task", "Add to Queue", or "Add to Favorites".
- **Terminal Output**: Task output appears in the integrated terminal with clear status indicators.
- **Multiple Simultaneous Tasks**: Run multiple tasks at the same time; each opens in its own terminal.
- **Keyboard Shortcuts**: Use VS Code's command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) to search and run tasks by name.

**Stopping Tasks:**

- **Stop Button**: Click the stop button (⏹) next to running tasks to terminate them.
- **Force Stop**: Long-running or unresponsive tasks can be forcefully terminated.
- **Status Tracking**: Visual indicators show when tasks are running, completed successfully, or failed.

**Navigation:**

- **Quick File Access**: Double-click any task or click the open file icon to jump directly to the task definition in its source file.
- **Line Precision**: Opens the file at the exact line where the task is defined for quick editing.
- **File Path Display**: Hover over tasks to see the full file path and task command.
- **Breadcrumb Navigation**: The tree structure shows the relationship between workspace folders, task types, and individual tasks.

**Additional Actions:**

- **Copy Task Name**: Right-click to copy task names for use in documentation or scripts.
- **Refresh Tasks**: Manually refresh the task list to pick up changes without reloading VS Code.
- **Collapse/Expand Groups**: Use the collapse all button (⊟) to toggle between different view states:
  - First click: Collapse task type groups
  - Second click: Collapse workspace folders
  - Third click: Expand everything

## Installation

1. Install the extension from the VS Code Marketplace.
2. Open a workspace with supported task files.
3. The "Workspace Tasks" view will appear in the Activity Bar.

## Usage

1. **View Tasks**: Expand the Workspace Tasks view to see all discovered tasks organized by type and location.
2. **Run Individual Tasks**: Click the play icon next to any task to execute it.
3. **Manage Queue**: Add tasks to the queue, reorder them, and run the entire sequence.
4. **Use Favorites**: Mark important tasks as favorites for easy access.
5. **Customize**: Rename the queue and use `.tasksignore` to filter unwanted tasks.

## Supported File Types

Workspace Tasks provides comprehensive support for various build tools, task runners, and scripting environments. Each task type is automatically discovered and organized in the task explorer.

### Build Systems & Project Management

| Task Type | File Patterns | Description |
| --------- | ------------- | ----------- |
| **[npm](https://www.npmjs.com/)** | `**/package.json` | Discovers scripts from the `scripts` section of Node.js package files. Click a task to open the package.json file. |
| **[Ant](https://ant.apache.org/)** | `**/*.xml` | Finds targets in Apache Ant build files. Supports target dependencies and descriptions. |
| **[Gradle](https://gradle.org/)** | `**/*.gradle` | Extracts tasks from Gradle build scripts for Java/Android projects. Parses both task definitions and task configurations. |
| **[MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild)** | `**/*.{csproj,vbproj,vcxproj,sln,proj,xml}` | Discovers targets in .NET project files and Visual Studio solutions. |
| **[Make](https://www.gnu.org/software/make/)** | `**/Makefile` | Identifies targets from Makefiles used in C/C++ and other native projects. |
| **[Composer](https://getcomposer.org/)** | `**/composer.json` | Finds scripts defined in PHP Composer configuration files. |
| **[Pipenv](https://pipenv.pypa.io/)** | `**/Pipfile`, `**/pipfile` | Discovers scripts from Python Pipenv project files. |

### Task Runners

| Task Type | File Patterns | Description |
| --------- | ------------- | ----------- |
| **[Gulp](https://gulpjs.com/)** | `**/gulpfile.js`, `**/gulpfile.mjs` | Detects tasks from Gulp build files. Supports both CommonJS and ES module formats. |
| **[Grunt](https://gruntjs.com/)** | `**/Gruntfile.js`, `**/gruntfile.js` | Finds tasks registered with `registerTask` or `registerMultiTask` in Grunt files. |
| **[Just](https://github.com/casey/just)** | `**/justfile`, `**/.justfile`, `**/*.just` | Discovers recipes from Just command runner files. |

### Scripts & Environments

| Task Type | File Patterns | Description |
| --------- | ------------- | ----------- |
| **Shell Scripts** | `**/*.{sh,bash,zsh,fish,csh,ksh,cmd,bat,ps1}` | Detects executable shell scripts across multiple shell environments (Bash, Zsh, PowerShell, Batch, etc.). |
| **Python venv** | `**/.venv/Scripts/activate.*`, `**/.venv/Scripts/deactivate.*` | Finds Python virtual environment activation and deactivation scripts. |
| **[Docker](https://www.docker.com/)** | `**/Dockerfile`, `**/dockerfile`, `**/*.dockerfile` | Identifies Docker container definition files for building images. |
| **[Docker Compose](https://docs.docker.com/compose/)** | `**/docker-compose.yml` | Discovers multi-container application orchestration tasks. Common tasks include starting services (`up`), stopping services (`down`), viewing logs, and rebuilding containers. |

### VS Code & Custom

| Task Type | File Patterns | Description |
| --------- | ------------- | ----------- |
| **VS Code Tasks** | `**/.vscode/tasks.json` | Loads tasks defined in VS Code's native task configuration files. |
| **Workspace Tasks** | `.workspace-tasks.json` | Custom task definitions with dynamic inputs and file associations (see Custom Workspace Tasks section). |

### Task Type Features

- **File-Associated Tasks**: Most task types are linked to their source files. Click any task to open the file at the task definition line.
- **Hierarchical Organization**: Tasks are grouped by workspace folder and task type for easy navigation.
- **Context Menus**: Right-click tasks for additional actions like adding to queue, marking as favorite, or copying task names.
- **Custom Icons**: Each task type displays a distinctive icon matching VS Code's file type icons or custom task-specific icons.
- **Live Discovery**: The task list updates automatically when you create, modify, or delete task files.
- **Pattern Matching**: All file patterns respect your workspace's `.gitignore` and custom `.tasksignore` files.

> [!NOTE]
> Some task types require their respective tools to be installed on your system to execute (e.g., `npm`, `make`, `docker`, `gradle`). The extension will discover and display tasks regardless of whether the tool is installed, but execution requires the tool to be available in your PATH.


## Requirements

- **VS Code Version**: 1.74.0 or later
- **External Tools**: For task execution, the corresponding tools must be installed on your system and available in your PATH:
  - [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) for npm tasks
  - [Apache Ant](https://ant.apache.org/) for Ant tasks
  - [Composer](https://getcomposer.org/) for Composer tasks
  - [Gradle](https://gradle.org/) for Gradle tasks
  - [Grunt](https://gruntjs.com/) for Grunt tasks
  - [Gulp](https://gulpjs.com/) for Gulp tasks
  - [Just](https://github.com/casey/just) for Just tasks
  - [Make](https://www.gnu.org/software/make/) for Makefile tasks
  - [MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild) for .NET project tasks
  - [Pipenv](https://pipenv.pypa.io/) for Pipenv tasks
  - [Docker](https://www.docker.com/) for Dockerfile tasks
  - [Docker Compose](https://docs.docker.com/compose/) for Docker Compose tasks
  - Bash, PowerShell, or other shell interpreters for shell scripts

> [!NOTE]
> The extension will discover and display tasks even if the required tools are not installed. However, you'll need the appropriate tool installed to actually execute the tasks.

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

This project is licensed under the [Apache 2.0 License](LICENSE).
