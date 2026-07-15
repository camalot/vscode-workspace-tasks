#!/usr/bin/env bash

# get version using package.json | jq -r .version

CURRENT_VSIX_VERSION="$(jq -r .version < package.json)"
TARGET_VSIX_VERSION="${1:-$CURRENT_VSIX_VERSION}"
TARGET_FILE_BASE="workspace-tasks-${TARGET_VSIX_VERSION}"
TARGET_FILE="${TARGET_FILE_BASE}.vsix"


# Extract the VSIX file to a temporary directory
TEMP_DIR=$(mktemp -d)
unzip -q "$TARGET_FILE" -d "$TEMP_DIR"
# save current directory to return to it later
CURRENT_DIR=$(pwd)
# set the working directory to the extracted contents
cd "$TEMP_DIR" || exit
# Generate the SBOM using Syft
syft "$TEMP_DIR" \
  -o github-json="$TARGET_FILE_BASE.sbom.gh.json" \
  -o spdx-json="$TARGET_FILE_BASE.sbom.spdx.json" \
  -o cyclonedx-json="$TARGET_FILE_BASE.sbom.cdx.json"

mv "$TARGET_FILE_BASE.sbom.gh.json" "$CURRENT_DIR/dist/"
mv "$TARGET_FILE_BASE.sbom.spdx.json" "$CURRENT_DIR/dist/"
mv "$TARGET_FILE_BASE.sbom.cdx.json" "$CURRENT_DIR/dist/"

# Clean up the temporary directory
cd "$CURRENT_DIR" || exit
rm -rf "$TEMP_DIR"


# run grype to find vulnerabilities in the generated SBOM
grype sbom:"dist/$TARGET_FILE_BASE.sbom.spdx.json" -o table
