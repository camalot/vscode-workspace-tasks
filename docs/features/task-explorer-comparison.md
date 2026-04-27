---
layout: default
title: 🏁 Comparison Matrix
parent: 🚀 Features
nav_order: 99
has_children: false
---

<!-- markdownlint-disable-file MD033 MD022 MD025 -->
# Feature Comparison: Workspace Tasks vs. Task Explorer
{: .no_toc }

This page compares **Workspace Tasks** (`darthminos.workspace-tasks`) with **Task Explorer** (`spmeesseman.vscode-taskexplorer`) — two popular VS Code extensions for discovering and running workspace tasks and scripts.

{: .note }
> Task Explorer information is based on the v2.13.2 source commit
> ([3edc102](https://github.com/spmeesseman/vscode-taskexplorer/tree/3edc1021a7b1bbc9ea1176b3828b298b0196993a))
> and the current marketplace listing (v3.0.12). Workspace Tasks information reflects the current release.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

| | **Workspace Tasks** | **Task Explorer** |
| --- | --- | --- |
| Publisher | darthminos (camalot) | spmeesseman |
| Marketplace ID | `darthminos.workspace-tasks` | `spmeesseman.vscode-taskexplorer` |
| License | Apache 2.0 | Custom (paid license planned) |
| Open VSX | ✅ Available | ❌ Not listed |
| VS Code minimum | 1.105.1 | 1.50+ (v2) / 1.102+ (v3) |
| Pricing | Free & open source | Free (Preview); paid license planned for full features |

---

## Task Type Support

| Task / Script Type | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| VS Code Tasks (`.vscode/tasks.json`) | ✅ | ✅ | |
| User-level Tasks (`tasks.json`) | ✅ | ✅ | |
| npm (`package.json`) | ✅ | ✅ | |
| Yarn (`package.json`) | ✅ | ✅ (v3+) | |
| pnpm (`package.json`) | ✅ | ❌ | |
| Bun (`package.json`) | ✅ | ❌ | |
| Gulp | ✅ | ✅ | |
| Grunt | ✅ | ✅ | |
| Apache Ant | ✅ | ✅ | |
| Apache Maven | ✅ | ✅ (v2.2+) | |
| Gradle | ✅ | ✅ (v1.15+) | |
| Make / Makefile | ✅ | ✅ (v1.10+) | |
| Composer (PHP) | ✅ | ✅ (v2.6+) | |
| Pipenv (Python `Pipfile`) | ✅ | ✅ (v2.4+) | |
| Poetry (`pyproject.toml`) | ✅ | ❌ | |
| Poe the Poet (`pyproject.toml`) | ✅ | ❌ | |
| Cargo (Rust) | ✅ | ❌ | |
| cargo-make (`Makefile.toml`) | ✅ | ❌ | |
| Just (`justfile`) | ✅ | ❌ | |
| mise (`mise.toml`) | ✅ | ❌ | |
| Cake Build (`.cake`) | ✅ | ❌ | |
| MSBuild (`.csproj`) | ✅ | ❌ | |
| Docker / Dockerfile | ✅ | ❌ | |
| Docker Compose | ✅ | ❌ | |
| GitHub Actions (via `act`) | ✅ | ❌ | |
| Bash / Shell scripts (`.sh`, `.bash`, `.zsh`, `.fish`) | ✅ | ✅ (v1.12+) | |
| PowerShell (`.ps1`) | ✅ | ✅ (v1.12+) | |
| Batch/CMD (`.bat`, `.cmd`) | ✅ | ✅ (v1.12+) | |
| Python scripts | ✅ | ✅ (v1.12+) | |
| Ruby scripts | ✅ | ✅ (v1.12+) | |
| Perl scripts | ✅ | ✅ (v1.12+) | ✅ |
| NSIS scripts | ❌ | ✅ (v1.12+) | ❌ |
| Shell scripts without extension | ✅ | ✅ (v2.6+) | ✅ v1.8.0 |
| Jupyter Notebooks | ✅ | ❌ | |
| Custom Workspace Tasks (`.workspace-tasks.json`) | ✅ | ❌ | |
| App-Publisher | ❌ | ✅ (v1.19+) | ❌ |
| TSC / TypeScript | ✅ | ✅ (v3+) | |
| ESLint | ✅ | ✅ (v3+) | |
| NodeJS scripts | ✅ | ✅ (v3+) | v1.8.0 |
| Laravel | ❌ | ✅ (v3+, via collaborator) | ❌ |
| GitHub Actions (`act`) integration | ✅ | ❌ | |
| External Provider API | ❌ | ✅ (v2.7+) | ❌ |

---

## Task Discovery & Filtering

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Auto-discovery on workspace open | ✅ | ✅ | |
| Multi-root workspace support | ✅ | ✅ | |
| Glob-based exclusion patterns | ✅ | ✅ | |
| Per-type glob include patterns | ✅ (path configs) | ✅ (Ant, Bash) | |
| `.tasksignore` file support | ✅ | ❌ | |
| Add to excludes from tree context menu | ✅ | ✅ | |
| Enable/disable per task type | ✅ | ✅ | |
| Configurable discovery depth | ✅ | ❌ | |
| File-cache for faster startup | ✅ | ✅ (v3+) | |
| Restore tree collapsed/expanded state | ✅ | ✅ (v3+) | |

---

## UI & Display

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Sidebar view (Activity Bar) | ✅ | ✅ | |
| Explorer panel view | ✅ | ✅ | |
| Hierarchical tree (workspace → type → file → task) | ✅ | ✅ | |
| Task grouping by separator character | ✅ | ✅ (v1.23+, up to 15 levels in v3) | |
| Hide individual tasks | ✅ | ❌ | |
| Hide task groups | ✅ | ❌ | |
| Animated running-task icon | ✅ | ✅ | |
| Status bar message while task runs | ❌ | ✅ (v1.26+) | |
| Configurable click action (run vs. open) | ✅ | ✅ (v1.30+) | |
| Task icons (per type) | ✅ | ✅ | |
| Custom icons via settings | ℹ️ (limited support currently) | ✅ | ✅ v1.8+ |
| Task Monitor (fullscreen webview console) | ❌ | ✅ (v3+) | ❌ |
| Estimated task duration display | ✅ | ❌ | ✅ v1.8.0 |
| Run Guard (confirm before running) | ✅ | ❌ | ✅ v1.8.0 |
| CodeLens support | ✅ | ❌ | |
| Editor Title Actions | ✅ | ❌ | |

---

## Task Execution

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Run task | ✅ | ✅ | |
| Stop task | ✅ | ✅ (v1.6+) | |
| Restart task | ✅ | ✅ (v1.20+) | |
| Run with arguments | ✅ | ✅ (v1.30+) | |
| Run without terminal | ✅ | ✅ (v1.30+) | |
| Keep terminal open after stop | ✅ | ✅ (v1.21+) | |
| Open terminal for running task | ✅ | ✅ (v1.24+) | |
| Stop `dependsOn` child tasks | ✅ | ❌ | |
| Configurable terminal presentation | ✅ | ❌ | |
| Graceful stop delay | ✅ | ❌ | |
| Task Guard (confirm before running) | ✅ | ❌ | |

---

## Favorites & Recent Tasks

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Favorites (pin tasks) | ✅ | ✅ (v2.0+) | |
| Clear favorites | ✅ | ✅ (v2.0+) | |
| Persistent favorites across sessions | ✅ | ✅ | |
| Settings Sync for favorites | ✅ | ❌ | |
| Recent / Last tasks list | ✅ | ✅ (v1.25+) | |
| Configurable recent task count | ✅ | ❌ | |
| Clear recent/last tasks | ✅ | ✅ (v2.0+) | |
| Recent Tasks / Latest Tasks | ✅ | ✅ (v1.17+) | |

---

## Compound Tasks

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Named compound task sequences | ✅ | ❌ | |
| Multiple independent queues | ✅ | ❌ | |
| Sequential execution mode | ✅ | ❌ | |
| Parallel execution mode | ✅ | ❌ | |
| Drag & drop task reordering in queues | ✅ | ❌ | |
| Persistent queues across sessions | ✅ | ❌ | |
| Settings Sync for queues | ✅ | ❌ | |
| VSCode native compound task support | ✅ | ❌ | |

> **Note:** Task Explorer's roadmap includes creating "composite tasks" via multi-selection (v3.x planned), but this is not yet implemented.

---

## Environment Variables & Secrets

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: | |
| Inject env vars into tasks | ✅ | ❌ | |
| 14-layer precedence env resolution | ✅ | ❌ | |
| Secrets stored in VS Code SecretStorage | ✅ | ❌ | |
| Encrypted data persistence | ✅ | ✅ (v3+, optional) | |
| Manage secrets from tree (store/update/delete/copy) | ✅ | ❌ | |
| Secrets via Command Palette | ✅ | ❌ | |

---

## Task History & Metrics

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Task execution history log | ✅ | ❌ | |
| Sortable history table view | ✅ | ❌ | |
| Per-task duration trends | ✅ | ❌ | |
| Per-task success/failure rates | ✅ | ❌ | |
| Interactive dashboard with charts | ✅ | ❌ | |
| Stats & runtime tracking | ✅ | ✅ (v3+) | |
| Stats & runtime quick reports | ✅ | ✅ (v3+) | |
| Task parsing / detail reports (webview) | ✅ | ✅ (v2+) | |

---

## Performance

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| v1.6.0: 98.5% perf improvement (large workspaces) | ✅ | — | |
| File caching for fast startup | ✅ | ✅ (v3+) | |
| Internal npm provider (avoids VSCode provider lag) | ✅ | ✅ (v3+) | |
| Internal tsc/grunt/gulp providers | ✅ | ✅ (v3+) | |
| Async/await task loading | ✅ | ✅ (v2.0+) | |

---

## Configuration

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Grouped settings categories | ✅ (5 groups) | ✅ (v3+) | |
| Executable path overrides | ✅ | ✅ | |
| Per-type enable/disable | ✅ | ✅ | |
| Configurable glob patterns per type | ✅ | ✅ (Ant, Bash) | |
| Tree grouping/separator settings | ✅ | ✅ | |
| Debug / verbose logging | ✅ | ✅ | |

---

## Distribution & Availability

| Feature | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Visual Studio Marketplace | ✅ | ✅ | |
| Open VSX Registry | ✅ | ❌ | |
| Cursor | ✅ | ❌ | |
| VSCodium | ✅ | ❌ | |
| Windsurf / Kiro / Antigravity | ✅ | ❌ | |

---

## Summary

**Workspace Tasks** focuses on breadth of task type support (20+ types including modern tools like Bun, mise, Just, Docker, GitHub Actions), developer quality-of-life features (compound task queues, environment/secrets management, task history with charts, Settings Sync), and broad editor compatibility (Open VSX, Cursor, Windsurf, etc.).

**Task Explorer** has deep roots in script-based task discovery including unique types like NSIS, Perl, and shell scripts without extensions. Its v3 release introduces a Task Monitor webview console, internal npm/tsc/grunt/gulp providers for improved performance, stats/runtime tracking, and an External Provider API for third-party extensions to register their own task types. A paid license model is planned for full-feature access.

| | **Workspace Tasks** | **Task Explorer** | **WST Planned** |
| --- | :---: | :---: | :---: |
| Best for | Teams wanting modern toolchain support, compound queues, secrets management, and broad editor compatibility | Developers needing deep script-type support, external provider APIs, or the Task Monitor console | |
| Licensing | Free & open source (Apache 2.0) | Free during Preview; paid license planned | |
| Open VSX / broader editors | ✅ Yes | ❌ No | |
| Compound task sequences | ✅ Yes (named queues) | ❌ Not yet (planned) | |
| Secrets management | ✅ Yes | ❌ No | |
| GitHub Actions (local) | ✅ Yes (via `act`) | ❌ No | |
| External provider API | ❌ No | ✅ Yes | ❌ |
| Task Monitor (webview) | ❌ No | ✅ Yes (v3+) | ❌ |
