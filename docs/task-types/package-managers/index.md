---
layout: default
title: 📦 Packages & Build Tools
parent: 📱 Supported Task Types
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Package Managers & Build Tools
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

<!-- markdownlint-disable MD033 -->
<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/npm.png" width="32" alt="npm" title="npm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/yarn.png" width="32" alt="Yarn" title="Yarn"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pnpm.png" width="32" alt="pnpm" title="pnpm"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/bun.png" width="32" alt="Bun" title="Bun"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/composer.png" width="32" alt="Composer" title="Composer"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/pipenv.png" width="32" alt="Pipenv" title="Pipenv"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/poe.png" width="32" alt="Poe the Poet" title="Poe the Poet"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/poetry.png" width="32" alt="Poetry" title="Poetry"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/ant.png" width="32" alt="Ant" title="Ant"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/maven.png" width="32" alt="Maven" title="Maven"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/msbuild.png" width="32" alt="MSBuild" title="MSBuild"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cmake.png" width="32" alt="CMake" title="CMake"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cake.png" width="32" alt="Cake" title="Cake Build"/>
</p>
<!-- markdownlint-enable MD033 -->

| Tool | File Patterns | Notes |
| --- | --- | --- |
| **[npm](https://www.npmjs.com/)** | `**/package.json` | Reads `scripts` section |
| **[Yarn](https://yarnpkg.com/)** | `**/package.json` | Reads `scripts` section |
| **[pnpm](https://pnpm.io/)** | `**/package.json` | Reads `scripts` section |
| **[Bun](https://bun.com/)** | `**/package.json` | Scripts via `bun run <script>`, plus built-in `bun:install`, `bun:build`, and `bun:test` |
| **[Composer](https://getcomposer.org/)** | `**/composer.json` | PHP dependency scripts |
| **[Pipenv](https://pipenv.pypa.io/)** | `**/Pipfile` | Python scripts |
| **[Poe the Poet](https://poethepoet.natn.io/)** | `**/pyproject.toml` | Python task runner |
| **[Poetry](https://python-poetry.org/)** | `**/pyproject.toml` | Python scripts |
| **[Apache Ant](https://ant.apache.org/)** | `**/*.xml` | Build file targets |
| **[Apache Maven](https://maven.apache.org/)** | `**/pom.xml` | Lifecycle goals |
| **[Gradle](https://gradle.org/)** | `**/*.gradle` | Java/Android build tasks |
| **[MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild)** | `**/*.{csproj,vbproj,sln}` | .NET project targets |
| **[CMake](https://cmake.org/)** | `**/CMakeLists.txt` | `add_custom_target` and `add_executable` targets |
| **[Cake Build](https://cakebuild.net/)** | `**/*.cake` | `Task("...")` declarations; requires `dotnet cake` |

---

## Next Steps

- [Task Runners](task-runners) — Gulp, Grunt, Cargo, Just, Make, mise
- [DevOps & Containers](devops) — Docker, Docker Compose, GitHub Actions
- [Scripts & Other](scripts) — Shell scripts, Python, Jupyter Notebooks
- [Configuration Reference](../configuration) — Full settings reference including task type toggles
- [Enabling / Disabling Task Types](../configuration/task-type) — Control which task types are active
