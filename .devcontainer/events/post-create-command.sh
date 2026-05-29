#!/bin/bash
# shellcheck disable=SC1090
# Helper script executed during post-create to provision additional tooling inside
# the dev container that can't be installed during the image build (because the
# workspace isn't mounted yet).

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/helpers.sh"

function claude_init() {
  # The Docker volume bind-mounted at ~/.claude comes up root-owned the first time;
  # without this chown, the vscode user can't write into it.
  sudo chown -R vscode:vscode /home/vscode/.claude || true

  # Symlink ~/.claude.json (sibling of ~/.claude/) into the persisted directory so
  # the file survives rebuilds. The CLI writes .claude.json via an atomic temp+rename
  # that explicitly passes allowSymlink:true — it readlink()s the symlink, writes the
  # temp next to the real target, and renames within the persisted directory. So the
  # symlink itself is never touched by writes.
  local persisted=/home/vscode/.claude/.claude.json
  local home_link=/home/vscode/.claude.json

  if ! { [ -L "$home_link" ] && [ "$(readlink "$home_link")" = "$persisted" ]; }; then
    # If a real file is sitting at the home path (e.g. from the prior copy-based
    # setup, or a stub written before this code shipped), migrate it.
    if [ -f "$home_link" ] && [ ! -L "$home_link" ]; then
      if [ ! -f "$persisted" ]; then
        command mv -f "$home_link" "$persisted"
      else
        command rm -f "$home_link"
      fi
    elif [ -L "$home_link" ]; then
      command rm -f "$home_link"
    fi
    # Seed the persisted file if absolutely nothing exists yet.
    [ -f "$persisted" ] || echo '{"hasCompletedOnboarding":true}' > "$persisted"
    command ln -sfn "$persisted" "$home_link"
  fi

  # Strip the legacy copy-to-.claude-persist Stop hook from settings.json if a
  # previous container shipped one. Leaves any unrelated hooks alone.
  local settings=/home/vscode/.claude/settings.json
  if [ -f "$settings" ] && jq -e '.hooks.Stop // empty' "$settings" >/dev/null 2>&1; then
    local tmp
    tmp=$(mktemp)
    if jq '
      .hooks.Stop |= (
        map(.hooks |= map(select((.command // "") | test("\\.claude-persist") | not)))
        | map(select((.hooks // []) | length > 0))
      )
      | if (.hooks.Stop // []) == [] then del(.hooks.Stop) else . end
      | if (.hooks // {}) == {} then del(.hooks) else . end
    ' "$settings" > "$tmp"; then
      command mv -f "$tmp" "$settings"
    else
      command rm -f "$tmp"
    fi
  fi

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
