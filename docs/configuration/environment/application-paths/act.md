---
layout: default
title: 🎬 Act (GitHub Actions)
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Act (GitHub Actions) Settings
{: .no_toc }

[Act](https://github.com/nektos/act) lets you run GitHub Actions workflows locally. These settings configure the `act` integration in Workspace Tasks.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.applicationPath.act

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"act"` |
| **Scope:** | `resource` |

Path to the `act` executable. On Windows, `.exe` is appended automatically when the path ends with `act`. On all platforms, `~/` is expanded to the user's home directory.

**Example:**

```jsonc
{
  // Look for the executable within the project directory
  "workspaceTasks.applicationPath.act": "tools\\act\\act.exe"
}
```

![Screenshot - Act Path]({{ '/configuration/act-path.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.act.envFile

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `""` |
| **Scope:** | `resource` |

Path to a `.env` file that provides environment variables when running workflows with `act`. See the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure) for the expected file format.

**Example:**

```json
{
  "workspaceTasks.act.envFile": ".env.act"
}
```

![Screenshot - Act Env File]({{ '/configuration/act-env.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.act.variablesFile

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `""` |
| **Scope:** | `resource` |

Path to a variables file for `act`. The file uses the same key=value format as `.env` files.

**Example:**

```json
{
  "workspaceTasks.act.variablesFile": ".vars"
}
```

![Screenshot - Act Variables File]({{ '/configuration/act-vars-file.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.act.variables

| | |
| --- | --- |
| **Type:** | `object` |
| **Default:** | `{}` |
| **Scope:** | `resource` |

Inline key-value variables passed to `act` at runtime. These supplement or override variables loaded from `workspaceTasks.act.variablesFile`.

**Example:**

```json
{
  "workspaceTasks.act.variables": {
    "MY_VAR": "value",
    "BUILD_ENV": "development"
  }
}
```

![Screenshot - Act Variables]({{ '/configuration/act-vars.png' | prepend: site.github_image_docs_url }})

---

### workspaceTasks.act.secretsFile

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `".secrets"` |
| **Scope:** | `resource` |

Path to a `.env`-format file containing secrets for `act`. This file should be added to `.gitignore` to avoid committing credentials. See the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure) for the expected file format.

**Example:**

```json
{
  "workspaceTasks.act.secretsFile": ".secrets"
}
```

![Screenshot - Act Secrets File]({{ '/configuration/act-secrets.png' | prepend: site.github_image_docs_url }})

---

## Related

- [GitHub Actions task type](../../../task-types/github-actions)
