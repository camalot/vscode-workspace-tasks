# Plan: Taskfile Required Variables Interactive Prompting

## TL;DR

Add support for prompting users to supply values for required Taskfile variables (declared
under `requires.vars`) before executing a task. Prompting occurs:

1. **Always** when the user clicks **Run with Args** and the task has required variables.
2. **Automatically** when the user clicks **Run Task** if the Taskfile declares
   `interactive: true` at the file level.

Variables with an `enum` field show a QuickPick menu; plain variables show an InputBox.
Collected values are passed to the `task` CLI as `VAR=value` assignments, placed between
the task name and any `--` separator (for tasks that also use `{{.CLI_ARGS}}`).

---

## Background

### Taskfile Required Variables

Taskfile v3 supports declaring required input variables per task under `requires.vars`:

```yaml
version: '3'
interactive: true   # enables prompting at the file level

tasks:
  deploy:
    requires:
      vars:
        - name: ENVIRONMENT
          enum: [dev, staging, prod]
        - VERSION
    cmds:
      - echo "Deploying {{.VERSION}} to {{.ENVIRONMENT}}"
```

Each entry in `requires.vars` is either:

- A plain string (`- VERSION`) — free-form text prompt
- An object with `name` and optional `enum` (`- {name: ENVIRONMENT, enum: [dev, staging, prod]}`)
  — QuickPick selection

When running `task deploy` interactively, the CLI prompts for each required variable that
has not already been set. Variables are supplied to the CLI as positional assignments:

```shell
task deploy ENVIRONMENT=staging VERSION=1.0.0
```

### `interactive: true`

The `interactive` flag is a **file-level** setting in the Taskfile. When `true`, the
Taskfile is designed for interactive terminal use and missing required variables trigger
prompts from the CLI itself. Without this flag, running a task with missing required vars
causes the CLI to fail immediately with an error.

VS Code mirrors this semantics:

- `interactive: true` → prompt even on plain **Run Task** click (user opted in to prompting
  at the Taskfile level)
- No `interactive` flag → prompt **only** on **Run with Args** (user explicitly requested
  to supply args via VS Code's UI)

Reference: [Prompting for Missing Variables Interactively](https://taskfile.dev/docs/guide#prompting-for-missing-variables-interactively)

---

## Requirements

1. Parse `requires.vars` for each task during YAML-based task discovery.
2. Detect the file-level `interactive: true` flag during discovery.
3. Store required-var metadata on `TaskItem.metadata`: `requiredVars: TaskfileRequiredVar[]`
   and `isInteractive: boolean`.
4. **Run Task** (`runTask.ts`): if `metadata.requiredVars.length > 0` AND
   `metadata.isInteractive === true`, prompt for each required var before executing.
5. **Run with Args** (`runTaskWithArgs.ts`): if `metadata.requiredVars.length > 0`, always
   prompt for each required var automatically (before the additional-args step).
6. Variables with `enum` show a `vscode.window.showQuickPick`; plain vars show a
   `vscode.window.showInputBox`.
7. Both prompt types use `ignoreFocusOut: true`; empty/whitespace-only inputs are rejected.
8. Cancelling any required-var prompt aborts task execution (returns `undefined`).
9. Collected var values are passed as shell-quoted `VAR='value'` tokens between the task
   name and any `--` separator in the CLI command.
10. Feature composes correctly with wildcard tasks and `{{.CLI_ARGS}}` tasks.
11. No additional processes spawned; detection uses the YAML content already read during
    discovery.
12. Cache detection results by file path; invalidate on file-watcher events (same pattern
    as `cliArgsTaskCache`).
13. All new code paths have 100% test coverage.

---

## Key Design Decisions

### Decision 1: Detection approach

**Chosen**: A new `detectRequiredVars(filePath, content)` method on `TaskfileTaskProvider`,
modelled on the existing `detectCLIArgsTasks`. It returns a `RequiredVarsInfo` object:

```typescript
interface RequiredVarsInfo {
  isInteractive: boolean;
  tasks: Map<string, TaskfileRequiredVar[]>;
}
```

Results are cached in `requiredVarsCache: Map<string, RequiredVarsInfo>` and invalidated
alongside `cliArgsTaskCache` by a renamed `invalidateTaskfileCache(filePath)` method.

**Alternative considered**: Inline detection inside `detectCLIArgsTasks`. Rejected — the
two concerns are orthogonal, combining them would make each harder to test independently and
would bloat an already complex method.

**Alternative considered**: Run `task --json` with extra flags. Rejected — no additional
processes (requirement 11); the JSON output from `task --list-all --json` does not include
`requires.vars` or the `interactive` flag.

**Alternative considered**: Register a `ScriptArgumentResolver` for `.yml`/`.yaml` files
and reuse the existing `tryGuidedInputWithStatus` / `collectGuidedArgs` pipeline. Rejected
for two independent reasons:

1. **Scope mismatch** — `resolve(filePath, content)` receives no task name. A Taskfile
   contains N tasks with N independent `requires.vars` sets; a resolver registered for
   `.yml` cannot know which task is running. The registry routes by file extension; the
   task identity (`item.label`) is never forwarded to `resolve()`.

2. **Output format mismatch** — `collectGuidedArgs` produces CLI-flag tokens
   (`--flag value`, `-Flag value`). Taskfile variables must be passed as assignment tokens
   (`VAR=value`). There is no `ScriptParameter` configuration that produces the assignment
   format without modifying `collectGuidedArgs` itself, which would affect all existing
   resolvers.

   Fixing (1) would require adding `context?: { taskName?: string }` to `resolve()` — a
   breaking interface change. Fixing (2) would require a new `ScriptParameter.type` or an
   `outputFormat` flag on `collectGuidedArgs`. Both changes add complexity to shared
   infrastructure that correctly serves existing resolvers, with no benefit to them.
   The dedicated `detectRequiredVars` + `promptAndResolveRequiredVars` approach is
   task-aware at discovery time (runs inside `parseOutput` where the task name is known)
   and produces the correct assignment format directly.

### Decision 2: Interface for required variable metadata

```typescript
// src/libs/taskfileVarPromptUtils.ts
export interface TaskfileRequiredVar {
  name: string;
  enum?: string[];
  // NOTE: the Taskfile spec also supports a `msg` field (custom error text when missing).
  // It is intentionally not stored — it has no prompting use case in the VS Code UI.
}
```

Stored in `TaskItem.metadata`:

- `metadata.requiredVars: TaskfileRequiredVar[]` — vars declared in `requires.vars`
- `metadata.isInteractive: boolean` — mirrors the file-level `interactive:` flag

The `isInteractive` flag lives at the `TaskItem` level (not per-var) because it is a
file-level property that applies uniformly to all tasks in that Taskfile.

### Decision 3: Prompting utility

A new function `promptAndResolveRequiredVars(vars, taskName)` in a new file
`src/libs/taskfileVarPromptUtils.ts`. Returns `string[]` (shell-quoted `VAR='value'` tokens)
on success or `undefined` on cancel. This mirrors the signature style of
`promptAndResolveWildcards`.

Values are single-quote-wrapped with escaped inner single quotes to handle spaces and shell
metacharacters (`$`, `*`, `"`, etc.) safely when spread into a `ShellExecution` args array.

```typescript
export async function promptAndResolveRequiredVars(
  vars: TaskfileRequiredVar[],
  taskName: string,
): Promise<string[] | undefined> {
  const assignments: string[] = [];
  for (const v of vars) {
    const title = `${taskName} — required variable "${v.name}"`;
    let value: string | undefined;
    if (v.enum && v.enum.length > 0) {
      value = await vscode.window.showQuickPick(v.enum, {
        title,
        placeHolder: `Select value for ${v.name}`,
        ignoreFocusOut: true,
      });
    } else {
      value = await vscode.window.showInputBox({
        title,
        prompt: `Enter value for ${v.name}`,
        ignoreFocusOut: true,
        validateInput: (s) => (s.trim() === '' ? 'Value cannot be empty' : undefined),
      });
    }
    if (value === undefined) { return undefined; } // cancelled
    const safeValue = value.replace(/'/g, "'\\''");
    assignments.push(`${v.name}='${safeValue}'`);
  }
  return assignments;
}
```

### Decision 4: Passing var assignments through the call stack

The Taskfile CLI expects var assignments between the task name and the `--` separator:

```shell
task deploy ENV='staging' VERSION='1.0' -- extra-cli-arg
```

The existing `args` string passed through `runTask → createTaskForItem → createTask` is
used for free-form additional arguments and is currently placed either directly after the
task name (no CLI_ARGS) or after `--` (has CLI_ARGS). Prepending var assignments to `args`
would break CLI_ARGS tasks.

**Chosen**: Add an optional `varAssignments?: string[]` parameter to the call chain:

| Function | New signature addition |
| --- | --- |
| `TaskRunner.runTask` | `varAssignments?: string[]` (5th param) |
| `createTaskForItem` | `varAssignments?: string[]` (4th param) |
| `_buildTask` | `varAssignments?: string[]` (4th param) |
| `BaseTaskProvider.createTask` | `varAssignments?: string[]` (4th param) |
| `TaskfileTaskProvider.createTask` | `varAssignments?: string[]` (4th param, used) |

All new parameters are optional; all other providers ignore `varAssignments`. The change is
fully backward-compatible.

In `TaskfileTaskProvider.createTask`:

```typescript
taskArgs.push(taskLabel);
if (varAssignments?.length) {
  taskArgs.push(...varAssignments);        // AFTER task name
}
if (hasArgs && item.metadata?.hasCLIArgs === true) {
  taskArgs.push('--', ...splitArgs(args!)); // AFTER var assignments
} else if (hasArgs) {
  taskArgs.push(...splitArgs(args!));
}
```

**Alternative considered**: Encode var assignments into the `args` string and parse at
`createTask` level. Rejected — fragile; `splitArgs` treats all tokens uniformly and does
not understand the `VAR=value` vs `--extra` distinction at the right level.

**Alternative considered**: Mutate `item.metadata.varAssignments` before calling
`runTask`. Rejected — the `TaskItem` is a cached singleton; concurrent rapid clicks would
race on the same object (same reasoning as the `resolvedLabel` race that was caught in the
wildcard plan).

### Decision 5: `runTask` vs `runTaskWithArgs` semantics

- **`runTask.ts`** and **`restartTask.ts`**: Only prompt when both `requiredVars.length > 0`
  AND `isInteractive === true`. The prompting block lives inside `TaskRunner.runTask` itself
  (not just in `RunTaskCommand.run`) so all callers — including `restartTask.ts` — pick it
  up automatically. Respects the user's Taskfile-level opt-in for interactive mode. A task
  with required vars but no `interactive: true` runs without prompting — the CLI will report
  the missing variable error, which is the correct, expected behavior.
- **`runTaskWithArgs.ts`**: Prompts unconditionally when `requiredVars.length > 0`. The
  user explicitly chose to supply arguments, so required vars are always collected first in
  the command layer before calling `TaskRunner.runTask`.

### Decision 6: Prompt ordering in `runTaskWithArgs`

The complete prompting sequence in `runTaskWithArgs`:

1. Confirm run guard (existing)
2. Resolve wildcards (existing)
3. **Collect required var values** (new) — `varAssignments` stored separately
4. Try guided script input (existing — always "unavailable" for Taskfile `.yml` files since
   no script resolver matches YAML)
5. Collect additional free-form args (existing)
6. Call `TaskRunner.runTask(item, extraArgs.join(' '), true, resolvedLabel, varAssignments)`

Required vars are collected before additional args because they are declared constraints in
the Taskfile definition; extra args are user-supplied addenda.

### Decision 7: Cache invalidation

Both `cliArgsTaskCache` and `requiredVarsCache` are derived from the same file content.
They must be invalidated together. `invalidateCLIArgsCache` is renamed to
`invalidateTaskfileCache` and clears both caches. All existing callers are updated:

- File-watcher `onEvent` callbacks in `reconcileGlobalTaskfileWatchers`
- A new workspace-file watcher registered in `getTasks()` (see Issue 9 resolution)
- All test stubs that call the old method name

### Decision 8: Alias items (revised after critique)

Initial design did NOT propagate `requiredVars` to alias items. The critique (Issue 6)
identified that aliases run via the LM tool would pass the required-vars guard (because
`requiredVars` is absent on the alias item) and then fail at the CLI level with a cryptic
error.

**Revised decision**: Propagate `requiredVars` to alias items. The Taskfile CLI resolves
aliases to their parent task, so the same variables are required regardless of which label
is invoked. Propagating makes alias behavior consistent with parent task behavior in all
contexts (tree-view, LM tool, restart).

Both `isInteractive` and `requiredVars` are propagated to alias `TaskItem` children in
`parseOutput`.

### Decision 9: LM Tool handling

`runTaskTool.ts` is non-interactive. If a task has `requiredVars`, the tool cannot prompt.
Initial implementation: inspect `metadata.requiredVars`; if present and non-empty, return
an informative error message listing the required variable names and directing the user to
use the **Run with Args** command in VS Code (where prompting will occur automatically).

Future enhancement: add a `variables` input field to the tool schema so LM agents can
supply required vars explicitly.

### Decision 10: Tooltip enrichment

Tasks with `requiredVars` receive an additional tooltip section. The tooltip type guard
(`typeof item.tooltip === 'string'`) is required because `item.tooltip` is typed as
`string | vscode.MarkdownString | undefined` and `+=` on a `MarkdownString` would produce
`"[object Object]..."`.

```typescript
if (requiredVars.length > 0 && typeof item.tooltip === 'string') {
  const varNames = requiredVars.map((v) => v.name).join(', ');
  item.tooltip += `\n\nRequires variables: ${varNames}`;
  if (isInteractive) {
    item.tooltip += '\nInteractive mode — you will be prompted for these when running.';
  }
}
```

---

## Implementation Phases

### Phase 1: New utility file — `src/libs/taskfileVarPromptUtils.ts`

Create a new file exporting:

- `TaskfileRequiredVar` interface (`name: string; enum?: string[]`) with JSDoc noting the
  intentional omission of `msg`
- `promptAndResolveRequiredVars(vars, taskName)` async function (see Decision 3)

### Phase 2: Detection in `taskfileTaskProvider.ts`

**New field on the class**:

```typescript
private requiredVarsCache = new Map<string, RequiredVarsInfo>();
```

**New method**: `detectRequiredVars(filePath: string, content: string): RequiredVarsInfo`

Logic:

1. Return cached value if present.
2. Sanitize YAML (same Go-template stripping as `detectCLIArgsTasks` — replace `{{...}}`
   patterns with placeholders so `yaml.parse` succeeds).
3. Parse YAML. Read `parsed['interactive'] === true` → `isInteractive`.
4. For each task in `parsed['tasks']`, read `taskDef['requires']?.['vars']`. Each array
   element is mapped as follows — invalid types (null, number, array) are skipped with a
   debug log:
   - `typeof entry === 'string'` → `{ name: entry }`
   - `entry && typeof entry === 'object' && 'name' in entry` → `{ name: entry.name, enum: entry.enum }`
5. After mapping, filter any entry whose `name` equals `'__WORKSPACE_TASKS_TPL__'`, and
   filter that placeholder from any `enum` arrays. Log a debug warning per filtered entry.
6. Cache `{ isInteractive, tasks }` and return.
7. On parse error: log debug, cache `{ isInteractive: false, tasks: new Map() }`, return.

**Rename** `invalidateCLIArgsCache` → `invalidateTaskfileCache`:

```typescript
public invalidateTaskfileCache(filePath: string): void {
  this.cliArgsTaskCache.delete(filePath);
  this.requiredVarsCache.delete(filePath);
}
```

Update all callers:

- `onEvent` callbacks in `reconcileGlobalTaskfileWatchers`
- New workspace-file watcher in `getTasks()` that calls `invalidateTaskfileCache(filePath)`
  for each discovered workspace Taskfile on create/change/delete events (mirrors global
  watcher pattern, fixes the stale-cache bug for in-session workspace Taskfile edits)

### Phase 3: Metadata enrichment in `parseOutput`

After the existing `cliArgsSet` detection block:

```typescript
const reqVarsInfo = taskfilePath && yamlContent
  ? this.detectRequiredVars(taskfilePath, yamlContent)
  : { isInteractive: false, tasks: new Map<string, TaskfileRequiredVar[]>() };
```

In the task loop, extend `item.metadata`:

```typescript
const requiredVars = reqVarsInfo.tasks.get(entry.name) ?? [];
const isInteractive = reqVarsInfo.isInteractive;

item.metadata = {
  ...item.metadata,
  ...(requiredVars.length > 0 ? { requiredVars } : {}),
  ...(isInteractive ? { isInteractive: true } : {}),
};
```

For alias items: propagate **both** `requiredVars` and `isInteractive` (revised per
critique Issue 6 — aliases must expose the same required-vars guard as the primary task):

```typescript
aliasItem.metadata = {
  ...aliasItem.metadata,
  ...(requiredVars.length > 0 ? { requiredVars } : {}),
  ...(isInteractive ? { isInteractive: true } : {}),
};
```

Extend the tooltip for tasks with required vars (type-guarded per critique Issue 14):

```typescript
if (requiredVars.length > 0 && typeof item.tooltip === 'string') {
  const varNames = requiredVars.map((v) => v.name).join(', ');
  item.tooltip += `\n\nRequires variables: ${varNames}`;
  if (isInteractive) {
    item.tooltip += '\nInteractive mode — you will be prompted for these when running.';
  }
}
```

### Phase 4: `TaskRunner.runTask` — interactive var prompting

Move the `isInteractive` var-prompting into `TaskRunner.runTask` so that `restartTask.ts`
and any other direct callers also receive prompting without duplicating logic in every
command.

After the guard check, before `createTaskForItem`:

```typescript
// Only auto-prompt for interactive Taskfiles when the caller hasn't already collected vars
if (!varAssignments && item.metadata?.requiredVars?.length > 0
    && item.metadata?.isInteractive === true) {
  varAssignments = await promptAndResolveRequiredVars(
    item.metadata.requiredVars as TaskfileRequiredVar[],
    item.label as string,
  );
  if (varAssignments === undefined) { return false; } // cancelled
}
```

Note: this block is inside the `else` branch (non-compound tasks). The `queuedTask` /
compound-task path is unaffected. This must be enforced with a comment in the code and a
test (see Phase 9).

**`runTask.ts` command**: no prompting block needed — simply calls
`TaskRunner.getInstance().runTask(item, undefined, false, resolvedLabel)` after wildcard
resolution. `TaskRunner` handles the rest.

### Phase 4b: `runActiveEditorTask.ts` and `runActiveEditorTaskWithArgs.ts`

Both editor-context commands call `TaskRunner.runTask` directly without var-prompting. For
the `isInteractive` case, `TaskRunner.runTask` now handles prompting (Phase 4) so
`runActiveEditorTask.ts` picks it up automatically.

For `runActiveEditorTaskWithArgs.ts`, add the same unconditional `requiredVars` collection
block as `runTaskWithArgs.ts` (Phase 5) before the additional-args step.

### Phase 5: `runTaskWithArgs.ts` changes

After wildcard resolution, before guided input:

```typescript
let varAssignments: string[] | undefined;
if (item.metadata?.requiredVars?.length > 0) {
  varAssignments = await promptAndResolveRequiredVars(
    item.metadata.requiredVars as TaskfileRequiredVar[],
    item.label as string,
  );
  if (varAssignments === undefined) { return; } // cancelled
}
```

Pass `varAssignments` to both branches of the runner call:

```typescript
// guided-input branch:
await TaskRunner.getInstance().runTask(item, mergedArgs.join(' '), true, resolvedLabel, varAssignments);

// free-form branch:
await TaskRunner.getInstance().runTask(item, extraArgs.join(' '), true, resolvedLabel, varAssignments);
```

### Phase 6: Thread `varAssignments` through the call stack

**`TaskRunner.runTask`** — add 5th optional param:

```typescript
public async runTask(
  item: TaskItem,
  args?: string,
  skipGuard = false,
  resolvedLabel?: string,
  varAssignments?: string[],
): Promise<boolean>
```

Pass `varAssignments` to `createTaskForItem`.

**`createTaskForItem` / `_buildTask`** (`taskFactory.ts`) — add 4th optional param:

```typescript
export async function createTaskForItem(
  item: TaskItem,
  args?: string,
  resolvedLabel?: string,
  varAssignments?: string[],
): Promise<CreatedTask | undefined>
```

Pass `varAssignments` to `registryProvider.createTask(item, args, resolvedLabel, varAssignments)`.

**`BaseTaskProvider.createTask`** — add 4th optional param (ignored in base):

```typescript
createTask(
  _item: TaskItem,
  _args?: string,
  _resolvedLabel?: string,
  _varAssignments?: string[],
): Promise<CreatedTask | undefined>
```

**`TaskfileTaskProvider.createTask`** — add 4th param and use it (see Decision 4).

### Phase 7: `createTask` implementation in `TaskfileTaskProvider`

```typescript
async createTask(
  item: TaskItem,
  args?: string,
  resolvedLabel?: string,
  varAssignments?: string[],
): Promise<CreatedTask | undefined> {
  // ... existing setup (taskCmd, taskArgs preamble, --taskfile flag) ...

  taskArgs.push(taskLabel);

  if (varAssignments?.length) {
    taskArgs.push(...varAssignments);         // VAR='value' BEFORE any --
  }

  const hasArgs = args !== undefined && args.trim().length > 0;
  if (hasArgs && item.metadata?.hasCLIArgs === true) {
    taskArgs.push('--', ...splitArgs(args!)); // CLI_ARGS after --
  } else if (hasArgs) {
    taskArgs.push(...splitArgs(args!));
  }

  // ... rest unchanged ...
}
```

### Phase 8: LM Tool update (`src/tools/runTaskTool.ts`)

In the tool's run handler, after retrieving the `TaskItem`:

```typescript
if (item.metadata?.requiredVars?.length > 0) {
  const names = (item.metadata.requiredVars as TaskfileRequiredVar[])
    .map((v) => v.name)
    .join(', ');
  return {
    content: [{
      type: 'text',
      text: `Task "${item.label as string}" requires variables: ${names}. ` +
            `Use the "Run with Args" command in VS Code to be prompted for these values.`,
    }],
    isError: true,
  };
}
```

### Phase 9: Tests

#### `src/test/suite/taskfileVarPromptUtils.test.ts` (new)

- `promptAndResolveRequiredVars` with a single enum var → `showQuickPick` called with enum
  values; selected value returned as `NAME='value'`
- `promptAndResolveRequiredVars` with a single plain var → `showInputBox` called; entered
  value returned as `NAME='value'`
- Value containing a space → correctly shell-quoted as `NAME='my value'`
- Value containing single-quote → correctly escaped as `NAME='it'\''s'`
- Multiple vars → each prompt called in order; all `NAME='value'` tokens returned
- Cancellation on first var → returns `undefined`
- Cancellation on second var (after first succeeds) → returns `undefined`
- Empty string input for plain var → `validateInput` returns error string (not accepted)
- `ignoreFocusOut` is `true` for both prompt types
- Entry with `msg` field in YAML object → parsed without error; `msg` field ignored

#### `src/test/suite/taskfileTaskProvider.test.ts` (existing — add cases)

- `detectRequiredVars` with task having `requires.vars` as strings → `TaskfileRequiredVar[]`
  with `name` only
- `detectRequiredVars` with task having `requires.vars` as objects with `enum` → enum
  values preserved
- `detectRequiredVars` with `requires.vars` object also containing `msg` → parsed without
  error; `msg` ignored
- `detectRequiredVars` reads `interactive: true` at file level
- `detectRequiredVars` returns `isInteractive: false` when flag is absent
- `detectRequiredVars` returns empty `tasks` map for task without `requires.vars`
- `detectRequiredVars` handles YAML parse errors → returns empty result, logs debug message
- `detectRequiredVars` returns cached result on second call (no re-parse)
- `detectRequiredVars` filters `__WORKSPACE_TASKS_TPL__` placeholder from var names and
  enum values, logs debug warning
- `detectRequiredVars` skips `null`, number, and array entries in `requires.vars`, logs
  debug warning
- `invalidateTaskfileCache` clears both `cliArgsTaskCache` and `requiredVarsCache`
  (replaces the existing test at line ~788 that calls `invalidateCLIArgsCache` by name)
- `parseOutput` populates `metadata.requiredVars` from `detectRequiredVars`
- `parseOutput` populates `metadata.isInteractive` from `detectRequiredVars`
- `parseOutput` propagates both `requiredVars` and `isInteractive` to alias items
- `parseOutput` tooltip includes required var names when `requiredVars` present
- `parseOutput` tooltip includes "Interactive mode" hint when `isInteractive` is true
- `parseOutput` does not mutate tooltip when `item.tooltip` is not a plain string

#### `src/test/suite/taskfileTaskProvider.createTask.test.ts` (existing or new section)

- `createTask` with `varAssignments` → tokens appear after task name, before any extra args
- `createTask` with `varAssignments` + `hasCLIArgs` + `args` → order is
  `[taskname, VAR='v', --, extra-args]`
- `createTask` with `varAssignments` only (no `args`) → no `--` added
- `createTask` without `varAssignments` → existing behavior unchanged

#### `src/test/suite/runTask.test.ts` (existing — add cases)

- Task with `requiredVars` and `isInteractive: true` → `promptAndResolveRequiredVars`
  called inside `TaskRunner.runTask`; var assignments forwarded to `createTaskForItem`
- Task with `requiredVars` but `isInteractive: false/undefined` → `promptAndResolveRequiredVars`
  NOT called; task executed directly
- Task with `requiredVars` and `isInteractive: true`, prompt cancelled → task NOT executed,
  `runTask` returns `false`
- Task without `requiredVars` → no prompting; existing behavior unchanged
- Task with `contextValue === 'queuedTask'` → `promptAndResolveRequiredVars` NOT called,
  `runCompoundTask` is called instead (guards the compound-task path)
- Caller-supplied `varAssignments` → skips internal prompting even when `isInteractive`
  (allows `runTaskWithArgs` to collect vars first)

#### `src/test/suite/runTaskWithArgs.test.ts` (existing — add cases)

- Task with `requiredVars` → `promptAndResolveRequiredVars` called before additional args
- Var prompt cancelled → task NOT executed, additional args prompt NOT shown
- Task with `requiredVars` + additional args → both `varAssignments` and extra args
  forwarded correctly
- Task with `requiredVars` + `hasCLIArgs` → command string contains `VAR='v'` before `--`
  (verified via `CreatedTask.command`)
- Task without `requiredVars` → no var prompting; existing behavior unchanged

### Phase 10: Documentation

- Add a CHANGELOG entry describing the new feature with an example Taskfile snippet.
- Inline JSDoc on `promptAndResolveRequiredVars` explaining the return contract and quoting
  behaviour.
- A note in `createTask`'s JSDoc about the `varAssignments` parameter and its placement
  before `--`.
- Note the known limitation (copyTaskCommand, included Taskfiles) in inline code comments
  near the relevant call sites.

---

## Interaction with Existing Features

| Feature | Interaction |
| --- | --- |
| Wildcard task names | Wildcards resolved first, then required vars prompted |
| `{{.CLI_ARGS}}` tasks | Var assignments placed before `--`, CLI args after |
| Wildcard + CLI_ARGS | Order: wildcards → vars → `--` → CLI args |
| Guided script input | Always "unavailable" for Taskfile `.yml` (no script resolver matches YAML) |
| Aliases | Both `isInteractive` and `requiredVars` propagated (revised — see Decision 8) |
| LM Tool (`runTaskTool`) | Returns structured error listing required var names |
| Task restart (`restartTask`) | Re-prompts via `TaskRunner.runTask` internal block (no bypass) |
| Global Taskfiles | Works identically — `detectRequiredVars` is path-agnostic |
| Included Taskfiles | Required vars in included files are NOT detected (known limitation, same as CLI_ARGS) |
| Copy Task command | Copied command omits var assignments — known limitation, user adds vars manually |

---

## Critique & Responses (Rubber-Duck Review)

A sub-agent critique identified 17 issues with the initial design. Each is addressed below.

| # | Severity | Issue | Resolution |
| --- | --- | --- | --- |
| 1 | Medium | `msg` field in `requires.vars` objects is silently dropped | Noted in interface JSDoc; test case added for entries containing `msg` |
| 2 | **High** | `VAR=value` tokens not shell-quoted — values with spaces/special chars break invocation | Shell-quote each value in `promptAndResolveRequiredVars` before building the token |
| 3 | **High** | `runActiveEditorTask.ts` and `runActiveEditorTaskWithArgs.ts` not updated | Added as Phase 4b — both commands receive the same var-prompting treatment |
| 4 | Medium | `restartTask.ts` bypasses prompting — restarts required-var tasks without vars | Moved `isInteractive` prompting into `TaskRunner.runTask`; all callers benefit |
| 5 | Low | Plan doesn't document that compound-task path is already guarded | Explicit comment requirement added in Phase 4; test case added in Phase 9 |
| 6 | Medium | Alias items pass LM tool check but CLI fails without required vars | `requiredVars` now propagated to alias items (Decision 8 revised) |
| 7 | Info | `getSystemTasks` metadata spreading correctly preserves required vars | Confirmed correct — no change needed |
| 8 | Medium | `invalidateCLIArgsCache` rename breaks existing test at line ~788 | Test call site explicitly listed in Phase 9; rename is still correct |
| 9 | Medium | Workspace Taskfile edits don't invalidate the in-session cache (existing bug) | Workspace-file watcher added in Phase 2 to call `invalidateTaskfileCache` |
| 10 | Low | `copyTaskCommand` copies command without var assignments | Documented as known limitation in Interaction table |
| 11 | Low | Defensive check missing for empty-string enum values | Placeholder-filtering step in Phase 2 covers malformed enums |
| 12 | Info | Cancel detection for `showQuickPick` vs `showInputBox` is correct | Confirmed — no change |
| 13 | Low | Missing test: `queuedTask` path does not trigger var-prompt | Added test case to Phase 9 |
| 14 | Medium | `item.tooltip +=` string on potentially `MarkdownString` tooltip value | `typeof item.tooltip === 'string'` guard added in Phase 3 and Decision 10 |
| 15 | Medium | YAML sanitization placeholder `__WORKSPACE_TASKS_TPL__` could appear in QuickPick | Post-parse filtering step added in Phase 2 `detectRequiredVars` logic |
| 16 | Low | Missing null/number guard in `detectRequiredVars` entry mapper | Explicit type guards added in Phase 2 pseudocode |
| 17 | Low | LM tool error text incorrectly implies manual `VAR=value` syntax | Updated error message directs user to "Run with Args" command instead |

### Detailed Responses

#### Issue 2 — Shell quoting (High)

`varAssignments` tokens (e.g. `ENV=my value`) are spread directly into `taskArgs`, which is
passed to `new vscode.ShellExecution(cmd, taskArgs)`. VS Code passes each array element
as a separate shell word, but does not quote values containing spaces or shell metacharacters.

**Resolution**: In `promptAndResolveRequiredVars`, single-quote-wrap each value with
embedded single-quote escaping before assembling the token:

```typescript
const safeValue = value.replace(/'/g, "'\\''");
assignments.push(`${v.name}='${safeValue}'`);
```

Test cases added for values containing spaces and single quotes.

#### Issue 3 — Missing editor commands (High)

`runActiveEditorTask.ts` and `runActiveEditorTaskWithArgs.ts` invoke `TaskRunner.runTask`
without the var-prompting step. Since `isInteractive` prompting now lives inside
`TaskRunner.runTask`, `runActiveEditorTask.ts` is automatically covered. Phase 4b adds the
unconditional `requiredVars` collection to `runActiveEditorTaskWithArgs.ts`.

#### Issue 4 — `restartTask.ts` bypass (Medium)

`restartTask.ts` calls `TaskRunner.runTask` directly, bypassing any command-layer prompting.
The cleanest fix is to move the `isInteractive` prompting block inside `TaskRunner.runTask`
itself. The command layer (`runTaskWithArgs`) still collects vars unconditionally before
calling the runner — passing them as `varAssignments` prevents double-prompting because the
internal block is guarded by `!varAssignments`.

#### Issue 6 — Alias + LM tool (Medium)

The initial design did NOT propagate `requiredVars` to alias items. The critique identified
that aliases would silently pass the LM tool guard and then fail at the CLI with a cryptic
error. **Revised**: propagate both `requiredVars` and `isInteractive` to alias items.
Aliases route to their parent task at the CLI level, so the same variables are always
required.

#### Issue 9 — Workspace file watcher (Medium)

The `TaskfileTaskProvider` uses `reconcileGlobalTaskfileWatchers` for global Taskfiles but
had no per-workspace-file watcher. Workspace file changes trigger a full cache refresh that
calls `parseOutput` → `detectRequiredVars` — but both returned cached results. Workspace
Taskfile edits within a session were silently ignored by both caches.

**Resolution**: Register a workspace-file watcher per discovered Taskfile in `getTasks()`
that calls `invalidateTaskfileCache(filePath)` on create/change/delete events. This is the
same watcher pattern used for global Taskfiles and fixes the latent bug for both the
`cliArgsTaskCache` (existing) and `requiredVarsCache` (new).

#### Issue 14 — Tooltip type safety (Medium)

`item.tooltip` is typed as `string | vscode.MarkdownString | undefined`. Using `+=` on a
`MarkdownString` instance produces `"[object Object]\n\n..."`. A `typeof` guard is required
before any concatenation.

#### Issue 15 — Sanitization placeholder leaking (Medium)

The YAML sanitization replaces all `{{...}}` patterns with `__WORKSPACE_TASKS_TPL__`. In a
malformed Taskfile, a `requires.vars` entry name or enum value could be replaced by this
placeholder and then appear in the QuickPick list or tooltip. Post-parse filtering removes
any entry whose `name` equals the placeholder and removes the placeholder from `enum` arrays,
logging a debug warning per filtered occurrence.

---

## Open Questions

1. Should `enum` values support a display label separate from the stored value (e.g.
   `{value: prod, description: "Production environment"}`)? Not in current Taskfile spec —
   deferred.
2. Should required vars be cached between runs (to avoid re-prompting on restarts)?
   Initial answer: no — variables may change between runs and re-prompting is safer. Can be
   revisited if user feedback indicates friction.
3. Should the `isInteractive` flag also affect the LM tool (i.e. allow running if
   `isInteractive: false` and required vars are present)? Currently the LM tool checks only
   for required vars, not the interactive flag. This seems correct — the interactive flag
   governs Taskfile CLI prompting behaviour, not the VS Code tool's interactivity.
