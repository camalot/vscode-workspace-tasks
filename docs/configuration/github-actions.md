---
layout: default
title: ⚙️ GitHub Actions
parent: ⚙️ Configuration
nav_order: 10
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# GitHub Actions Settings (Act)
{: .no_toc }

These settings configure how the extension runs GitHub Actions locally using Act.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.act.envFile

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Specify the path to a .env file containing environment variables for Act. This file will be used to provide environment variable values when running GitHub Actions locally with Act. For examples of the file format see the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure).

**Example:**

```json
{
	"workspaceTasks.act.envFile": ".env.act"
}
```

![Screenshot - Act Env File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-env.png)

### workspaceTasks.act.variablesFile

**Type:** `string`
**Default:** `""`
**Scope:** `resource`

Path to the variables file for `act`. The file format is the same as `.env` file format.

**Example:**

```json
{
	"workspaceTasks.act.variablesFile": ".vars"
}
```

![Screenshot - Act Variables File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-vars-file.png)

### workspaceTasks.act.variables

**Type:** `object`
**Default:** `{}`
**Scope:** `resource`

Variables to pass to 'act'. Each key-value pair represents a variable name and its corresponding value.

**Example:**

```json
{
	"workspaceTasks.act.variables": {
		"MY_VAR": "value",
		"BUILD_ENV": "development"
	}
}
```

![Screenshot - Act Variables](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-vars.png)

### workspaceTasks.act.secretsFile

**Type:** `string`
**Default:** `".secrets"`
**Scope:** `resource`

Specify the path to a .env file containing secrets for Act. This file will be used to provide secret values when running GitHub Actions locally with Act. For examples of the file format see the [Act documentation](https://nektosact.com/usage/index.html#envsecrets-files-structure).

**Example:**

```json
{
	"workspaceTasks.act.secretsFile": ".secrets"
}
```

![Screenshot - Act Secrets File](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-secrets.png)
