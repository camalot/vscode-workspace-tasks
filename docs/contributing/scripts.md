---
layout: default
title: Scripts
parent: Contributing
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# npm Scripts
{: .no_toc }

All development tasks are driven by npm scripts defined in `package.json`. Run any script with:

```bash
npm run <script-name>
```

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Building

| Script | Command | Description |
|--------|---------|-------------|
| `compile` | `npm run compile` | Alias for `compile:webpack`. Compiles the extension using webpack. |
| `compile:webpack` | `npm run compile:webpack` | Bundles the extension source via webpack (development mode). |
| `compile:prod` | `npm run compile:prod` | Production-quality compile: runs type-checking, linting, then webpack. |
| `compile:tests` | `npm run compile:tests` | Compiles TypeScript test files to `out/` using `tsc`. |
| `watch` | `npm run watch` | Alias for `watch:webpack`. Starts webpack in watch mode for incremental builds. |
| `watch:webpack` | `npm run watch:webpack` | Runs webpack with `--watch`; recompiles on every file save. |
| `watch:tsc` | `npm run watch:tsc` | Runs `tsc --noEmit --watch` to surface type errors continuously without emitting files. |
| `watch:tests` | `npm run watch:tests` | Watches and recompiles test files to `out/` using `tsc -w`. |

> **Tip:** During active development, run `npm run watch` (or press **F5** to launch the Extension Development Host) so your changes are compiled automatically.

---

## Testing

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `npm test` | Runs `pretest` then `vscode:test`. This is the standard test command. |
| `test:coverage` | `npm run test:coverage` | Runs `pretest` then `vscode:test:coverage`. Generates a coverage report. |
| `test:ui` | `npm run test:ui` | Compiles tests then launches UI/integration tests via `vscode-extension-tester`. |
| `vscode:test` | `npm run vscode:test` | Runs the compiled test suite inside a VS Code environment using `vscode-test`. |
| `vscode:test:coverage` | `npm run vscode:test:coverage` | Same as `vscode:test` but also collects coverage data, writing output to `coverage/` in `lcov` format. |
| `pretest` | _(runs automatically before `test`)_ | Compiles tests (`compile:tests`), builds the extension (`compile:webpack`), and runs the linter before any test run. |

Coverage reports are written to:

- `coverage/lcov.info` — LCOV data (consumed by coverage tools and CI)
- `coverage/junit.xml` — JUnit XML results

The project targets **90% code coverage** for existing files. New code should achieve **100% coverage**.

---

## Linting & Formatting

| Script | Command | Description |
|--------|---------|-------------|
| `lint` | `npm run lint` | Runs ESLint against the `src/` directory. |
| `format` | `npm run format` | Runs Prettier with `--write` to auto-format all files. |
| `check` | `npm run check` | Runs both `check:types` and `check:format` together. |
| `check:types` | `npm run check:types` | Runs `tsc --noEmit` to verify TypeScript types without emitting output. |
| `check:format` | `npm run check:format` | Runs Prettier in check mode; exits with an error if any files are not formatted. |

---

## Packaging

| Script | Command | Description |
|--------|---------|-------------|
| `package` | `npm run package` | Alias for `package:vsix`. Packages the extension into a `.vsix` file. |
| `package:webpack` | `npm run package:webpack` | Bundles the extension in production mode with hidden source maps. |
| `package:vsix` | `npm run package:vsix` | Creates a `.vsix` package using `@vscode/vsce`. |
| `package:prerelease` | `npm run package:prerelease` | Builds a production webpack bundle and then packages it as a pre-release `.vsix`. |
| `package:vsix:prerelease` | `npm run package:vsix:prerelease` | Runs `vsce package --pre-release`. |
| `vscode:prepublish` | _(runs automatically before publishing)_ | Runs `compile:prod` and `package:webpack` before the extension is published to the marketplace. |

---

## Documentation

The docs scripts use the `~/bin/build-docs` helper installed in the dev container. They run `bundle exec jekyll` from the `docs/` directory and output the built site to `_site/`.

| Script | Command | Description |
|--------|---------|-------------|
| `docs:build` | `npm run docs:build` | Builds the Jekyll documentation site to `_site/`. |
| `docs:serve` | `npm run docs:serve` | Starts a local Jekyll server for previewing the documentation. Uses `_config.yml` and `_config-local.yml`. |
| `docs:serve:watch` | `npm run docs:serve:watch` | Same as `docs:serve`. |
| `docs:build:serve` | `npm run docs:build:serve` | Builds and then immediately serves the documentation site. |

Open `http://localhost:4000` (or the port shown in the terminal) to preview the site locally.

---

## Changelog

| Script | Command | Description |
|--------|---------|-------------|
| `changelog:build` | `npm run changelog:build` | Runs `git-cliff --bump` to regenerate `CHANGELOG.md` from Conventional Commits. |

> **Note:** Do not edit `CHANGELOG.md` manually. It is generated automatically by this script.

---

## Utility Scripts (`scripts/`)

The `scripts/` directory contains standalone helper scripts for development and asset management tasks. These are not npm scripts — they are run directly from the terminal.

### `load-secrets.ps1`

**Language:** PowerShell
**Usage:**

```powershell
# Load secrets for the current session (default)
.\scripts\load-secrets.ps1

# Load secrets permanently for the current user
.\scripts\load-secrets.ps1 -Scope User

# Dot-source to load secrets into the current context
. .\scripts\load-secrets.ps1
```

Reads a `.secrets` file from the repository root and sets its key-value pairs as environment variables. This is useful for supplying credentials and tokens needed during local development and testing without committing sensitive values to source control.

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-SecretsFile` | `.secrets` (repo root) | Path to the secrets file to load. |
| `-Scope` | `Process` | `Process` — sets variables for the current session only. `User` — sets variables permanently for the current user. |

The `.secrets` file follows the standard `KEY=VALUE` (or `KEY="VALUE"`) format. Lines starting with `#` and blank lines are ignored. If a variable is already set in the current session, it is skipped (with a warning) unless `-Scope User` is used.

---

### `remove-svg-padding.js`

**Language:** Node.js
**Usage:**

```bash
# Remove padding from an icon, using automatic margin (2% of icon size)
node scripts/remove-svg-padding.js <icon-name>

# Remove padding with an explicit pixel margin
node scripts/remove-svg-padding.js <icon-name> [padding-px]

# Examples
node scripts/remove-svg-padding.js cargo
node scripts/remove-svg-padding.js cargo 5
```

Trims excess padding from SVG icon files by recalculating the `viewBox`, `width`, and `height` attributes to tightly fit the icon's actual content. It processes both the `dark` and `light` variants of a named icon from `res/icons/dark/<name>.svg` and `res/icons/light/<name>.svg`.

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `icon-name` | Yes | The base name of the icon (without `.svg` extension). |
| `padding-px` | No | Optional padding in pixels to add around the bounding box. Defaults to 2% of the icon's largest dimension. |

---

### `svg-convert.ps1`

**Language:** PowerShell
**Requires:** [ImageMagick](https://imagemagick.org/) (`magick` command available on `PATH`)
**Usage:**

```powershell
# Convert all SVG icons to 128×128 PNG (default)
.\scripts\svg-convert.ps1

# Convert at a custom width (height scales proportionally)
.\scripts\svg-convert.ps1 -Width 64

# Force overwrite existing PNG files
.\scripts\svg-convert.ps1 -overwrite $true

# Use a custom file glob pattern
.\scripts\svg-convert.ps1 -pattern "../res/icons/**/*.svg"
```

Converts SVG icon files to PNG using ImageMagick. Iterates over all `.svg` files matching the given glob pattern and writes a matching `.png` file alongside each SVG. By default, existing PNG files are skipped.

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-Width` | `128` | Output image width in pixels. Height scales proportionally. |
| `-pattern` | `../res/icons/**/*.svg` | Glob pattern used to find SVG source files. |
| `-overwrite` | `$false` | If `$true`, existing PNG files are re-generated. |
