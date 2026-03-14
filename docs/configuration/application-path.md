---
layout: default
title: ⚙️ Application Path
parent: ⚙️ Configuration
nav_order: 9
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Application Path Settings
{: .no_toc }

These settings allow you to specify custom paths for various build tools and task runners.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.applicationPath.act

**Type:** `string`
**Default:** `"act"`
**Scope:** `resource`

Act allows you to run GitHub Actions locally. Specify the path to the [Act](https://github.com/nektos/act) executable. On Windows, if the path ends with `act`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```jsonc
{
  // this will look for the executable within the project
  "workspaceTasks.applicationPath.act": "tools\\act\\act.exe",
}
```

![Screenshot - Act Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/act-path.png)

### workspaceTasks.applicationPath.ant

**Type:** `string`
**Default:** `"ant"`

Specify the path to the Ant executable. On Windows, if the path ends with `ant`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ant": "ant"
}
```

![Screenshot - Ant Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ant-path.png)

### workspaceTasks.applicationPath.ansicon

**Type:** `string`
**Default:** `"ansicon.exe"`

Specify the path to the ANSICON executable. This is used to enable colored output for Ant tasks in the terminal. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ansicon": "ansicon.exe"
}
```

![Screenshot - Ansicon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ansicon-path.png)

### workspaceTasks.applicationPath.composer

**Type:** `string`
**Default:** `"composer"`

Specify the path to the [Composer](https://getcomposer.org/) executable. On Windows, if the path ends with `composer`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.composer": "composer"
}
```

![Screenshot - Composer Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/composer-path.png)

### workspaceTasks.applicationPath.deno

**Type:** `string`
**Default:** `"~/.deno/bin/deno"`

Specify the path to the [Deno](https://deno.land/) executable. On Windows, if the path ends with `deno`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.deno": "~/.deno/bin/deno"
}
```

![Screenshot - Deno Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/deno-path.png)

### workspaceTasks.applicationPath.gradle

**Type:** `string`
**Default:** `"gradlew"`

Specify the path to the [Gradle](https://gradle.org/) executable. On Windows, if the path ends with `gradle`, `.bat` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.gradle": "gradlew"
}
```

![Screenshot - Gradle Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/gradle-path.png)

### workspaceTasks.applicationPath.just

**Type:** `string`
**Default:** `"just"`

Specify the path to the [Just](https://just.systems/) executable. On Windows, if the path ends with `just`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.just": "just"
}
```

![Screenshot - Just Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/just-path.png)

### workspaceTasks.applicationPath.make

**Type:** `string`
**Default:** `"make"`

Specify the path to the Make executable. On Windows, if the path ends with `make`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.make": "make"
}
```

![Screenshot - Make Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/make-path.png)

### workspaceTasks.applicationPath.maven

**Type:** `string`
**Default:** `"mvn"`

Specify the path to the [Maven](https://maven.apache.org/) executable. On Windows, if the path ends with `mvn`, `.cmd` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.maven": "mvn"
}
```

![Screenshot - Maven Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/maven-path.png)

### workspaceTasks.applicationPath.msbuild

**Type:** `string`
**Default:** `"msbuild"`

Specify the path to the MSBuild executable. On Windows, if the path ends with `msbuild`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.msbuild": "msbuild"
}
```

![Screenshot - MSBuild Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/msbuild-path.png)

### workspaceTasks.applicationPath.pipenv

**Type:** `string`
**Default:** `"pipenv"`

Specify the path to the [Pipenv](https://pipenv.pypa.io/en/latest/) executable. On Windows, if the path ends with `pipenv`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory.

**Example:**

```json
{
  "workspaceTasks.applicationPath.pipenv": "pipenv"
}
```

![Screenshot - Pipenv Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/pipenv-path.png)
