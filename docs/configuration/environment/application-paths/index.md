---
layout: default
title: 📂 Application Paths
parent: 🌐 Environment
grand_parent: ⚙️ Configuration
nav_order: 1
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Application Path Settings
{: .no_toc }

These settings allow you to specify custom executable paths for build tools and task runners supported by the extension. On all platforms, `~/` in a path is automatically expanded to the user's home directory. On Windows, if a path ends with the bare executable name (e.g. `ant`, not `ant.exe`), the appropriate extension (`.exe`, `.bat`, `.cmd`) is appended automatically.

Some tools have dedicated sub-pages with additional tool-specific settings:

| Sub-section | Description |
| --- | --- |
| [Act](act) | Run GitHub Actions locally with `act` |
| [Ant](ant) | Ant build tool and ANSICON settings |
| [CMake](cmake) | CMake build system settings |

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.applicationPath.ansicon

**Type:** `string`
**Default:** `"ansicon.exe"`

Path to the ANSICON executable used to provide coloured output for Ant tasks in the Windows terminal.

**Example:**

```json
{
  "workspaceTasks.applicationPath.ansicon": "ansicon.exe"
}
```

![Screenshot - Ansicon Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/ansicon-path.png)

---

### workspaceTasks.applicationPath.cargo

**Type:** `string`
**Default:** `"cargo"`

Path to the [Cargo](https://doc.rust-lang.org/cargo/) executable (Rust package manager and build tool). On Windows, `.exe` is appended automatically when the path ends with `cargo`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.cargo": "cargo"
}
```

---

### workspaceTasks.applicationPath.cargo-make

**Type:** `string`
**Default:** `"cargo-make"`

Path to the [cargo-make](https://github.com/sagiegurari/cargo-make) task runner. On Windows, `.exe` is appended automatically when the path ends with `cargo-make`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.cargo-make": "cargo-make"
}
```

---

### workspaceTasks.applicationPath.composer

**Type:** `string`
**Default:** `"composer"`

Path to the [Composer](https://getcomposer.org/) PHP package manager executable. On Windows, `.bat` is appended automatically when the path ends with `composer`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.composer": "composer"
}
```

![Screenshot - Composer Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/composer-path.png)

---

### workspaceTasks.applicationPath.deno

**Type:** `string`
**Default:** `"~/.deno/bin/deno"`

Path to the [Deno](https://deno.land/) runtime executable. On Windows, `.exe` is appended automatically when the path ends with `deno`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.deno": "~/.deno/bin/deno"
}
```

![Screenshot - Deno Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/deno-path.png)

---

### workspaceTasks.applicationPath.gradle

**Type:** `string`
**Default:** `"gradlew"`

Path to the [Gradle](https://gradle.org/) wrapper or executable. On Windows, `.bat` is appended automatically when the path ends with `gradle`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.gradle": "gradlew"
}
```

![Screenshot - Gradle Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/gradle-path.png)

---

### workspaceTasks.applicationPath.just

**Type:** `string`
**Default:** `"just"`

Path to the [Just](https://just.systems/) command runner. On Windows, `.exe` is appended automatically when the path ends with `just`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.just": "just"
}
```

![Screenshot - Just Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/just-path.png)

---

### workspaceTasks.applicationPath.make

**Type:** `string`
**Default:** `"make"`

Path to the Make executable. On Windows, `.exe` is appended automatically when the path ends with `make`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.make": "make"
}
```

![Screenshot - Make Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/make-path.png)

---

### workspaceTasks.applicationPath.maven

**Type:** `string`
**Default:** `"mvn"`

Path to the [Maven](https://maven.apache.org/) executable. On Windows, `.cmd` is appended automatically when the path ends with `mvn`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.maven": "mvn"
}
```

![Screenshot - Maven Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/maven-path.png)

---

### workspaceTasks.applicationPath.msbuild

**Type:** `string`
**Default:** `"msbuild"`

Path to the MSBuild executable. On Windows, `.exe` is appended automatically when the path ends with `msbuild`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.msbuild": "msbuild"
}
```

![Screenshot - MSBuild Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/msbuild-path.png)

---

### workspaceTasks.applicationPath.pipenv

**Type:** `string`
**Default:** `"pipenv"`

Path to the [Pipenv](https://pipenv.pypa.io/) Python environment manager. On Windows, `.exe` is appended automatically when the path ends with `pipenv`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.pipenv": "pipenv"
}
```

![Screenshot - Pipenv Path](https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/assets/images/docs/configuration/pipenv-path.png)

---

### workspaceTasks.applicationPath.poe

**Type:** `string`
**Default:** `"poe"`

Path to the [Poe the Poet](https://poethepoet.natn.io/) task runner for Python projects. On Windows, `.exe` is appended automatically when the path ends with `poe`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.poe": "poe"
}
```

---

### workspaceTasks.applicationPath.poetry

**Type:** `string`
**Default:** `"poetry"`

Path to the [Poetry](https://python-poetry.org/) Python dependency and packaging tool. On Windows, `.exe` is appended automatically when the path ends with `poetry`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.poetry": "poetry"
}
```

---

### workspaceTasks.applicationPath.rake

**Type:** `string`
**Default:** `"rake"`

Path to the [Rake](https://ruby.github.io/rake/) Ruby build tool. On Windows, `.bat` is appended automatically when the path ends with `rake`.

**Example:**

```json
{
  "workspaceTasks.applicationPath.rake": "rake"
}
```
