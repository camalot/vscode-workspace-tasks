# Plan: Task Alias Feature — Full Scope (Native VS Code Tasks)

## TL;DR

Extend the task alias feature to cover **native VS Code tasks** defined in `.vscode/tasks.json` (and user profile `tasks.json`), in addition to the `.workspace-tasks.json` tasks covered by the original plan. Users add an `"alias"` property to any `shell` or `process` task in `tasks.json`. The extension registers a `"workspace-tasks"` VS Code task type whose `resolveTask()` implementation looks up the alias across **both** source systems and returns the resolved `vscode.Task`. Auto-injection of alias stubs is extended to handle both sources, with native-task stubs written into the same `tasks.json` file.

## Decisions

- **Scope**: aliases for both `.workspace-tasks.json` tasks AND native `shell`/`process` tasks in `.vscode/tasks.json`
- **Supported native types**: only `"type": "shell"` and `"type": "process"`; custom execution types (e.g. `"type": "npm"`, `"type": "gradle"`) are not supported
- **Variable resolution for native tasks**: `${input:id}` replaced with default values; common VS Code variables (`${workspaceFolder}`, `${workspaceFolderBasename}`, `${cwd}`) substituted; `${command:...}` and `${env:...}` passed through unresolved
- **`dependsOn` chains**: not followed; only the direct command is resolved
- **Auto-injection for native tasks**: the `{ "type": "workspace-tasks", "alias": "...", "label": "..." }` stub is written into the **same** `tasks.json` file alongside the aliased native task
- **Lookup order**: `.workspace-tasks.json` is checked first; native tasks are the fallback
- **User profile tasks**: supported for alias lookup; stub injection skipped (profile tasks.json path varies per OS and user)

## Phase 1: Schema & Service (`.workspace-tasks.json` — unchanged from original plan)

### `res/schemas/workspace-tasks.schema.json`

Add `alias` to task item properties (same as original plan):

```json
"alias": {
  "type": "string",
  "description": "A stable identifier for this task. Used to reference the task from .vscode/tasks.json and launch.json independent of its display label."
}
```

### `src/services/workspaceTasksService.ts`

Same additions as the original plan:

1. Add `alias?: string` to `FileTaskDefinition` interface
2. Add `findTaskByAlias(alias: string): { task: FileTaskDefinition; languageId: string } | undefined`
3. Add `getRawTaskCommand(alias: string, resourceUri: vscode.Uri): string | undefined` — substitutes `{{ .FileName }}` and `{{ .InputId }}` default values, removes unresolved templates

## Phase 2: New Service — `NativeTaskAliasService`

**`src/services/nativeTaskAliasService.ts`** — New singleton service that reads `.vscode/tasks.json` files from all workspace folders and indexes native tasks by alias.

### Interfaces

```ts
interface NativeTaskInput {
  id: string;
  type: 'promptString' | 'pickString' | 'command';
  description?: string;
  default?: string;
  options?: string[];
  command?: string;
}

interface NativeTaskDefinition {
  label: string;
  alias: string;
  type: 'shell' | 'process';
  command: string | { value: string; quoting?: string };
  args?: Array<string | { value: string; quoting?: string }>;
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    shell?: { executable?: string; args?: string[] };
  };
  inputs?: NativeTaskInput[];
  workspaceFolderUri: vscode.Uri;
  fileUri: vscode.Uri;
}

interface NativeTasksFile {
  version: string;
  inputs?: NativeTaskInput[];
  tasks?: Array<Record<string, unknown>>;
}
```

### Methods

- **`getInstance(): NativeTaskAliasService`** — singleton accessor
- **`loadFromWorkspaceFolders(): Promise<void>`** — iterates all workspace folders, reads each `.vscode/tasks.json` via `vscode.workspace.fs.readFile`, parses with the existing `parseJsonWithComments` utility, and indexes tasks that have a non-empty `alias` property into an internal `Map<string, NativeTaskDefinition>`
- **`findByAlias(alias: string): NativeTaskDefinition | undefined`** — lookup by alias
- **`getAllAliases(): { alias: string; workspaceFolderUri: vscode.Uri; fileUri: vscode.Uri }[]`** — returns all known native-task aliases (for auto-injection)
- **`resolveCommand(def: NativeTaskDefinition): string`** — builds the final shell command string:
  1. Substitute `${input:id}` with default values from `inputs` array
  2. Substitute `${workspaceFolder}` with the workspace folder `fsPath`
  3. Substitute `${workspaceFolderBasename}` with the workspace folder name
  4. Substitute `${cwd}` with `options.cwd` if present, else workspace folder fsPath
  5. Append `args` (extracted string values) to the command string
  6. Leave any remaining `${...}` variables as-is (VS Code resolves them at runtime in some contexts)
- **`invalidate(): void`** — clears the internal cache; called by file-watcher triggers

### When to call `loadFromWorkspaceFolders()`

- On extension activation (after `WorkspaceTasksService.initialize()`)
- Whenever a `.vscode/tasks.json` file changes (via the existing `TaskFilesService` watcher for `GLOB_VSCODE`)

## Phase 3: VS Code Task Type Registration

### `package.json`

Add to `contributes` (same as original plan):

```json
"taskDefinitions": [
  {
    "type": "workspace-tasks",
    "required": ["alias"],
    "properties": {
      "alias": {
        "type": "string",
        "description": "The alias of a task defined in .workspace-tasks.json or in a native .vscode/tasks.json task with an 'alias' property."
      }
    }
  }
]
```

### `src/providers/workspaceAliasTaskProvider.ts`

New file implementing `vscode.TaskProvider`. The `resolveTask()` method now has a two-stage lookup:

```
resolveTask(task: vscode.Task): vscode.Task | undefined
  1. alias = task.definition.alias
  2. Check WorkspaceTasksService.getInstance().findTaskByAlias(alias)
     → if found: use getRawTaskCommand() to get shell command → return ShellExecution task
  3. Check NativeTaskAliasService.getInstance().findByAlias(alias)
     → if found: use resolveCommand() to get shell command
     → determine execution type (ShellExecution vs ProcessExecution) from def.type
     → build and return vscode.Task with appropriate execution
  4. If neither found: return undefined
```

#### `resolveTask()` Detail for Native Tasks

```ts
const nativeDef = NativeTaskAliasService.getInstance().findByAlias(alias);
if (!nativeDef) { return undefined; }

const command = NativeTaskAliasService.getInstance().resolveCommand(nativeDef);
const scope = vscode.workspace.getWorkspaceFolder(nativeDef.workspaceFolderUri)
  ?? vscode.TaskScope.Workspace;

let execution: vscode.ShellExecution | vscode.ProcessExecution;
if (nativeDef.type === 'process') {
  execution = new vscode.ProcessExecution(command, {
    cwd: nativeDef.options?.cwd,
    env: nativeDef.options?.env,
  });
} else {
  const shellOptions: vscode.ShellExecutionOptions = {
    cwd: nativeDef.options?.cwd,
    env: nativeDef.options?.env,
  };
  if (nativeDef.options?.shell?.executable) {
    shellOptions.executable = nativeDef.options.shell.executable;
    shellOptions.shellArgs = nativeDef.options.shell.args;
  }
  execution = new vscode.ShellExecution(command, shellOptions);
}

return new vscode.Task(task.definition, scope, task.name, 'workspace-tasks', execution);
```

**Environment variable injection** — After building the task, env variables and secrets from
the `TaskEnvService` (task-environment-variables feature) must be merged into the execution.
The injection must use the **underlying** task's identity (type, label, `taskFileUri`), not the
`workspace-tasks` stub, so that `workspaceTasks.taskEnv` rules match correctly:

```ts
// Build underlyingTaskItem from the resolved alias source
const underlyingTaskItem = buildTaskItemFromAlias(nativeDef /* or workspaceTasksDef */);
const envMap = await TaskEnvService.getInstance().resolveTaskEnv(underlyingTaskItem);
if (envMap.size > 0) {
  const mergedEnv = Object.fromEntries([...envMap.entries()].map(([k, v]) => [k, v.value]));
  // Re-wrap execution with env merged in
  if (execution instanceof vscode.ShellExecution) {
    execution = new vscode.ShellExecution(
      execution.commandLine ?? execution.command,
      { ...execution.options, env: { ...(execution.options?.env ?? {}), ...mergedEnv } }
    );
  } else if (execution instanceof vscode.ProcessExecution) {
    execution = new vscode.ProcessExecution(
      execution.process, execution.args,
      { ...execution.options, env: { ...(execution.options?.env ?? {}), ...mergedEnv } }
    );
  }
}

return new vscode.Task(task.definition, scope, task.name, 'workspace-tasks', execution);
```

`envFiles` and `secretFiles` at all levels (global, `.workspace-tasks.json` block, per-task, and
`workspaceTasks.taskEnv` rules) use the `IEnvFileReference` type — a single string, an array of
strings, or an `{ include: string[], exclude?: string[] }` object — and are all handled
transparently by `TaskEnvFileResolver.resolveFileReferences()`. No special handling is needed in
`WorkspaceAliasTaskProvider` beyond passing the correct `underlyingTaskItem`.

### `src/providers/index.ts`

After existing provider registrations, add:

```ts
import { WorkspaceAliasTaskProvider } from './workspaceAliasTaskProvider';
// ...
context.subscriptions.push(
  vscode.tasks.registerTaskProvider('workspace-tasks', new WorkspaceAliasTaskProvider())
);
```

Also wire up the `NativeTaskAliasService` invalidation when tasks.json changes:

```ts
const nativeAliasService = NativeTaskAliasService.getInstance();
await nativeAliasService.loadFromWorkspaceFolders();
// Re-load whenever tasks.json changes (TaskFilesService already watches GLOB_VSCODE)
filesService.onFilesChanged(async (uris) => {
  const hasTasksJson = uris.some(u => u.fsPath.endsWith('tasks.json'));
  if (hasTasksJson) {
    nativeAliasService.invalidate();
    await nativeAliasService.loadFromWorkspaceFolders();
    await TaskAliasService.getInstance().syncAliasStubs();
  }
});
```

## Phase 4: Auto-injection Service

**`src/services/taskAliasService.ts`** — New singleton service (extended from original plan to handle both alias sources).

### `syncAliasStubs()`

1. Collect aliases from `.workspace-tasks.json` via `WorkspaceTasksService` (all providers → all tasks with `alias`)
2. Collect aliases from native tasks via `NativeTaskAliasService.getAllAliases()`
3. Group aliases by workspace folder URI
4. For each workspace folder, call `injectStubsIntoTasksJson(folderUri, aliases)`

### `injectStubsIntoTasksJson(folderUri, aliases)`

1. Resolve `tasks.json` path: `{folderUri}/.vscode/tasks.json`
2. Read existing content (or start from skeleton `{ "version": "2.0.0", "tasks": [] }` if absent)
3. Parse with `parseJsonWithComments`
4. For each alias: if NO existing entry where `type === "workspace-tasks"` AND `alias === theAlias` → push stub `{ "type": "workspace-tasks", "alias": theAlias, "label": theAlias }`
5. Write back with `JSON.stringify(json, null, 2)` via `vscode.workspace.fs.writeFile`
6. Log all add/skip operations

### Key Difference from Original Plan

For native tasks that already live in `tasks.json`, the stub is added to the **same file**. The injection guard (`type === "workspace-tasks" && alias === theAlias`) ensures the original native task (which has a different `type`) is not mistaken for the stub. The file ends up with both the original task and the stub:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "🐍 Run pytest",
      "alias": "python:test",
      "type": "shell",
      "command": "python -m pytest tests/ -v"
    },
    {
      "type": "workspace-tasks",
      "alias": "python:test",
      "label": "python:test"
    }
  ]
}
```

### When to call `syncAliasStubs()`

- After `WorkspaceTasksService.loadWorkspaceConfig()` completes
- After `NativeTaskAliasService.loadFromWorkspaceFolders()` completes
- On each subsequent reload triggered by file watchers

## Phase 5: Tests

### `src/test/suite/workspaceTasksService.test.ts`

Add test group for alias methods (same as original plan):

- `findTaskByAlias` returns correct task and languageId
- `findTaskByAlias` returns `undefined` for unknown alias
- `getRawTaskCommand` substitutes input defaults correctly
- `getRawTaskCommand` substitutes `{{ .FileName }}` with basename
- `getRawTaskCommand` removes unresolved templates

### NEW `src/test/suite/nativeTaskAliasService.test.ts`

- `loadFromWorkspaceFolders()` indexes tasks that have an `alias` property
- `loadFromWorkspaceFolders()` ignores tasks without an `alias` property
- `loadFromWorkspaceFolders()` ignores tasks with unsupported types (not `shell` or `process`)
- `findByAlias()` returns correct `NativeTaskDefinition` for a known alias
- `findByAlias()` returns `undefined` for an unknown alias
- `resolveCommand()` substitutes `${input:id}` with default value
- `resolveCommand()` substitutes `${workspaceFolder}` with folder fsPath
- `resolveCommand()` substitutes `${workspaceFolderBasename}` with folder name
- `resolveCommand()` appends `args` after command string
- `resolveCommand()` leaves unresolved `${command:...}` as-is
- `invalidate()` clears the cache so subsequent `findByAlias()` returns `undefined`
- `getAllAliases()` returns entries for all indexed aliases
- Tasks without `inputs` in file use empty array (no crash)

### NEW `src/test/suite/workspaceAliasTaskProvider.test.ts`

- `provideTasks()` returns empty array
- `resolveTask()` returns `ShellExecution` task when alias maps to a `.workspace-tasks.json` task
- `resolveTask()` returns `ShellExecution` task when alias maps to a native shell task
- `resolveTask()` returns `ProcessExecution` task when alias maps to a native process task
- `resolveTask()` checks `.workspace-tasks.json` first (takes priority over native task with same alias)
- `resolveTask()` returns `undefined` when alias not found in either source
- `resolveTask()` sets correct task scope from workspace folder URI
- `resolveTask()` merges env vars from `TaskEnvService` using the underlying task's identity
- `resolveTask()` matching uses the underlying task `taskType` (e.g. `"npm"`), not `"workspace-tasks"`
- When `TaskEnvService.resolveTaskEnv()` returns a non-empty map, `execution.options.env` is set on the returned task
- When `TaskEnvService.resolveTaskEnv()` returns an empty map, `execution.options.env` is unchanged

### NEW `src/test/suite/taskAliasService.test.ts`

- `syncAliasStubs()` creates `tasks.json` when it does not exist (workspace-tasks alias)
- `syncAliasStubs()` adds stub for new `.workspace-tasks.json` alias
- `syncAliasStubs()` adds stub for new native task alias (same file)
- `syncAliasStubs()` skips existing `workspace-tasks` stub with matching alias
- `syncAliasStubs()` does NOT skip the original native task when injecting its stub
- `syncAliasStubs()` handles multiple workspace folders independently
- `syncAliasStubs()` handles no aliases from either source (no-op)
- `syncAliasStubs()` collects aliases from both sources in one pass

## Phase 6: Wiring into Extension Activation

**`src/extension.ts`** or **`src/providers/index.ts`** — Activation sequence after this change:

```
1. WorkspaceTasksService.initialize(context)
2. NativeTaskAliasService.getInstance().loadFromWorkspaceFolders()
3. TaskEnvService.getInstance().initialize(context)   // env/secrets feature dependency
4. TaskAliasService.getInstance().syncAliasStubs()
5. vscode.tasks.registerTaskProvider('workspace-tasks', new WorkspaceAliasTaskProvider())
6. File-watcher hook: on .vscode/tasks.json change → invalidate NativeTaskAliasService → reload → syncAliasStubs
7. File-watcher hook: on .workspace-tasks.json change → syncAliasStubs (WorkspaceTasksService already reloads)
8. Subscribe to TaskEnvService.onDidChangeEnvSources to invalidate any cached resolved tasks
```

## Phase 7: Documentation

**`docs/features/custom-workspace-tasks.md`** — Add "Task Aliases" section:

- Explain the problem (label = identifier, fragile when labels change)
- Show `alias` property in `.workspace-tasks.json`
- Show `alias` property in native `.vscode/tasks.json`
- Show auto-injected stub format
- Show `launch.json` usage (`preLaunchTask`, `postDebugTask`)
- Show `dependsOn` usage from other tasks
- Note limitations: `dependsOn` chains not followed; only `shell`/`process` native types supported; `${command:...}` variables not resolved

**`README.md`** — Add brief mention of alias support under the workspace tasks section, noting it works for both `.workspace-tasks.json` and native `tasks.json` tasks.

## Relevant Files

| File | Change |
|---|---|
| `res/schemas/workspace-tasks.schema.json` | Add `alias` property |
| `src/services/workspaceTasksService.ts` | Add `alias?` to `FileTaskDefinition`; add `findTaskByAlias`, `getRawTaskCommand` |
| `src/services/nativeTaskAliasService.ts` | **NEW**: reads native tasks.json files, indexes by alias, resolves commands |
| `src/services/taskAliasService.ts` | **NEW**: auto-injects stubs into tasks.json from both alias sources |
| `src/providers/workspaceAliasTaskProvider.ts` | **NEW**: `vscode.TaskProvider` with two-stage alias lookup + `TaskEnvService` injection |
| `src/providers/index.ts` | Register `WorkspaceAliasTaskProvider`; wire `NativeTaskAliasService` reload on file change; init `TaskEnvService` |
| `package.json` | Add `contributes.taskDefinitions` |
| `src/test/suite/workspaceTasksService.test.ts` | Add alias method tests |
| `src/test/suite/nativeTaskAliasService.test.ts` | **NEW** |
| `src/test/suite/workspaceAliasTaskProvider.test.ts` | **NEW** |
| `src/test/suite/taskAliasService.test.ts` | **NEW** |
| `docs/features/custom-workspace-tasks.md` | Add "Task Aliases" section |
| `README.md` | Add brief alias mention |

## Examples

### Example 1 — Native VS Code Shell Task

**`.vscode/tasks.json`** — user writes:

```json
{
  "version": "2.0.0",
  "inputs": [
    {
      "id": "testPath",
      "type": "promptString",
      "description": "Test path",
      "default": "tests/"
    }
  ],
  "tasks": [
    {
      "label": "🐍 Run pytest",
      "alias": "python:test",
      "type": "shell",
      "command": "python -m pytest ${input:testPath} -v",
      "group": "test"
    }
  ]
}
```

**After auto-injection**, `.vscode/tasks.json` becomes:

```json
{
  "version": "2.0.0",
  "inputs": [
    {
      "id": "testPath",
      "type": "promptString",
      "description": "Test path",
      "default": "tests/"
    }
  ],
  "tasks": [
    {
      "label": "🐍 Run pytest",
      "alias": "python:test",
      "type": "shell",
      "command": "python -m pytest ${input:testPath} -v",
      "group": "test"
    },
    {
      "type": "workspace-tasks",
      "alias": "python:test",
      "label": "python:test"
    }
  ]
}
```

**`.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: Debug Tests",
      "type": "debugpy",
      "request": "launch",
      "module": "pytest",
      "preLaunchTask": "python:test"
    }
  ]
}
```

When VS Code resolves `"python:test"`:
1. Finds the stub `{ "type": "workspace-tasks", "alias": "python:test", "label": "python:test" }`
2. Calls `WorkspaceAliasTaskProvider.resolveTask()`
3. `WorkspaceTasksService.findTaskByAlias("python:test")` → not found
4. `NativeTaskAliasService.findByAlias("python:test")` → found
5. `resolveCommand()` substitutes `${input:testPath}` → `"tests/"` (default value)
6. Returns `new vscode.Task(..., new vscode.ShellExecution("python -m pytest tests/ -v"))`

---

### Example 2 — Mixed: `.workspace-tasks.json` + Native Task in Same Workspace

**`.workspace-tasks.json`**

```json
{
  "ruby": {
    "version": "2.0.0",
    "inputs": [],
    "tasks": [
      {
        "label": "bundle:install",
        "alias": "ruby:install",
        "type": "workspace",
        "command": "bundle install",
        "group": "build"
      }
    ]
  }
}
```

**`.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run RSpec Tests",
      "alias": "ruby:test",
      "type": "shell",
      "command": "bundle exec rspec",
      "group": "test"
    }
  ]
}
```

**After auto-injection**, `.vscode/tasks.json` becomes:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run RSpec Tests",
      "alias": "ruby:test",
      "type": "shell",
      "command": "bundle exec rspec",
      "group": "test"
    },
    {
      "type": "workspace-tasks",
      "alias": "ruby:install",
      "label": "ruby:install"
    },
    {
      "type": "workspace-tasks",
      "alias": "ruby:test",
      "label": "ruby:test"
    }
  ]
}
```

**`.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Ruby: Debug App",
      "type": "rdbg",
      "request": "launch",
      "script": "${workspaceFolder}/bin/rails server",
      "preLaunchTask": "ruby:install"
    },
    {
      "name": "Ruby: Debug RSpec",
      "type": "rdbg",
      "request": "launch",
      "script": "${workspaceFolder}/bin/rspec",
      "preLaunchTask": "ruby:test"
    }
  ]
}
```

`ruby:install` resolves via `WorkspaceTasksService` (`.workspace-tasks.json` source).
`ruby:test` resolves via `NativeTaskAliasService` (native tasks.json source).

---

### Example 3 — Alias Priority: Same Alias in Both Sources

If both `.workspace-tasks.json` and `.vscode/tasks.json` define a task with `"alias": "build"`, the `.workspace-tasks.json` definition wins (`WorkspaceTasksService` is checked first).

Document this as a tie-breaking rule and recommend using distinct namespaced aliases (e.g. `ws:build` vs `native:build`) to avoid ambiguity.

---

### Variable Resolution Comparison

| Variable syntax | Source | Resolved by |
|---|---|---|
| `{{ .InputId }}` | `.workspace-tasks.json` | `getRawTaskCommand()` (default value) |
| `{{ .FileName }}` | `.workspace-tasks.json` | `getRawTaskCommand()` (workspace folder basename) |
| `${input:id}` | Native `tasks.json` | `NativeTaskAliasService.resolveCommand()` (default value) |
| `${workspaceFolder}` | Native `tasks.json` | `NativeTaskAliasService.resolveCommand()` (fsPath) |
| `${workspaceFolderBasename}` | Native `tasks.json` | `NativeTaskAliasService.resolveCommand()` (folder name) |
| `${cwd}` | Native `tasks.json` | `NativeTaskAliasService.resolveCommand()` (options.cwd or fsPath) |
| `${command:...}` | Native `tasks.json` | **Not resolved** — passed through as-is |
| `${env:NAME}` | Native `tasks.json` | **Not resolved** — passed through as-is |

---

### Limitation: `dependsOn` Chains

If a native task has `dependsOn`, **only the direct command is resolved**, not the chain. If you need a pre-chain to run before a debug session, alias each task individually and use VS Code's `dependsOn` in a wrapper task:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "install",
      "alias": "ruby:install",
      "type": "shell",
      "command": "bundle install"
    },
    {
      "label": "test",
      "alias": "ruby:test",
      "type": "shell",
      "command": "bundle exec rspec"
    },
    {
      "type": "workspace-tasks",
      "alias": "ruby:install",
      "label": "ruby:install"
    },
    {
      "type": "workspace-tasks",
      "alias": "ruby:test",
      "label": "ruby:test"
    },
    {
      "label": "CI",
      "dependsOn": ["ruby:install", "ruby:test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

### Limitation: Custom Execution Types

Tasks with `"type": "npm"`, `"type": "gradle"`, etc. cannot be aliased this way. The extension cannot reconstruct a custom provider's execution from the raw JSON definition. Only `"type": "shell"` and `"type": "process"` tasks are supported.

## Verification

1. Run `npm test` — all tests pass including new alias tests
2. Run `npm run vscode:test:coverage` — new code has 100% coverage
3. **Manual — native task alias**: add `"alias": "build"` to a `shell` task in `.vscode/tasks.json`, confirm `.vscode/tasks.json` auto-gets the `workspace-tasks` stub
4. **Manual — `.workspace-tasks.json` alias**: add `"alias": "build"` to a task, confirm same stub added
5. **Manual — preLaunchTask**: add `"preLaunchTask": "build"` to `launch.json`, start debug session, confirm task runs
6. **Manual — rename label**: rename the display label in either source file (keep alias), confirm `preLaunchTask` still resolves
7. **Manual — priority**: define `"alias": "shared"` in both files, confirm `.workspace-tasks.json` task runs
8. **Manual — user profile tasks**: add `"alias": "profile:build"` to a user profile task, confirm lookup works but no stub is injected

## Differences from Original Plan (Summary)

| Aspect | Original Plan | Full Scope Plan |
|---|---|---|
| Alias sources | `.workspace-tasks.json` only | `.workspace-tasks.json` + `.vscode/tasks.json` |
| New services | `taskAliasService.ts` | `taskAliasService.ts` + `nativeTaskAliasService.ts` |
| Variable syntax | `{{ .InputId }}` | `{{ .InputId }}` + `${input:id}` |
| `resolveTask()` lookup | Single source | Two-stage (workspace-tasks first, native fallback) |
| Auto-injection target | New or existing `tasks.json` | Same `tasks.json` for native tasks (stub alongside original) |
| Supported task types | All `.workspace-tasks.json` types | `.workspace-tasks.json` + native `shell`/`process` only |
| New test files | 2 (`workspaceAliasTaskProvider`, `taskAliasService`) | 3 (`workspaceAliasTaskProvider`, `taskAliasService`, `nativeTaskAliasService`) |
