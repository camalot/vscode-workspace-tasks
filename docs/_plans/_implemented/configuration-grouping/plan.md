# Plan: Configuration Grouping

## TL;DR

The extension currently exposes all its settings as a single flat `configuration` object in
`package.json`. VS Code supports grouping configuration into named sections by converting
`configuration` from a single object to an **array of objects**, each with a `"title"` and its
own `"properties"` block. This plan introduces **five logical groups** that organise the ~45
settings into discoverable, user-friendly categories, and restructures the documentation to match.

---

## Problem Statement

The Workspace Tasks extension exposes a large number of configuration properties across several
concern areas (discovery, display, execution, metrics, etc.). They are all surfaced flat in the
VS Code Settings UI, making it hard for users to scan, find, and reason about them. The C/C++
extension (`ms-vscode.cpptools`) demonstrates the array-based grouping pattern as a first-class
VS Code feature.

---

## Requirements

1. Group all existing `workspaceTasks.*` settings into logical named sections.
2. Use 3–5 groups — enough to create structure without over-fragmenting.
3. Change the `"configuration"` entry in `package.json` from an object to an array of section
   objects, each with `"title"` and `"properties"`.
4. Add NLS keys for each section title in `package.nls.json`.
5. No settings are renamed, removed, or given new defaults — this is a **presentation-only**
   change; no runtime code changes are needed.
6. Restructure documentation in `docs/configuration/` to mirror the five groups, with
   sub-pages for each logical sub-section.
7. Documentation pages must include full configuration detail and link to related feature docs
   where applicable.
8. All existing tests must continue to pass.

---

## Groups (5)

### Group 1 — General

General-purpose settings that do not belong to a narrower concern. Includes the debug-logging
toggle and all task metrics/retention settings (too few metrics settings to warrant their own
top-level group).

| Setting | Description |
| --- | --- |
| `workspaceTasks.debug` | Enable debug logging |
| `workspaceTasks.metrics.scope` | Where metrics are stored (workspace, global, both, disabled) |
| `workspaceTasks.metrics.maxDurationSamples` | Maximum number of duration samples retained per task |
| `workspaceTasks.metrics.retentionDays` | Days after which metrics are automatically pruned |

---

### Group 2 — Task Discovery

Settings that control which tasks the extension finds, indexes, and how it discovers them —
including task type enablement, file-system traversal depth, exclusion patterns, and the shell
interpreters used when scanning shell-script tasks.

| Setting | Description |
| --- | --- |
| `workspaceTasks.exclude` | Glob patterns to exclude from task discovery |
| `workspaceTasks.taskDiscovery.fetchDepth` | Directory depth limit for task discovery |
| `workspaceTasks.enabledTaskTypes` | Enable/disable each supported task-type provider |
| `workspaceTasks.shellEnabledTaskTypes` | Enable/disable specific shell-script task types |
| `workspaceTasks.shellPaths` | Paths to shell interpreter executables |
| `workspaceTasks.shellAdditionalExtensions` | Additional file extensions mapped to shell types |

> **Design note — shell settings placed here:** Shell type and path settings describe *how the
> extension discovers and identifies* shell-script tasks. They are more naturally co-located with
> task-type enablement than with runtime execution behavior.

---

### Group 3 — Display & Interaction

Settings that govern the visual presentation of the task tree view and how the user interacts
with tasks — grouping, icons, click actions, action bar buttons, and the recent tasks cap.

| Setting | Description |
| --- | --- |
| `workspaceTasks.groups.enabled` | Enable grouping in the task tree |
| `workspaceTasks.groups.useParentFolder` | Use parent folder as an additional grouping level |
| `workspaceTasks.groups.expanded` | Default expanded/collapsed state of each group header |
| `workspaceTasks.groups.recentTasks.enabled` | Show the Recent Tasks group |
| `workspaceTasks.groups.compoundTasks.enabled` | Show the Compound Tasks group |
| `workspaceTasks.groups.taskSeparator` | Character that splits a task name into group segments |
| `workspaceTasks.task.actionBar` | Items shown in the inline task action bar |
| `workspaceTasks.task.statusResetDelay` | Milliseconds before the task status icon resets |
| `workspaceTasks.task.singleClickAction` | Action on single-click (run / open / none / …) |
| `workspaceTasks.task.doubleClickAction` | Action on double-click |
| `workspaceTasks.task.iconType` | Source of the task icon (type / file / gear / run / custom) |
| `workspaceTasks.task.iconTypeCustom` | Custom ThemeIcon or image path |
| `workspaceTasks.recentTasks.maxItems` | Maximum items in the Recent Tasks list |

---

### Group 4 — Task Execution

Settings that directly control how tasks behave at runtime — lifecycle (graceful stop),
presentation in the terminal, and compound task execution logic.

| Setting | Description |
| --- | --- |
| `workspaceTasks.task.stopGracefulDelayMilliseconds` | Grace period before force-killing a task |
| `workspaceTasks.task.stopCompoundDependencies` | Also stop dependent tasks in a compound run |
| `workspaceTasks.compoundTasks.defaultExecutionType` | Default sequential vs. parallel execution |
| `workspaceTasks.compoundTasks.includeVsCodeCompoundTasks` | Include VS Code built-in compound tasks |
| `workspaceTasks.task.presentationOptions` | Terminal reveal, clear, echo, panel, focus, close |

---

### Group 5 — Environment

Tool-specific executable paths and per-tool configuration for task-type providers that require
external binaries (GitHub Actions via Act, Apache Ant, CMake, and all other tools).

| Setting | Description |
| --- | --- |
| `workspaceTasks.applicationPath.act` | Path to the `act` executable |
| `workspaceTasks.applicationPath.ansicon` | Path to `ansicon.exe` |
| `workspaceTasks.applicationPath.ant` | Path to the `ant` executable |
| `workspaceTasks.applicationPath.cargo` | Path to `cargo` |
| `workspaceTasks.applicationPath.cargo-make` | Path to `cargo-make` |
| `workspaceTasks.applicationPath.cmake` | Path to `cmake` |
| `workspaceTasks.applicationPath.composer` | Path to `composer` |
| `workspaceTasks.applicationPath.deno` | Path to `deno` |
| `workspaceTasks.applicationPath.gradle` | Path to `gradlew` |
| `workspaceTasks.applicationPath.just` | Path to `just` |
| `workspaceTasks.applicationPath.make` | Path to `make` |
| `workspaceTasks.applicationPath.maven` | Path to `mvn` |
| `workspaceTasks.applicationPath.msbuild` | Path to `msbuild` |
| `workspaceTasks.applicationPath.pipenv` | Path to `pipenv` |
| `workspaceTasks.applicationPath.poe` | Path to `poe` |
| `workspaceTasks.applicationPath.poetry` | Path to `poetry` |
| `workspaceTasks.applicationPath.rake` | Path to `rake` |
| `workspaceTasks.ant.ansicon.enabled` | Enable ANSICON color output for Ant tasks |
| `workspaceTasks.act.envFile` | Path to the `.env` file for Act |
| `workspaceTasks.act.variablesFile` | Path to the Act variables file |
| `workspaceTasks.act.variables` | Inline variables map for Act |
| `workspaceTasks.act.secretsFile` | Path to the Act secrets file |
| `workspaceTasks.cmake.buildDirectory` | CMake build output directory |
| `workspaceTasks.cmake.buildType` | CMake build type (Debug / Release / …) |
| `workspaceTasks.cmake.generator` | CMake generator string |

---

## NLS Keys

Keys already added (Tasks 1–5):

```json
"config.group.general.title": "General",
"config.group.discovery.title": "Task Discovery",
"config.group.display.title": "Display & Interaction"
```

Keys requiring update/addition (new Tasks 6–10):

```json
"config.group.execution.title": "Task Execution",
"config.group.environment.title": "Environment"
```

> `config.group.execution.title` was previously `"Task Execution & Environment"` — its value
> must be updated to `"Task Execution"`. A new `config.group.environment.title` key is added
> for the split-off Environment group.

---

## `package.json` Structural Change

**Before (implemented in Tasks 1–5 — 4 groups):**

```json
"configuration": [
  { "title": "%config.group.general.title%",   "properties": { /* 4 settings  */ } },
  { "title": "%config.group.discovery.title%", "properties": { /* 6 settings  */ } },
  { "title": "%config.group.display.title%",   "properties": { /* 13 settings */ } },
  { "title": "%config.group.execution.title%", "properties": { /* 30 settings */ } }
]
```

**After (target — 5 groups):**

```json
"configuration": [
  {
    "title": "%config.group.general.title%",
    "properties": {
      "workspaceTasks.debug": { ... },
      "workspaceTasks.metrics.scope": { ... },
      "workspaceTasks.metrics.maxDurationSamples": { ... },
      "workspaceTasks.metrics.retentionDays": { ... }
    }
  },
  {
    "title": "%config.group.discovery.title%",
    "properties": {
      "workspaceTasks.exclude": { ... },
      "workspaceTasks.taskDiscovery.fetchDepth": { ... },
      "workspaceTasks.enabledTaskTypes": { ... },
      "workspaceTasks.shellEnabledTaskTypes": { ... },
      "workspaceTasks.shellPaths": { ... },
      "workspaceTasks.shellAdditionalExtensions": { ... }
    }
  },
  {
    "title": "%config.group.display.title%",
    "properties": {
      "workspaceTasks.groups.enabled": { ... },
      "workspaceTasks.groups.useParentFolder": { ... },
      "workspaceTasks.groups.expanded": { ... },
      "workspaceTasks.groups.recentTasks.enabled": { ... },
      "workspaceTasks.groups.compoundTasks.enabled": { ... },
      "workspaceTasks.groups.taskSeparator": { ... },
      "workspaceTasks.task.actionBar": { ... },
      "workspaceTasks.task.statusResetDelay": { ... },
      "workspaceTasks.task.singleClickAction": { ... },
      "workspaceTasks.task.doubleClickAction": { ... },
      "workspaceTasks.task.iconType": { ... },
      "workspaceTasks.task.iconTypeCustom": { ... },
      "workspaceTasks.recentTasks.maxItems": { ... }
    }
  },
  {
    "title": "%config.group.execution.title%",
    "properties": {
      "workspaceTasks.task.stopGracefulDelayMilliseconds": { ... },
      "workspaceTasks.task.stopCompoundDependencies": { ... },
      "workspaceTasks.compoundTasks.defaultExecutionType": { ... },
      "workspaceTasks.compoundTasks.includeVsCodeCompoundTasks": { ... },
      "workspaceTasks.task.presentationOptions": { ... }
    }
  },
  {
    "title": "%config.group.environment.title%",
    "properties": {
      "workspaceTasks.applicationPath.act": { ... },
      "workspaceTasks.applicationPath.ansicon": { ... },
      "workspaceTasks.applicationPath.ant": { ... },
      "workspaceTasks.applicationPath.cargo": { ... },
      "workspaceTasks.applicationPath.cargo-make": { ... },
      "workspaceTasks.applicationPath.cmake": { ... },
      "workspaceTasks.applicationPath.composer": { ... },
      "workspaceTasks.applicationPath.deno": { ... },
      "workspaceTasks.applicationPath.gradle": { ... },
      "workspaceTasks.applicationPath.just": { ... },
      "workspaceTasks.applicationPath.make": { ... },
      "workspaceTasks.applicationPath.maven": { ... },
      "workspaceTasks.applicationPath.msbuild": { ... },
      "workspaceTasks.applicationPath.pipenv": { ... },
      "workspaceTasks.applicationPath.poe": { ... },
      "workspaceTasks.applicationPath.poetry": { ... },
      "workspaceTasks.applicationPath.rake": { ... },
      "workspaceTasks.ant.ansicon.enabled": { ... },
      "workspaceTasks.act.envFile": { ... },
      "workspaceTasks.act.variablesFile": { ... },
      "workspaceTasks.act.variables": { ... },
      "workspaceTasks.act.secretsFile": { ... },
      "workspaceTasks.cmake.buildDirectory": { ... },
      "workspaceTasks.cmake.buildType": { ... },
      "workspaceTasks.cmake.generator": { ... }
    }
  }
]
```

---

## Documentation Structure

The existing `docs/configuration/` pages are a flat list. The new structure introduces five
group-level index pages as parents, with existing and new pages nested under them using
just-the-docs `parent:` / `grand_parent:` front matter.

```
docs/configuration/
├── index.md                                    (updated — 5-group overview, links to group landing pages)
├── general/
│   ├── index.md                                (new — General group landing page)
│   ├── debugging.md                            (new — workspaceTasks.debug)
│   └── metrics.md                              (new — workspaceTasks.metrics.*)
├── task-discovery/
│   ├── index.md                                (new — Task Discovery group landing page)
│   ├── general.md                              (new — exclude, fetchDepth)
│   └── discovery.md                            (new — enabledTaskTypes, shellEnabledTaskTypes,
│                                                       shellPaths, shellAdditionalExtensions)
├── display-interaction/
│   ├── index.md                                (new — Display & Interaction group landing page)
│   ├── grouping.md                             (new — groups.* settings)
│   └── tasks.md                                (new — task action, icon, click, status,
│                                                       recentTasks.maxItems)
├── task-execution/
│   ├── index.md                                (new — Task Execution group landing page)
│   ├── tasks.md                                (new — stop behavior, presentationOptions)
│   └── compound-tasks.md                       (new — compoundTasks.* settings)
└── environment/
    ├── index.md                                (new — Environment group landing page)
    └── application-paths/
        ├── index.md                            (new — intro + all simple applicationPath.* settings)
        ├── ant.md                              (new — applicationPath.ant, ant.ansicon.enabled)
        ├── act.md                              (new — applicationPath.act, act.envFile/
        │                                               variablesFile/variables/secretsFile)
        └── cmake.md                            (new — applicationPath.cmake, cmake.buildDirectory/
                                                        buildType/generator)
```

> **Existing flat pages** (`docs/configuration/general.md`, `task-grouping.md`, etc.) are
> **replaced** by the new structured pages. Their content is migrated and enhanced with feature
> links. A redirect or deprecation notice should be left in each old file until verified safe to
> remove.

---

## Documentation Page Specifications

Each page must include:

- Jekyll front matter with correct `title`, `parent`, `grand_parent` (where applicable), and
  `nav_order`.
- A `## Table of Contents` TOC block.
- For each setting: **type**, **default**, full description, all enum values explained, an
  example JSON snippet, a screenshot reference (where one already exists in the repo), and a
  **Feature links** section pointing to related feature documentation.

---

### `docs/configuration/index.md` (updated)

Replace the current flat section table with a four-row group overview table: group name,
description, and a link to the group landing page. No individual settings are documented here.

---

### `docs/configuration/general/index.md` (new)

**Title:** `⚙️ General`
**Parent:** `⚙️ Configuration`

Landing page for the General group. Short paragraph describing the group's scope (operational
settings and metrics). Lists sub-pages: Debugging, Metrics. Does not document individual settings.

---

### `docs/configuration/general/debugging.md` (new)

**Title:** `🐛 Debugging`
**Parent:** `⚙️ General`
**Grand parent:** `⚙️ Configuration`

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.debug` | `boolean` | `false` |

**`workspaceTasks.debug`**
Enables verbose debug-level logging from the extension into the VS Code Output panel (channel:
"Workspace Tasks"). When `true`, the extension logs internal events such as task discovery steps,
provider invocations, and error stack traces. Useful for diagnosing issues before filing a bug
report.

**Feature links:** None — this is a diagnostic toggle with no corresponding feature guide.

---

### `docs/configuration/general/metrics.md` (new)

**Title:** `📊 Metrics`
**Parent:** `⚙️ General`
**Grand parent:** `⚙️ Configuration`

Migrate and expand the existing `docs/configuration/metrics.md` content here.

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.metrics.scope` | `string` | `"workspace"` |
| `workspaceTasks.metrics.maxDurationSamples` | `integer` | `100` |
| `workspaceTasks.metrics.retentionDays` | `integer` | `0` |

**`workspaceTasks.metrics.scope`**
Controls where task execution metrics are written and read. Options:

- `"workspace"` (default) — stored in `workspaceState`; each workspace has its own independent
  metrics.
- `"global"` — stored in `globalState`; shared across all workspaces.
- `"both"` — written to both; workspace data takes read precedence.
- `"disabled"` — metrics collection is off; the Statistics tab is empty.

**`workspaceTasks.metrics.maxDurationSamples`**
Maximum number of recent task duration samples retained per task, stored as a ring buffer.
When the limit is reached the oldest sample is dropped. Samples feed the `avg`, `median`, and
`p95` statistics shown in the History view. Range: `10`–`1000`.

**`workspaceTasks.metrics.retentionDays`**
Number of days after which metrics for a task are pruned on extension startup, based on the
task's `lastRunAt` timestamp. `0` (default) means metrics are kept indefinitely.

**Feature links:**
- [Task History](../../features/task-history.md) — the History view where metrics are displayed.

---

### `docs/configuration/task-discovery/index.md` (new)

**Title:** `🔍 Task Discovery`
**Parent:** `⚙️ Configuration`

Landing page for the Task Discovery group. Explains that this group controls which files are
scanned, how deeply, and which task types and shell types are recognised. Lists sub-pages:
General, Discovery.

---

### `docs/configuration/task-discovery/general.md` (new)

**Title:** `🔍 General`
**Parent:** `🔍 Task Discovery`
**Grand parent:** `⚙️ Configuration`

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.exclude` | `array` of `string` | `[]` |
| `workspaceTasks.taskDiscovery.fetchDepth` | `number \| null` | `null` |

**`workspaceTasks.exclude`**
Glob patterns to exclude files and folders from the task discovery scan. Patterns follow
[micromatch glob syntax](https://github.com/micromatch/glob). `**/node_modules/**` and
`**/.git/**` are always excluded regardless of this setting.

Example:
```json
{ "workspaceTasks.exclude": ["**/sample/**", "**/test/**", "**/build/**"] }
```

**`workspaceTasks.taskDiscovery.fetchDepth`**
Limits the directory depth searched during task discovery. `null` (default) means the entire
workspace is scanned. A positive integer restricts the scan to that many directory levels from
the workspace root. Set to a small value (e.g. `3`) to improve startup performance in large
monorepos.

Example:
```json
{ "workspaceTasks.taskDiscovery.fetchDepth": 3 }
```

**Feature links:**
- [Hide Tasks](../../features/hide-tasks.md) — hide individual tasks without excluding them
  from discovery.
- [Tasksignore](../../features/tasksignore.md) — a file-based alternative for exclusions.

---

### `docs/configuration/task-discovery/discovery.md` (new)

**Title:** `🔍 Discovery`
**Parent:** `🔍 Task Discovery`
**Grand parent:** `⚙️ Configuration`

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.enabledTaskTypes` | `object` | _(most enabled; bun, yarn, pnpm off by default)_ |
| `workspaceTasks.shellEnabledTaskTypes` | `object` | _(all shell types enabled)_ |
| `workspaceTasks.shellPaths` | `object` | _(standard system paths)_ |
| `workspaceTasks.shellAdditionalExtensions` | `object` | `{}` |

**`workspaceTasks.enabledTaskTypes`**
An object whose keys are task-type provider IDs and whose values are booleans that enable or
disable that provider. Disabling a provider prevents any of its tasks from being discovered or
displayed. Full list of supported keys: `ant`, `bun`, `cake`, `cargo`, `cargo-make`, `cmake`,
`composer`, `deno`, `docker`, `eslint`, `github-actions`, `go`, `gradle`, `grunt`, `gulp`,
`jupyter`, `just`, `make`, `maven`, `msbuild`, `npm`, `pipenv`, `pnpm`, `poe`, `poetry`,
`rake`, `ruby`, `shell`, `tsc`, `venv`, `vscode`, `webpack`, `workspace`, `yarn`.

**`workspaceTasks.shellEnabledTaskTypes`**
Controls which shell-script interpreters are active for the `shell` task-type provider. Keys:
`bash`, `batch`, `fish`, `nushell`, `perl`, `pwsh`, `python`, `ruby`, `sh`, `zsh`, `other`.
Setting any key to `false` prevents files using that interpreter from being scanned.

**`workspaceTasks.shellPaths`**
Maps each shell-type key to the path of its interpreter executable. Used when the interpreter
is installed in a non-standard location. Keys match `shellEnabledTaskTypes` (excluding `other`).
`~/` is expanded to the user's home directory.

**`workspaceTasks.shellAdditionalExtensions`**
Maps additional file extensions to a shell-type key. For example `{ ".bsh": "bash" }` causes
`.bsh` files to be treated as Bash scripts during discovery.

**Feature links:**
- [Task Types overview](../../task-types/index.md)
- [Shell Scripts](../../task-types/scripts.md)
- [Running Tasks](../../features/running-tasks.md)

---

### `docs/configuration/display-interaction/index.md` (new)

**Title:** `🖥️ Display & Interaction`
**Parent:** `⚙️ Configuration`

Landing page for the Display & Interaction group. Describes that the group covers how tasks are
presented (icons, grouping) and how the user interacts with them (clicks, action buttons,
terminal output). Lists sub-pages: Grouping, Tasks.

---

### `docs/configuration/display-interaction/grouping.md` (new)

**Title:** `🖥️ Grouping`
**Parent:** `🖥️ Display & Interaction`
**Grand parent:** `⚙️ Configuration`

Migrate and expand content from the existing `docs/configuration/task-grouping.md`.

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.groups.enabled` | `boolean` | `true` |
| `workspaceTasks.groups.useParentFolder` | `boolean` | `false` |
| `workspaceTasks.groups.expanded` | `object` | `{ favorites: true, compoundTask: true, recent: true }` |
| `workspaceTasks.groups.recentTasks.enabled` | `boolean` | `false` |
| `workspaceTasks.groups.compoundTasks.enabled` | `boolean` | `false` |
| `workspaceTasks.groups.taskSeparator` | `string` | `""` |

**`workspaceTasks.groups.enabled`**
When `true`, tasks are grouped in the tree by type, folder, or separator. When `false`, all
tasks are shown as a single flat list.

**`workspaceTasks.groups.useParentFolder`**
When `true`, an additional grouping level is added based on the parent folder of each task's
source file. Particularly useful in monorepos where multiple packages define tasks with the
same name.

**`workspaceTasks.groups.expanded`**
An object controlling the default expanded/collapsed state of the three special groups. Keys:
`favorites` (boolean), `compoundTask` (boolean), `recent` (boolean). Each key is `true` by
default (groups start expanded).

**`workspaceTasks.groups.recentTasks.enabled`**
When `true`, a "Recent Tasks" group is shown at the top of the tree containing the most recently
run tasks. The number of items retained is controlled by
`workspaceTasks.recentTasks.maxItems`.

**`workspaceTasks.groups.compoundTasks.enabled`**
When `true`, a "Compound Tasks" group is shown containing user-defined task queues.

**`workspaceTasks.groups.taskSeparator`**
A single character (e.g. `":"`, `"/"`, `"#"`) used to split a task's name into nested groups.
For example, with separator `":"`, the task `build:frontend` appears under a `build` group.
An empty string (default) disables name-based grouping.

**Feature links:**
- [Favorites](../../features/favorites.md)
- [Compound Tasks / Queues](../../features/compound-tasks.md)
- [Recent Tasks](../../features/recents.md)
- [Task Filtering](../../features/task-filtering.md)

---

### `docs/configuration/display-interaction/tasks.md` (new)

**Title:** `🖥️ Tasks`
**Parent:** `🖥️ Display & Interaction`
**Grand parent:** `⚙️ Configuration`

Migrate and expand content from `task-display.md`, `task-action.md`, and `task-icon.md`.

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.task.singleClickAction` | `string` | `"open"` |
| `workspaceTasks.task.doubleClickAction` | `string` | `"run"` |
| `workspaceTasks.task.statusResetDelay` | `number` | `500` |
| `workspaceTasks.task.iconType` | `string` | `"type"` |
| `workspaceTasks.task.iconTypeCustom` | `string` | `""` |
| `workspaceTasks.task.actionBar` | `object` | _(see below)_ |
| `workspaceTasks.recentTasks.maxItems` | `number` | `20` |

**`workspaceTasks.task.singleClickAction`** / **`workspaceTasks.task.doubleClickAction`**
Actions triggered by single or double-clicking a task row. Options: `"run"`, `"runWithArgs"`,
`"open"` (opens the task's source file), `"none"`.

**`workspaceTasks.task.statusResetDelay`**
Milliseconds to wait after a task finishes before the status icon on the task row resets back
to its idle state. Set to `0` to reset immediately.

**`workspaceTasks.task.iconType`**
Source used for the icon displayed next to each task in the tree. Options:

- `"type"` (default) — the icon registered by the task-type provider
- `"file"` — VS Code's file icon for the task's source file
- `"gear"` — a generic gear/settings icon
- `"run"` — a play icon
- `"custom"` — the icon specified by `workspaceTasks.task.iconTypeCustom`

**`workspaceTasks.task.iconTypeCustom`**
Active only when `iconType` is `"custom"`. Accepts a
[ThemeIcon](https://code.visualstudio.com/api/references/icons-in-labels) reference (e.g.
`"$(rocket)"`) or a path to a PNG/SVG file.

**`workspaceTasks.task.actionBar`**
An object controlling which inline buttons appear when hovering over a task row. Default:

```jsonc
{
  "run": true,        // Run task
  "runWithArgs": true,// Run with arguments
  "openFile": true,   // Open source file
  "favorite": true,   // Add to / remove from Favorites
  "queue": true,      // Add to Compound Task
  "hide": false,      // Hide this task
  "unhide": true      // Unhide a hidden task (visible in show-hidden mode)
}
```

**`workspaceTasks.recentTasks.maxItems`**
Maximum number of entries kept in the Recent Tasks list. When the limit is reached the oldest
entry is removed. Set to `0` to disable the list entirely (this also overrides
`workspaceTasks.groups.recentTasks.enabled`).

**Feature links:**
- [Running Tasks](../../features/running-tasks.md)
- [Favorites](../../features/favorites.md)
- [Compound Tasks / Queues](../../features/compound-tasks.md)
- [Hide Tasks](../../features/hide-tasks.md)
- [Recent Tasks](../../features/recents.md)

**`workspaceTasks.task.singleClickAction`** / **`workspaceTasks.task.doubleClickAction`**
Actions triggered by single or double-clicking a task row. Options: `"run"`, `"runWithArgs"`,
`"open"` (opens the task's source file), `"none"`.

**`workspaceTasks.task.statusResetDelay`**
Milliseconds to wait after a task finishes before the status icon on the task row resets back
to its idle state. Set to `0` to reset immediately.

**`workspaceTasks.task.iconType`**
Source used for the icon displayed next to each task in the tree. Options:

- `"type"` (default) — the icon registered by the task-type provider
- `"file"` — VS Code's file icon for the task's source file
- `"gear"` — a generic gear/settings icon
- `"run"` — a play icon
- `"custom"` — the icon specified by `workspaceTasks.task.iconTypeCustom`

**`workspaceTasks.task.iconTypeCustom`**
Active only when `iconType` is `"custom"`. Accepts a
[ThemeIcon](https://code.visualstudio.com/api/references/icons-in-labels) reference (e.g.
`"$(rocket)"`) or a path to a PNG/SVG file.

**`workspaceTasks.task.actionBar`**
An object controlling which inline buttons appear when hovering over a task row. Default:

```jsonc
{
  "run": true,        // Run task
  "runWithArgs": true,// Run with arguments
  "openFile": true,   // Open source file
  "favorite": true,   // Add to / remove from Favorites
  "queue": true,      // Add to Compound Task
  "hide": false,      // Hide this task
  "unhide": true      // Unhide a hidden task (visible in show-hidden mode)
}
```

**`workspaceTasks.task.presentationOptions`**
Mirrors the VS Code `presentation` block. Applied to all tasks launched from the extension
unless a task's own `tasks.json` definition overrides it. Sub-properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `reveal` | `string` | `"always"` | When to reveal the terminal panel (`"always"`, `"silent"`, `"never"`) |
| `clear` | `boolean` | `false` | Clear the terminal before each run |
| `close` | `boolean` | `false` | Close the terminal after the task finishes |
| `echo` | `boolean` | `true` | Echo the command to the terminal |
| `focus` | `boolean` | `false` | Focus the terminal when the task starts |
| `panel` | `string` | `"shared"` | Terminal panel mode (`"dedicated"`, `"shared"`, `"new"`) |

**Feature links:**
- [Running Tasks](../../features/running-tasks.md)
- [Favorites](../../features/favorites.md)
- [Compound Tasks / Queues](../../features/compound-tasks.md)
- [Hide Tasks](../../features/hide-tasks.md)

---

### `docs/configuration/task-execution/index.md` (new)

**Title:** `⚡ Task Execution`
**Parent:** `⚙️ Configuration`

Landing page for the Task Execution group. Explains the group covers task lifecycle
(graceful stop, compound execution), and terminal presentation. Lists sub-pages: Tasks,
Compound Tasks.

---

### `docs/configuration/task-execution/tasks.md` (new)

**Title:** `⚡ Tasks`
**Parent:** `⚡ Task Execution`
**Grand parent:** `⚙️ Configuration`

Migrate and expand `task-presentation.md` stop-related content from `general.md`.

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.task.stopGracefulDelayMilliseconds` | `number` | `5000` |
| `workspaceTasks.task.stopCompoundDependencies` | `boolean` | `true` |
| `workspaceTasks.task.presentationOptions` | `object` | _(see below)_ |

**`workspaceTasks.task.stopGracefulDelayMilliseconds`**
When the user stops a running task the extension sends SIGTERM (or the platform equivalent) and
waits this many milliseconds before escalating to SIGKILL. Set to `0` to force-kill immediately
with no grace period.

**`workspaceTasks.task.stopCompoundDependencies`**
When `true`, stopping a compound task also terminates any currently running dependent tasks that
were launched as part of the same compound run. When `false`, only the compound task itself is
stopped.

**`workspaceTasks.task.presentationOptions`**
Mirrors the VS Code `presentation` block. Applied to all tasks launched from the extension
unless a task's own `tasks.json` definition overrides it. Sub-properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `reveal` | `string` | `"always"` | When to reveal the terminal panel (`"always"`, `"silent"`, `"never"`) |
| `clear` | `boolean` | `false` | Clear the terminal before each run |
| `close` | `boolean` | `false` | Close the terminal after the task finishes |
| `echo` | `boolean` | `true` | Echo the command to the terminal |
| `focus` | `boolean` | `false` | Focus the terminal when the task starts |
| `panel` | `string` | `"shared"` | Terminal panel mode (`"dedicated"`, `"shared"`, `"new"`) |

**Feature links:**
- [Running Tasks](../../features/running-tasks.md)

---

### `docs/configuration/task-execution/compound-tasks.md` (new)

**Title:** `⚡ Compound Tasks`
**Parent:** `⚡ Task Execution`
**Grand parent:** `⚙️ Configuration`

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.compoundTasks.defaultExecutionType` | `string` | `"sequential"` |
| `workspaceTasks.compoundTasks.includeVsCodeCompoundTasks` | `boolean` | `true` |

**`workspaceTasks.compoundTasks.defaultExecutionType`**
Sets the default execution mode applied when creating a new compound task queue. Options:

- `"sequential"` (default) — tasks are run one at a time in order; the next task starts only
  after the previous finishes.
- `"parallel"` — all tasks in the queue are launched simultaneously.

Individual compound tasks retain their own execution type once set, overriding this default.

**`workspaceTasks.compoundTasks.includeVsCodeCompoundTasks`**
When `true`, compound tasks defined natively in a workspace's `tasks.json` file using `"dependsOn"`
are surfaced in the Compound Tasks group alongside extension-managed queues. Set to `false` if
you want to hide VS Code built-in compound tasks from the tree.

**Feature links:**
- [Compound Tasks / Queues](../../features/compound-tasks.md) — complete guide to creating and
  managing compound task queues.
- [Task Queues](../../features/task-queues.md)

---

### `docs/configuration/environment/index.md` (new)

**Title:** `🌐 Environment`
**Parent:** `⚙️ Configuration`

Landing page for the Environment group. Introduces the concept of tool-specific executable
paths and per-tool configuration. Lists the Application Paths sub-section.

---

### `docs/configuration/environment/application-paths/index.md` (new)

**Title:** `📂 Application Paths`
**Parent:** `🌐 Environment`
**Grand parent:** `⚙️ Configuration`

Introduction: The extension invokes external executables when running tasks. Each
`workspaceTasks.applicationPath.*` setting specifies where to find the executable for a
particular tool. The default is to use the tool name alone (relying on `PATH`). Override when
an executable is in a non-standard location.

Common behavior for all application path settings:

- `~/` is expanded to the user's home directory on all platforms.
- On Windows, if the value matches the bare tool name (e.g. `"ant"`), the appropriate extension
  (`.bat`, `.exe`, `.cmd`) is appended automatically.

Tools with extended configuration (multiple related settings) have dedicated sub-pages:
[Ant](ant.md), [Act / GitHub Actions](act.md), [CMake](cmake.md).

#### Simple application path settings (documented on this page)

These tools have only a single `applicationPath.*` setting each.

| Setting | Default | Task Type |
| --- | --- | --- |
| `workspaceTasks.applicationPath.cargo` | `"cargo"` | [Scripts / Cargo](../../../task-types/scripts.md) |
| `workspaceTasks.applicationPath.cargo-make` | `"cargo-make"` | — |
| `workspaceTasks.applicationPath.composer` | `"composer"` | [Package Managers](../../../task-types/package-managers.md) |
| `workspaceTasks.applicationPath.deno` | `"~/.deno/bin/deno"` | [Scripts](../../../task-types/scripts.md) |
| `workspaceTasks.applicationPath.gradle` | `"gradlew"` | — |
| `workspaceTasks.applicationPath.just` | `"just"` | — |
| `workspaceTasks.applicationPath.make` | `"make"` | — |
| `workspaceTasks.applicationPath.maven` | `"mvn"` | [Package Managers](../../../task-types/package-managers.md) |
| `workspaceTasks.applicationPath.msbuild` | `"msbuild"` | — |
| `workspaceTasks.applicationPath.pipenv` | `"pipenv"` | [Package Managers](../../../task-types/package-managers.md) |
| `workspaceTasks.applicationPath.poe` | `"poe"` | [Package Managers](../../../task-types/package-managers.md) |
| `workspaceTasks.applicationPath.poetry` | `"poetry"` | [Package Managers](../../../task-types/package-managers.md) |
| `workspaceTasks.applicationPath.rake` | `"rake"` | — |
| `workspaceTasks.applicationPath.ansicon` | `"ansicon.exe"` | — |

For each entry: a brief description of the tool, how the extension uses the path, and what
happens if the executable is not found (task type is disabled at runtime).

---

### `docs/configuration/environment/application-paths/ant.md` (new)

**Title:** `📂 Ant`
**Parent:** `📂 Application Paths`
**Grand parent:** `🌐 Environment`

#### Settings documented

| Setting | Type | Default |
| --- | --- | --- |
| `workspaceTasks.applicationPath.ant` | `string` | `"ant"` |
| `workspaceTasks.ant.ansicon.enabled` | `boolean` | `true` |

**`workspaceTasks.applicationPath.ant`**
Path to the Apache Ant executable. On Windows, if the value ends with `ant` (no extension),
`.bat` is appended automatically. `~/` is expanded to the home directory.

**`workspaceTasks.ant.ansicon.enabled`**
When `true`, Ant task output is passed through ANSICON to decode ANSI color escape codes in
the terminal on Windows. Requires a valid ANSICON binary at `workspaceTasks.applicationPath.ansicon`.
Has no effect on macOS/Linux where ANSI colors are natively supported.

**Feature links:** None — Ant does not have a standalone feature guide.

---

### `docs/configuration/environment/application-paths/act.md` (new)

**Title:** `📂 Act (GitHub Actions)`
**Parent:** `📂 Application Paths`
**Grand parent:** `🌐 Environment`

#### Settings documented

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `workspaceTasks.applicationPath.act` | `string` | `"act"` | `resource` |
| `workspaceTasks.act.envFile` | `string` | `""` | `resource` |
| `workspaceTasks.act.variablesFile` | `string` | `""` | `resource` |
| `workspaceTasks.act.variables` | `object` | `{}` | `resource` |
| `workspaceTasks.act.secretsFile` | `string` | `".secrets"` | `resource` |

**`workspaceTasks.applicationPath.act`**
Full path to the [Act](https://github.com/nektos/act) executable. Act runs GitHub Actions
workflows locally. On Windows, `.exe` is appended when not already present. `~/` is expanded.

**`workspaceTasks.act.envFile`**
Path to a `.env`-format file (`KEY=VALUE` per line) providing environment variables to Act.
Relative paths are resolved from the workspace root.
See the [Act env/secret file docs](https://nektosact.com/usage/index.html#envsecrets-files-structure).

**`workspaceTasks.act.variablesFile`**
Path to a file containing Act *variables* (distinct from secrets). Same `.env` format as the
env file. Relative paths resolved from the workspace root.

**`workspaceTasks.act.variables`**
Inline JSON object of string key/value pairs passed as Act variables. Takes precedence over
`variablesFile` when both are provided.

**`workspaceTasks.act.secretsFile`**
Path to the Act secrets file. Defaults to `.secrets` in the workspace root. Relative paths
resolved from the workspace root.

**Feature links:**
- [GitHub Actions task type](../../../task-types/github-actions.md)

---

### `docs/configuration/environment/application-paths/cmake.md` (new)

**Title:** `📂 CMake`
**Parent:** `📂 Application Paths`
**Grand parent:** `🌐 Environment`

#### Settings documented

| Setting | Type | Default | Scope |
| --- | --- | --- | --- |
| `workspaceTasks.applicationPath.cmake` | `string` | `"cmake"` | `resource` |
| `workspaceTasks.cmake.buildDirectory` | `string` | `"build"` | `resource` |
| `workspaceTasks.cmake.buildType` | `string` | `"Debug"` | `resource` |
| `workspaceTasks.cmake.generator` | `string` | `""` | `resource` |

**`workspaceTasks.applicationPath.cmake`**
Path to the `cmake` executable. Defaults to `cmake` on `PATH`.

**`workspaceTasks.cmake.buildDirectory`**
Directory where CMake places its build artefacts, relative to the workspace root. Passed as
`-B <value>` when invoking cmake. Change this if your project uses a different build folder
convention (e.g. `"out"`, `"_build"`).

**`workspaceTasks.cmake.buildType`**
Passed as `-DCMAKE_BUILD_TYPE=<value>`. Options:

| Value | Description |
| --- | --- |
| `"Debug"` (default) | Full debug symbols, no optimisation |
| `"Release"` | Maximum optimisation, no debug symbols |
| `"RelWithDebInfo"` | Optimisation with debug symbols |
| `"MinSizeRel"` | Smallest binary size |

**`workspaceTasks.cmake.generator`**
Optional CMake generator string passed as `-G "<value>"`. Leave empty to use CMake's platform
default (e.g. `"Unix Makefiles"` on Linux/macOS, `"Visual Studio"` on Windows). Common values:
`"Ninja"`, `"Unix Makefiles"`, `"NMake Makefiles"`.

**Feature links:**
- [CMake task type](../../../task-types/cmake.md)

---

## Files to Change

### Modified files

| File | Change |
| --- | --- |
| `package.json` | ~~Convert `"configuration"` from `{}` to `[]`; distribute all settings across 4 named section objects; remove root `"type": "object"` and `"title"`~~ ✅ Done (Tasks 1–5). **Pending:** split old Group 4 into Task Execution (5 settings) and Environment (25 settings); move `presentationOptions` from Display to Task Execution; move `recentTasks.maxItems` from Task Execution to Display |
| `package.nls.json` | ~~Add four NLS section-title keys~~ ✅ Done. **Pending:** update `config.group.execution.title` value to `"Task Execution"`; add `config.group.environment.title` = `"Environment"` |
| `docs/configuration/index.md` | Replace flat section table with 5-group overview linking to group landing pages |

### New documentation files

| File | Content Summary |
| --- | --- |
| `docs/configuration/general/index.md` | General group landing page |
| `docs/configuration/general/debugging.md` | `workspaceTasks.debug` |
| `docs/configuration/general/metrics.md` | `workspaceTasks.metrics.*` |
| `docs/configuration/task-discovery/index.md` | Task Discovery group landing page |
| `docs/configuration/task-discovery/general.md` | `exclude`, `fetchDepth` |
| `docs/configuration/task-discovery/discovery.md` | `enabledTaskTypes`, shell settings |
| `docs/configuration/display-interaction/index.md` | Display & Interaction group landing page |
| `docs/configuration/display-interaction/grouping.md` | `groups.*` settings |
| `docs/configuration/display-interaction/tasks.md` | task action, icon, click, status, `recentTasks.maxItems` |
| `docs/configuration/task-execution/index.md` | Task Execution group landing page |
| `docs/configuration/task-execution/tasks.md` | stop behavior, `presentationOptions` |
| `docs/configuration/task-execution/compound-tasks.md` | `compoundTasks.*` settings |
| `docs/configuration/environment/index.md` | Environment group landing page |
| `docs/configuration/environment/application-paths/index.md` | All simple `applicationPath.*` + intro |
| `docs/configuration/environment/application-paths/ant.md` | `applicationPath.ant`, `ant.ansicon.enabled` |
| `docs/configuration/environment/application-paths/act.md` | `applicationPath.act`, `act.*` |
| `docs/configuration/environment/application-paths/cmake.md` | `applicationPath.cmake`, `cmake.*` |

### Retired / replaced files

These existing flat docs pages are superseded by the new hierarchy. Migrate their content into
the designated replacement pages, then add a deprecation redirect notice to each old file:

| Old file | Replaced by |
| --- | --- |
| `docs/configuration/general.md` | `task-discovery/general.md` + `task-execution/tasks.md` |
| `docs/configuration/metrics.md` | `general/metrics.md` |
| `docs/configuration/task-display.md` | `display-interaction/tasks.md` |
| `docs/configuration/task-grouping.md` | `display-interaction/grouping.md` |
| `docs/configuration/task-icon.md` | `display-interaction/tasks.md` |
| `docs/configuration/task-action.md` | `display-interaction/tasks.md` |
| `docs/configuration/task-presentation.md` | `task-execution/tasks.md` |
| `docs/configuration/task-type.md` | `task-discovery/discovery.md` |
| `docs/configuration/shell-script.md` | `task-discovery/discovery.md` |
| `docs/configuration/application-path.md` | `environment/application-paths/index.md` |
| `docs/configuration/github-actions.md` | `environment/application-paths/act.md` |
| `docs/configuration/ant.md` | `environment/application-paths/ant.md` |

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Settings accidentally omitted from any group | Low | Property-count check before and after editing (steps 1 & 3) |
| Old root `"type"/"title"` fields left on the array form | Low | Explicit checklist item in step 2 |
| NLS key missing causes `%…%` token visible in the Settings UI | Medium | Step 5: verify every `%config.group.*.title%` token has a matching key |
| Broken inbound links to old flat doc pages | Medium | Leave each retired page with a deprecation notice and link to its replacement |
| just-the-docs `grand_parent:` requires exact title string match | Medium | Copy the literal `title:` value from each parent's front matter when writing `grand_parent:` |

---

## Out of Scope

- Renaming, deprecating, or adding settings.
- Runtime TypeScript code changes.
- Changes to the CHANGELOG (auto-generated).
- Per-section JSON Schema validation beyond what already exists.

---

## Implementation Tasks

### Completed (Tasks 1–5)

1. ✅ **Verified property count before editing** — 53 properties confirmed.
2. ✅ **Edited `package.json`** — converted to 4-group array; root `"type"`/`"title"` removed.
3. ✅ **Verified property count after** — 4 + 6 + 13 + 30 = 53 ✓
4. ✅ **Edited `package.nls.json`** — added `config.group.general.title`, `config.group.discovery.title`, `config.group.display.title`, `config.group.execution.title` (value: `"Task Execution & Environment"`).
5. ✅ **Verified NLS coverage** — all four tokens resolve correctly.

---

### New Tasks (6–11) — 5-Group Split

6. **Re-verify property count** (should still be 53).

   ```sh
   python3 -c "import json; p=json.load(open('package.json')); \
     t=sum(len(s['properties']) for s in p['contributes']['configuration']); print(t)"
   ```

7. **Update `package.json`** — restructure from 4 groups to 5:
   - Split the existing `config.group.execution.title` group into:
     - **Task Execution** (`task.stopGracefulDelayMilliseconds`, `task.stopCompoundDependencies`, `compoundTasks.defaultExecutionType`, `compoundTasks.includeVsCodeCompoundTasks`, `task.presentationOptions`)
     - **Environment** (all remaining: `applicationPath.*`, `ant.*`, `act.*`, `cmake.*`)
   - Move `task.presentationOptions` **from** Display & Interaction **to** Task Execution.
   - Move `recentTasks.maxItems` **from** Task Execution **to** Display & Interaction.

8. **Re-verify property count after** — must still equal 53.

   ```sh
   python3 -c "import json; p=json.load(open('package.json')); \
     t=sum(len(s['properties']) for s in p['contributes']['configuration']); print(t)"
   ```

9. **Update `package.nls.json`**:
   - Change value of `config.group.execution.title` from `"Task Execution & Environment"` to `"Task Execution"`.
   - Add `"config.group.environment.title": "Environment"`.

10. **Verify NLS coverage** — all five `%config.group.*.title%` tokens must resolve.

11. **Create the new documentation files** per the structure table above. Populate each page with
    the full setting documentation, feature links, and example JSON as specified in the Page
    Specifications section.

12. **Update `docs/configuration/index.md`** — replace the flat section table with the new
    five-group overview.

13. **Add deprecation notices to retired flat pages** pointing to their replacement page.

14. **Run tests**

    ```sh
    npm test
    ```

    All tests must pass. Failures here indicate a malformed `package.json`.

15. **Manual UI verification** — open VS Code Settings (`Ctrl+,`), search `workspaceTasks`.
    Confirm all five section headers are visible and each setting appears under its correct group.

16. **Update `README.md`** — brief note that settings are now grouped into five categories with
    a link to the configuration docs.

---

## Rubber Duck Review

A sub-agent critique was commissioned on an earlier version of this plan. The plan has since
been revised significantly in response to both that critique and additional reviewer direction:

| Finding | Resolution |
| --- | --- |
| Group 1 (General) had only one setting | Metrics settings folded into General — group is now substantive |
| History & Metrics warranted its own group | Reviewer decision: folded into General; separate group removed → 4 groups total |
| Group 4 too large; shell config mixed with execution | Shell settings (`shellEnabledTaskTypes`, `shellPaths`, `shellAdditionalExtensions`) moved to Task Discovery |
| Documentation strategy lacked cross-references | Each page specification now lists explicit feature doc links |
| "Task Execution & Runners" title vague | Renamed to "Task Execution & Environment" |
| Missing implementation verification | Property-count verification added as steps 1 and 3 |
| Documentation needed richer content and hierarchy | Full page specifications added for every new doc file; the flat layout is replaced by a four-level hierarchy matching the Settings UI groups |
