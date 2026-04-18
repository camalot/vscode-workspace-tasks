---
layout: default
title: ▶️ Task Runners
parent: 📱 Supported Task Types
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Runners
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

<!-- markdownlint-disable MD033 -->
<p align="left">
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/gulp.png" width="32" alt="Gulp" title="Gulp"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/grunt.png" width="32" alt="Grunt" title="Grunt"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/justfile.png" width="32" alt="Just" title="Just"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/mise.png" width="32" alt="mise" title="mise"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo.png" width="32" alt="cargo" title="cargo"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cargo-make.png" width="32" alt="cargo-make" title="cargo-make"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cmake.png" width="32" alt="CMake" title="CMake"/>
  <img src="https://raw.githubusercontent.com/camalot/vscode-workspace-tasks/refs/heads/develop/res/icons/dark/cake.png" width="32" alt="Cake" title="Cake Build"/>
</p>
<!-- markdownlint-enable MD033 -->

| Tool | File Patterns | Notes |
| --- | --- | --- |
| **[Gulp](https://gulpjs.com/)** | `**/gulpfile.{js,mjs}` | Exported tasks |
| **[Grunt](https://gruntjs.com/)** | `**/Gruntfile.js` | Registered tasks |
| **[Cargo](https://doc.rust-lang.org/cargo/)** | `**/Cargo.toml` | Rust build tasks |
| **[cargo-make](https://sagiegurari.github.io/cargo-make/)** | `**/{Makefile.toml,*.toml}` | Rust task runner (requires Cargo) |
| **[Just](https://github.com/casey/just)** | `**/{justfile,.justfile,*.just}` | Command recipes |
| **[Make](https://www.gnu.org/software/make/)** | `**/Makefile` | Build targets |
| **[mise](https://mise.jdx.dev/)** | `**/mise.toml`, `**/mise.*.toml`, `**/mise.*.local.toml` | TOML tasks and file tasks |
| **[Task (go-task)](https://taskfile.dev/)** | `**/Taskfile.{yml,yaml}`, `**/Taskfile.dist.{yml,yaml}` | CLI-based discovery; requires `task` on `PATH` |
| **[CMake](https://cmake.org/)** | `**/CMakeLists.txt` | `add_custom_target` and `add_executable` targets |
| **[Cake Build](https://cakebuild.net/)** | `**/*.cake` | `Task("...")` declarations; requires `dotnet cake` |

---

## Next Steps

- [Package Managers & Build Tools](package-managers) — npm, Yarn, pnpm, Bun, Composer, and more
- [DevOps & Containers](devops) — Docker, Docker Compose, GitHub Actions
- [Scripts & Other](scripts) — Shell scripts, Python, Jupyter Notebooks
- [Configuration Reference](../configuration) — Full settings reference including task type toggles
- [Enabling / Disabling Task Types](../configuration/task-type) — Control which task types are active
