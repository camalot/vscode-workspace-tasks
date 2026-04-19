---
layout: default
title: 🐳 Dev Container
parent: ✏️ Contributing
nav_order: 1
---
<!-- markdownlint-disable MD033 -->

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Dev Container
{: .no_toc }

The repository ships with a fully configured [dev container](https://containers.dev/) so you can get a consistent, ready-to-use development environment without installing dependencies on your local machine.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

- [Docker](https://www.docker.com/) (Desktop or Engine) running on your machine
- [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension installed

---

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/camalot/vscode-workspace-tasks.git
   cd vscode-workspace-tasks
   ```

2. Open the folder in VS Code:

   ```bash
   code .
   ```

3. When prompted, click **Reopen in Container**, or run the command palette action **Dev Containers: Reopen in Container**.

{: .note }
VS Code will build the Docker image and start the container. The `postCreateCommand` runs automatically to install all dependencies.

---

## What's Included

### Base Image

The container is built from `mcr.microsoft.com/devcontainers/ruby:3`, which provides Ruby 3 and a non-root `vscode` user as the default working user.

### System Packages

The following tools are installed via `apt`:

| Tool | Purpose |
| ------ | --------- |
| `git` | Source control |
| `curl` / `wget` | HTTP downloads |
| `zip` / `unzip` | Archive management |
| `jq` | JSON processing |
| `yq` | YAML processing |
| `bat` | Syntax-highlighted file viewer (`bat` alias for `batcat`) |
| `fzf` | Fuzzy finder |
| `zoxide` | Smarter `cd` |
| `nano` / `vim` | Terminal editors |
| `zsh` | Default shell |
| `pwsh` | Available Shell with Oh-My-Posh |
| `bash` | Available Shell with Oh-My-Posh |
| `copilot cli` | GitHub Copilot CLI |

### Runtimes & Package Managers

| Tool | Version | Purpose |
| ---- | ------- | -------- |
| Node.js | 25.x | Extension build & test toolchain |
| npm | 11.x | Node package manager |
| pnpm | latest | Alternative Node package manager |
| yarn | latest | Alternative Node package manager |
| nvm | 0.40.x | Node version manager |
| Ruby / Bundler | 3.x | Jekyll documentation site |
| PowerShell | 7.4.5 | Cross-platform scripting |
| Java (Temurin 17) | 17 | Required by `vscode-extension-tester` UI tests |

### Shell & Terminal

- **Default shell:** `zsh`
- **Prompt theme:** [Powerlevel10k](https://github.com/romkatv/powerlevel10k) (configured via `.p10k.zsh`)
- **Plugin manager:** [Antigen](https://github.com/zsh-users/antigen)
- **Prompt renderer (pwsh & bash):** [oh-my-posh](https://ohmyposh.dev/) (installed by `install-tools.sh`)

Custom aliases are loaded from `~/.zsh/custom/aliases/default.zsh`.

### VS Code Extensions

The following extensions are automatically installed inside the container:

| Extension | Purpose |
| --------- | ------- |
| `shopify.ruby-lsp` | Ruby language support |
| `dbaeumer.vscode-eslint` | ESLint integration |
| `esbenp.prettier-vscode` | Code formatting |
| `darthminos.workspace-tasks` | The extension under development |
| `DavidAnson.vscode-markdownlint` | Markdown linting |
| `EditorConfig.EditorConfig` | EditorConfig support |
| `GitHub.vscode-github-actions` | GitHub Actions workflow support |
| `mads-hartmann.bash-ide-vscode` | Bash language support |
| `mkhl.shfmt` | Shell script formatting |
| `ms-azuretools.vscode-docker` | Docker integration |
| `ms-vscode.makefile-tools` | Makefile support |
| `timonwong.shellcheck` | Shell script linting |
| `mikestead.dotenv` | `.env` file support |
| `bierner.github-markdown-preview` | GitHub Markdown preview |
| `igorsbitnev.error-gutters` | Inline error highlighting |

---

## Post-Create Setup

After the container is created, the `postCreateCommand` in `devcontainer.json` runs the following steps automatically:

1. **Install Ruby gems** — Runs `bundle install` inside `docs/` to set up the Jekyll documentation site.
2. **Install Node dependencies** — Runs `npm install` in the workspace root.
3. **Run `install-tools.sh`** — Provisions additional tooling that cannot be installed during the Docker image build:
   - Fixes SSH key permissions (copies from `~/_ssh` if needed)
   - Installs the [nektos/act](https://github.com/nektos/act) CLI to `tools/act/act` for running GitHub Actions locally
   - Installs [oh-my-posh](https://ohmyposh.dev/) for terminal prompt rendering
   - Clones the [sample-workspace-tasks](https://github.com/camalot/sample-workspace-tasks) repository to `sample/sample-workspace-tasks/` for integration testing

---

## Volume Mounts

| Source | Container Path | Purpose |
| ------ | ------------- | ------- |
| `${localWorkspaceFolder}` | `/workspace` | Workspace files |
| `~/.ssh` (host) | `/home/vscode/_ssh` | SSH keys (permissions are fixed by `install-tools.sh`) |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker-outside-of-Docker |
| `~/.gitconfig` (host) | `/home/vscode/.gitconfig` | Git configuration |
| `.devcontainer/mount` | `/home/vscode/.devcontainer` | Container-local configuration overrides |

{: .note }
SSH keys are mounted to `~/_ssh` rather than `~/.ssh` because some host setups (e.g., WSL with a Windows-mounted drive) have permission attributes that Docker cannot preserve. The `install-tools.sh` script copies the files to `~/.ssh` and applies correct permissions.

### Docker-outside-of-Docker

The container uses the `ghcr.io/devcontainers/features/docker-outside-of-docker:1` feature (with Moby disabled). This mounts the host's Docker socket into the container, allowing `docker` commands to control the host daemon without running a second Docker daemon inside the container.

---

## Default Shell & Terminal

The integrated terminal defaults to `zsh`. The shell is configured with:

- Powerlevel10k theme (`~/.p10k.zsh`)
- Custom aliases in `~/.zsh/custom/aliases/default.zsh`
- A `build-docs` helper script in `~/bin/` for serving the Jekyll documentation site locally

---

## Zsh Configuration

The Zsh configuration is located in `~/.zshrc` and includes:

- Sourcing the Powerlevel10k theme (`~/.p10k.zsh`)
- Loading custom aliases from `~/.zsh/custom/aliases/default.zsh`
- Setting up the `build-docs` helper script in `~/bin/` for serving the Jekyll documentation site locally

### Powerlevel10k Theme

The Powerlevel10k theme is configured in `~/.p10k.zsh` and provides a highly customizable prompt for Zsh. It is designed to be fast and informative, displaying information such as the current Git branch, command execution time, and more.

### Plugins

The Zsh configuration uses [Antigen](https://github.com/zsh-users/antigen) to manage plugins. The following plugins and theme are loaded:

| Plugin | Description |
| ------ | ----------- |
| `romkatv/powerlevel10k` (theme) | Highly customizable Zsh prompt with Git status, execution time, and more |
| `git` | Git aliases and helpers |
| `vscode` | VS Code integration helpers |
| `docker` | Docker aliases and completions |
| [zsh-users/zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting) | Syntax highlighting for the command line |
| [zsh-users/zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) | Command suggestions based on history |
| [zsh-users/zsh-history-substring-search](https://github.com/zsh-users/zsh-history-substring-search) | History search by substring (up/down arrow) |
| [rupa/z](https://github.com/rupa/z) | Jump to frequently used directories |
| [b4b4r07/emoji-cli](https://github.com/b4b4r07/emoji-cli) | Emoji picker for the command line |
| `sudo` | Press <kbd>Esc</kbd> twice to prefix the previous command with `sudo` |
| `aliases` | Lists defined aliases with `als` |
| `ant` | Apache Ant completions |
| `command-not-found` | Suggests packages when a command is not found |
| `colorize` | Syntax-highlighted `cat` via `ccat` |
| `common-aliases` | Useful common shell aliases |
| `debian` | Apt/dpkg aliases for Debian-based systems |
| `dotenv` | Automatically loads `.env` files in directories |
| `emoji` | Emoji helper utilities |
| `fzf` | Fuzzy finder key bindings and completions |
| `gh` | GitHub CLI completions |
| `history` | History aliases (`h`, `hsi`, etc.) |
| `npm` | npm aliases and completions |
| `nvm` | nvm (Node Version Manager) integration |
| `ruby` | Ruby and Bundler aliases |

---

## File Structure

```tree
.devcontainer/
├── devcontainer.json       ← Container configuration
├── Dockerfile              ← Image definition
├── install-tools.sh        ← Post-create tool installer
├── mount/                  ← Bind-mounted to ~/. devcontainer inside container
└── files/
    └── home/
        └── vscode/
            ├── .bashrc
            ├── .gitconfig
            ├── .p10k.zsh
            ├── .zshrc
            ├── bin/
            │   └── build-docs
            ├── .config/
            │   └── powershell/
            │       ├── Microsoft.PowerShell_profile.ps1
            │       ├── profile.ps1
            │       └── darthminos.omp.json
            ├── .workspace-tasks/
            │   └── logo.txt
            └── .zsh/
                └── custom/
                    └── aliases/
                        └── default.zsh
```

---

## Rebuilding the Container

If you change the `Dockerfile` or `devcontainer.json`, rebuild the container using the command palette:

```text
Dev Containers: Rebuild Container
```

Or to also clear the Docker layer cache:

```text
Dev Containers: Rebuild Container Without Cache
```
