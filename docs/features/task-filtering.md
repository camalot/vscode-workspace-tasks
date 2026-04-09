---
layout: default
title: 🪄 Task Filtering
nav_order: 7
parent: 🚀 Features
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task Filtering
{: .no_toc }

The `.tasksignore` file allows you to control which files are excluded from task discovery in the Workspace Tasks extension.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

This helps keep your task list focused on relevant tasks by filtering out unwanted files and directories.

## Overview

`.tasksignore` works similarly to `.gitignore`, using the same pattern syntax to specify which files and directories should be excluded from task scanning. When the extension searches for task files (like `package.json`, `Makefile`, `build.gradle`, etc.), it will skip any files that match patterns in `.tasksignore` files.

## How It Works

- **Performance with Caching**: The extension drastically speeds up task discovery using an in-memory cache system. Upon the first scan, all supported file patterns are combined into a single file system query. Future task resolutions read purely from memory. This means if new task files are created while a scan is in-progress, they'll be reliably visible on the explicit "Refresh" action.
The cache invalidates whenever changes to `.tasksignore`, relevant user configurations, or system files are detected.
- **Per-Directory Control**: Place a `.tasksignore` file in any directory to exclude files from that location and its subdirectories
- **Hierarchical Application**: Ignore files are evaluated from the workspace root down to the file location
- **Gitignore Syntax**: Uses standard gitignore pattern matching rules
- **Automatic Reload**: Changes to `.tasksignore` files are automatically detected and applied along with resetting the underlying cache.
- **Smart Defaults**: The extension always ignores certain directories regardless of `.tasksignore` settings:
  - `**/node_modules/**`
  - `**/.git/**`
  - `**/.vscode-test/**`
  - `**/__pycache__/**`
  - `**/vendor/bundle/**`

## Filter Rule Syntax and Examples

The full `.tasksignore` syntax, task-level rules, and worked examples now live on the dedicated Ignoring Tasks page:

- [Ignoring Tasks](./tasksignore)
- [Task-Level Filtering](./tasksignore#task-level-filtering)
- [Pattern Syntax](./tasksignore#pattern-syntax)

Use this page for filtering behavior and precedence, and use the Ignoring Tasks page as the source of truth for rule syntax.

## Global Configuration

In addition to `.tasksignore` files, you can configure workspace-wide exclusions in your Visual Studio Code `settings.json`:

```json
{
  "workspaceTasks.exclude": [
    "**/.git/**",
    "**/vendor/**",
    "**/third-party/**",
    "**/__pycache__/**",
    "**/vendor/bundle/**"

  ]
}
```

These patterns are applied globally across the entire workspace and complement any local `.tasksignore` files.

For pattern syntax details and edge cases, refer to [Ignoring Tasks](./tasksignore).

## Pattern Evaluation Order

The extension evaluates ignore patterns in the following order:

1. **Built-in defaults**: Always-ignored patterns (node_modules, .git, etc.)
2. **Global configuration**: Patterns from `workspaceTasks.exclude` setting
3. **Local .tasksignore files**: Patterns from `.tasksignore` files, evaluated from closest to the file up to the workspace root

If any pattern matches, the file is excluded from task discovery.

## Best Practices

1. **Use `.tasksignore` for repository-specific rules**: Keep project intent close to files and folders.
2. **Use `workspaceTasks.exclude` for user/workspace-wide rules**: Keep personal or environment-specific filtering in settings.
3. **Start broad, then refine**: Begin with high-signal exclusions and tighten only when needed.
4. **Refresh after changes**: If results look stale during active edits, trigger a refresh to rebuild the cache immediately.
5. **Keep rule syntax centralized**: Use [Ignoring Tasks](./tasksignore) as the canonical syntax reference.

## Common Use Cases

Use [Ignoring Tasks](./tasksignore#examples) for ready-to-copy ignore rule examples.

This page focuses on when filtering is evaluated, how cache invalidation works, and where to place each kind of filter rule.

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
5. Verify the rule syntax against [Ignoring Tasks](./tasksignore)

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
- [Ignoring Tasks](./tasksignore)
- [Configuration](../configuration)
- [Visual Studio Code Settings](https://code.visualstudio.com/docs/getstarted/settings)
