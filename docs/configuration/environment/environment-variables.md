---
layout: default
title: 🔐 Environment Variables
parent: 🌐 Environment
grand_parent: ⚙️ Configuration
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Environment Variables Settings
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
v1.7.0 introduces a powerful new system for environment variables and secrets.

Full settings reference for all `workspaceTasks.envVars.*` configuration keys. For a
conceptual overview, worked examples, and the fourteen-layer precedence table see
[Task Environment Variables]({{ site.baseurl }}/features/task-environment-variables/).

---

## Global Variables

### workspaceTasks.envVars.env

**Type:** `object` (`additionalProperties: string`)
**Default:** `{}`

A flat map of environment variable names to values applied to **all** tasks (Layer 1).

```jsonc
{
  "workspaceTasks.envVars.env": {
    "NODE_ENV": "development",
    "DEBUG": "workspace-tasks:*"
  }
}
```

---

### workspaceTasks.envVars.envFiles

**Type:** `string | string[] | { include: string[]; exclude?: string[] }`
**Default:** `[]`

`.env`-format files loaded for **all** tasks (Layer 2). Accepts three forms:

```jsonc
// Single path or glob
"workspaceTasks.envVars.envFiles": ".env"

// Ordered list
"workspaceTasks.envVars.envFiles": [".env", ".env.local"]

// Include/exclude glob object
"workspaceTasks.envVars.envFiles": {
  "include": [".env", ".env.*"],
  "exclude": ["**/.env.secret", "**/node_modules/**"]
}
```

When a glob pattern expands to multiple files, results are sorted alphabetically. Files load in
the order they are resolved; later files override earlier files for duplicate keys.

---

### workspaceTasks.envVars.secretFiles

**Type:** `string | string[] | { include: string[]; exclude?: string[] }`
**Default:** `[]`

`.secret`-format files loaded for **all** tasks (Layer 3). These files are parsed identically to
`.env` files but variables from them are tagged `isSecret = true` and **never trigger** the
secret-pattern warning. The same three forms are accepted as `envFiles`.

```jsonc
{
  "workspaceTasks.envVars.secretFiles": {
    "include": [".secrets", "**/.env.secret"],
    "exclude": ["**/node_modules/**"]
  }
}
```

---

### workspaceTasks.envVars.secretPatterns

**Type:** `string[]`
**Default:** `["*_TOKEN", "*_KEY", "*_SECRET", "PASSWORD", "PASSWD", "CREDENTIALS", "API_KEY"]`

A list of glob patterns matched against variable key names. When a key name matches and the value
came from a plain `env` block or `.env` file (not from a `.secret` file or `SecretStorage`), the
**Inspect Task Environment** command displays a warning.

This is advisory only — the task still runs.

```jsonc
{
  "workspaceTasks.envVars.secretPatterns": [
    "*_TOKEN", "*_KEY", "*_SECRET",
    "PASSWORD", "PASSWD",
    "CREDENTIALS", "API_KEY",
    "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"
  ]
}
```

---

## Per-Task Rules

### workspaceTasks.envVars.taskEnv

**Type:** `ITaskEnvRule[]`
**Default:** `[]`

An array of rules that inject environment variables into any discovered task — npm scripts,
Makefile targets, shell scripts, etc. — without requiring a `.workspace-tasks.json` file (Layers
11–14).

Each rule has a `match` object (all specified fields must pass — AND logic) and any combination
of `env`, `envFiles`, `secretFiles`, and `secrets` payloads.

```jsonc
{
  "workspaceTasks.envVars.taskEnv": [
    {
      "match": {
        "taskType": "npm",
        "taskName": "publish",
        "source": "**/package.json",
        "workspaceFolder": "api"
      },
      "env": {
        "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org"
      },
      "envFiles": [".env", ".env.local"],
      "secretFiles": ".secrets.publish",
      "secrets": {
        "NPM_TOKEN": "myapp.npm-publish-token"
      },
      "enabled": true
    }
  ]
}
```

#### `match` — `ITaskMatcher`

All specified fields must match (AND logic). Omitting a field skips that check.

| Field | Type | Description |
|-------|------|-------------|
| `taskName` | `string` | Exact match, glob (`publish*`), or `/regex/` match against the task label |
| `taskType` | `string \| string[]` | Task source type, e.g. `"npm"`, `"shell"`. Array: any element must match |
| `source` | `string \| string[]` | Glob pattern(s) matched against the task definition file path |
| `workspaceFolder` | `string` | Workspace folder **name** (not path) for multi-root scoping |

**taskName matching rules:**

- Plain string → case-sensitive exact match.
- Contains `*` or `?` → gitignore-style glob via `micromatch`.
- Starts and ends with `/` (e.g. `/^deploy.*/`) → compiled as a `RegExp`.
- An empty `match: {}` matches **all** tasks globally.

#### Rule Payload Fields

| Field | Type | Description |
|-------|------|-------------|
| `env` | `Record<string, string>` | Inline variable overrides (may trigger secret-pattern warning) |
| `envFiles` | `IEnvFileReference` | `.env`-type files (same three forms as global setting) |
| `secretFiles` | `IEnvFileReference` | `.secret`-type files — never triggers warning |
| `secrets` | `Record<string, string>` | Maps env var names → VS Code `SecretStorage` keys |
| `enabled` | `boolean` | Per-rule kill switch. Default: `true` |

Multiple matching rules are applied in array order. The last matching value for any duplicate key
wins.

---

## Commands

### `workspaceTasks.env.storeSecret` — Store Secret

Prompts for a storage key and a secret value, then saves the value in VS Code `SecretStorage`.
The value is encrypted at rest, not synced to other machines, and accessible via the `secrets`
field in `taskEnv` rules or in per-task `.workspace-tasks.json` `secrets` maps.

**Command palette:** `Workspace Tasks: Store Secret`

---

### `workspaceTasks.env.updateSecret` — Update Secret

Shows a sorted QuickPick of all stored secret keys. After selecting a key, prompts for the new
value and overwrites the existing entry in VS Code `SecretStorage`. Can also be triggered from
the **Secrets** tree group by clicking the `$(edit)` (pencil) icon on any secret item or via its
right-click context menu.

**Command palette:** `Workspace Tasks: Update Secret`

---

### `workspaceTasks.env.deleteSecret` — Delete Secret

Shows a sorted QuickPick of all stored secret keys and deletes the selected entry after
confirmation. Can also be triggered from the **Secrets** tree group by clicking the `$(trash)`
(delete) icon on any secret item or via its right-click context menu.

**Command palette:** `Workspace Tasks: Delete Secret`

---

### `workspaceTasks.env.copySecretKey` — Copy Secret Key

Shows a sorted QuickPick of all stored secret keys and copies the selected key **name** (not the
value) to the clipboard. Useful for pasting the key into a `secrets` map in your task
configuration. Can also be triggered from the **Secrets** tree group by clicking the `$(copy)`
icon on any secret item, double-clicking the item, or via its right-click context menu.

**Command palette:** `Workspace Tasks: Copy Secret Key`

---

### `workspaceTasks.env.inspect` — Inspect Task Environment

Resolves the fully-merged environment variable table for a task — applying all fourteen
precedence layers — and displays a source-annotated, redacted table in the
**Workspace Tasks – Environment** output channel.

Can be triggered from:

- **Context menu** — right-click any task item → **Inspect Environment**
- **Command palette** → `Workspace Tasks: Inspect Task Environment` (opens a QuickPick to choose a task)

Secret values are shown as `***`. A warning section lists any keys from non-secret sources whose
names match `workspaceTasks.envVars.secretPatterns`.

---

## `.workspace-tasks.json` — Env Fields Reference

These fields are available at both the **language-block** level (applies to all tasks in the
block) and the **per-task** level. Per-task values override language-block values for the same
key.

| Field | Type | Layer | Description |
|-------|------|-------|-------------|
| `env` | `Record<string, string>` | 5 (block) / 8 (task) | Inline variable overrides |
| `envFiles` | `IEnvFileReference` | 4 (block) / 7 (task) | `.env`-type files |
| `secretFiles` | `IEnvFileReference` | 6 (block) / 9 (task) | `.secret`-type files |
| `secrets` | `Record<string, string>` | 10 (task only) | Env var name → `SecretStorage` key map |

**Full example:**

```jsonc
{
  "shell": {
    "version": "2.0.0",
    "envFiles": { "include": [".env", ".env.*"], "exclude": ["**/.env.secret"] },
    "env": { "APP_ENV": "local" },
    "secretFiles": ".secrets",
    "tasks": [
      {
        "label": "Start Dev Server",
        "command": "node server.js",
        "envFiles": [".env.dev", ".env.override"],
        "env": { "PORT": "3000" },
        "secretFiles": { "include": [".env.secret", ".secrets"], "exclude": ["**/vendor/**"] },
        "secrets": {
          "DEPLOY_TOKEN": "myapp.deploy-token",
          "DB_PASSWORD":  "myapp.db-password"
        }
      }
    ]
  }
}
```

---

## See Also

- [Task Environment Variables (Feature Overview)]({{ site.baseurl }}/features/task-environment-variables/)
- [Custom Workspace Tasks]({{ site.baseurl }}/features/custom-workspace-tasks/)
