---
layout: default
title: 🛃 Workspace Tasks
nav_order: 10
parent: 🚀 Features
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Workspace Tasks
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

## Command Context Tokens

The `command` field for workspace tasks supports context token substitution at execution time.

| Token | Value |
| --- | --- |
| `${args}` | Args typed in **Run with Args**. If omitted from `command`, args are appended to the end. Use as a **standalone token** (e.g. `docker run ${args} image`) or **embedded** (e.g. `tool --name=${args}`). |
| `${workspaceFolder}` | Absolute path of the workspace folder that contains the task source file. |
| `${workspaceFolderBasename}` | Base name of `${workspaceFolder}`. |
| `${file}` | Absolute path of the active editor file (empty string if no active editor). |
| `${fileBasename}` | Active file name with extension. |
| `${fileDirname}` | Directory of the active file. |
| `${fileExtname}` | Active file extension (including the dot). |
| `${fileBasenameNoExtension}` | Active file name without extension. |
| `${pathSeparator}` | OS path separator (`/` or `\\`). |
| `${env.VAR}` | `process.env.VAR` value at execution time (empty string if missing). |

Unknown `${...}` tokens are preserved unchanged so shell-style patterns such as `${HOME}` continue to work.

{: .note }
**Arguments are passed as separate tokens, not raw shell text.** Each argument entered in the
**Run with Args** prompt is passed to the shell as a discrete quoted value. Shell metacharacters
such as `;`, `&&`, `|`, and `$(...)` are treated as **literal strings**. This prevents shell
injection attacks but also means **shell operators in the base `command` field** (e.g.
`"npm run build && npm run test"`) are now treated as literal argument tokens rather than
control operators. Use VSCode [compound tasks](https://code.visualstudio.com/docs/editor/tasks#_compound-tasks)
(`dependsOn`) or a wrapper script to chain commands.

**Embedded `${args}` behaviour:** When `${args}` is embedded inside a token (e.g.
`--name=${args}`), the entire user input is kept as a single argument. When it appears as a
standalone token, each whitespace-separated word in the user input becomes a separate argument.
Quoted phrases (e.g. `'my value'`) in the user input are collapsed into a single token with
quotes removed.

## Custom Icons (`iconUri`)

Each task type group can display a custom icon in the tree view via the optional `iconUri` field. It accepts three forms:

### 1. Bundled icon — `$(iconName)`

References a light/dark SVG pair shipped with the extension under `res/icons/light/<name>.svg` and `res/icons/dark/<name>.svg`:

```json
{
  "my-tool": {
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

## Environment Variables

Custom workspace tasks support per-task and language-block environment variables through four
complementary fields. For a full explanation of precedence layers and the global settings tier,
see [Task Environment Variables](task-environment-variables/).

### `env` — Inline Key/Value Pairs

Set variables directly in the task or language block. Per-task `env` overrides language-block
`env` for the same key.

```jsonc
{
  "shell": {
    "version": "2.0.0",
    "env": { "APP_ENV": "local" },
    "tasks": [
      {
        "label": "Start Dev Server",
        "command": "node server.js",
        "env": { "PORT": "3000" }
      }
    ]
  }
}
```

### `envFiles` — Load from `.env` Files

Accepts a single path/glob, an ordered array, or an include/exclude object. Variables from
`.env` files whose names match `secretPatterns` trigger a warning in the Inspect command.

```jsonc
{
  "shell": {
    "version": "2.0.0",
    "envFiles": { "include": [".env", ".env.*"], "exclude": ["**/.env.secret"] },
    "tasks": [
      {
        "label": "Run Tests",
        "command": "npm test",
        "envFiles": ".env.test"
      }
    ]
  }
}
```

### `secretFiles` — Load from `.secret` Files

Same format as `envFiles` but variables are tagged as secrets — they are **never** shown in
plaintext in the Inspect command and never trigger the secret-pattern warning.

```jsonc
{
  "shell": {
    "tasks": [
      {
        "label": "Deploy",
        "command": "deploy.sh",
        "secretFiles": [".secrets", ".env.secret"]
      }
    ]
  }
}
```

### `secrets` — Reference VS Code SecretStorage

Map environment variable names to VS Code `SecretStorage` keys (per-task only). The value is
fetched at run time from the encrypted, per-machine store.

To store a secret: open the Command Palette → **Workspace Tasks: Add New Secret**.

```jsonc
{
  "shell": {
    "tasks": [
      {
        "label": "Deploy",
        "command": "deploy.sh",
        "secrets": {
          "DEPLOY_TOKEN": "myapp.deploy-token",
          "DB_PASSWORD": "myapp.db-password"
        }
      }
    ]
  }
}
```

---

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
  - **command** - Shell command (supports `{{ .InputId }}` and context tokens: `${args}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${file}`, `${fileBasename}`, `${fileDirname}`, `${fileExtname}`, `${fileBasenameNoExtension}`, `${pathSeparator}`, `${env.VAR}`)
  - **group** - Task group (`"build"`, `"test"`, etc.)
  - **env** - Per-task inline environment variable overrides
  - **envFiles** - Per-task `.env` file references (`string | string[] | { include, exclude }`)
  - **secretFiles** - Per-task `.secret` file references (same format as `envFiles`)
  - **secrets** - Per-task `SecretStorage` map (`Record<string, string>`: env var → storage key)
  - **confirm** - `boolean` (default `false`) — when `true`, a confirmation dialog is shown before the task runs. See [Run Guard](run-guard) for details.
