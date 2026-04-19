---
layout: default
title: 🦊 gitlab-ci-local
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 5
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# gitlab-ci-local Settings
{: .no_toc }

[gitlab-ci-local](https://github.com/firecow/gitlab-ci-local) lets you run GitLab CI/CD pipeline jobs locally. These settings configure the `gitlab-ci-local` integration in Workspace Tasks.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
> **New in v1.9.0**: GitLab CI support.

---

### workspaceTasks.applicationPath.gitlabCiLocal

**Type:** `string`
**Default:** `"gitlab-ci-local"`
**Scope:** `resource`

Path to the `gitlab-ci-local` executable. On all platforms, `~/` is expanded to the user's home directory.

Install globally with npm:

```sh
npm install -g gitlab-ci-local
```

**Example:**

```jsonc
{
  // Use a project-local installation
  "workspaceTasks.applicationPath.gitlabCiLocal": "./node_modules/.bin/gitlab-ci-local"
}
```

---

### workspaceTasks.gitlabCiLocal.additionalFilePatterns

**Type:** `string[]`
**Default:** `[]`
**Scope:** `resource`

Additional glob patterns for discovering `.gitlab-ci.yml` files with non-standard names or locations. Patterns are merged with the built-in `**/.gitlab-ci.yml` pattern.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.additionalFilePatterns": [
    "**/.gitlab-ci.staging.yml",
    "**/ci/pipeline.yml"
  ]
}
```

---

### workspaceTasks.gitlabCiLocal.variablesFile

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Path to a YAML file containing CI/CD variables, passed to `gitlab-ci-local` via `--variables-file`.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.variablesFile": ".local-variables.yml"
}
```

---

### workspaceTasks.gitlabCiLocal.variable

**Type:** `string[]`
**Default:** `[]`
**Scope:** `resource`

Array of `KEY=VALUE` strings passed via `--variable`. Each entry results in a separate `--variable` flag.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.variable": [
    "DEPLOY_ENV=staging",
    "APP_VERSION=1.2.3"
  ]
}
```

---

### workspaceTasks.gitlabCiLocal.unsetVariable

**Type:** `string[]`
**Default:** `[]`
**Scope:** `resource`

Array of variable names to unset, passed via `--unset-variable`. Each entry results in a separate `--unset-variable` flag.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.unsetVariable": ["SECRET_KEY"]
}
```

---

### workspaceTasks.gitlabCiLocal.remoteVariables

**Type:** `string[]`
**Default:** `[]`
**Scope:** `resource`

Array of remote variable sources passed via `--remote-variables`.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.remoteVariables": ["group/project:main"]
}
```

---

### workspaceTasks.gitlabCiLocal.home

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Override the home directory used by `gitlab-ci-local` via `--home`. Leave empty to use the system default.

**Example:**

```jsonc
{
  "workspaceTasks.gitlabCiLocal.home": "/custom/home"
}
```
