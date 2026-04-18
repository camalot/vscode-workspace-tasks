# Plan: Task (go-task) Support

## TL;DR

Add first-class support for [Task](https://taskfile.dev/) (`go-task/task`) — a fast, cross-platform
task runner that uses `Taskfile.yml` files — as a new task type (`task`) in the extension. Task
discovery uses the CLI's built-in `--list-all --json` output. The `task` executable path is
configurable via `workspaceTasks.applicationPath.taskfile`, consistent with every other configurable
runner in the extension.

---

## Requirements

- Discover tasks from all standard Taskfile filenames in the workspace.
- Parse task metadata (name, description, source file, line number) from the JSON output of
  `task --list-all --no-status --json`.
- Surface tasks under a new **task** group in the tree view.
- Execute tasks via `task <taskName> [args]`, using the workspace-folder cwd.
- Allow the `task` executable path to be overridden via
  `workspaceTasks.applicationPath.taskfile` (default: `task`).
- Enable the task type by default (`enabledTaskTypes.taskfile: true`).
- Provide a sample `Taskfile.yml` in `sample/sample-workspace-tasks/task/`.
- Provide full documentation in `docs/task-types/task.md`.
- Achieve ≥90% test coverage for all new code.

---

## Key Design Decisions

### Task Discovery Strategy

Task provides a purpose-built machine-readable output format via
`task --list-all --no-status --json`. The JSON schema is:

```json
{
  "tasks": [
    {
      "name": "build",
      "task": "build",
      "desc": "Build the application",
      "summary": "…",
      "up_to_date": false,
      "location": {
        "line": 12,
        "column": 3,
        "taskfile": "/absolute/path/to/Taskfile.yml"
      }
    }
  ],
  "location": "/absolute/path/to/Taskfile.yml"
}
```

**Why use the CLI instead of YAML parsing?**

Task supports includes, namespacing, templating, and remote Taskfiles. A static YAML parser cannot
reliably resolve the full task graph. The CLI always returns the correctly-resolved, flat list. This
is the same approach used by other providers (e.g. Deno's `deno task` discovery).

**Discovery flow:**

1. Use `vscode.workspace.findFiles(GLOB_TASKFILE)` to locate all Taskfiles.
2. For each unique _parent directory_ (a Taskfile must live at the workspace root or a subfolder
   root to be meaningful), run `task --list-all --no-status --json` in that directory using
   `child_process.execFile` via `util.promisify` (async/await).
3. Parse the JSON response and emit one `TaskItem` per task entry.
4. Use `location.taskfile` and `location.line` from the JSON to populate `taskFileUri` and
   `startLine` on the `TaskItem` so "Open File at Line" works.

**Deduplication:** Because multiple glob patterns can match the same parent directory (e.g. both
`Taskfile.yml` and `Taskfile.dist.yml` can coexist), directories are deduplicated before spawning
the CLI.

**Fallback (CLI unavailable):** If the `task` executable is not found, log a warning and fall
back to returning an empty task list. Do not attempt YAML parsing as a fallback — the CLI's
presence is required to correctly resolve includes and namespaced tasks.

### Task Execution

```
task [options] <taskName> [-- CLI_ARGS...]
```

The `cwd` is set to the directory containing the Taskfile (from `item.taskFileUri`'s parent). This
ensures that `task` resolves the correct Taskfile relative to its cwd, consistent with how the
CLI is designed to be invoked.

If extra args are provided (via Run with Args), they are appended after the task name (before `--`
is needed only when passing positional CLI args; for simplicity the extension appends args directly
after the task name without `--`).

### File Patterns (GLOB_TASKFILE)

```
{**/Taskfile.yml,**/taskfile.yml,**/Taskfile.yaml,**/taskfile.yaml,**/Taskfile.dist.yml,**/taskfile.dist.yml,**/Taskfile.dist.yaml,**/taskfile.dist.yaml}
```

**Not included:** `$HOME/{T,t}askfile.{yml,yaml}` (global Taskfiles). Global Taskfiles are outside
the workspace and not addressable by `findFiles`. Users who want global tasks can configure a
workspace-level include.

### applicationPath Setting

Follows the exact pattern of `workspaceTasks.applicationPath.just` and
`workspaceTasks.applicationPath.act`:

```json
"workspaceTasks.applicationPath.taskfile": {
  "type": "string",
  "default": "task",
  "description": "...",
  "markdownDescription": "...",
  "scope": "resource"
}
```

`ExecutableService.getCommand` handles `~/` expansion and `.exe` appending on Windows.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Using the CLI's `--json` output is the most robust approach for Task because it handles
  includes, namespacing, and templating without requiring the extension to re-implement Task's
  resolution logic.
- The pattern for a CLI-based provider is already well-established in the codebase (Deno, mise).
- Task is cross-platform and widely adopted in modern Go, Rust, and polyglot projects, making
  this a high-value addition.

**Risks / Weaknesses:**

- **CLI dependency:** If `task` is not installed, no tasks are discovered. This is expected
  behavior (same as `act`, `just`, etc.) and is documented clearly. A configurable path allows
  non-PATH installs.
- **Performance:** Spawning a subprocess per Taskfile directory during workspace scan adds latency.
  Mitigated by: (1) deduplication of directories, (2) running only when the task type is enabled,
  (3) using `child_process.execFile` via `util.promisify` (non-shell, lower overhead than `exec`).
- **Large workspaces with many Taskfiles:** If a monorepo contains dozens of Taskfiles, the
  discovery becomes sequential subprocess invocations. A `Promise.all` fan-out is used so all
  directories are processed concurrently, capped by the OS process limit.
- **JSON parse errors:** Malformed or truncated output from the CLI is caught and logged; the
  affected directory yields no tasks but does not crash the provider.
- **`up_to_date` field in JSON:** The `--no-status` flag suppresses the status check that
  populates `up_to_date`. Without `--no-status`, the CLI runs status checks which can be slow.
  The `--no-status` flag is therefore mandatory for performance.
- **Namespaced tasks:** Task supports namespaced task names (e.g. `frontend:build`). The `name`
  field in the JSON output already includes the full namespaced name, so the extension receives
  and displays the correct name without special handling.
- **`aliases` field:** The JSON includes an `aliases` array per task. For Phase 1, aliases are
  not surfaced as separate tree items. They are stored in `item.metadata` for future use.

**Verdict:** Viable, well-scoped, and follows established patterns. The CLI-based discovery is the
correct architectural choice. The main risk (CLI not installed) is documented and handled
gracefully.

---

## Implementation Phases

### Phase 1 — Provider & Core

#### `src/libs/constants.ts`

Add:

```typescript
GLOB_TASKFILE: '{**/Taskfile.yml,**/taskfile.yml,**/Taskfile.yaml,**/taskfile.yaml,**/Taskfile.dist.yml,**/taskfile.dist.yml,**/Taskfile.dist.yaml,**/taskfile.dist.yaml}',
```

#### `src/providers/taskfileTaskProvider.ts` (new file)

> **Naming note:** The file is named `taskfileTaskProvider.ts` to follow the `<type>TaskProvider.ts`
> pattern (e.g. `rakeTaskProvider.ts` → `RakeTaskProvider`). The exported class is
> `TaskfileTaskProvider`. The file-level constant `execFileAsync` mirrors the pattern in
> `rakeTaskProvider.ts`.

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { LoggerService } from '../services/loggerService';

const execFileAsync = promisify(execFile);

interface TaskJsonEntry {
  name: string;
  task: string;
  desc?: string;
  summary?: string;
  aliases?: string[];
  location?: {
    line: number;
    column: number;
    taskfile: string;
  };
}

interface TaskJsonOutput {
  tasks: TaskJsonEntry[];
  location: string;
}

export class TaskFileTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('task', constants.GLOB_TASKFILE);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.taskfile',
        defaultValue: 'taskfile',
        configName: 'taskfile',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_TASKFILE]);

    // Deduplicate by parent directory — task discovers all tasks within its cwd automatically;
    // multiple Taskfile variants in the same directory are handled by the CLI itself.
    const dirMap = new Map<string, vscode.Uri>();
    for (const file of files) {
      const dir = path.dirname(file.fsPath);
      if (!dirMap.has(dir)) {
        dirMap.set(dir, file);
      }
    }

    const results = await Promise.all(
      Array.from(dirMap.entries()).map(([dir, representativeFile]) =>
        this._loadTasksFromDirectory(dir, representativeFile, iconService),
      ),
    );

    return results.flat();
  }

  private async _loadTasksFromDirectory(
    dir: string,
    representativeFile: vscode.Uri,
    iconService: TaskIconService,
  ): Promise<TaskItem[]> {
    const { command, args } = this.getCommand(representativeFile);
    const cmdArgs = [...(args ?? []), '--list-all', '--no-status', '--json'];

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd: dir, timeout: 10000 });
      const output: TaskJsonOutput = JSON.parse(stdout);
      const tasks: TaskItem[] = [];
      const fallbackUri = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));
      const iconPath = iconService.getTaskIcon('task', fallbackUri);

      for (const entry of output.tasks ?? []) {
        const taskFileUri = entry.location?.taskfile
          ? vscode.Uri.file(entry.location.taskfile)
          : fallbackUri;

        const item = new TaskItem(
          entry.name,
          vscode.TreeItemCollapsibleState.None,
          'taskfile',
          taskFileUri,
          undefined,
          iconPath,
        );
        item.taskFileUri = taskFileUri;
        // description: relative path shown in tree view (consistent with other file-based providers)
        item.description = vscode.workspace.asRelativePath(taskFileUri);
        // tooltip: the human-readable task description from the Taskfile
        item.tooltip = entry.desc || entry.name;
        item.startLine = entry.location?.line ? entry.location.line - 1 : 0;
        item.metadata = {
          aliases: entry.aliases ?? [],
          summary: entry.summary ?? '',
        };
        item.onOpenActionCommand = {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open File',
          arguments: [taskFileUri, item.startLine],
        };
        tasks.push(item);
      }
      return tasks;
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[task] Failed to list tasks in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }
}
```

#### `src/providers/index.ts`

1. Import `TaskfileTaskProvider`.
2. Add `TaskfileTaskProvider` to the `TaskProviderConstructor` union type.
3. Register the provider in the `registerProviders` function alongside the other providers.

#### `src/taskFactory.ts`

1. Import `TaskfileTaskProvider`.
2. Add `'task'` to the `KNOWN_TASK_TYPES` Set.
3. Add a `case 'task':` block in `_buildTask`:

```typescript
case 'task': {
  const taskProvider = new TaskfileTaskProvider();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
  const { command: taskCmd, args: taskInitialArgs, cwd: taskCwd } = taskProvider.getCommand(workspaceFolder?.uri);

  const taskArgs = taskInitialArgs ? [...taskInitialArgs] : [];
  taskArgs.push(taskLabel);
  if (args) {
    taskArgs.push(...args.split(' '));
  }

  const full = `${taskCmd} ${taskArgs.join(' ')}`;
  const taskFileCwd = item.taskFileUri ? path.dirname(item.taskFileUri.fsPath) : taskCwd;
  const shellExec = new vscode.ShellExecution(taskCmd, taskArgs, { cwd: taskFileCwd });

  const task = new vscode.Task(
    { type: 'taskfile', task: taskLabel, path: resourceUri.fsPath },
    vscode.TaskScope.Workspace,
    taskLabel,
    'taskfile',
    shellExec,
  );
  return { task, command: full, cwd: taskFileCwd, native: false };
}
```

### Phase 2 — Configuration

#### `package.json`

**`workspaceTasks.enabledTaskTypes`** — add property and default:

```json
"task": {
  "type": "boolean",
  "description": "%config.workspaceTasks.enabledTaskTypes.taskfile%"
}
```

Default: `"task": true`

**`workspaceTasks.applicationPath` group** — add new setting:

```json
"workspaceTasks.applicationPath.taskfile": {
  "type": "string",
  "default": "task",
  "description": "%config.workspaceTasks.applicationPath.taskfile%",
  "markdownDescription": "%config.workspaceTasks.applicationPath.taskfile.markdown%",
  "scope": "resource"
}
```

**`keywords`** — add `"task"` and `"taskfile"`.

#### `package.nls.json`

Add:

```json
"config.workspaceTasks.enabledTaskTypes.taskfile": "Enable Task (go-task) support",
"config.workspaceTasks.applicationPath.taskfile": "Path to Task executable",
"config.workspaceTasks.applicationPath.taskfile.markdown": "Specify the path to the [Task](https://taskfile.dev/) executable. On Windows, if the path ends with `task`, `.exe` will be appended automatically. On all platforms, `~/` will be expanded to the user's home directory. [read more](https://camalot.github.io/vscode-workspace-tasks/configuration/application-path.html#workspacetasksapplicationpathtaskfile)"
```

### Phase 3 — Sample Workspace

Create `sample/sample-workspace-tasks/task/Taskfile.yml`:

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

  lint:
    desc: Run the linter
    cmds:
      - echo "Linting {{.APP_NAME}}..."

  clean:
    desc: Clean build artifacts
    cmds:
      - echo "Cleaning {{.APP_NAME}} artifacts..."

  deploy:
    desc: Deploy the application
    cmds:
      - echo "Deploying {{.APP_NAME}}..."

  ci:
    desc: Run the full CI pipeline
    deps: [build, test, lint]
```

### Phase 4 — Tests

#### `src/test/suite/taskTaskProvider.test.ts` (new file)

Following the pattern of `rake.test.ts`, the test file mocks `filesService.findFiles` and
`provider.getCommand`. For the error-path tests, `getCommand` is overridden to return a
non-existent executable name (which causes `execFileAsync` to throw), verifying graceful
fallback. For success-path tests, the provider's private `_loadTasksFromDirectory` is accessed
via `(provider as any)._loadTasksFromDirectory` and a spy is injected, or the tests use a
real fixture directory with a real `task` installation if available in CI; otherwise tests
mock at the `getCommand` level.

> **Test mocking note:** Because `execFileAsync` is a module-level `const`, it cannot be
> monkey-patched directly. Tests use one of:
> (a) Override `provider.getCommand()` to return an unavailable command → covers error path.
> (b) Extract `_loadTasksFromDirectory` as a public or protected method and provide a testable
>     override → covers success path without spawning a real process.
> (c) Use a JSON parse test against a known stdout string via a helper method
>     `_parseTaskOutput(stdout: string): TaskItem[]` extracted from the private method.
>
> **Recommendation:** Extract a public `parseOutput(stdout: string, dir: string): TaskItem[]`
> helper method on the provider (similar to `rakeTaskProvider.parseRakeOutput`). Tests can
> then call `parseOutput` directly with fixture JSON strings, covering all parsing branches
> without process spawning.

Test suite covering:

| Test | Description |
|------|-------------|
| `uses correct type` | `provider.type === 'task'` |
| `uses correct file pattern` | `provider.filePattern === constants.GLOB_TASKFILE` |
| `getCommand returns default task command` | Result contains `task` |
| `getSystemTasks returns empty array` | `[]` always |
| `getTasks returns empty when disabled` | Provider with `enabled = false` returns `[]` |
| `getTasks returns empty when no files found` | Mock `findFiles` returns `[]` |
| `getTasks handles CLI exec failure gracefully` | Override `getCommand` to bad path → `[]` |
| `parseOutput returns items from JSON` | Pass fixture JSON string, verify `TaskItem` fields |
| `parseOutput uses task name from JSON` | `item.label === entry.name` |
| `parseOutput sets description to relative path` | `item.description` equals relative path |
| `parseOutput sets tooltip to desc field` | `item.tooltip === entry.desc` |
| `parseOutput sets startLine from location.line` | `item.startLine === location.line - 1` |
| `parseOutput handles missing location` | No crash when `location` is undefined |
| `parseOutput handles malformed JSON` | Returns `[]` on parse error |
| `parseOutput stores aliases in metadata` | `item.metadata.aliases` populated |
| `parseOutput deduplicates on same directory` | Two files in same dir → one entry in `dirMap` |

#### `src/test/suite/taskFactoryTask.test.ts` (new file)

Test suite covering:

| Test | Description |
|------|-------------|
| `creates task with correct type` | `task.definition.type === 'task'` |
| `creates task with correct label` | Task name equals item label |
| `creates task with correct cwd` | cwd is directory of Taskfile |
| `creates task with args appended` | Args are appended to command |
| `getCommand returns task executable path` | Respects `applicationPath.taskfile` config |

#### `src/test/task-files/task/`

Add sample JSON fixture files used by `parseOutput` unit tests (not actual Taskfiles, since the
tests call `parseOutput` directly with pre-crafted strings rather than spawning the CLI):

- `valid-output.json` — representative `task --list-all --json` stdout with multiple tasks,
  descriptions, and location data
- `empty-output.json` — valid JSON with `"tasks": []`
- `no-location-output.json` — tasks with `location` field omitted
- `malformed.txt` — non-JSON text to test parse error handling

### Phase 5 — Documentation

#### `docs/task-types/task.md` (new file)

Sections:
- Overview of Task (go-task)
- Supported Taskfile filenames
- How task discovery works (CLI-based)
- Configuration: enabling/disabling, `applicationPath.taskfile`
- Example Taskfile
- Execution command format
- Troubleshooting (task not found, empty list)

#### `README.md`

Add `task` to the supported task runners table/list.

#### `docs/configuration/application-path.md`

Add `workspaceTasks.applicationPath.taskfile` entry with description and default value.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/libs/constants.ts` | Add `GLOB_TASKFILE` |
| `src/providers/taskfileTaskProvider.ts` | **New** — `TaskfileTaskProvider` class with `parseOutput` helper |
| `src/providers/index.ts` | Import and register `TaskfileTaskProvider` |
| `src/taskFactory.ts` | Import provider, add `'task'` to `KNOWN_TASK_TYPES`, add `case 'task':` |
| `package.json` | Add `enabledTaskTypes.taskfile` (property + default), `applicationPath.taskfile`, keyword `"task"` and `"taskfile"` |
| `package.nls.json` | Add 3 NLS strings |
| `sample/sample-workspace-tasks/task/Taskfile.yml` | **New** — sample Taskfile |
| `src/test/suite/taskTaskProvider.test.ts` | **New** — provider unit tests |
| `src/test/suite/taskFactoryTask.test.ts` | **New** — factory unit tests |
| `src/test/task-files/task/valid-output.json` | **New** — JSON fixture |
| `src/test/task-files/task/empty-output.json` | **New** — JSON fixture |
| `src/test/task-files/task/no-location-output.json` | **New** — JSON fixture |
| `src/test/task-files/task/malformed.txt` | **New** — parse-error fixture |
| `docs/task-types/task.md` | **New** — full documentation page |
| `README.md` | Add `task` to supported task runners table |
| `docs/configuration/application-path.md` | Add `applicationPath.taskfile` entry |

---

## Open Questions / Future Work

- **`aliases` as separate tree items:** Task aliases are stored in `metadata` but not yet surfaced
  as separate tree entries. A follow-up plan can add alias items under the primary task as children.
- **Global Taskfiles (`$HOME/Taskfile.yml`):** Not in scope for Phase 1. A `getSystemTasks()`
  implementation could detect global Taskfiles, but this requires different discovery logic and
  user opt-in to avoid scanning outside the workspace.
- **Watch mode integration:** `task --watch` is a useful mode. It is out of scope for Phase 1
  but could integrate with a future "watch task" feature.
- **`--taskfile` flag:** If a Taskfile has a non-standard path or name, a user could configure a
  per-folder override. Out of scope for Phase 1.
- **`sample-workspace-tasks.code-workspace`:** The sample workspace uses `"path": "."` (single
  root) so the new `task/Taskfile.yml` subfolder is automatically scanned. However, if the sample
  project gains a `workspaceTasks.applicationPath.taskfile` entry for CI/tooling environments where
  `task` is installed to a non-standard path, the `.code-workspace` file should be updated.

---

## Self-Review Findings Applied to This Plan

| Finding | Resolution |
|---------|------------|
| Callback-style `execFile` inconsistent with `rakeTaskProvider` | Changed to `promisify(execFile)` / async-await pattern |
| `item.description` set to `entry.desc` (task desc) inconsistent with file-based providers | Changed to `asRelativePath(taskFileUri)`; `entry.desc` moved to `item.tooltip` |
| Missing `item.onOpenActionCommand` | Added to provider code |
| Tests couldn't easily mock module-level `execFileAsync` | Added `parseOutput` public helper method; tests call it directly with fixture JSON |
| Test fixture files were Taskfile YAML (not needed for unit tests) | Replaced with JSON fixture strings that match CLI output format |
| `File Change Summary` was missing `src/libs/constants.ts` | Added |
