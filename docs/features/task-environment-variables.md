---
layout: default
title: 🔐 Environment Variables
parent: 🚀 Features
nav_order: 10
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Environment Variables
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
v1.7.0 introduces a powerful new system for environment variables and secrets.

Attach environment variables and secrets to any task — whether it comes from a
`.workspace-tasks.json` file, a discovered `package.json` script, a `Makefile` target, or
any other supported task type. Variables are merged in a deterministic fourteen-layer
precedence order so global defaults are always overridden by the most specific value.

---

## Two-Path Philosophy

| Path | Best for | How configured |
|------|----------|----------------|
| **Inline** (`.workspace-tasks.json`) | Tasks you own and version alongside your project | `env`, `envFiles`, `secretFiles`, `secrets` fields in the config file |
| **Settings rules** (`workspaceTasks.envVars.taskEnv`) | Discovered tasks you don't control — npm scripts, Makefile targets, Gradle tasks | `workspaceTasks.envVars.taskEnv` array in `settings.json` |

---

## File Type Distinction

Three storage tiers offer increasing security for sensitive values:

| Tier | Convention | Triggers secret warning? | Best for |
|------|-----------|--------------------------|----------|
| `.env` files | `.env`, `.env.local`, `.env.dev` | Yes, for keys matching `secretPatterns` | Non-sensitive config and public defaults |
| `.secret` files | `.secrets`, `.env.secret` | **Never** | Sensitive values you want out of `.env` files |
| VS Code `SecretStorage` | `context.secrets` API (per-machine, encrypted) | **Never** | Credentials — tokens, passwords, API keys |

**`.secret` files should be gitignored.** Use the secret warning indicator to catch any sensitive
keys that have accidentally been placed in a plain `.env` file.

---

## Precedence (Lowest → Highest)

Later layers override earlier layers for duplicate keys.

| Layer | Source | Scope |
|------:|--------|-------|
| 1 | `workspaceTasks.envVars.env` (global `settings.json`) | All tasks |
| 2 | `workspaceTasks.envVars.envFiles` | All tasks |
| 3 | `workspaceTasks.envVars.secretFiles` | All tasks |
| 4 | Language-block `envFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 5 | Language-block `env` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 6 | Language-block `secretFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 7 | Per-task `envFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 8 | Per-task `env` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 9 | Per-task `secretFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 10 | Per-task `secrets` → `SecretStorage` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks |
| 11 | Matching `taskEnv` rules — `envFiles` | All tasks |
| 12 | Matching `taskEnv` rules — `env` | All tasks |
| 13 | Matching `taskEnv` rules — `secretFiles` | All tasks |
| 14 | Matching `taskEnv` rules — `secrets` → `SecretStorage` | All tasks |

---

## Configuration Examples

### Dev/Production `.env` Files (`.workspace-tasks.json` Task)

Apply different environment files depending on which task runs:

```jsonc
{
  "shell": {
    "version": "2.0.0",
    "envFiles": ".env",
    "tasks": [
      {
        "label": "Start Dev Server",
        "command": "node server.js",
        "envFiles": [".env", ".env.local"]
      },
      {
        "label": "Start Production Server",
        "command": "node server.js",
        "envFiles": ".env.production"
      }
    ]
  }
}
```

### Per-Task Port Override

Override a single variable at the task level while inheriting everything else from global config:

```jsonc
// settings.json
{
  "workspaceTasks.envVars.env": {
    "NODE_ENV": "development",
    "PORT": "3000"
  }
}
```

```jsonc
// .workspace-tasks.json
{
  "shell": {
    "version": "2.0.0",
    "tasks": [
      {
        "label": "Alt Port Server",
        "command": "node server.js",
        "env": { "PORT": "4000" }
      }
    ]
  }
}
```

The `Alt Port Server` task uses `PORT=4000`; all other tasks use the global `PORT=3000`.

### Inject a Deploy Token into `npm publish` (No `.workspace-tasks.json` Required)

Use a settings rule to inject credentials into any discovered `npm publish` script:

```jsonc
// settings.json (workspace)
{
  "workspaceTasks.envVars.taskEnv": [
    {
      "match": {
        "taskType": "npm",
        "taskName": "publish"
      },
      "secrets": {
        "NPM_TOKEN": "myapp.npm-publish-token"
      }
    }
  ]
}
```

Store the secret value once:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Workspace Tasks: Store Secret**
3. Enter key: `myapp.npm-publish-token`
4. Enter value: `<your npm token>`

The token is encrypted at rest and never synced to other machines.

### Scoping Rules to a Specific Workspace Folder (Monorepo)

In a multi-root workspace, limit a rule to one folder by name:

```jsonc
{
  "workspaceTasks.envVars.taskEnv": [
    {
      "match": {
        "taskType": "npm",
        "workspaceFolder": "api"
      },
      "envFiles": [".env", ".env.local"]
    }
  ]
}
```

### Matching a Family of Tasks with a Regex

Apply the same env block to all tasks whose names start with `deploy`:

```jsonc
{
  "workspaceTasks.envVars.taskEnv": [
    {
      "match": {
        "taskName": "/^deploy.*/"
      },
      "secretFiles": ".secrets.deploy"
    }
  ]
}
```

---

## File Reference Format (`envFiles` / `secretFiles`)

All `envFiles` and `secretFiles` fields accept the same three forms at every level:

```jsonc
// Single path or glob
"envFiles": ".env"

// Ordered list — files load in list order, later files win
"envFiles": [".env", ".env.local", ".env.override"]

// Include/exclude glob object — results sorted alphabetically
"envFiles": {
  "include": [".env", ".env.*"],
  "exclude": [".env.secret", "**/node_modules/**"]
}
```

Glob patterns use VS Code's `findFiles` API under the hood. When a glob expands to multiple
files they are sorted alphabetically by path for determinism.

---

## Secret Pattern Warnings

When a variable key name matches any pattern in `workspaceTasks.envVars.secretPatterns` (e.g.
`*_TOKEN`, `PASSWORD`) **and** the value came from a plain `env` block or `.env` file (not from a
`.secret` file or `SecretStorage`), the **Inspect Environment** command displays a warning.

The default patterns are: `*_TOKEN`, `*_KEY`, `*_SECRET`, `PASSWORD`, `PASSWD`, `CREDENTIALS`,
`API_KEY`.

This is advisory only — the task still runs. To eliminate the warning, move the value to a
`.secret` file or into `SecretStorage` via **Workspace Tasks: Store Secret**.

---

## Git-Tracked File Warnings

{: .new }
Added in v1.7.1

In addition to the per-key secret-pattern warning, the extension proactively checks whether any
files listed in `workspaceTasks.envVars.envFiles` or `workspaceTasks.envVars.secretFiles` are
tracked by git. If they are, a warning is written to the **Problems** panel at startup and
whenever those settings change.

A file tracked by git means its contents — including any tokens, passwords, or other sensitive
values — could be committed to version control and exposed in your repository history.

![Git-tracked file warning in Problems panel](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/features/git-tracked-envfile-warning.png)

**Remediation options:**

1. Add the file to `.gitignore` and optionally run `git rm --cached <file>` to stop tracking it.
2. Move sensitive values into VS Code `SecretStorage` (see [Managing Secrets](#managing-secrets)).
3. Use a `.secret` file that is already gitignored for values you want to keep local.

To silence all git-tracking warnings, set
[`workspaceTasks.envVars.warnIfGitTracked`]({{ site.baseurl }}/configuration/environment/environment-variables/#workspacetasksenvvarswarnifgittracked)
to `false`.

For the full settings reference see
[Environment Variables Settings]({{ site.baseurl }}/configuration/environment/environment-variables/#workspacetasksenvvarswarnifgittracked).

---

## Managing Secrets

Secrets can be managed via the **Secrets tree group** in the task view or via the Command Palette.

### Storing a Secret

**From the tree view:** Right-click the **Secrets** group (or click `$(add)` in its action bar) and
select **Store Secret**.

**From the Command Palette:**

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Workspace Tasks: Store Secret**
3. Enter a storage key (e.g. `myapp.deploy-token`)
4. Enter the secret value

### Updating a Secret

**From the tree view:** Click `$(edit)` in the action bar of any secret item, or right-click and
select **Update Secret**. Enter the new value when prompted — the key name is unchanged.

**From the Command Palette:** Run **Workspace Tasks: Update Secret**, then select the key to update.

### Deleting a Secret

**From the tree view:** Click `$(trash)` in the action bar of any secret item, or right-click and
select **Delete Secret**. Confirm the deletion when prompted.

**From the Command Palette:**

1. Open the Command Palette
2. Run **Workspace Tasks: Delete Secret**
3. Select the key to remove and confirm

### Copying a Secret Key Name

The key name (never the value) can be copied to the clipboard for use in configuration files.

**From the tree view:** Double-click a secret item, click `$(copy)` in its action bar, or
right-click and select **Copy Secret Key**.

**From the Command Palette:** Run **Workspace Tasks: Copy Secret Key** and select the key.

### Referencing a Secret in a Task

```jsonc
// .workspace-tasks.json — per-task secrets map
{
  "shell": {
    "tasks": [
      {
        "label": "Deploy",
        "command": "deploy.sh",
        "secrets": {
          "DEPLOY_TOKEN": "myapp.deploy-token"
        }
      }
    ]
  }
}
```

```jsonc
// settings.json — via taskEnv rule
{
  "workspaceTasks.envVars.taskEnv": [
    {
      "match": { "taskName": "Deploy" },
      "secrets": { "DEPLOY_TOKEN": "myapp.deploy-token" }
    }
  ]
}
```

---

## Inspecting Resolved Variables

Run **Workspace Tasks: Inspect Task Environment** (right-click a task → *Inspect Environment*, or
from the Command Palette) to see a fully source-annotated, redacted variable table for any task:

```text
KEY                           VALUE                         SOURCE                FILE
────────────────────────────  ────────────────────────────  ────────────────────  ──────────────────────────────
NODE_ENV                      development                   global.env            settings.json
APP_ENV                       local                         block.env             .workspace-tasks.json
PORT                          3000                          task.env              .workspace-tasks.json
DEPLOY_TOKEN                  ***                           task.secretStorage    SecretStorage
DB_PASSWORD                   ***                           task.secretFile       .secrets

⚠  Warning — keys below match secret patterns but are not from a secure source:
   API_KEY  (source: global.env, file: settings.json)
   Consider moving them to a .secret file or use "Workspace Tasks: Store Secret".
```

Secret values are always shown as `***`. The source column identifies where each variable came
from so you can trace overrides back to the exact configuration layer.

---

## Secrets Tree View

All secrets stored by Workspace Tasks are visible in a dedicated **Secrets** group at the bottom
of the task tree. The group only appears when at least one secret exists.

| Element | Icon | Description |
|---------|------|-------------|
| **Secrets** group | `$(key)` | Container for all stored secret keys |
| Secret item | `$(lock)` | Displays the key name only (never the value) |

### Interacting with Secrets

**Double-click** a secret item to copy its key name to the clipboard.

The action bar on each secret item provides three one-click operations:

| Icon | Action | Description |
|------|--------|-------------|
| `$(copy)` | **Copy Secret Key** | Copies the key name to the clipboard |
| `$(edit)` | **Update Secret** | Prompts for a new value and replaces the existing one |
| `$(trash)` | **Delete Secret** | Prompts for confirmation, then removes the secret |

The same three actions are available in the right-click context menu on any secret item.

**Right-clicking the Secrets group** exposes an **Add New Secret** action (also available in the
`…` overflow menu in the view title bar).

### Managing Secrets from the Command Palette

All secret operations are also available without using the tree view:

| Command | Description |
|---------|-------------|
| **Workspace Tasks: Store Secret** | Prompts for a key name and value, stores in SecretStorage |
| **Workspace Tasks: Delete Secret** | Shows a QuickPick of keys — choose one and confirm |
| **Workspace Tasks: Update Secret** | Shows a QuickPick of keys — choose one and enter a new value |
| **Workspace Tasks: Copy Secret Key** | Shows a QuickPick of keys — copies the chosen key name to clipboard |

---

## See Also

- [Environment Variables — Settings Reference]({{ site.baseurl }}/configuration/environment/environment-variables/)
- [Custom Workspace Tasks]({{ site.baseurl }}/features/custom-workspace-tasks/)
