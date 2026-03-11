---
layout: default
title: Requirements
nav_order: 10
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Requirements
{: .no_toc }

<!-- markdownlint-disable-next-line MD025 MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Visual Studio Code Version

- **Minimum:** Visual Studio Code 1.108.1 or later

---

## External Tool Requirements

The extension **discovers** tasks regardless of whether tools are installed. However, **executing** a task requires the corresponding tool to be available in your system `PATH`.

### Package Managers

| Tool | Used For | Install |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) + [npm](https://www.npmjs.com/) | npm tasks | [nodejs.org](https://nodejs.org/) |
| [pnpm](https://pnpm.io/) | pnpm tasks | [pnpm.io](https://pnpm.io/installation) |
| [Yarn](https://yarnpkg.com/) | Yarn tasks | [yarnpkg.com](https://yarnpkg.com/getting-started/install) |
| [Bun](https://bun.com/) | Bun tasks | [bun.sh](https://bun.sh/docs/installation) |
| [Composer](https://getcomposer.org/) | PHP Composer tasks | [getcomposer.org](https://getcomposer.org/download/) |
| [Pipenv](https://pipenv.pypa.io/) | Python Pipenv tasks | [pipenv.pypa.io](https://pipenv.pypa.io/en/latest/installation/) |
| [Poe the Poet](https://poethepoet.natn.io/) | Python Poe tasks | [poethepoet.natn.io](https://poethepoet.natn.io/installation.html) |
| [Poetry](https://python-poetry.org/) | Python Poetry tasks | [python-poetry.org](https://python-poetry.org/docs/) |

### Build Systems

| Tool | Used For | Install |
| --- | --- | --- |
| [Apache Ant](https://ant.apache.org/) | Ant tasks | [ant.apache.org](https://ant.apache.org/manual/install.html) |
| [Gradle](https://gradle.org/) | Gradle tasks | [gradle.org](https://gradle.org/install/) |
| [MSBuild](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild) | .NET tasks | Included with Visual Studio / .NET SDK |
| [Make](https://www.gnu.org/software/make/) | Makefile tasks | Included with build tools on most platforms |
| [Apache Maven](https://maven.apache.org/) | Maven tasks | [maven.apache.org](https://maven.apache.org/install.html) |

### Task Runners

| Tool | Used For | Install |
| --- | --- | --- |
| [Cargo](https://doc.rust-lang.org/cargo/) | Cargo / cargo-make tasks | Included with [Rust](https://www.rust-lang.org/tools/install) |
| [cargo-make](https://sagiegurari.github.io/cargo-make/) | cargo-make tasks | `cargo install --force cargo-make` |
| [Grunt](https://gruntjs.com/) | Grunt tasks | `npm install -g grunt-cli` |
| [Gulp](https://gulpjs.com/) | Gulp tasks | `npm install -g gulp-cli` |
| [Just](https://github.com/casey/just) | Just tasks | [just.systems](https://just.systems/man/en/packages.html) |
| [mise](https://mise.jdx.dev/) | mise tasks | [mise.jdx.dev](https://mise.jdx.dev/getting-started.html) |

### DevOps & Containers

| Tool | Used For | Install |
| --- | --- | --- |
| [Docker](https://www.docker.com/) | Docker & Docker Compose tasks, and act | [docker.com](https://www.docker.com/get-started/) |
| [act](https://github.com/nektos/act) | GitHub Actions local execution | [nektosact.com](https://nektosact.com/installation/index.html) |

### Data Science & Notebooks

| Tool | Used For | Install |
| --- | --- | --- |
| [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) | Jupyter Notebook tasks | VS Code Extensions Marketplace |

The Jupyter Extension must be installed **and** a Jupyter Server must be configured. See the [Jupyter Extension documentation](https://code.visualstudio.com/docs/datascience/jupyter-notebooks) for setup instructions.

### Scripts

| Interpreter | Used For |
| --- | --- |
| Bash / Zsh / sh | `.sh`, `.bash`, `.zsh` scripts |
| Fish | `.fish` scripts |
| PowerShell | `.ps1` scripts |
| Command Prompt | `.bat`, `.cmd` scripts |

---

## Installation Instructions

Visit each tool's official website (linked above) for installation guides specific to your operating system. Most tools are available via common package managers:

```bash
# macOS (Homebrew)
brew install node yarn just make act

# Windows (winget)
winget install OpenJS.NodeJS
winget install nektos.act

# Linux (apt)
sudo apt install nodejs npm make
```

---

## Custom Tool Paths

If tools are installed in non-standard locations, configure their paths in `settings.json`:

```json
{
  "workspaceTasks.applicationPath.act": "/usr/local/bin/act",
  "workspaceTasks.applicationPath.ant": "/opt/ant/bin/ant",
  "workspaceTasks.applicationPath.maven": "/opt/maven/bin/mvn"
}
```

See the [Configuration Reference](Configuration#application-path-settings) for all available path settings.

---

## See Also

- [Getting Started](getting-started) — Installation and initial setup
- [Configuration Reference](Configuration) — All settings including application paths
- [Supported Task Types](task-types) — All supported build tools and frameworks
