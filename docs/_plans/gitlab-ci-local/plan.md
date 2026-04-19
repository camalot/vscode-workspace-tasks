# Plan: GitLab CI Local (`gitlab-ci-local`) Task Type

## TL;DR

Add `gitlab-ci` as a new task type backed by the [`gitlab-ci-local`](https://github.com/firecow/gitlab-ci-local)
CLI, which runs GitLab CI jobs locally using Docker or shell executors. The extension discovers
`.gitlab-ci.yml` files in the workspace, lists jobs via `gitlab-ci-local --file <path> --list-json`,
and surfaces each job as a runnable `TaskItem` child under a collapsible per-file parent. A set of
configuration settings maps the most useful `gitlab-ci-local` flags to VS Code settings.

---

## Self-Critique & Viability Assessment (post-review)

**Strengths:**

- `gitlab-ci-local --list-json` is purpose-built machine-readable output — same reliable pattern as
  `task --list-all --json` used by the Taskfile provider. No YAML parsing required for discovery.
- Job names from `--list-json` are already fully-resolved (includes, extends) by the CLI itself.
- The existing sample at `sample/sample-workspace-tasks/gitlab/.gitlab-ci.yml` covers all four
  pipeline stages, giving a real-world test fixture out of the box.
- Configuration flags (`--variables-file`, `--variable`, etc.) are a clean extension point for
  the most common local-CI customization needs.

**Risks / Weaknesses (raised in critique — addressed below):**

- **Docker at execution time**: `--list-json` does not require Docker; job execution does. This must
  be documented prominently.
- **Remote `include:` directives**: If the `.gitlab-ci.yml` uses remote includes, discovery can be
  slow or fail without network. Documents must warn; timeout should be configurable.
- **Windows support**: `gitlab-ci-local` is not a Windows-native tool. Remove
  `windowsExecutableExtension` / `windowsEnforceExtension` from `getCommand` options and document
  Linux/macOS support only.
- **`when: never` jobs**: These intentionally-disabled jobs should be filtered from the tree to
  avoid confusing users. A `showNeverJobs` toggle can be added later.
- **Multi-root ambiguity**: Parent items must show their relative path as `description` so
  duplicate `.gitlab-ci.yml` labels are disambiguated.

**Verdict:** Straightforward addition following proven patterns. All identified risks have clear
mitigations built into this plan.

---

## Requirements

- Discover all `.gitlab-ci.yml` files in the workspace (excluding `node_modules`, `.git`, etc.).
- Parse job metadata from `gitlab-ci-local --file <path> --list-json`.
- Surface each file as a collapsible tree group; each job as a runnable child item.
- Filter out jobs with `when: never` (they are intentionally disabled in the pipeline).
- Visually distinguish `when: manual` jobs in their tooltip.
- Execute jobs via `gitlab-ci-local --file <path> [config-flags] <jobName> [extra-args]`.
- Always pass `--file` so the correct `.gitlab-ci.yml` is used regardless of cwd.
- Provide configurable settings for `--variables-file`, `--variable`, `--unset-variable`,
  `--remote-variables`, and `--home`.
- Allow users to specify additional glob patterns (`workspaceTasks.gitlabCiLocal.additionalFilePatterns`) that
  are combined with `GLOB_GITLAB_CI` during file discovery, enabling non-default CI file names.
- Enable the type **disabled by default** (`"gitlab-ci": false`) — requires Docker and an external tool.
- Add `gitlab-ci` to `KNOWN_TASK_TYPES` in `taskFactory.ts`.
- Add `'gitlab-ci'` entry in the `enabledTaskTypes` schema in `package.json`.
- Provide full documentation in `docs/task-types/gitlab-ci.md` and an application-path page.
- Achieve 100% test coverage for all new code.

---

## Key Design Decisions

### CLI-Based Discovery

`gitlab-ci-local --file <path> --list-json` returns a fully-resolved flat JSON array of job
objects, including jobs from `include:` and `extends:` resolved by the CLI. This is identical in
principle to how the Taskfile provider uses `task --list-all --json`.

**JSON shape returned by `--list-json`:**

```json
[
  {
    "name": "npm-install",
    "description": "Install npm packages",
    "stage": "build",
    "when": "on_success",
    "allow_failure": false,
    "needs": []
  },
  {
    "name": "docker-compose-down",
    "description": "Down docker-compose services",
    "stage": ".post",
    "when": "manual",
    "allow_failure": false,
    "rules": [{ "if": "$GITLAB_CI == 'false'", "when": "manual" }]
  }
]
```

### Type Name: `gitlab-ci`

Matches the canonical file name (`.gitlab-ci.yml`), is short, and follows the pattern of other
hyphenated types (`cargo-make`, `github-actions`).

### Glob Pattern

```
GLOB_GITLAB_CI: '**/.gitlab-ci.yml'
```

Only the default GitLab CI filename is matched by `GLOB_GITLAB_CI`. However, many projects use
custom file names (e.g., `.gitlab-ci-staging.yml`, `ci/build.yml`) configured in GitLab project
settings. The `workspaceTasks.gitlabCiLocal.additionalFilePatterns` setting lets users supply
extra globs that are **merged** with `GLOB_GITLAB_CI` at discovery time:

```typescript
// Provider getTasks() — effective glob list:
const extraPatterns = TaskConfigService.getInstance()
  .get<string[]>('gitlabCiLocal.additionalFilePatterns', []);
const globs = [constants.GLOB_GITLAB_CI, ...extraPatterns];
const files = await TaskFilesService.getInstance().findFiles(globs);
```

Duplicate files (same URI) are deduplicated before processing. The base glob is always included
and cannot be overridden or removed.

### Tree Structure

```
gitlab-ci    ← group header (task type)
└── .gitlab-ci.yml  (sample/sample-workspace-tasks/gitlab/.gitlab-ci.yml)   ← parent, collapsible
    ├── npm-install          build         ← on_success
    ├── npm-outdated         test          ← on_success · allow_failure
    ├── docker-compose-up    deploy        ← on_success
    └── docker-compose-down  .post         ← manual
```

- **Parent item**: `vscode.TreeItemCollapsibleState.Collapsed`, label = `.gitlab-ci.yml`, description =
  `vscode.workspace.asRelativePath(fileUri)` (disambiguates in multi-root workspaces), no
  `onRunActionCommand` (parent is not directly executable).
- **Child items**: `vscode.TreeItemCollapsibleState.None`, label = job name, description = stage name,
  tooltip includes stage, when, allow_failure, needs, description.
- **`when: never` jobs**: filtered out from the tree (silently; not a warning).
- **`when: manual` jobs**: included in tree with `[manual]` noted in tooltip.

### `startLine` Handling

`--list-json` does not emit line numbers. All job items will have `startLine = 0`, pointing the
"Open File" action to the top of the YAML. This is clearly documented in the code comment and is
consistent with how `githubActionsTaskProvider.ts` falls back to line 0 when no source map is
available. A line-scanning enhancement (similar to `lines.findIndex(l => l.trim().startsWith(name + ':'))`)
is deferred as a future improvement.

### Windows Support

`gitlab-ci-local` is not available as a Windows-native executable. The `getCommand()` call will
**not** set `windowsExecutableExtension` or `windowsEnforceExtension`. If a user on Windows has
`gitlab-ci-local` available via WSL2 or a custom path, they can configure
`workspaceTasks.applicationPath.gitlabCiLocal` to point to it. Documentation will note
Linux/macOS as the primary supported environment.

### `when: never` Filtering

Jobs whose `when` field equals `'never'` are excluded during `parseOutput()`. These represent
intentionally-disabled pipeline jobs and would be misleading if surfaced as runnable tasks.

### Execution Argument Order

```
gitlab-ci-local --file <path> [--variables-file X] [--variable K=V ...] \
                [--unset-variable K ...] [--remote-variables URL ...] [--home H] \
                <jobName> [extra-user-args]
```

The job name comes **before** any user-supplied extra args (consistent with all other providers in
the codebase, e.g., Taskfile: `task <name> [args]`).

---

## Configuration Settings

All settings have `"scope": "resource"` so they can be overridden per workspace folder.
All `markdownDescription` values link to the generated documentation page.

| Key | Type | Default | CLI Flag | Description |
|-----|------|---------|----------|-------------|
| `workspaceTasks.applicationPath.gitlabCiLocal` | `string` | `"gitlab-ci-local"` | n/a | Path to the `gitlab-ci-local` executable |
| `workspaceTasks.gitlabCiLocal.additionalFilePatterns` | `string[]` | `[]` | n/a | Additional glob patterns merged with `GLOB_GITLAB_CI` for file discovery |
| `workspaceTasks.gitlabCiLocal.variablesFile` | `string` | `""` | `--variables-file` | Path to a local variables file (`.gitlab-ci-local-variables.yml`) |
| `workspaceTasks.gitlabCiLocal.variable` | `string[]` | `[]` | `--variable KEY=VALUE` | Inline variable overrides; each entry must be `KEY=VALUE` |
| `workspaceTasks.gitlabCiLocal.unsetVariable` | `string[]` | `[]` | `--unset-variable KEY` | Variable names to unset |
| `workspaceTasks.gitlabCiLocal.remoteVariables` | `string[]` | `[]` | `--remote-variables URL` | Remote variable file URLs |
| `workspaceTasks.gitlabCiLocal.home` | `string` | `""` | `--home` | Override `$HOME/.gitlab-ci-local/` location |

> **Note on `remoteVariables`**: The `gitlab-ci-local` CLI accepts multiple `--remote-variables`
> flags (one per invocation), so an array maps naturally.

---

## Files to Modify / Create

| File | Action | Description |
|------|--------|-------------|
| `src/providers/gitlabCiLocalTaskProvider.ts` | **Create** | New provider class |
| `src/providers/index.ts` | **Modify** | Import, add to `TaskProviderConstructor` union, register |
| `src/taskFactory.ts` | **Modify** | Add `'gitlab-ci'` to `KNOWN_TASK_TYPES`; add switch case |
| `src/libs/constants.ts` | **Modify** | Add `GLOB_GITLAB_CI` |
| `package.json` | **Modify** | `contributes.configuration`, `enabledTaskTypes` schema + default, `keywords` |
| `package.nls.json` | **Modify** | NLS strings for all new config keys |
| `src/test/suite/gitlabCiLocalTaskProvider.test.ts` | **Create** | Provider unit tests (100% coverage) |
| `src/test/suite/taskFactoryGitlabCi.test.ts` | **Create** | Task factory integration tests |
| `src/test/task-files/gitlab-ci/` | **Create** | JSON fixture files for unit tests |
| `res/icons/light/gitlab-ci.svg` | **Create** | Light theme icon (pipeline/stages motif) |
| `res/icons/dark/gitlab-ci.svg` | **Create** | Dark theme icon |
| `res/icons/light/gitlab-ci.png` | **Create** | Light PNG (generated via `scripts/svg-convert.ps1`) |
| `res/icons/dark/gitlab-ci.png` | **Create** | Dark PNG |
| `docs/task-types/gitlab-ci.md` | **Create** | Task type user-facing documentation |
| `docs/configuration/environment/application-paths/gitlab-ci-local.md` | **Create** | App-path config docs |
| `sample/sample-workspace-tasks/gitlab/.gitlab-ci.yml` | **Modify** | Expand sample to cover all `when` values |
| `README.md` | **Modify** | Add `gitlab-ci-local` to the supported task types list |

---

## Provider Implementation

### `src/providers/gitlabCiTaskProvider.ts`

```typescript
interface GitlabCiJobEntry {
  name: string;
  description?: string;
  stage: string;
  when: string;                   // 'on_success' | 'on_failure' | 'always' | 'manual' | 'never'
  allow_failure: boolean;
  needs?: Array<{ job: string; artifacts: boolean; optional: boolean }>;
  rules?: Array<{ if?: string; when?: string }>;
}

export class GitlabCiTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('gitlab-ci', constants.GLOB_GITLAB_CI);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    // configKey: 'applicationPath.gitlabCiLocal'
    // defaultValue: 'gitlab-ci-local'
    // NO windowsExecutableExtension — not a Windows-native tool
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) { return []; }
    const extraPatterns = TaskConfigService.getInstance()
      .get<string[]>('gitlabCiLocal.additionalFilePatterns', []);
    const globs = [constants.GLOB_GITLAB_CI, ...extraPatterns];
    // findFiles returns deduplicated URIs; no extra dedup needed here.
    const files = await TaskFilesService.getInstance().findFiles(globs);
    const results = await Promise.all(files.map(f => this._loadJobsFromFile(f)));
    return results.flat();
  }

  private async _loadJobsFromFile(file: vscode.Uri): Promise<TaskItem[]> {
    const { command, args: providerArgs } = this.getCommand(file);
    const cmdArgs = [...(providerArgs ?? []), '--file', file.fsPath, '--list-json'];
    const cwd = path.dirname(file.fsPath);

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd, timeout: 15000 });
      return this.parseOutput(stdout, file);
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[gitlab-ci] Failed to list jobs in ${file.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Parses the JSON array output of `gitlab-ci-local --list-json`.
   * Extracted as public for direct unit testing without spawning a process.
   */
  public parseOutput(stdout: string, fileUri: vscode.Uri, iconService?: TaskIconService): TaskItem[] {
    let entries: GitlabCiJobEntry[];
    try {
      entries = JSON.parse(stdout) as GitlabCiJobEntry[];
    } catch (parseErr) {
      LoggerService.getInstance().warn(`[gitlab-ci] JSON parse error for ${fileUri.fsPath}: ...`);
      return [];
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const iconPath = svc.getTaskIcon('gitlab-ci', fileUri);

    // Parent item (file-level, collapsible, not directly runnable)
    const parentItem = new TaskItem(
      path.basename(fileUri.fsPath),        // '.gitlab-ci.yml'
      vscode.TreeItemCollapsibleState.Collapsed,
      'gitlab-ci',
      fileUri,
      undefined,                            // no run command on parent
      iconPath,
    );
    parentItem.description = vscode.workspace.asRelativePath(fileUri);
    parentItem.taskFileUri = fileUri;
    parentItem.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    parentItem.children = [];

    for (const entry of entries) {
      // Filter intentionally-disabled jobs
      if (entry.when === 'never') {
        continue;
      }

      const tooltipParts = [
        entry.description ?? entry.name,
        `Stage: ${entry.stage}`,
        `When: ${entry.when}`,
        entry.allow_failure ? 'Allow failure: yes' : undefined,
        entry.needs && entry.needs.length > 0
          ? `Needs: ${entry.needs.map(n => n.job).join(', ')}`
          : undefined,
      ].filter(Boolean);

      const jobItem = new TaskItem(
        entry.name,
        vscode.TreeItemCollapsibleState.None,
        'gitlab-ci',
        fileUri,
        undefined,
        iconPath,
      );
      jobItem.taskFileUri = fileUri;           // required for factory cwd resolution
      jobItem.description = entry.stage;
      jobItem.tooltip = tooltipParts.join('\n');
      jobItem.startLine = 0;                   // --list-json has no line info
      jobItem.metadata = {
        stage: entry.stage,
        when: entry.when,
        allowFailure: entry.allow_failure,
        needs: entry.needs ?? [],
        rules: entry.rules ?? [],
      };
      jobItem.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, 0],
      };
      parentItem.children.push(jobItem);
    }

    // Only add parent if it has runnable children
    if (parentItem.children.length === 0) {
      return [];
    }
    return [parentItem];
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }
}
```

---

## Task Factory Changes

### `src/taskFactory.ts`

**1. Add to `KNOWN_TASK_TYPES`:**

```typescript
export const KNOWN_TASK_TYPES: ReadonlySet<string> = new Set([
  // ... existing types ...
  'gitlab-ci',
]);
```

**2. Add import:**

```typescript
import { GitlabCiTaskProvider } from './providers/gitlabCiTaskProvider';
```

**3. Add switch case (inside `_buildTask`):**

```typescript
case 'gitlab-ci': {
  const ciProvider = new GitlabCiTaskProvider();
  const { command: ciCmd, args: providerArgs } = ciProvider.getCommand(resourceUri);
  const ciArgs = [...(providerArgs ?? [])];

  // --file is always required; use the resolved file URI
  ciArgs.push('--file', effectiveResourceUri.fsPath);

  // Configuration-driven flags — use vscode.workspace.getConfiguration pattern
  const ciConfig = vscode.workspace.getConfiguration('workspaceTasks');

  const variablesFile = ciConfig.get<string>('gitlabCiLocal.variablesFile', '');
  if (variablesFile) {
    ciArgs.push('--variables-file', variablesFile);
  }

  const variables = ciConfig.get<string[]>('gitlabCiLocal.variable', []);
  for (const v of variables) {
    ciArgs.push('--variable', v);
  }

  const unsetVars = ciConfig.get<string[]>('gitlabCiLocal.unsetVariable', []);
  for (const u of unsetVars) {
    ciArgs.push('--unset-variable', u);
  }

  const remoteVars = ciConfig.get<string[]>('gitlabCiLocal.remoteVariables', []);
  for (const r of remoteVars) {
    ciArgs.push('--remote-variables', r);
  }

  const home = ciConfig.get<string>('gitlabCiLocal.home', '');
  if (home) {
    ciArgs.push('--home', home);
  }

  // Job name before optional user args
  ciArgs.push(taskLabel);
  if (args) {
    ciArgs.push(...args.split(' '));
  }

  const fullCommand = `${ciCmd} ${ciArgs.join(' ')}`;
  const shellExec = new vscode.ShellExecution(ciCmd, ciArgs, { cwd });
  const task = new vscode.Task(
    { type: 'gitlab-ci', job: taskLabel, path: resourceUri.fsPath },
    vscode.TaskScope.Workspace,
    taskLabel,
    'gitlab-ci',
    shellExec,
  );
  return { task, command: fullCommand, cwd, native: false };
}
```

---

## `package.json` Changes

### `contributes.configuration` — new configuration group (or added to Application Paths group):

```jsonc
// In the applicationPath configuration group:
"workspaceTasks.applicationPath.gitlabCiLocal": {
  "type": "string",
  "default": "gitlab-ci-local",
  "scope": "resource",
  "description": "%config.workspaceTasks.applicationPath.gitlabCiLocal%",
  "markdownDescription": "%config.workspaceTasks.applicationPath.gitlabCiLocal.markdown%"
}

// New gitlabCiLocal configuration group:
{
  "title": "%config.group.gitlabCiLocal.title%",
  "properties": {
    "workspaceTasks.gitlabCiLocal.additionalFilePatterns": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.additionalFilePatterns%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.additionalFilePatterns.markdown%"
    },
    "workspaceTasks.gitlabCiLocal.variablesFile": {
      "type": "string",
      "default": "",
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.variablesFile%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.variablesFile.markdown%"
    },
    "workspaceTasks.gitlabCiLocal.variable": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.variable%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.variable.markdown%"
    },
    "workspaceTasks.gitlabCiLocal.unsetVariable": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.unsetVariable%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.unsetVariable.markdown%"
    },
    "workspaceTasks.gitlabCiLocal.remoteVariables": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.remoteVariables%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.remoteVariables.markdown%"
    },
    "workspaceTasks.gitlabCiLocal.home": {
      "type": "string",
      "default": "",
      "scope": "resource",
      "description": "%config.workspaceTasks.gitlabCiLocal.home%",
      "markdownDescription": "%config.workspaceTasks.gitlabCiLocal.home.markdown%"
    }
  }
}
```

### `enabledTaskTypes` — schema property + default:

```jsonc
// In schema "properties":
"gitlab-ci": {
  "type": "boolean",
  "description": "%config.workspaceTasks.enabledTaskTypes.gitlab-ci%"
}

// In "default":
"gitlab-ci": false
```

### `keywords`:
Add `"gitlab"`, `"gitlab-ci"`, `"gitlab-ci-local"`.

---

## `package.nls.json` Strings

```jsonc
"config.workspaceTasks.applicationPath.gitlabCiLocal": "Path to gitlab-ci-local executable",
"config.workspaceTasks.applicationPath.gitlabCiLocal.markdown": "Path to the [gitlab-ci-local](https://github.com/firecow/gitlab-ci-local) executable. Runs GitLab CI jobs locally. On all platforms, `~/` is expanded to the user's home directory. [Read More](https://camalot.github.io/vscode-workspace-tasks/configuration/environment/application-paths/gitlab-ci-local.html)",
"config.group.gitlabCiLocal.title": "GitLab CI Local",
"config.workspaceTasks.gitlabCiLocal.additionalFilePatterns": "Additional file glob patterns for GitLab CI discovery",
"config.workspaceTasks.gitlabCiLocal.additionalFilePatterns.markdown": "Additional glob patterns (e.g. `**/ci/*.yml`, `**/.gitlab-ci-staging.yml`) merged with the built-in `**/.gitlab-ci.yml` pattern during task discovery. Useful for projects that use non-default GitLab CI file names. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.gitlabCiLocal.variablesFile": "gitlab-ci-local variables file path",
"config.workspaceTasks.gitlabCiLocal.variablesFile.markdown": "Path to a local variables file passed to `gitlab-ci-local` as `--variables-file`. Defaults to `.gitlab-ci-local-variables.yml` if not set. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.gitlabCiLocal.variable": "Inline variable overrides for gitlab-ci-local",
"config.workspaceTasks.gitlabCiLocal.variable.markdown": "Additional variables passed to `gitlab-ci-local` as `--variable KEY=VALUE`. Each array entry must be in `KEY=VALUE` format. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.gitlabCiLocal.unsetVariable": "Variables to unset for gitlab-ci-local",
"config.workspaceTasks.gitlabCiLocal.unsetVariable.markdown": "Variable names to unset, passed as `--unset-variable KEY`. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.gitlabCiLocal.remoteVariables": "Remote variable file URLs for gitlab-ci-local",
"config.workspaceTasks.gitlabCiLocal.remoteVariables.markdown": "Remote variable file URLs passed as `--remote-variables URL`. Each array entry is a separate `--remote-variables` flag. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.gitlabCiLocal.home": "Override HOME directory for gitlab-ci-local",
"config.workspaceTasks.gitlabCiLocal.home.markdown": "Overrides the `$HOME/.gitlab-ci-local/` location passed as `--home`. Supports `~/` expansion. [Read More](https://camalot.github.io/vscode-workspace-tasks/task-types/gitlab-ci.html#configuration)",
"config.workspaceTasks.enabledTaskTypes.gitlab-ci": "Enable GitLab CI Local task discovery"
```

---

## Test Strategy (100% Coverage)

### Test Fixture Files (`src/test/task-files/gitlab-ci/`)

- **`valid-jobs.json`** — Array with `on_success`, `on_failure`, `always`, `manual`, `never` jobs,
  plus one job with `allow_failure: true` and a nested `needs` array.
- **`empty-array.json`** — `[]`
- **`invalid.json`** — `{ not: "an array" }` (triggers parse-error path)
- **`only-never-jobs.json`** — All jobs have `when: never` (parent should not be returned)
- **`special-chars-job.json`** — Jobs named `test:unit`, `build:staging` (colons, common in GitLab CI)

### `src/test/suite/gitlabCiTaskProvider.test.ts`

**Provider basics:**
- [ ] `provider.type` === `'gitlab-ci'`
- [ ] `provider.filePattern` === `constants.GLOB_GITLAB_CI`
- [ ] `getCommand()` returns `'gitlab-ci-local'` as default command
- [ ] `getCommand()` returns configured path when `workspaceTasks.applicationPath.gitlabCiLocal` is set
- [ ] `getSystemTasks()` returns `[]`

**`getTasks()`:**
- [ ] Returns `[]` when provider is disabled
- [ ] Returns `[]` when no files found
- [ ] Returns parsed parent items for valid files
- [ ] Returns `[]` when CLI invocation fails (error logged as warn)
- [ ] Processes multiple `.gitlab-ci.yml` files (multi-root / monorepo scenario)
- [ ] Merges `additionalFilePatterns` with base glob when configured — discovers extra files
- [ ] Discovers files matching only an additional pattern (no `.gitlab-ci.yml` present)
- [ ] Returns `[]` when both base glob and additional patterns yield no files
- [ ] When `additionalFilePatterns` is empty, behavior is identical to base-glob-only discovery

**`parseOutput()` — job parsing:**
- [ ] Jobs with `when: on_success` → included in children
- [ ] Jobs with `when: manual` → included; tooltip contains `When: manual`
- [ ] Jobs with `when: always` → included
- [ ] Jobs with `when: on_failure` → included
- [ ] Jobs with `when: never` → **filtered out**
- [ ] Jobs with `allow_failure: true` → tooltip contains `Allow failure: yes`
- [ ] Jobs with `needs` array → tooltip contains needs job names
- [ ] Jobs with empty `needs` → no needs line in tooltip
- [ ] Jobs with missing `description` → falls back to job name in tooltip
- [ ] Jobs with names containing colons (e.g., `test:unit`) → label set correctly

**`parseOutput()` — structural validation:**
- [ ] Parent item has `vscode.TreeItemCollapsibleState.Collapsed`
- [ ] Child items have `vscode.TreeItemCollapsibleState.None`
- [ ] Parent item has no `onRunActionCommand` (not directly executable)
- [ ] Child items have `taskFileUri` set to the `.gitlab-ci.yml` URI
- [ ] Parent `description` = `vscode.workspace.asRelativePath(fileUri)`
- [ ] Child `description` = stage name

**`parseOutput()` — error paths:**
- [ ] Invalid JSON → returns `[]`, logs warning
- [ ] Empty array → returns `[]`
- [ ] All jobs are `when: never` → returns `[]` (no parent emitted)
- [ ] Missing optional fields (`description`, `needs`) → defaults applied, no crash

### `src/test/suite/taskFactoryGitlabCi.test.ts`

- [ ] `'gitlab-ci'` is present in `KNOWN_TASK_TYPES`
- [ ] `createTaskForItem(item)` produces task with `definition.type === 'gitlab-ci'`
- [ ] `task.name` matches job name
- [ ] `--file <path>` is always present in args
- [ ] `cwd` is set to the directory of the `.gitlab-ci.yml` file
- [ ] `--variables-file X` is added when `gitlabCiLocal.variablesFile` is set
- [ ] `--variables-file` is **not** added when value is empty string
- [ ] `--variable KEY=VAL` is added once per entry in `gitlabCiLocal.variable`
- [ ] `--unset-variable KEY` is added once per entry in `gitlabCiLocal.unsetVariable`
- [ ] `--remote-variables URL` is added once per entry in `gitlabCiLocal.remoteVariables`
- [ ] `--home H` is added when `gitlabCiLocal.home` is set
- [ ] `--home` is **not** added when value is empty string
- [ ] Job name appears **before** extra args when `args` string is provided
- [ ] `item.taskFileUri` falling back to `item.resourceUri` → `--file` still correct
- [ ] `CreatedTask.command` string is well-formed (all args joined)
- [ ] Empty config arrays → those flags are absent from command

---

## Icon Strategy

- **No `$(gitlab)` Codicon** exists in VS Code's built-in Codicon set. Do not use it.
- **Trademark**: The GitLab tanuki (fox) logo is trademarked. Do not use it.
- **Recommended design**: A simple pipeline diagram icon (three connected boxes representing
  CI stages) in SVG, saved as `gitlab-ci.svg`.
- **Required files** (4 total — matches all other task types):
  - `res/icons/light/gitlab-ci.svg`
  - `res/icons/dark/gitlab-ci.svg`
  - `res/icons/light/gitlab-ci.png` (generated from SVG via `scripts/svg-convert.ps1`)
  - `res/icons/dark/gitlab-ci.png`
- `TaskIconService.getTaskIcon('gitlab-ci')` will resolve to these files automatically since the
  type name matches the file stem.

---

## Documentation Plan

### `docs/task-types/gitlab-ci.md`

Sections:
1. Overview — what gitlab-ci-local is and why it's useful
2. Requirements — `gitlab-ci-local` installed; **Docker must be running for job execution**;
   minimum `gitlab-ci-local` version that supports `--list-json`
3. Task Tree Structure — ASCII diagram matching the design above
4. Features — discovery, stage labels, manual job indication in tooltip, needs metadata
5. Limitations — `when: never` filtered; non-default CI file names require `additionalFilePatterns`;
   remote `include:` may cause slow/failed discovery without network; line numbers always point
   to top of file; Windows not natively supported
6. Configuration — table of all seven settings with examples, including `additionalFilePatterns`
   with a worked example showing a project-specific staging CI file
7. Installation — brief `npm install -g gitlab-ci-local` + link to upstream docs

### `docs/configuration/environment/application-paths/gitlab-ci-local.md`

- `workspaceTasks.applicationPath.gitlabCiLocal` — type, default, scope, example

### `docs/task-types/index.md` (or task type comparison page)

- Add `gitlab-ci` row to any existing comparison/overview table.

---

## Sample File Update (`sample/sample-workspace-tasks/gitlab/.gitlab-ci.yml`)

Add jobs covering all `when` values to improve test-via-sample coverage and serve as a
demonstration of all scenarios:

```yaml
# @Description Always runs (cleanup)
always-cleanup:
  stage: .post
  when: always
  script:
    - echo "always cleanup"

# @Description Only on failure
notify-failure:
  stage: .post
  when: on_failure
  allow_failure: true
  script:
    - echo "notifying failure"

# @Description This job is intentionally disabled (when: never)
skip-me:
  stage: build
  when: never
  script:
    - echo "this should not appear in the tree"
```

> The existing `npm-install`, `npm-outdated`, `docker-compose-up`, and `docker-compose-down` jobs
> cover `on_success`, `allow_failure`, and `manual` scenarios and need no changes.

---

## Implementation Order

1. **Constants** — Add `GLOB_GITLAB_CI` to `src/libs/constants.ts`
2. **Provider** — Implement `src/providers/gitlabCiTaskProvider.ts`
3. **Provider registration** — Update `src/providers/index.ts`
4. **Task factory** — Update `KNOWN_TASK_TYPES` and add switch case in `src/taskFactory.ts`
5. **package.json** — Add configuration, enabledTaskTypes entry, keywords
6. **package.nls.json** — Add NLS strings
7. **Tests** — Write `gitlabCiTaskProvider.test.ts` and `taskFactoryGitlabCi.test.ts`
8. **Icons** — Create SVG files; generate PNGs
9. **Sample** — Expand `.gitlab-ci.yml` with additional `when` scenarios
10. **Documentation** — Create `docs/task-types/gitlab-ci.md` and application-path page; update
    task-types index; update `README.md`
11. **Run tests** — `npm test`; verify coverage ≥ 100% for new files

---

## Open Questions / Deferred Work

| Item | Deferred Reason |
|------|----------------|
| Line number resolution for "Open File" action | `--list-json` provides no line info; YAML scan heuristic is fragile for complex includes. Low value. |
| `additionalFilePatterns` config for custom CI file names | **Promoted to this plan** — now implemented as `workspaceTasks.gitlabCiLocal.additionalFilePatterns`. |
| `--pull-policy` / `--privileged` / `--network` settings | High-specificity Docker flags; add in follow-up based on user demand. |
| `when: never` toggle to show hidden jobs | No immediate user demand; add `workspaceTasks.gitlabCiLocal.showNeverJobs` setting in follow-up. |
| Stage-based sub-grouping | Adds tree depth without clear UX benefit; flat list per file is simpler. |
| Windows WSL2 path support | Requires cross-shell execution path that other Linux-only tools also lack. Defer. |
