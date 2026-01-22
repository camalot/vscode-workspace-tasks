# Workspace Tasks

A powerful VS Code extension that provides a comprehensive task explorer for your workspace. It automatically discovers and organizes tasks from various file types, allowing you to run, queue, and manage them efficiently.

## Features

### Task Discovery

Workspace Tasks automatically scans your workspace for the following types of task files:

- **NPM Scripts**: Tasks defined in `package.json` files (e.g., `scripts` section).
- **VS Code Tasks**: Tasks defined in `.vscode/tasks.json` files.
- **Shell Scripts**: Executable scripts with extensions like `.sh`, `.ps1`, `.bat`, `.cmd`, etc.
- **Makefiles**: Targets defined in `Makefile`, `makefile`, or `.makefile` files.
- **Dockerfiles**: Build tasks for `Dockerfile`, `dockerfile`, `*.dockerfile`, etc.
- **Justfiles**: Recipes defined in `justfile`, `.justfile`, or `*.just` files.
- **Python Virtual Environments**: Activation/deactivation scripts in `.venv/Scripts/` directories.
- **Workspace Tasks**: Custom tasks defined in `.workspace-tasks.json` files (see below).

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

The queue allows you to create a sequential list of tasks to run in order:

- **Add Tasks**: Click on the "list" icon to add to queue.
- **Reorder**: Drag and drop tasks within the queue to change their execution order.
- **Run Queue**: Execute all tasks in the queue sequentially, or start from a specific task in the queue.
- **Persistence**: The queue is saved across VS Code sessions.
- **Rename Queue**: Customize the name of your queue group.
- **Clear Queue**: Remove all tasks from the queue at once.

### Favorites

Mark frequently used tasks as favorites for quick access:

- **Add to Favorites**: Click on the ⭐ to add a task to Favorites.
- **Remove from Favorites**: Click on the ⭐ to remove a task to Favorites.
- **Persistence**: Favorites are saved across sessions.
- **Dedicated Group**: Favorites appear in their own section in the task tree.

### Task Ignore

Use `.tasksignore` files to exclude certain files or patterns from task discovery, following the same syntax as `.gitignore`.

You can also configure a global exclude list using the extension setting `workspaceTasks.exclude` — an array of glob patterns. For example, add the following to your `settings.json`:

>[!NOTE]
> `**/node_modules/**` is added to all task types by default.

```json
"workspaceTasks.exclude": ["**/.git/**"]
```

### Execution and Navigation

- **Run Tasks**: Click the play button or use context menus to execute tasks.
- **Stop Tasks**: Halt running tasks with the stop button.
- **Open Files**: Double-click or use the open button to navigate to the task definition in its source file.

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

| Task Type | File Patterns | Description | Icon |
| --------- | ------------- | ----------- | ---- |
| **npm** | `**/package.json` | NPM scripts from package.json files | 📦 package.json |
| **vscode** | `.vscode/tasks.json` | VS Code task definitions | ⚙️ workspace |
| **script** | `**/*.sh`, `**/*.ps1`, `**/*.bat`, `**/*.cmd` | Executable shell scripts | 📜 script |
| **makefile** | `**/Makefile`, `**/makefile`, `**/.makefile` | Make targets | 🔨 Makefile |
| **dockerfile** | `**/Dockerfile`, `**/dockerfile`, `**/*.dockerfile` | Docker build tasks | 🐳 Dockerfile |
| **justfile** | `**/justfile`, `**/.justfile`, `**/*.just` | Just command runner recipes | ⚡ justfile |
| **venv** | `**/.venv/Scripts/activate.*`, `**/.venv/Scripts/deactivate.*` | Python virtual environment scripts | 🐍 Python |
| **workspace-task** | `.workspace-tasks.json` | Custom workspace task definitions | 📋 Custom |

### Task Type Features

- **File-Associated Tasks**: Tasks linked to specific files (npm, makefile, dockerfile, etc.) show the file path and open the file on click
- **Global Tasks**: Tasks defined in `.workspace-tasks.json` without file globs appear under their workspace folder
- **Dynamic Inputs**: Workspace tasks support prompted values and variable substitution
- **Custom Icons**: Each task type has a distinctive icon for easy identification
- **Runnable**: All tasks can be executed directly from the tree view with context menu or inline buttons


## Requirements

- VS Code 1.74.0 or later
- For certain task types, the corresponding tools must be installed (e.g., `npm`, `make`, `docker`, `just`)

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

This project is licensed under the MIT License.
