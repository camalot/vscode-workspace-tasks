#!/usr/bin/env bash
# shellcheck disable=SC1090

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/helpers.sh"

echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Running post-attach setup script...${COLOR_RESET}"
echo -e "${COLOR_GREEN}Installing additional tools...${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo ""

# Best-effort snapshot live -> persist on every attach. This now actually works
# because post-create chowned the persist volume to vscode. The Stop hook in
# ~/.claude/settings.json keeps the snapshot current within a session; this
# extra copy covers the case where the Stop hook never fired (extension-only
# auth flows, hook misconfigured, etc.).
if [ -d /home/vscode/.claude-persist ]; then
  [ -f /home/vscode/.claude/.credentials.json ] && \
    cp -p /home/vscode/.claude/.credentials.json /home/vscode/.claude-persist/.credentials.json || true
  [ -f /home/vscode/.claude.json ] && \
    cp -p /home/vscode/.claude.json /home/vscode/.claude-persist/.claude.json || true
  [ -f /home/vscode/.claude/settings.json ] && \
    cp -p /home/vscode/.claude/settings.json /home/vscode/.claude-persist/settings.json || true
fi

# Sweep stale IDE locks left over from previous container/IDE sessions.
if [ -d /home/vscode/.claude/ide ]; then
  for f in /home/vscode/.claude/ide/*.lock; do
    [ -f "$f" ] || continue
    pid=$(jq -r '.pid // empty' "$f" 2>/dev/null || true)
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$f"
    fi
  done
fi

echo ""
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN}Post-attach setup script completed successfully!${COLOR_RESET}"
echo -e "${COLOR_GREEN}=================================================================${COLOR_RESET}"

exit 0
