---
layout: default
title: ✅ Task (go-task)
parent: ▶️ Task Runners
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Task (go-task)
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

[Task](https://taskfile.dev/) is a fast, cross-platform task runner and build tool
written in Go. It is designed as a simpler, more portable alternative to Make. Tasks
are defined in a `Taskfile.yml` file using a clean YAML syntax with support for
variables, dependencies, namespacing, includes, and remote Taskfiles.

## How It Works

Task discovery uses the CLI's built-in JSON output mode rather than static YAML
parsing. This correctly resolves included Taskfiles, namespaced tasks, and template
variables that a static parser cannot evaluate. For each directory in the workspace
that contains a Taskfile, the extension runs:

```shell
task --list-all --no-status --json
```yaml

The JSON response contains the resolved task name, description, and source location
(file path and line number) for every available task. Each task is surfaced as a
runnable entry in the tree view.

{: .note }
> The `task` executable must be installed and accessible on your system `PATH`
> (or configured via `workspaceTasks.applicationPath.task`) for task discovery to work.
> If the executable is not found, no tasks are discovered from Taskfiles.

---

## Supported File Patterns

The extension scans for any of the following Taskfile filenames anywhere in the workspace:

| Pattern | Description |
| --- | --- |
| `**/Taskfile.yml` | Standard Taskfile (recommended name) |
| `**/taskfile.yml` | Lowercase variant |
| `**/Taskfile.yaml` | YAML extension variant |
| `**/taskfile.yaml` | Lowercase YAML variant |
| `**/Taskfile.dist.yml` | Distribution Taskfile (intended for version control) |
| `**/taskfile.dist.yml` | Lowercase distribution variant |
| `**/Taskfile.dist.yaml` | Distribution YAML variant |
| `**/taskfile.dist.yaml` | Lowercase distribution YAML variant |

When multiple Taskfile variants exist in the same directory (e.g. both
`Taskfile.yml` and `Taskfile.dist.yml`), the directory is scanned only once by
the CLI, which automatically applies its own resolution precedence.

{: .note }
> Global Taskfiles (`$HOME/Taskfile.yml`) are outside the workspace and are not
> discovered by default.

### Global Taskfile

Task can discover tasks from a global Taskfile in your home directory when
enabled:

```json
{
  "workspaceTasks.taskfile.discoverGlobalTaskfile": true
}
```

When enabled, Workspace Tasks checks standard Taskfile variants in `$HOME` and
uses the first one found by Task precedence. These files are watched for
create/change/delete events, and global tasks are refreshed automatically when
they change.

### Custom Taskfile Patterns

{: .deprecated }
> **Deprecated in favor of `workspaceTasks.additionalFilePatterns.taskfile`.**

If your project uses non-standard Taskfile names, add custom glob patterns to
discover them:

```json
{
  "workspaceTasks.taskfile.additionalFilePatterns": [
    "**/Taskfile.ci.yml",
    "**/backend/MyTasks.yml"
  ]
}
```

Executions automatically include `--taskfile <absolute path>` to ensure the
selected Taskfile is used consistently regardless of current working directory.

---

## Task Execution

When you run a Task task, the extension invokes:

```shell
task <taskName> [args]
```

The working directory is set to the directory containing the Taskfile. This ensures
`task` resolves the correct Taskfile, local includes, and relative paths.

**Run with arguments example:**

```shell
task deploy --force
```

---

## Example Taskfile

```yaml
# yaml-language-server: $schema=https://taskfile.dev/schema.json
---

version: '3'

vars:
  APP_NAME: my-app

tasks:
  default:
    desc: Print a greeting message
    cmds:
      - echo "Hello from Task!"
    silent: true

  build:
    desc: Build the application
    cmds:
      - echo "Building {{.APP_NAME}}..."

  test:
    desc: Run the test suite
    cmds:
      - echo "Running tests for {{.APP_NAME}}..."

  ci:
    desc: Run the full CI pipeline
    deps: [build, test]
```

---

## Configuration

### Enabling / Disabling

Task support is **enabled by default**. To disable it, add the following to your
VS Code settings:

```json
{
  "workspaceTasks.enabledTaskTypes": {
    "taskfile": false
  }
}
```

### Application Path

If `task` is not on your system `PATH`, or you want to use a specific version,
configure the executable path:

```json
{
  "workspaceTasks.applicationPath.taskfile": "/usr/local/bin/task"
}
```

On Windows, if the path ends with `task` (without `.exe`), the `.exe` extension
is appended automatically. The `~/` prefix is expanded to your home directory on
all platforms.

See [Application Paths](../configuration/environment/application-paths#workspacetasksapplicationpathtask)
for the full reference.

### Aliases In The Tree

Task supports aliases (alternative names for the same task). When
`workspaceTasks.taskfile.showAliases` is enabled (default: `true`), tasks
with aliases appear as expandable tree items and each alias is shown as a
child item.

Running an alias child executes:

```shell
task <alias>
```

Disable alias child items in the tree with:

```json
{
  "workspaceTasks.taskfile.showAliases": false
}
```

---

## Wildcard Tasks

Task supports task names that contain `*` as a wildcard — for example:

```yaml
tasks:
  build:*:
    desc: Build a component
    cmds:
      - echo "Building {{index .MATCH 0}}"
```

When you run a wildcard task from the tree view (or via a command), the extension
detects the `*` in the task name and prompts you to supply a value for each
wildcard segment before executing.

For example, running `build:*` opens an input box:

```text
Enter value for wildcard 1 of 1 in "build:*"
```

Type the value (e.g. `frontend`) and press **Enter**. The extension then runs:

```shell
task build:frontend
```

If the task name contains multiple wildcards (e.g. `deploy:*:*`), you are
prompted once for each `*` in sequence. Pressing **Escape** at any prompt
cancels the operation.

{: .note }
> Wildcard tasks are indicated in the tree view with a `[*]` suffix on their
> tooltip to help you identify them at a glance.

---

## CLI_ARGS Forwarding

Task's `{{.CLI_ARGS}}` template variable forwards any command-line arguments
that follow `--` directly to the task. The extension detects this pattern at
discovery time and automatically inserts `--` before any arguments you supply
when running such a task with **Run with Args**.

For example, given:

```yaml
tasks:
  test:
    desc: Run tests
    cmds:
      - go test ./... {{.CLI_ARGS}}
```

Running this task with args `-v -run TestFoo` produces:

```shell
task test -- -v -run TestFoo
```

Without `{{.CLI_ARGS}}`, arguments are appended directly (no `--` separator).

---

## Required Variables (`requires.vars`)

Taskfile supports required variables via `requires.vars`.

Workspace Tasks treats these as a Taskfile-specific guided argument flow:

- **Run Task** prompts only for required variables that are not already
  predefined in Taskfile `vars`.
- **Run with Args** always prompts for all required variables, and uses
  predefined values as defaults when available.

For enum-based required variables, the extension shows a pick list. For plain
variables, it shows an input box. Values are passed to `task` as
`VAR='value'` assignments and are inserted before any `--` separator.

Example:

```yaml
tasks:
  prompt:
    vars:
      APP_NAME: my-app
    requires:
      vars:
        - name: APP_NAME
        - name: ENVIRONMENT
          enum: [dev, staging, prod]
```

In this example:

- **Run Task** prompts only for `ENVIRONMENT` (because `APP_NAME` is already
  defined).
- **Run with Args** prompts for both `APP_NAME` and `ENVIRONMENT`, with
  `APP_NAME` pre-filled to `my-app`.

{: .note }
>This guided flow is controlled by the `workspaceTasks.task.guidedArgInput` setting (default: `true`).
>If the setting is `false`, the required-variables prompt is skipped and the task runs without
>collecting variable values.

---

## Watch Mode

Task supports a watch mode (`task --watch`) that re-runs a task whenever its source files change.
To start a task in watch mode, click the **Watch** ($(eye)) button that appears next to a task
item in the tree view, or right-click and select **Watch Task**.

Watch mode opens a new integrated terminal named `task watch: <taskName>`. Close the terminal
to stop watching.

To disable the Watch button on task items:

```json
{
  "workspaceTasks.taskfile.enableWatchMode": false
}
```

---

## Troubleshooting

### No tasks appear in the tree view

1. **Check that `task` is installed.** Run `task --version` in a terminal to verify.
2. **Check the application path setting.** If `task` is not on your `PATH`,
   set `workspaceTasks.applicationPath.task` to the full path of the executable.
3. **Check that task is enabled.** Verify `workspaceTasks.enabledTaskTypes.task`
   is `true` (it is `true` by default).
4. **Reload the workspace.** Use the **Workspace Tasks: Refresh** command
   (`Ctrl+Shift+P` → `Workspace Tasks: Refresh`).

### Tasks from included Taskfiles are missing

Task automatically resolves includes when `--list-all --json` is invoked. If
included Taskfiles reference paths that do not exist, `task` may print an error
to stderr instead of returning JSON. Check the extension output channel
(**Workspace Tasks** in the Output panel) for warning messages from the task
discovery process.

---

## Related

- [Task Runners overview](task-runners) — all supported task runners
- [Application Paths](../configuration/environment/application-paths) — configure executable paths
- [Enabling / Disabling Task Types](../configuration/task-type) — control which task types are active
- [Task website](https://taskfile.dev/) — official documentation
- [Task on GitHub](https://github.com/go-task/task) — source code and issue tracker
