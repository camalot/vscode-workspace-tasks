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

Tasks are organized hierarchically by workspace folder, task type, and individual tasks.

### Queue System
The queue allows you to create a sequential list of tasks to run in order:

- **Add Tasks**: Right-click on any task and select "Add to Queue".
- **Reorder**: Drag and drop tasks within the queue to change their execution order.
- **Run Queue**: Execute all tasks in the queue sequentially, or start from a specific task in the queue.
- **Persistence**: The queue is saved across VS Code sessions.
- **Rename Queue**: Customize the name of your queue group.
- **Clear Queue**: Remove all tasks from the queue at once.

### Favorites
Mark frequently used tasks as favorites for quick access:

- **Add to Favorites**: Right-click on any task and select "Add to Favorites".
- **Remove from Favorites**: Unfavorite tasks as needed.
- **Persistence**: Favorites are saved across sessions.
- **Dedicated Group**: Favorites appear in their own section in the task tree.

### Task Ignore
Use `.tasksignore` files to exclude certain files or patterns from task discovery, following the same syntax as `.gitignore`.

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

| File Type | Patterns | Language ID | Task Type |
|-----------|----------|-------------|-----------|
| package.json | `**/package.json` | json | npm |
| tasks.json | `.vscode/tasks.json` | json | vscode |
| Shell Scripts | `**/*.sh`, `**/*.ps1`, etc. | shellscript, powershell, etc. | script |
| Makefiles | `**/Makefile`, `**/makefile` | makefile | makefile |
| Dockerfiles | `**/Dockerfile`, `**/*.dockerfile` | dockerfile | dockerfile |
| Justfiles | `**/justfile`, `**/*.just` | just | justfile |

## Requirements

- VS Code 1.74.0 or later
- For certain task types, the corresponding tools must be installed (e.g., `npm`, `make`, `docker`, `just`)

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

This project is licensed under the MIT License.
