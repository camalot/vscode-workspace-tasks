#!/bin/bash
# shellcheck disable=SC1090
# Helper script executed during post-create to provision additional tooling inside
# the dev container that can't be installed during the image build (because the
# workspace isn't mounted yet).

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/helpers.sh"

function claude_init() {
  # The claude-code-persist Docker volume is created as root-owned. Without this
  # chown, the snapshot copies in post-attach (and the Stop hook in ~/.claude/settings.json)
  # silently fail because the vscode user can't write into it, so nothing ever persists.
  sudo chown -R vscode:vscode /home/vscode/.claude-persist || true

  mkdir -p /home/vscode/.claude
  if [ -f /home/vscode/.claude-persist/.credentials.json ]; then
    cp -p /home/vscode/.claude-persist/.credentials.json /home/vscode/.claude/.credentials.json
    chmod 600 /home/vscode/.claude/.credentials.json || true
  fi
  if [ -f /home/vscode/.claude-persist/.claude.json ]; then
    cp -p /home/vscode/.claude-persist/.claude.json /home/vscode/.claude.json
  else
    echo '{"hasCompletedOnboarding":true}' > /home/vscode/.claude.json
  fi
  if [ -f /home/vscode/.claude-persist/settings.json ]; then
    cp -p /home/vscode/.claude-persist/settings.json /home/vscode/.claude/settings.json
  fi

  # Ensure the Stop hook is present in ~/.claude/settings.json. The hook copies
  # live auth state to the persist volume after each agent response so OAuth
  # refreshes survive a container rebuild without needing a detach/reattach cycle.
  # shellcheck disable=SC2016
  local hook_cmd='if [ -d "$HOME/.claude-persist" ]; then [ -f "$HOME/.claude/.credentials.json" ] && cp -p "$HOME/.claude/.credentials.json" "$HOME/.claude-persist/.credentials.json" 2>/dev/null; [ -f "$HOME/.claude.json" ] && cp -p "$HOME/.claude.json" "$HOME/.claude-persist/.claude.json" 2>/dev/null; [ -f "$HOME/.claude/settings.json" ] && cp -p "$HOME/.claude/settings.json" "$HOME/.claude-persist/settings.json" 2>/dev/null; fi; exit 0'
  local settings=/home/vscode/.claude/settings.json
  [ -f "$settings" ] || echo '{}' > "$settings"
  local tmp
  tmp=$(mktemp)
  # shellcheck disable=SC2015
  jq --arg cmd "$hook_cmd" '
    .hooks //= {} |
    .hooks.Stop //= [] |
    .hooks.Stop |= (
      (map(select(
        (.hooks // []) | any(.command == $cmd)
      )) as $existing |
       if ($existing | length) > 0 then .
       else . + [{matcher: "*", hooks: [{type: "command", command: $cmd}]}] end)
    )
  ' "$settings" > "$tmp" && mv "$tmp" "$settings" || rm -f "$tmp"

  # Drop ~/.claude/ide/*.lock entries whose pid is no longer alive so the
  # extension doesn't try to hand a fresh CLI session to a dead websocket.
  if [ -d /home/vscode/.claude/ide ]; then
    for f in /home/vscode/.claude/ide/*.lock; do
      [ -f "$f" ] || continue
      pid=$(jq -r '.pid // empty' "$f" 2>/dev/null || true)
      if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$f"
      fi
    done
  fi
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

echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Running post-create setup script...${COLOR_RESET}"
echo -e "${COLOR_GREEN}Installing additional tools...${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo ""

fix_ssh_permissions
claude_init

echo ""
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Post-create setup script completed successfully!${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"

exit 0
