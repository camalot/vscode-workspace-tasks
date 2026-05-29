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

# ~/.claude is now a Docker volume bind-mount, so credentials, settings, and session
# history persist automatically — no copy-back sync needed here.

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
