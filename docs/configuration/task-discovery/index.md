---
layout: default
title: 🔍 Task Discovery
parent: ⚙️ Configuration
nav_order: 2
has_children: true
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Discovery Settings
{: .no_toc }

Settings that control which tasks the extension finds and how it discovers them — including which files and directories to scan, how deeply to search, which task-type providers are active, and how shell-script tasks are identified.

---

## Defined Task Types Discovery Patterns

Each task type watches specific file patterns:

| Task Type | Patterns | Notes |
| --- | --- | --- |
| npm/yarn/pnpm | `**/package.json` | Reads `scripts` section |
| Ant | `**/*.xml` | Parses build file targets |
| cake | `**/*.cake` | Cake build targets from `Task("...")` declarations |
| cargo-make | `**/{Makefile.toml,*.toml}` | Rust task runner from TOML files (requires Cargo) |
| Composer | `**/composer.json` | PHP dependency scripts |
| Gradle | `**/*.gradle` | Java/Android build tasks |
| Grunt | `**/Gruntfile.js` | Registered tasks |
| Gulp | `**/gulpfile.{js,mjs}` | Exported tasks |
| Just | `**/{justfile,.justfile,*.just}` | Command recipes |
| Jupyter | `**/*.ipynb` | Notebook cells (requires [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)) |
| Make | `**/Makefile` | Build targets |
| Maven | `**/pom.xml` | Lifecycle goals |
| mise | `**/mise.toml`, `**/mise.*.toml`, `**/mise.*.local.toml` | TOML tasks and file tasks |
| MSBuild | `**/*.{csproj,vbproj,sln}` | .NET project targets |
| Pipenv | `**/Pipfile` | Python scripts |
| Poe the Poet | `**/pyproject.toml` | Python task runner |
| Poetry | `**/pyproject.toml` | Python scripts |
| Shell | `**/*.{sh,bash,ps1,bat,cmd}` | Executable scripts |
| Docker | `**/Dockerfile*` | Container builds |
| Docker Compose | `**/docker-compose.yml` | Service orchestration |
| GitHub Actions | `**/.github/workflows/*.yml` | CI/CD workflows |
| Visual Studio Code | `**/.vscode/tasks.json`, user-level `tasks.json` | Native Visual Studio Code tasks (workspace and user-level) |
| Workspace | `.workspace-tasks.json` | Custom tasks |

All patterns respect `.gitignore` and `.tasksignore` exclusions.

---

## Next Steps

| Page | Description |
| --- | --- |
| [General](general) | Exclusion patterns and discovery depth |
| [Discovery](discovery) | Task type providers and shell script detection |
