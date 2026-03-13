#!/bin/bash
# Helper script executed during post-create to provision additional tooling inside
# the dev container that can't be installed during the image build (because the
# workspace isn't mounted yet).

set -euo pipefail

# --- act CLI ---------------------------------------------------------------
# Download a pre-built binary if it doesn't already exist in the repository.
# The extension's settings.json points to "tools/act/act", so we need to
# populate that path.
ACT_VERSION="0.2.84" # bump as needed; use a known working release
ACT_PATH="tools/act/act"

if [ ! -f "$ACT_PATH" ]; then
  echo "Installing act v${ACT_VERSION}..."
  mkdir -p "$(dirname "$ACT_PATH")"
  curl -fsSL "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" | tar -xz -C "$(dirname "$ACT_PATH")"
  chmod +x "$ACT_PATH"
else
  echo "act already present at $ACT_PATH"
fi

# --- other tooling --------------------------------------------------------
# you can add additional setup steps here (e.g. install global npm packages)

exit 0
