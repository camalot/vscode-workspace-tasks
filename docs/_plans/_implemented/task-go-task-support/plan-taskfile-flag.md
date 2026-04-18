# Plan: Custom Taskfile Patterns and `--taskfile` Flag

## TL;DR

Task's default file discovery covers the standard `Taskfile.yml` / `Taskfile.yaml` /
`Taskfile.dist.*` naming conventions. Users with non-standard Taskfile names (e.g.
`Taskfile.ci.yml`, `backend/MyTasks.yml`) cannot currently have those files discovered or their
tasks run correctly. This plan adds:

1. `workspaceTasks.taskfile.additionalFilePatterns` — an array of glob strings (default `[]`,
   `scope: resource`) that are appended to the built-in discovery globs.
2. `workspaceTasks.taskfile.useTaskfileFlag` — a boolean (default `false`) that, when enabled,
   always passes `--taskfile <absolute path>` to the `task` CLI during execution to ensure the
   correct Taskfile is used regardless of cwd.

Both settings reside under the `workspaceTasks.taskfile.*` namespace, alongside the planned
`showAliases` and `discoverGlobalTaskfile` settings.

---

## Requirements

- `workspaceTasks.taskfile.additionalFilePatterns`: array of glob strings, `scope: resource`,
  default `[]`. Patterns are merged with the built-in `GLOB_TASKFILE` patterns for file discovery.
- `workspaceTasks.taskfile.useTaskfileFlag`: boolean, `scope: resource`, default `false`. When
  `true`, `--taskfile <absolute path>` is prepended to the `task` CLI arguments during execution.
- Non-standard Taskfile paths discovered through `additionalFilePatterns` are treated identically
  to standard Taskfiles: each unique parent directory gets one CLI invocation.
- When `useTaskfileFlag` is `true`, every `task` execution in `taskFactory.ts` prepends
  `--taskfile <item.taskFileUri.fsPath>`. This applies to all `taskfile`-type items, not only those
  from custom patterns.
- Achieve 100% test coverage for all new/changed code paths.

---

## Key Design Decisions

### Setting placement alongside `applicationPath`

The user request specifies the setting should "reside along with the `applicationPath` setting."
This means it should appear in the same settings group in the VS Code Settings UI. The
`applicationPath.*` settings are under the `workspaceTasks` prefix. We use
`workspaceTasks.taskfile.additionalFilePatterns` (matching `workspaceTasks.taskfile.*` namespace) rather
than `workspaceTasks.applicationPath.taskfilePatterns` because:

- It is a behavioral/discovery setting, not an executable path.
- Keeping task-specific settings under `workspaceTasks.taskfile.*` is consistent with
  `workspaceTasks.taskfile.showAliases` and `workspaceTasks.taskfile.discoverGlobalTaskfile`.

In the Settings UI, the `workspaceTasks.taskfile.*` group naturally appears near `applicationPath.taskfile`
since both share the `workspaceTasks.task` prefix.

### Glob merge strategy

Custom globs from `additionalFilePatterns` are appended to the built-in pattern array when
`TaskFilesService.findFiles` is called. The built-in constant `GLOB_TASKFILE` remains unchanged; the
provider constructs a merged list at query time:

```typescript
const customPatterns = config.get<string[]>('task.additionalFilePatterns') ?? [];
const patterns = [constants.GLOB_TASKFILE, ...customPatterns];
const files = await filesService.findFiles(patterns);
```

This ensures backward compatibility: when `additionalFilePatterns` is empty, behavior is
identical to Phase 1.

### `--taskfile` flag and cwd

When `useTaskfileFlag` is `true`, the task is invoked as:

```shell
task --taskfile <absolute/path/to/Taskfile.yml> <taskName> [args]
```

The `cwd` is still set to the Taskfile's parent directory (`path.dirname(item.taskFileUri.fsPath)`),
which is consistent with the existing behavior. Passing `--taskfile` is belt-and-suspenders:
it guarantees the correct Taskfile even if the user's shell `cwd` resolution differs from what
the extension computes.

### Discovery for custom patterns

When a custom glob matches a file whose parent directory is already in `dirMap` (e.g. both
`**/Taskfile.yml` and `**/Taskfile.ci.yml` match files in the same `backend/` directory), the
directory is only scanned once (existing deduplication). The CLI discovers all tasks from all
Taskfiles in that directory per its own resolution rules. However, custom-named Taskfiles (e.g.
`backend/Taskfile.ci.yml`) may not be found by `task --list-all` without `--taskfile`. This is
where `useTaskfileFlag` becomes important during execution.

**Discovery special case:** For custom-named Taskfiles, the representative URI stored in `dirMap`
may be the first file matched. To ensure tasks are associated with the correct file, the
`_loadTasksFromDirectory` method should pass `--taskfile <representativeFile>` when the file's
basename does not match the standard naming convention. This is detected by checking whether the
filename is in the standard set.

```typescript
const STANDARD_TASKFILE_NAMES = new Set([
  'Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml',
  'Taskfile.dist.yml', 'taskfile.dist.yml', 'Taskfile.dist.yaml', 'taskfile.dist.yaml',
]);

function isStandardTaskfileName(filePath: string): boolean {
  return STANDARD_TASKFILE_NAMES.has(path.basename(filePath));
}
```

If the representative file is non-standard, `--taskfile <path>` is added to the discovery args.

### `GLOB_TASKFILE` constant remains unchanged

The built-in `GLOB_TASKFILE` constant in `src/libs/constants.ts` is not modified. Custom patterns
are merged at runtime in the provider, not baked into the constant.

---

## Self-Critique & Viability Assessment

**Strengths:**

- `additionalFilePatterns` is purely additive: zero configuration change required for existing
  users.
- `useTaskfileFlag` is opt-in and default `false`, preserving existing execution behavior.
- The non-standard file detection in discovery (`isStandardTaskfileName`) ensures tasks from
  custom Taskfiles are correctly discovered.
- Single source of truth: the `--taskfile` path comes from `item.taskFileUri`, which is already
  set during discovery.

**Risks / Weaknesses:**

- **Non-standard Taskfiles in the same directory:** If a user adds `**/Taskfile.ci.yml` and
  `**/Taskfile.yml` both exist in `backend/`, the directory is scanned once. `task --list-all`
  without `--taskfile` returns tasks from the standard Taskfile only. The user may expect tasks
  from the custom Taskfile. The fix is to treat each non-standard match as its own invocation
  (different from the current deduplication strategy).

  **Revised strategy for non-standard files:** Build the `dirMap` keyed by `(dir, taskfile path)`
  rather than just `dir` when the file is non-standard. Standard files are still deduplicated by
  directory; non-standard files each get their own CLI invocation with `--taskfile`.

  ```typescript
  Map<string, vscode.Uri>  →  Map<string, { uri: vscode.Uri; useTaskfileArg: boolean }>
  ```

- **`useTaskfileFlag` in execution for standard-named Taskfiles:** Passing `--taskfile` is safe
  even for standard Taskfiles because `task` accepts it. The only overhead is a slightly longer
  command line.
- **`TaskFilesService.findFiles` with multiple patterns:** Verify that the service de-duplicates
  across patterns (i.e., if both `GLOB_TASKFILE` and a custom glob match the same file, it only
  appears once in the returned array). If not, the `dirMap` deduplication handles it at the
  directory level.
- **Glob security:** User-provided glob patterns are passed to `vscode.workspace.findFiles`.
  This API already scopes results to the workspace, so patterns cannot escape the workspace root.
  No additional sanitization is needed.

**Verdict:** Viable, moderate complexity. The revised deduplication strategy (keyed by `(dir,
file)` for non-standard files) is the key insight that makes discovery correct for custom-named
Taskfiles. The `useTaskfileFlag` for execution is straightforward. The main implementation risk
is getting the `dirMap` keying right.

---

## Implementation

### Phase 1 — Configuration

#### `package.json`

```json
"workspaceTasks.taskfile.additionalFilePatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "%config.workspaceTasks.taskfile.additionalFilePatterns%",
  "scope": "resource"
},
"workspaceTasks.taskfile.useTaskfileFlag": {
  "type": "boolean",
  "default": false,
  "description": "%config.workspaceTasks.taskfile.useTaskfileFlag%",
  "scope": "resource"
}
```

#### `package.nls.json`

```json
"config.workspaceTasks.taskfile.additionalFilePatterns": "Additional glob patterns for discovering Taskfiles with non-standard names (e.g. **/Taskfile.ci.yml). Merged with the built-in patterns.",
"config.workspaceTasks.taskfile.useTaskfileFlag": "When enabled, passes --taskfile <path> to the task CLI during execution to ensure the correct Taskfile is always used."
```

### Phase 2 — Constants

#### `src/libs/constants.ts`

Add the standard Taskfile name set as an exported constant for use in the provider:

```typescript
STANDARD_TASKFILE_NAMES: new Set([
  'Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml',
  'Taskfile.dist.yml', 'taskfile.dist.yml', 'Taskfile.dist.yaml', 'taskfile.dist.yaml',
]),
```

### Phase 3 — Provider Changes

#### `src/providers/taskTaskProvider.ts`

**`getTasks()` — revised discovery loop:**

```typescript
public async getTasks(): Promise<TaskItem[]> {
  if (!this.enabled) {
    return [];
  }

  const config = Configuration.getInstance();
  const customPatterns = config.get<string[]>('task.additionalFilePatterns') ?? [];
  const patterns = [constants.GLOB_TASKFILE, ...customPatterns];

  const filesService = TaskFilesService.getInstance();
  const iconService = TaskIconService.getInstance();
  const files = await filesService.findFiles(patterns);

  // Standard files: deduplicate by directory (task handles multiple files in cwd itself).
  // Non-standard files: each gets its own entry with useTaskfileArg = true.
  const dirMap = new Map<string, { uri: vscode.Uri; useTaskfileArg: boolean }>();
  for (const file of files) {
    const dir = path.dirname(file.fsPath);
    const isStandard = constants.STANDARD_TASKFILE_NAMES.has(path.basename(file.fsPath));
    const key = isStandard ? dir : file.fsPath;  // non-standard keyed by full path
    if (!dirMap.has(key)) {
      dirMap.set(key, { uri: file, useTaskfileArg: !isStandard });
    }
  }

  const results = await Promise.all(
    Array.from(dirMap.entries()).map(([, { uri, useTaskfileArg }]) =>
      this._loadTasksFromDirectory(path.dirname(uri.fsPath), uri, iconService, useTaskfileArg),
    ),
  );

  return results.flat();
}
```

**`_loadTasksFromDirectory()` — signature change:**

```typescript
private async _loadTasksFromDirectory(
  dir: string,
  representativeFile: vscode.Uri,
  iconService: TaskIconService,
  useTaskfileArg: boolean = false,
): Promise<TaskItem[]> {
  const { command, args } = this.getCommand(representativeFile);
  const cmdArgs = [...(args ?? [])];

  if (useTaskfileArg) {
    cmdArgs.push('--taskfile', representativeFile.fsPath);
  }

  cmdArgs.push('--list-all', '--no-status', '--json');

  try {
    const { stdout } = await execFileAsync(command, cmdArgs, { cwd: dir, timeout: 10000 });
    return this.parseOutput(stdout, dir, iconService);
  } catch (err: unknown) {
    LoggerService.getInstance().warn(
      `[task] Failed to list tasks in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
```

#### `src/taskFactory.ts`

In `case 'task':`, after building `taskArgs`:

```typescript
const useTaskfileFlag = Configuration.getInstance().get<boolean>('task.useTaskfileFlag') ?? false;
if (useTaskfileFlag && item.taskFileUri) {
  taskArgs.unshift('--taskfile', item.taskFileUri.fsPath);
}
```

### Phase 4 — Tests

#### `src/test/suite/taskTaskProvider.test.ts`

New `additionalFilePatterns` sub-suite:

| Test | Description |
|------|-------------|
| `getTasks uses only built-in patterns when additionalFilePatterns is empty` | `findFiles` called with `[GLOB_TASKFILE]` |
| `getTasks merges custom patterns with built-in` | `findFiles` called with `[GLOB_TASKFILE, custom]` |
| `standard Taskfiles deduplicated by directory` | Two standard files in same dir → one CLI call |
| `non-standard Taskfiles get own CLI invocation` | Custom-named file → separate entry in dirMap |
| `non-standard file discovery passes --taskfile arg` | `cmdArgs` includes `--taskfile <path>` |
| `standard file discovery does NOT pass --taskfile arg` | No `--taskfile` for standard files |

New `useTaskfileFlag` sub-suite in `taskFactoryTask.test.ts`:

| Test | Description |
|------|-------------|
| `useTaskfileFlag false: no --taskfile in args` | Default behavior unchanged |
| `useTaskfileFlag true: --taskfile prepended` | `args[0] === '--taskfile'`, `args[1] === fsPath` |
| `useTaskfileFlag true but no taskFileUri: no --taskfile` | Graceful fallback |

#### `src/test/task-files/task/custom-named-output.json`

New fixture representing CLI output for a custom-named Taskfile.

### Phase 5 — Documentation

#### `docs/task-types/task.md`

Add a **Custom Taskfile Patterns** section after **Supported File Patterns**:

> ### Custom Taskfile Patterns
>
> If your project uses non-standard Taskfile names, add glob patterns to discover them:
>
> ```json
> {
>   "workspaceTasks.taskfile.additionalFilePatterns": [
>     "**/Taskfile.ci.yml",
>     "**/tasks/Taskfile.yml"
>   ]
> }
> ```
>
> To ensure the correct Taskfile is always passed to the `task` CLI during execution:
>
> ```json
> { "workspaceTasks.taskfile.useTaskfileFlag": true }
> ```
>
> This adds `--taskfile <path>` to every `task` invocation, guaranteeing the right file is used
> regardless of working directory.

#### `sample/sample-workspace-tasks/task/Taskfile.yml`

No change needed — the feature is for non-standard names and the sample uses standard names.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/providers/taskTaskProvider.ts` | Revised `getTasks()`, `_loadTasksFromDirectory()` |
| `src/libs/constants.ts` | Add `STANDARD_TASKFILE_NAMES` set |
| `src/taskFactory.ts` | Add `--taskfile` flag logic |
| `package.json` | Add `additionalFilePatterns`, `useTaskfileFlag` settings |
| `package.nls.json` | Add NLS strings |
| `src/test/suite/taskTaskProvider.test.ts` | New pattern/deduplication tests |
| `src/test/suite/taskFactoryTask.test.ts` | New `useTaskfileFlag` tests |
| `src/test/task-files/task/custom-named-output.json` | New fixture |
| `docs/task-types/task.md` | Add Custom Taskfile Patterns section |

---

## Open Questions / Future Work

- **`GLOB_TASKFILE` as array vs brace expansion:** Consider refactoring `GLOB_TASKFILE` from a single
  brace-expansion glob string to an array of strings. This would make appending custom patterns
  more natural without a separate constant. Deferred to avoid unrelated refactoring.
- **Per-folder Taskfile override:** A future `workspaceTasks.task.taskfileOverridePath` could
  let the user specify an exact Taskfile path per workspace folder (absolute or workspace-relative).
  This is more granular than glob patterns and targets the "I know exactly where my Taskfile is"
  use case.
