# Plan: Taskfile Wildcard Task Names & CLI_ARGS Support

## TL;DR

Add first-class support for two Taskfile-specific argument-passing features:

1. **Wildcard task names** — tasks whose name contains one or more `*` characters (e.g.
   `start:*`, `deploy:*:*`). When the user clicks **Run Task** or **Run with Args** on such
   a task, the extension prompts for a value for each wildcard before executing. The
   resolved values are spliced into the task name at run-time (e.g. `start:*` + `foo` →
   `task start:foo`).

2. **`{{.CLI_ARGS}}` forwarding** — tasks whose commands reference the Taskfile
   `{{.CLI_ARGS}}` variable. When the user selects **Run with Args** for such a task, the
   extra arguments are passed using the `--` separator required by Taskfile (`task name --
   arg1 arg2`). When the user clicks **Run Task** (no-args) the task is executed normally
   without `--`.

Both features interact when a task is **both** a wildcard task and uses `{{.CLI_ARGS}}`:
wildcards are resolved first, then the `--` args are appended.

---

## Background

### Wildcard arguments (Taskfile docs)

Taskfile supports wildcard `*` tokens in task names:

```yaml
version: '3'

tasks:
  start:*:*:
    vars:
      SERVICE: '{{index .MATCH 0}}'
      REPLICAS: '{{index .MATCH 1}}'
    cmds:
      - echo "Starting {{.SERVICE}} with {{.REPLICAS}} replicas"

  start:*:
    vars:
      SERVICE: '{{index .MATCH 0}}'
    cmds:
      - echo "Starting {{.SERVICE}}"
```

Invoked as `task start:foo` or `task start:foo:3`. The values are **not** passed as
separate arguments; they become part of the task name segment used to dispatch. The task
CLI never sees `start:*`; it receives `start:foo`.

### CLI_ARGS forwarding (Taskfile docs)

```yaml
tasks:
  yarn:
    cmds:
      - yarn {{.CLI_ARGS}}
```

Invoked as `task yarn -- install`. Everything after `--` is captured in `.CLI_ARGS` and
forwarded. Without `--`, `.CLI_ARGS` is empty.

---

## Requirements

1. The extension detects wildcard task names in the JSON output from `task --list-all --json`.
2. When `Run Task` is invoked on a wildcard task, the extension prompts for each wildcard value (required; cancelling aborts execution).
3. When `Run with Args` is invoked on a wildcard task, wildcards are resolved first, then the user is asked for additional CLI arguments.
4. The extension detects `{{.CLI_ARGS}}` usage in a task's Taskfile YAML.
5. When `Run with Args` is invoked on a `{{.CLI_ARGS}}`-aware task, arguments are appended after `--` in the shell command.
6. When `Run Task` (no args) is invoked on a `{{.CLI_ARGS}}`-aware task, the task runs normally without `--`.
7. A task may have both wildcards and `{{.CLI_ARGS}}`; both features compose correctly.
8. Wildcard metadata and `{{.CLI_ARGS}}` metadata are stored in `TaskItem.metadata`.
9. Detection must not spawn additional processes; YAML is parsed from the file that is already known from the task's `location.taskfile`.
10. All new code has 100% test coverage.

---

## Critique & Responses (Rubber-Duck Review)

A sub-agent critique identified 13 issues with the initial design. Each is addressed below.

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | Critical | `resolvedLabel` on a cached singleton creates a race condition between two rapid clicks | **Removed `resolvedLabel` from `TaskItem`. Pass resolved name as a new `resolvedLabel` parameter down to `createTask` instead.** |
| 2 | Critical | Order of wildcard prompt vs cache resolution not explicit — prompted before cache resolves the real item | **Plan explicitly requires wildcard prompt to run after cache resolution.** |
| 3 | High | `getSystemTasks()` calls `parseOutput` directly, bypassing `_loadTasksFromDirectory` — would skip CLI_ARGS detection | **`getSystemTasks()` updated to read global YAML and pass it to `parseOutput`.** |
| 4 | High | Included Taskfiles (`includes:`) are not scanned for `{{.CLI_ARGS}}` | **Documented as known limitation. A debug warning is logged. Future work can recurse includes.** |
| 5 | High | `replace('*', value)` — if user types `*` as a value, subsequent iteration corrupts the template | **Replaced with index-based substitution using `slice + concat`.** |
| 6 | Medium | No `validateInput` — blank string accepted, producing e.g. `deploy::v2` | **Added `validateInput` rejecting empty/whitespace-only strings.** |
| 7 | Medium | YAML parse errors bubble up through `_loadTasksFromDirectory`'s `try/catch`, silently returning `[]` and masking all tasks | **`detectCLIArgsTasks` wraps `parse()` in its own `try/catch`, returning empty `Set` on failure.** |
| 8 | Medium | `onDidDelete` does not invalidate the CLI_ARGS cache | **Cache invalidation called from `onDidDelete` handlers as well as `onCreate`/`onChange`.** |
| 9 | Medium | `runTaskTool.ts` (LM tool) calls `TaskRunner.runTask` directly, bypassing wildcard prompting | **`runTaskTool.ts` updated to call a shared `resolveWildcardForItem(item)` helper before invoking the runner. LM tool context is non-interactive so it should return an error if wildcards are required (cannot prompt).** |
| 10 | Medium | Restart task clears `resolvedLabel` state — restarting `deploy:*:*` would invoke the template name, failing | **After a successful wildcard run, store the last resolved label in `item.metadata.lastResolvedLabel`. Restart uses this value, re-prompting only if unavailable.** |
| 11 | Low | No tree UX hint that a task is a wildcard task | **Tooltip update included in Phase 7. Label unchanged.** |
| 12 | Low | Wildcard detection on alias items is ambiguous — Taskfile alias wildcards are `aliases: [run:*]` | **Confirmed: Taskfile does support wildcard aliases. Detection applies to alias label string identically to task names. If the alias contains `*`, it is a wildcard alias.** |
| 13 | High | Test plan was incomplete | **All new code paths added to test matrix in Phase 8.** |

---

## Key Design Decisions

### Decision 1: Where to store metadata

Both features require metadata on `TaskItem`:
- `metadata.isWildcardTask: boolean` — true when name contains `*`
- `metadata.wildcardCount: number` — number of `*` in the name
- `metadata.hasCLIArgs: boolean` — true when any command in the task body contains `{{.CLI_ARGS}}`
- `metadata.lastResolvedLabel?: string` — populated after a successful wildcard run, for restart support

This metadata is set in `parseOutput` (for wildcard detection) and in a new synchronous
helper that reads the Taskfile YAML (for `{{.CLI_ARGS}}` detection).

**Alternative considered**: lazy detection at run-time. Rejected — metadata is cheap to
compute at parse time and is needed by both `RunTaskCommand` and `RunTaskWithArgsCommand`.
Encoding it in metadata is consistent with how `isAlias`, `isGlobalTask`, `aliases`, etc.
are stored today.

### Decision 2: How to detect `{{.CLI_ARGS}}`

The `task --json` output does not include command bodies. Options:

| Option | Pros | Cons |
|--------|------|------|
| Parse Taskfile YAML using existing `yaml` package | Precise per-task detection | Requires YAML parsing on every discovery |
| Raw string search in full YAML text | Simple, no parsing | False positives if `{{.CLI_ARGS}}` appears in comments or other tasks |
| Always treat every taskfile task as potentially having CLI_ARGS | No detection needed | Breaks every run-with-args invocation (extra `--` that task doesn't expect) |

**Chosen**: Parse YAML using the `yaml` package (already a direct dependency). Task body is
determined by indexing into `parsed.tasks[taskName].cmds` and checking each entry for the
`{{.CLI_ARGS}}` substring. Since YAML is read from disk once per file, not per task, a
single parse serves all tasks from that file. The parsed result is cached in a `Map<string,
Set<string>>` (file path → set of task names with CLI_ARGS) within the provider instance,
invalidated when the file watcher fires a change, create, or delete event.

**Known limitation**: Taskfile `includes:` definitions pull in tasks from external YAML
files. Those external files are **not** scanned by this implementation. A task whose
commands live in an included file will not be detected as `hasCLIArgs`. This is documented
and a debug warning is logged.

### Decision 3: Wildcard prompting — where in the call stack

Options:
- In `RunTaskCommand.run()` / `RunTaskWithArgsCommand.run()` (command layer)
- In `TaskRunner.runTask()` (runner layer)
- In `TaskfileTaskProvider.createTask()` (provider layer)

**Chosen**: A new utility function `promptAndResolveWildcards(templateName, wildcardCount)`
called from both `RunTaskCommand.run()` and `RunTaskWithArgsCommand.run()` (command layer),
similar to how `tryGuidedInputWithStatus` / `collectAdditionalArgs` are called today. This
keeps interactive prompting out of the runner and provider, which are also used in tests
and non-interactive flows (e.g. compound tasks, recents replay).

The resolved name is passed as an explicit `resolvedLabel` **parameter** to `createTask`
rather than as a mutable property on the cached `TaskItem`. This avoids a race condition
when the same cached item is used twice concurrently (two rapid clicks). **Wildcard
prompting must occur after the cache resolution step** (which replaces the serialized
command argument with the live cached instance).

### Decision 4: `--` separator for CLI_ARGS

When a task has `hasCLIArgs = true` and the user provides args via **Run with Args**, the
args should be passed as `-- arg1 arg2` at the end of the command. This requires
`createTask` to be aware of `hasCLIArgs`. The cleanest approach is:

- `createTask` signature gains an optional `resolvedLabel?: string` parameter.
- `createTask` checks `item.metadata?.hasCLIArgs === true` when an `args` string is
  non-empty, and inserts `--` before the args.
- The `--` separator is only inserted when `args` is non-empty after trimming (no-args
  invocations are unaffected).

### Decision 5: Alias items and wildcards

Wildcard aliases (e.g. `aliases: [run:*]`) also contain `*`. Taskfile's documentation
confirms aliases work with wildcards: `task run:foo` dispatches to `start:*` via its
`run:*` alias. The alias `TaskItem` child records the alias as `label`; its
`metadata.isAlias = true` and `metadata.primaryTask` = parent name. Wildcard detection
applies to alias items too: `metadata.isWildcardTask` and `metadata.wildcardCount` are set
on both parent and alias items when the name/alias contains `*`. The alias prompt resolves
the alias pattern (e.g. `run:*`) — the resolved alias name is then invoked, and Taskfile
routes it to the correct task internally.

### Decision 6: LM Tool handling

The LM tool (`runTaskTool.ts`) is a non-interactive context. If a wildcard task is invoked
via the tool, the user cannot be prompted. The tool receives wildcard values as part of its
invocation parameters (or as a structured input field). If no wildcard values are
available, the tool returns an error message explaining that the task requires wildcard
values and cannot be run without them. Future enhancement: accept wildcard values as an
optional input field in the tool's schema.

---

## Implementation Phases

### Phase 1: Wildcard Detection in `parseOutput`

**File: `src/providers/taskfileTaskProvider.ts`**

In `parseOutput`, after creating the `TaskItem`:

```ts
const wildcardCount = (entry.name.match(/\*/g) ?? []).length;
if (wildcardCount > 0) {
  item.metadata = {
    ...item.metadata,
    isWildcardTask: true,
    wildcardCount,
  };
}
```

Alias items: same logic applied to each alias string. Wildcard aliases are real Taskfile
features (e.g. `aliases: [run:*]`) so they must also receive `isWildcardTask` / `wildcardCount`.

---

### Phase 2: `{{.CLI_ARGS}}` Detection

**File: `src/providers/taskfileTaskProvider.ts`**

Add a private in-memory cache:

```ts
private cliArgsTaskCache = new Map<string, Set<string>>();
```

Add a method `detectCLIArgsTasks(filePath: string, content: string): Set<string>`:

1. If `cliArgsTaskCache` has an entry for `filePath`, return the cached set.
2. Wrap the body in `try/catch` — return empty `Set` and log a debug warning if the YAML
   cannot be parsed (malformed file does not propagate errors into the discovery path).
3. Parse the YAML with `import { parse } from 'yaml'`.
4. Iterate `parsed?.tasks` (object whose keys are task names).
5. For each task, collect the `cmds` array and check if any entry (string or `{cmd: string}`
   object) contains the substring `{{.CLI_ARGS}}`.
6. Collect matching task names into a `Set<string>`, store in cache, return.

**Note**: Tasks from included Taskfiles (`includes:`) appear in the `task --json` output
under namespaced names but their commands live in external YAML files. Those external files
are **not** scanned. If an included task uses `{{.CLI_ARGS}}`, it will not be detected.
A debug warning is logged when any `includes:` key is found, alerting developers to this
limitation. This is deferred for future work.

**Cache invalidation**: call `invalidateCLIArgsCache(filePath: string)` — which deletes the
map entry — from the watcher `onDidCreate`, `onDidChange`, *and* `onDidDelete` handlers for
each Taskfile, before the debounced refresh fires.

**Integration into `parseOutput`**:

`parseOutput` signature update:

```ts
public parseOutput(
  stdout: string,
  dir: string,
  iconService?: TaskIconService,
  taskfilePath?: string,
  yamlContent?: string,
): TaskItem[]
```

`_loadTasksFromDirectory` reads the YAML file and passes content + path:

```ts
private async _loadTasksFromDirectory(dir, representativeFile, iconService): Promise<TaskItem[]> {
  // ... existing execFileAsync call ...
  let yamlContent: string | undefined;
  try {
    const bytes = await vscode.workspace.fs.readFile(representativeFile);
    yamlContent = new TextDecoder().decode(bytes);
  } catch { /* non-fatal */ }

  return this.parseOutput(stdout, dir, iconService, representativeFile.fsPath, yamlContent);
}
```

`getSystemTasks()` also calls `parseOutput` directly. It must be updated to read the global
Taskfile YAML and pass it:

```ts
// After discovering globalTaskfilePath:
let globalYamlContent: string | undefined;
try {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalTaskfilePath));
  globalYamlContent = new TextDecoder().decode(bytes);
} catch { /* non-fatal */ }

const items = this.parseOutput(stdout, homeDir, iconService, globalTaskfilePath, globalYamlContent);
```

Within `parseOutput`, call `detectCLIArgsTasks(taskfilePath, yamlContent)` once per
invocation, then for each `entry`, check `cliArgsSet.has(entry.name)` and set
`metadata.hasCLIArgs = true`.

---

### Phase 3: Wildcard Prompt Utility

**New file: `src/libs/taskfileWildcardUtils.ts`**

```ts
import * as vscode from 'vscode';

/**
 * Prompts the user to supply a value for each `*` wildcard in the given
 * Taskfile task name pattern.  Returns the resolved task name (e.g. `start:foo:3`)
 * or `undefined` when the user cancels any prompt.
 *
 * Each `*` is replaced left-to-right with the user-supplied value using
 * index-based substitution (safe even when a user-supplied value contains `*`).
 */
export async function promptAndResolveWildcards(
  templateName: string,
  wildcardCount: number,
): Promise<string | undefined> {
  const parts = templateName.split('*');  // [before1, before2, ..., afterLast]
  const values: string[] = [];

  for (let i = 0; i < wildcardCount; i++) {
    const position = i + 1;
    const value = await vscode.window.showInputBox({
      title: `Wildcard argument ${position} of ${wildcardCount}`,
      prompt: `Enter value for wildcard ${position} in task "${templateName}"`,
      placeHolder: `value${position}`,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() === '' ? 'Value cannot be empty' : undefined),
    });
    if (value === undefined) {
      return undefined; // user cancelled
    }
    values.push(value);
  }

  // Interleave parts and values: parts[0] + values[0] + parts[1] + values[1] + ...
  return parts.reduce((acc, part, i) => acc + part + (i < values.length ? values[i] : ''), '');
}
```

Using `split('*')` and interleaving with the collected values is safe regardless of whether
any value itself contains a `*` character.

---

### Phase 4: Passing Resolved Label to `createTask`

The resolved label is passed as a new optional parameter to `createTask` rather than stored
on the `TaskItem` instance. This avoids mutating the cached singleton and eliminates the
race condition between two rapid invocations of the same wildcard task.

`TaskfileTaskProvider.createTask` signature change:

```ts
async createTask(item: TaskItem, args?: string, resolvedLabel?: string): Promise<CreatedTask | undefined>
```

Inside `createTask`:

```ts
const taskLabel = resolvedLabel ?? item.originalLabel ?? (item.label as string);
```

For `{{.CLI_ARGS}}` — insert `--` separator only when `hasCLIArgs` is true **and** `args`
is non-empty after trimming:

```ts
const hasArgs = args && args.trim().length > 0;
if (hasArgs && item.metadata?.hasCLIArgs === true) {
  taskArgs.push(taskLabel, '--', ...splitArgs(args));
} else {
  taskArgs.push(taskLabel, ...splitArgs(args ?? ''));
}
```

The `createTask` interface is defined in `BaseTaskProvider` / `TaskProvider`. The signature
update must be applied there as well.

For **restart support**: after a successful wildcard run, `TaskRunner.runTask()` sets
`item.metadata.lastResolvedLabel = resolvedLabel`. When `RestartTaskCommand` or
`RecentTasksService` re-invokes the task, it reads `item.metadata.lastResolvedLabel` to
skip the prompt. Future enhancement: provide an option to re-prompt.

---

### Phase 5: `RunTaskCommand` Updates

**File: `src/commands/runTask.ts`**

Import `promptAndResolveWildcards` from `../libs/taskfileWildcardUtils`.

In `RunTaskCommand.run()`, **after** the cache resolution block:

```ts
let resolvedLabel: string | undefined;
if (item.metadata?.isWildcardTask === true) {
  resolvedLabel = await promptAndResolveWildcards(
    item.label as string,
    item.metadata.wildcardCount as number,
  );
  if (resolvedLabel === undefined) {
    return; // user cancelled
  }
}
await TaskRunner.getInstance().runTask(item, undefined, false, resolvedLabel);
```

`TaskRunner.runTask` gains a new optional `resolvedLabel` parameter, which it passes
through to `createTaskForItem` → `createTask`.

---

### Phase 6: `RunTaskWithArgsCommand` Updates

**File: `src/commands/runTaskWithArgs.ts`**

Updated flow:

1. Confirm guard
2. Cache resolution (existing)
3. **[NEW]** If `isWildcardTask`, prompt for wildcards → capture `resolvedLabel`; cancel → return
4. Try guided input (unchanged)
5. Collect additional args (unchanged)
6. Call `TaskRunner.getInstance().runTask(item, args.join(' '), true, resolvedLabel)`

The `--` separator is handled inside `createTask` based on `hasCLIArgs`. When the user
provides no extra args (empty string), `splitArgs('')` is empty and `--` is not inserted,
so the task runs identically to "Run Task".

---

### Phase 7: `TaskRunner.runTask` and `createTaskForItem` Signature Updates

`TaskRunner.runTask(item, args?, skipGuard?, resolvedLabel?)` → passes `resolvedLabel` to
`createTaskForItem(item, args, resolvedLabel)` → calls `provider.createTask(item, args, resolvedLabel)`.

**File: `src/taskFactory.ts`**

`createTaskForItem` (or equivalent dispatch function) updated to accept and pass
`resolvedLabel`.

After a successful `vscode.tasks.executeTask(task)` call, `TaskRunner.runTask` persists:

```ts
if (resolvedLabel && item.metadata?.isWildcardTask) {
  item.metadata.lastResolvedLabel = resolvedLabel;
}
```

---

### Phase 8: `runTaskTool.ts` (LM Tool)

**File: `src/tools/runTaskTool.ts`**

The LM tool runs in a non-interactive context. For wildcard tasks:

- If the task has `isWildcardTask = true` and the tool's invocation does not supply wildcard
  values (no relevant input field), the tool returns an explanatory error message:
  > "This task requires wildcard values but none were provided. Please specify the wildcard
  > values to run `{taskName}`."
- Future enhancement: add an optional `wildcardValues: string[]` field to the tool's input
  schema so the LM can supply them.

For `hasCLIArgs` tasks, the tool already accepts a `args` / `arguments` field. The `--`
separator is handled in `createTask`, so no special LM tool logic is required beyond
passing args normally.

---

### Phase 9: Tree View Display

Wildcard tasks in the tree view show with `*` in their label, e.g. `start:*`. This is
already correct since `entry.name` from `task --json` includes the literal `*`.

**Tooltip update** in `parseOutput` when `isWildcardTask`:

```ts
item.tooltip = `${entry.desc || entry.name}\n\nWildcard task — you will be prompted for each * when running.`;
```

---

### Phase 10: Tests

**`src/test/suite/taskfileTaskProvider.test.ts`** (existing)

Add test group `"wildcard and CLI_ARGS detection"`:

| ID | Description |
|----|-------------|
| T-W1 | `parseOutput` sets `isWildcardTask = true` and `wildcardCount = 1` for `start:*` |
| T-W2 | `parseOutput` sets `wildcardCount = 2` for `start:*:*` |
| T-W3 | `parseOutput` leaves `isWildcardTask` unset for non-wildcard tasks |
| T-W4 | `parseOutput` sets `isWildcardTask` on alias items when alias contains `*` |
| T-C1 | `detectCLIArgsTasks` returns task name when `cmds` has string cmd with `{{.CLI_ARGS}}` |
| T-C2 | `detectCLIArgsTasks` returns task name when `cmds` has `{cmd: "... {{.CLI_ARGS}} ..."}` object |
| T-C3 | `detectCLIArgsTasks` does not return task name when `{{.CLI_ARGS}}` absent |
| T-C4 | `detectCLIArgsTasks` caches result (second call with same path returns cached set, no re-parse) |
| T-C5 | `parseOutput` sets `hasCLIArgs = true` on item when task is in cliArgs set |
| T-C6 | Cache invalidated by `invalidateCLIArgsCache` |
| T-C7 | `detectCLIArgsTasks` returns empty `Set` (not throw) when YAML is malformed |
| T-C8 | `getSystemTasks` passes YAML content to `parseOutput` (hasCLIArgs propagated for global tasks) |
| T-C9 | `onDidDelete` event triggers cache invalidation |

**New `src/test/suite/taskfileWildcardUtils.test.ts`**

| ID | Description |
|----|-------------|
| T-P1 | Single wildcard resolved correctly |
| T-P2 | Two wildcards resolved in order |
| T-P3 | User cancels first prompt → returns `undefined` |
| T-P4 | User cancels second prompt of two → returns `undefined` |
| T-P5 | Value containing `*` does not corrupt subsequent wildcard substitution |
| T-P6 | `validateInput` rejects blank string |

**`src/test/suite/runTask.test.ts`** (extend)

| ID | Description |
|----|-------------|
| T-R1 | `RunTaskCommand` calls `promptAndResolveWildcards` after cache resolution when `isWildcardTask` |
| T-R2 | `RunTaskCommand` passes `resolvedLabel` to `runTask` |
| T-R3 | `RunTaskCommand` aborts when wildcard prompt is cancelled |
| T-R4 | `RunTaskCommand` skips wildcard prompt for non-wildcard tasks |

**`src/test/suite/runTaskWithArgs.test.ts`** (extend)

| ID | Description |
|----|-------------|
| T-A1 | Wildcard prompt shown (after cache resolution) before guided input |
| T-A2 | Cancel on wildcard prompt aborts without calling `runTask` |
| T-A3 | `resolvedLabel` passed to `runTask` when wildcards provided |
| T-A4 | `hasCLIArgs` task: args passed to `runTask`, `--` inserted in `createTask` |

**`src/test/suite/taskfileTaskProvider.createTask.test.ts`** (extend or new)

| ID | Description |
|----|-------------|
| T-CT1 | `createTask` uses `resolvedLabel` param when provided |
| T-CT2 | `createTask` falls back to `originalLabel` then `label` when `resolvedLabel` absent |
| T-CT3 | `createTask` inserts `--` before args when `hasCLIArgs = true` and args non-empty |
| T-CT4 | `createTask` does NOT insert `--` when args is empty string |
| T-CT5 | `createTask` does NOT insert `--` when args is undefined |
| T-CT6 | `createTask` does NOT insert `--` when `hasCLIArgs` is false/unset |

---

### Phase 11: Documentation

**`docs/features/running-tasks.md`** — Add section "Wildcard Tasks":

- Explain wildcard syntax with Taskfile YAML example
- Show prompts the user sees for each `*`
- Note that empty values are rejected
- Note limitation: wildcards in included Taskfiles shown with `*` in tree but not detected
  for CLI_ARGS

**`docs/features/running-tasks.md`** — Add section "CLI_ARGS Forwarding":

- Explain `{{.CLI_ARGS}}` and `--` separator Taskfile behaviour
- Describe extension behaviour with Run with Args vs Run Task
- Note limitation: tasks in included Taskfiles are not scanned for `{{.CLI_ARGS}}`

**`README.md`** — Brief mention under "Taskfile support" section.

---

## Relevant Files

| File | Change |
|------|--------|
| `src/providers/taskfileTaskProvider.ts` | Wildcard + CLI_ARGS detection in `parseOutput`; `detectCLIArgsTasks` + cache; YAML read in `_loadTasksFromDirectory` and `getSystemTasks`; `createTask(item, args, resolvedLabel)` |
| `src/libs/taskfileWildcardUtils.ts` | **NEW** — `promptAndResolveWildcards` |
| `src/commands/runTask.ts` | Wildcard prompt after cache resolution; pass `resolvedLabel` to runner |
| `src/commands/runTaskWithArgs.ts` | Wildcard prompt before guided/free input; pass `resolvedLabel` to runner |
| `src/taskRunner.ts` | Add optional `resolvedLabel` param; persist `lastResolvedLabel` on success |
| `src/taskFactory.ts` | Pass `resolvedLabel` through to provider `createTask` |
| `src/taskProvider.ts` | Update `createTask` interface signature |
| `src/tools/runTaskTool.ts` | Return error for wildcard tasks without values |
| `src/test/suite/taskfileTaskProvider.test.ts` | Wildcard + CLI_ARGS detection tests |
| `src/test/suite/taskfileWildcardUtils.test.ts` | **NEW** — prompt utility tests |
| `src/test/suite/runTask.test.ts` | Wildcard command flow tests |
| `src/test/suite/runTaskWithArgs.test.ts` | Wildcard + CLI_ARGS command flow tests |
| `src/test/suite/taskfileTaskProvider.createTask.test.ts` | `createTask` tests |
| `docs/features/running-tasks.md` | Wildcard and CLI_ARGS documentation |
| `README.md` | Brief mention |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| YAML parse failure for malformed Taskfile | `detectCLIArgsTasks` wraps `parse()` in its own `try/catch`; returns empty `Set` and logs warning; task listing is unaffected |
| Included Taskfile tasks not detected for `{{.CLI_ARGS}}` | Documented limitation; debug warning logged when `includes:` key found |
| Wildcard value containing `:` (Taskfile namespace separator) | Values used verbatim; user is responsible. Documented. |
| Race condition on rapid double-click | Eliminated by using `resolvedLabel` as a parameter, not a mutable property |
| Restart task after wildcard run invokes template name | `lastResolvedLabel` persisted in `metadata` after successful run; restart uses it |
| LM tool cannot prompt for wildcards | Tool returns explanatory error; future work adds `wildcardValues` input field |
| `createTask` interface change breaks other providers | Other providers do not implement the `resolvedLabel` parameter; it is optional with `?` — no breakage |
