---
layout: default
title: ⚡ Performance
nav_order: 7
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Performance
{: .no_toc }

This section documents the performance investigations and improvements made to the Workspace Tasks extension. Each analysis covers root-cause diagnosis, the optimizations applied, and before/after measurements.

---

{% include _v160_perf.md %}

## Test Dataset

All performance measurements were taken against the **sample-workspace-tasks** project — a comprehensive multi-language workspace representative of a real-world monorepo.

| Attribute | Value |
| --- | --- |
| Workspace task providers | 17 (16 built-in + 1 custom) |
| Files indexed by `TaskFilesService` | 53 |
| Shell script tasks | 27 across 10 shell types |
| VS Code tasks (`.vscode/tasks.json`) | 3 |
| Custom provider (`pantera`) | 1 target glob |

### Languages and Task Types Represented

The sample workspace exercises every major provider and task runner supported by the extension:

| Category | Technologies |
| --- | --- |
| **Package managers** | npm, poetry, pipenv, cargo, bun, pnpm, yarn |
| **Build tools** | webpack, cmake, cargo-make, gradle, maven |
| **Task runners** | make, just, grunt, gulp, cake |
| **Languages** | TypeScript, Python, Go, Rust, Ruby, Perl, Bash, PowerShell, Batch, Deno |
| **Containers** | Docker, docker-compose |
| **CI/CD** | GitHub Actions workflows |
| **VS Code native** | `.vscode/tasks.json` |
| **Custom** | `.workspace-tasks.json` with custom `pantera` provider |

### Sample Directory Layout

```tree
sample-workspace-tasks/
├── apps/                   # Multi-root app sub-folders (appA, appB, appC)
├── cargo/                  # Rust / Cargo tasks
├── cmake/                  # CMake build tasks
├── deno/                   # Deno tasks
├── docker/                 # Dockerfile and docker-compose
├── golang/                 # Go module tasks
├── gradle/                 # Gradle build tasks
├── grunt/                  # Grunt task runner
├── gulp/                   # Gulp task runner
├── justfile/               # just task runner
├── makefile/               # GNU Make tasks
├── maven/                  # Maven build tasks
├── nodejs/                 # Node.js package tasks
├── powershell/             # PowerShell scripts
├── python/                 # Python (poetry, pipenv)
├── ruby/                   # Ruby / Rake tasks
├── shell/                  # Shell scripts (bash, sh, zsh, python, batch)
├── .devcontainer/          # Dev container setup scripts
├── .vscode/tasks.json      # VS Code native tasks
└── .workspace-tasks.json   # Custom workspace-tasks provider config
```

---

## Improvement Plans

| Plan | Baseline | After Optimization | Improvement |
| --- | --- | --- | --- |
| [Workspace Tasks Loading](workspace-tasks-loading.md) | ~52,000 ms | ~795 ms | **~98.5%** |
| [Shell Task Loading](shell-task-loading.md) | ~15,483 ms | ~15,419 ms cold / <10 ms warm | FS scan unavoidable; warm reload eliminated |
