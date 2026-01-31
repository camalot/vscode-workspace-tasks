# Custom Workspace Tasks

These are similar to `.vscode/tasks.json`, except you can define them as any task type. They can be bound to any file glob pattern.

Create a `.workspace-tasks.json` file in your workspace to define custom reusable tasks with dynamic inputs. This is perfect for tasks that don't fit existing file types or need variable substitution.

## Basic Example

```json
{
  "shell": {
    "version": "2.0.0",
    "tasks": [
      {
        "label": "Clean Build Artifacts",
        "type": "workspace",
        "command": "rm -rf dist build out",
        "group": "build"
      }
    ]
  }
}
```

## File-Associated Tasks with Inputs

Tasks can be associated with file patterns and accept user inputs:

```json
{
  "dockerfile": {
    "version": "2.0.0",
    "globs": {
      "include": ["{**/Dockerfile,**/dockerfile,**/*.dockerfile}"],
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

## Schema Reference

- **Top-level keys** - Task type identifiers (e.g., `dockerfile`, `shell`)
- **version** - Schema version (`"2.0.0"`)
- **globs** (optional) - File pattern matching
  - **include** - Array of glob patterns to match
  - **exclude** - Array of glob patterns to ignore
- **inputs** - Array of input definitions
  - **id** - Unique input identifier
  - **type** - `promptString` or `pickString`
  - **description** - Prompt text for user
  - **default** - Default value (supports `${workspaceFolderBasename}`)
  - **options** - Array of choices (for `pickString`)
- **tasks** - Array of task definitions
  - **label** - Display name
  - **type** - Must be `"workspace"`
  - **command** - Shell command (use `{{ .InputId }}` for variables)
  - **group** - Task group (`"build"`, `"test"`, etc.)
