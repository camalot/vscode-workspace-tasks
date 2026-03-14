#!/bin/bash
# Helper script executed during post-create to provision additional tooling inside
# the dev container that can't be installed during the image build (because the
# workspace isn't mounted yet).

set -euo pipefail

COLOR_RESET="\033[0m"
COLOR_GREEN="\033[32m"
COLOR_BLUE="\033[34m"
COLOR_RED="\033[31m"

function draw_logo() {
  local logo_file
  logo_file="$HOME/.workspace-tasks/logo.txt"

  if [ -f "$logo_file" ]; then
    # draw each line of the logo in red
    while IFS= read -r line; do
      echo -e "${COLOR_RED}${line}${COLOR_RESET}"
    done <"$logo_file"
  fi

  echo ""
  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo -e "${COLOR_BLUE}Welcome to the VS Code Workspace Tasks Dev Container!${COLOR_RESET}"
  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo ""
}

function fix_ssh_permissions() {
  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo -e "${COLOR_BLUE}Fixing SSH key permissions...${COLOR_RESET}"

  if [ -d "$HOME/_ssh" ]; then
    echo -e "${COLOR_BLUE}Copying SSH files from $HOME/_ssh to $HOME/.ssh...${COLOR_RESET}"
    mkdir -p "$HOME/.ssh"
    cp -rp "$HOME/_ssh"/. "$HOME/.ssh/" 2>/dev/null || true
  elif [ -L "$HOME/.ssh" ]; then
    echo -e "${COLOR_BLUE}SSH directory is a symlink. Converting to a native directory...${COLOR_RESET}"
    SYMLINK_TARGET=$(readlink "$HOME/.ssh")
    rm "$HOME/.ssh"
    mkdir -p "$HOME/.ssh"
    cp -rp "$SYMLINK_TARGET"/. "$HOME/.ssh/" 2>/dev/null || true
  fi

  if [ -d "$HOME/.ssh" ]; then
    # Attempt to fix permissions for SSH keys, config, and known_hosts.
    # Ignore errors (e.g., if files are mounted read-only from Windows).
    chmod 700 "$HOME/.ssh" || true
    find "$HOME/.ssh" -type f -exec chmod 600 {} \; || true
    find "$HOME/.ssh" -type f -name "*.pub" -exec chmod 644 {} \; || true
    echo -e "${COLOR_GREEN}SSH key permissions fixed.${COLOR_RESET}"
  else
    echo -e "${COLOR_BLUE}No $HOME/.ssh directory found.${COLOR_RESET}"
  fi
  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo ""
}

function install_act() {
  # --- act CLI ---------------------------------------------------------------
  # Download a pre-built binary if it doesn't already exist in the repository.
  # The extension's settings.json points to "tools/act/act", so we need to
  # populate that path.
  ACT_VERSION="${ACT_VERSION:-0.2.84}" # bump as needed; use a known working release
  ACT_PATH="tools/act/act"

  if [ ! -f "$ACT_PATH" ]; then
    echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
    echo -e "${COLOR_BLUE}Installing nektos/act v${ACT_VERSION} CLI for running GitHub Actions locally...${COLOR_RESET}"
    mkdir -p "$(dirname "$ACT_PATH")"
    curl -fsSL "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" | tar -xz -C "$(dirname "$ACT_PATH")"
    chmod +x "$ACT_PATH"
    echo -e "${COLOR_GREEN}nektos/act v${ACT_VERSION} CLI installed successfully.${COLOR_RESET}"
    echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
    echo ""
  fi
}

function install_sample_tasks() {
  # clone https://github.com/camalot/sample-workspace-tasks.git to use when running project for testing.
  SAMPLE_WORKSPACE_TASKS_REPO="https://github.com/camalot/sample-workspace-tasks.git"
  SAMPLE_WORKSPACE_TASKS_DIR="sample/sample-workspace-tasks"

  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo -e "${COLOR_BLUE}Installing sample workspace tasks...${COLOR_RESET}"

  mkdir -p "$(dirname "$SAMPLE_WORKSPACE_TASKS_DIR")"

  if [ ! -d "$SAMPLE_WORKSPACE_TASKS_DIR" ]; then
    echo -e "${COLOR_BLUE}Cloning sample workspace tasks...${COLOR_RESET}"
    # Bypass local SSH config to avoid "Bad owner or permissions on /home/vscode/.ssh/config" errors
    # on WSL setups where ~/.ssh is symlinked to a Windows drive mount.
    env GIT_SSH_COMMAND="ssh -F /dev/null" git clone "$SAMPLE_WORKSPACE_TASKS_REPO" "$SAMPLE_WORKSPACE_TASKS_DIR"
    echo -e "${COLOR_GREEN}Sample workspace tasks installed successfully at $SAMPLE_WORKSPACE_TASKS_DIR.${COLOR_RESET}"
  else
    echo -e "${COLOR_GREEN}Sample workspace tasks already present at $SAMPLE_WORKSPACE_TASKS_DIR${COLOR_RESET}"
  fi
  echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
  echo ""
}

function install_ohmyposh() {
  # --- oh-my-posh ----------------------------------------------------------
  # Install the oh-my-posh for a better terminal experience.

  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo -e "${COLOR_BLUE}Installing oh-my-posh ...${COLOR_RESET}"

  if ! oh-my-posh &>/dev/null; then
    curl -s https://ohmyposh.dev/install.sh | bash
    echo -e "${COLOR_GREEN}oh-my-posh installed successfully.${COLOR_RESET}"
  else
    echo -e "${COLOR_GREEN}oh-my-posh is already installed.${COLOR_RESET}"
  fi
  echo -e "${COLOR_BLUE}=================================================================${COLOR_RESET}"
  echo ""
}

draw_logo

echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Running post-create setup script...${COLOR_RESET}"
echo -e "${COLOR_GREEN}Installing additional tools...${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo ""

fix_ssh_permissions
install_act
install_ohmyposh
install_sample_tasks

echo ""
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Post-create setup script completed successfully!${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"

exit 0
