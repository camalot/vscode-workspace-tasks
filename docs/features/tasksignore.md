---
layout: default
title: 🚫 Ignoring Tasks
nav_order: 6
parent: 🚀 Features
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# .tasksignore
{: .no_toc }

The `.tasksignore` file allows you to control which files are excluded from task discovery in the Workspace Tasks extension.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

This helps keep your task list focused on relevant tasks by filtering out unwanted files and directories.

## Overview}

`.tasksignore` works similarly to `.gitignore`, using the same pattern syntax to specify which files and directories should be excluded from task scanning. When the extension searches for task files (like `package.json`, `Makefile`, `build.gradle`, etc.), it will skip any files that match patterns in `.tasksignore` files.

## How It Works

- **Per-Directory Control**: Place a `.tasksignore` file in any directory to exclude files from that location and its subdirectories
- **Hierarchical Application**: Ignore files are evaluated from the workspace root down to the file location
- **Gitignore Syntax**: Uses standard gitignore pattern matching rules
- **Automatic Reload**: Changes to `.tasksignore` files are automatically detected and applied
- **Smart Defaults**: The extension always ignores certain directories regardless of `.tasksignore` settings:
  - `**/node_modules/**`
  - `**/.git/**`
  - `**/.vscode-test/**`
  - `**/__pycache__/**`

## File Format

The `.tasksignore` file is a plain text file with one pattern per line. The format follows gitignore conventions:

### Basic Rules

- **One pattern per line**: Each line specifies a pattern to exclude
- **Comments**: Lines starting with `#` are treated as comments and ignored
- **Empty lines**: Empty lines are ignored
- **No quotes needed**: Patterns are specified directly without quotes

### Pattern Syntax

| Pattern | Description | Example |
| --- | --- | --- |
| `filename` | Matches the filename in any directory | `package.json` |
| `*.ext` | Matches all files with the extension | `*.test.js` |
| `dir/` | Matches the directory and all its contents | `build/` |
| `**/pattern` | Matches in all directories recursively | `**/test/**` |
| `dir/*.ext` | Matches files in specific directory | `scripts/*.sh` |
| `!pattern` | Negates a previous pattern (re-includes) | `!important.js` |

## Examples

### Basic Example

```ignore
# Ignore test files
**/test/**
**/*.test.js
**/*.spec.ts

# Ignore build outputs
build/
dist/
out/
target/

# Ignore temporary files
*.tmp
*.bak
*.swp

# Ignore specific tools
tools/legacy/
scripts/deprecated/
```

### Advanced Example

```ignore
# Ignore all JavaScript files in the scripts directory
scripts/*.js

# But keep the important ones
!scripts/deploy.js
!scripts/release.js

# Ignore all test directories except integration tests
**/test/**
!**/test/integration/**

# Ignore generated files
**/*.generated.*
**/auto-generated/**

# Ignore vendor and third-party code
vendor/
third-party/
external/

# Ignore CI/CD configuration
.github/
.gitlab-ci.yml
.travis.yml

# Ignore documentation build files
docs/build/
*.md.bak
```

### Project-Specific Examples

#### Node.js Project

```ignore
# Ignore test and coverage
coverage/
.nyc_output/
**/*.test.js
**/*.spec.js

# Ignore build artifacts
dist/
lib/
.next/
.nuxt/

# Ignore example and demo files
examples/
demo/
```

#### Python Project

```ignore
# Ignore test files
**/test_*.py
**/*_test.py
tests/

# Ignore build and distribution
build/
dist/
*.egg-info/

# Ignore virtual environments
venv/
.venv/
env/

# Ignore Jupyter notebooks
**/*.ipynb
```

#### Multi-Language Project

```ignore
# Frontend
frontend/node_modules/
frontend/dist/
**/*.test.tsx

# Backend
backend/target/
backend/build/
**/*Test.java

# Infrastructure
infrastructure/terraform/.terraform/
infrastructure/temp/

# Documentation
docs/build/
```

## Global Configuration

In addition to `.tasksignore` files, you can configure workspace-wide exclusions in your Visual Studio Code `settings.json`:

```json
{
  "workspaceTasks.exclude": [
    "**/.git/**",
    "**/vendor/**",
    "**/third-party/**",
    "**/__pycache__/**"
  ]
}
```

These patterns will be applied globally across the entire workspace, regardless of `.tasksignore` files.

## Pattern Evaluation Order

The extension evaluates ignore patterns in the following order:

1. **Built-in defaults**: Always-ignored patterns (node_modules, .git, etc.)
2. **Global configuration**: Patterns from `workspaceTasks.exclude` setting
3. **Local .tasksignore files**: Patterns from `.tasksignore` files, evaluated from closest to the file up to the workspace root

If any pattern matches, the file is excluded from task discovery.

## Best Practices

1. **Place `.tasksignore` at project root**: For workspace-wide rules
2. **Use specific `.tasksignore` files**: For directory-specific exclusions
3. **Comment your patterns**: Use `#` comments to explain complex patterns
4. **Start broad, then refine**: Begin with general patterns, add specific ones as needed
5. **Test your patterns**: Use the Workspace Tasks view to verify files are excluded correctly
6. **Use negation sparingly**: The `!` operator can make patterns hard to understand
7. **Prefer global config for permanent exclusions**: Use `workspaceTasks.exclude` for workspace-level settings

## Common Use Cases

### Exclude Test Files

```ignore
**/test/**
**/__tests__/**
**/*.test.*
**/*.spec.*
```

### Exclude Build Artifacts

```ignore
build/
dist/
out/
target/
bin/
obj/
*.o
*.pyc
```

### Exclude Example/Demo Code

```ignore
examples/
demo/
sample/
playground/
```

### Exclude Generated Code

```ignore
**/*.generated.*
**/generated/**
**/auto-generated/**
```

## Troubleshooting

### Files Still Showing Up

1. Check if the pattern syntax is correct
2. Verify the `.tasksignore` file is in the correct location
3. Remember that patterns are relative to the `.tasksignore` file location
4. Use `**` for recursive matching across directories

### Pattern Not Working

1. Ensure there are no leading/trailing spaces in patterns
2. Use forward slashes `/` in patterns (even on Windows)
3. Check for typos in filenames or extensions
4. Remember that directory patterns should end with `/`

### Need to Re-include Files

Use the `!` negation operator, but remember it only works if a parent pattern excluded the file first:

```ignore
# Exclude all JS files
*.js

# But include this one
!important.js
```

## Next Steps

- [Gitignore Pattern Format](https://git-scm.com/docs/gitignore#_pattern_format)
- [Configuration](../configuration)
- [Visual Studio Code Settings](https://code.visualstudio.com/docs/getstarted/settings)
