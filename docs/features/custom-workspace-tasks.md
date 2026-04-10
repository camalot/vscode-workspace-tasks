---
layout: default
title: 🛃 Custom Workspace Tasks
nav_order: 9
parent: 🚀 Features
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Custom Workspace Tasks
{: .no_toc }

These are similar to `.vscode/tasks.json`, except you can define them as any task type.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

They can be bound to any file glob pattern.

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

## Custom Icons (`iconUri`)

Each task type group can display a custom icon in the tree view via the optional `iconUri` field. It accepts three forms:

### 1. Bundled icon — `$(iconName)`

References a light/dark SVG pair shipped with the extension under `res/icons/light/<name>.svg` and `res/icons/dark/<name>.svg`:

```json
{
  "venv": {
    "version": "2.0.0",
    "iconUri": "$(python)",
    "tasks": [...]
  }
}
```

If no matching SVG pair exists the icon falls back to the default task group icon.

### 2. Image file path

An absolute path or a path relative to the extension root pointing to a `.svg`, `.png`, or other image file. When the path exists in both a `light/` and `dark/` subdirectory under `res/icons/`, both variants are used automatically:

```json
{
  "my-tool": {
    "version": "2.0.0",
    "iconUri": "res/icons/light/my-tool.svg",
    "tasks": [...]
  }
}
```

### 3. Explicit light/dark object

Provide separate paths for light and dark themes:

```json
{
  "my-tool": {
    "version": "2.0.0",
    "iconUri": {
      "light": "res/icons/light/my-tool.svg",
      "dark":  "res/icons/dark/my-tool.svg"
    },
    "tasks": [...]
  }
}
```

### 4. Well-known filename (file icon theme)

Pass a filename whose extension (or full name) VS Code file icon themes recognize — e.g. `"tsconfig.json"`, `"Makefile"`, `".gitignore"`. The tree will use the matching file-type icon from the active icon theme:

```json
{
  "typescript": {
    "version": "2.0.0",
    "iconUri": "tsconfig.json",
    "tasks": [...]
  }
}
```

Filenames with unrecognized extensions fall back to the default task group icon.

## Schema Reference

- **Top-level keys** - Task type identifiers (e.g., `dockerfile`, `shell`)
- **version** - Schema version (`"2.0.0"`)
- **globs** (optional) - File pattern matching
  - **include** - Array of glob patterns to match
  - **exclude** - Array of glob patterns to ignore
- **iconUri** (optional) - Icon for the task type group in the tree view. Accepts:
  - `"$(iconName)"` — bundled light/dark SVG pair (`res/icons/{light,dark}/<iconName>.svg`)
  - A string path to an image file (absolute, or relative to the extension root)
  - `{ "light": "...", "dark": "..." }` — explicit light/dark image paths
  - A well-known filename (e.g. `"tsconfig.json"`) for file icon theme matching
- **taskType** (optional) - The `workspaceTasks.enabledTaskTypes` setting key that controls whether this
  provider is shown in the tree. If omitted, the top-level key name is used. This is useful when multiple
  provider keys share a single toggle — for example, both `dockerfile` and `docker-compose` use `"taskType": "docker"`.
- **inputs** - Array of input definitions
  - **id** - Unique input identifier
  - **type** - `promptString` or `pickString`
  - **description** - Prompt text for user
  - **default** - Default value (supports `${workspaceFolderBasename}`)
  - **options** - Array of choices (for `pickString`)
- **tasks** - Array of task definitions
  - **label** - Display name
  - **type** - The type of task. Examples include `"workspace"`, `"shell"`, `"process"`, etc.
  - **command** - Shell command (use `{{ .InputId }}` for variables)
  - **group** - Task group (`"build"`, `"test"`, etc.)
