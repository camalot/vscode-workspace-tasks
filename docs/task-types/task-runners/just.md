---
layout: default
title: ⚡ Just
parent: ▶️ Task Runners
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Just
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

[Just](https://just.systems/) is a handy command runner for project-specific tasks. It
is similar to Make but focused purely on running commands (not building files). Recipes
are defined in a `justfile` using a clean, readable syntax with support for parameters,
dependencies, doc-comments, and attributes.

## How It Works

Just discovery uses the `just` CLI's built-in JSON dump rather than a static text
parser. For each justfile found in the workspace, the extension invokes:

```shell
just --justfile <path> --dump --dump-format json
```

The JSON response contains every recipe defined in the file — including its name, optional
doc-comment, and attributes. Each recipe is surfaced as a runnable entry in the tree view.

{: .note }
> The `just` executable must be installed and accessible on your system `PATH`
> (or configured via `workspaceTasks.applicationPath.just`) for recipe discovery to work.
> If the executable is not found or returns an error, no tasks are discovered from that
> justfile and a warning is written to the **Workspace Tasks** output channel.

---

## Supported File Patterns

The extension scans for justfiles anywhere in the workspace using the following patterns:

| Pattern | Description |
| --- | --- |
| `**/justfile` | Standard justfile |
| `**/.justfile` | Hidden justfile |
| `**/*.just` | Imported sub-module files |

---

## Task Execution

When you run a Just recipe, the extension invokes:

```shell
just --justfile <path> <recipeName>
```

The working directory is set to the directory containing the justfile so that `just`
can resolve any imported files and relative paths correctly.

**Run with arguments example:**

If a recipe accepts parameters you can pass them via **Run with Args**:

```shell
just --justfile /path/to/justfile deploy production
```

---

## Example Justfile

```just
# Build the project
build:
    cargo build --release

# Run tests
test:
    cargo test

# Deploy to an environment
deploy env='staging':
    echo "Deploying to {{env}}..."
    ./scripts/deploy.sh {{env}}

# Run the full CI pipeline
[group('CI')]
ci: build test
    echo "CI pipeline complete"

# Clean build artefacts
[group('CI')]
clean:
    rm -rf target/
```

---

## Configuration

### Enabling / Disabling

Just support is **enabled by default**. To disable it, add the following to your
VS Code settings:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "justfile": false
  }
}
```

### Application Path

If `just` is not on your system `PATH`, or you want to use a specific version,
configure the executable path:

```json
{
  "workspaceTasks.applicationPath.just": "/usr/local/bin/just"
}
```

On Windows, if the path ends with `just` (without `.exe`), the `.exe` extension
is appended automatically. The `~/` prefix is expanded to your home directory on
all platforms.

See [Application Paths — Just](../configuration/environment/application-paths#workspacetasksapplicationpathjust)
for the full reference.

### Recipe Groups

Just supports a `[group('name')]` attribute on recipes (available since just 1.13.0).
When `workspaceTasks.groups.justfile.enabled` is `true`, recipes that carry a group
attribute are shown as collapsible group nodes in the task tree. Recipes without a
group attribute are always shown at the top level, even when groups are enabled.

```json
{
  "workspaceTasks.groups.justfile.enabled": true
}
```

See [Display & Interaction — Grouping — justfile groups](../configuration/display-interaction/grouping#workspacetasksgroupsjustfileenabled)
for details.

---

## Tooltips from Doc-Comments

When a recipe has a doc-comment (`# comment` on the line immediately above the recipe
header), the comment text is shown as a tooltip when hovering over the task item in
the tree view.

```just
# Build the project in release mode
build:
    cargo build --release
```

Hovering over the `build` task shows `Build the project in release mode`.

---

## Troubleshooting

### No tasks appear in the tree view

1. **Check that `just` is installed.** Run `just --version` in a terminal to verify.
2. **Check the application path setting.** If `just` is not on your `PATH`,
   set `workspaceTasks.applicationPath.just` to the full path of the executable.
3. **Check the output channel.** Open the **Output** panel and select
   **Workspace Tasks** from the dropdown. Warning messages from recipe discovery
   are logged there (e.g. if `just --dump` fails for a particular justfile).
4. **Check that just is enabled.** Verify `workspaceTasks.enabledTaskTypes.justfile`
   is `true` (it is `true` by default).
5. **Reload the workspace.** Use the **Workspace Tasks: Refresh** command
   (`Ctrl+Shift+P` → `Workspace Tasks: Refresh`).

### Tasks from a justfile are missing after editing

The tree refreshes automatically on file change events. If tasks do not appear,
use **Workspace Tasks: Refresh** to force a reload.

### Phantom task names like `for` or `echo` appeared previously

Earlier versions of the extension used a regex-based parser that incorrectly matched
recipe body lines containing shell keywords as recipe names. This was fixed by
switching to `just --dump --dump-format json` for all recipe discovery. If you see
unexpected tasks, ensure you are running an up-to-date version of the extension.

---

## Related

- [Task Runners overview](index) — all supported task runners
- [Application Paths](../../configuration/environment/application-paths#workspacetasksapplicationpathjust) — configure the `just` executable path
- [Grouping — justfile groups](../../configuration/display-interaction/grouping#workspacetasksgroupsjustfileenabled) — show recipes under group nodes
