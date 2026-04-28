# Plan: Language Model Tools — `workspaceTasks_getTasks` + `workspaceTasks_runTask`

## TL;DR

Implement two VS Code Language Model Tools for the Workspace Tasks extension:

1. **`workspaceTasks_getTasks`** (`#wTasks`) — exposes all discovered tasks to
   Copilot's agent mode so the LLM can reason about what is available.
2. **`workspaceTasks_runTask`** (`#runWTask`) — executes a specific task by its
   stable ID (or by label + type), delegating to the existing `TaskRunner`.

Together these tools let the user say "run the build task" in agent mode and have
Copilot discover, confirm, and execute the task without leaving the chat.

---

## Requirements

### `workspaceTasks_getTasks`

1. Contribute a `languageModelTools` entry to `package.json` so the tool is visible
   to agent mode and can be referenced via `#wTasks`.
2. Implement the tool as a class that satisfies `vscode.LanguageModelTool<T>`.
3. The tool must:
   - Check `vscode.workspace.isTrusted`; return an empty result with an explanatory
     message if the workspace is not trusted.
   - Recursively collect leaf tasks from `TaskCacheService.getAllTasks()` (some
     providers, e.g. `githubActionsTaskProvider`, `circleCiTaskProvider`,
     `bitbucketPipelinesTaskProvider`, return hierarchical `TaskItem` trees where
     the actual runnable tasks are `.children` of group nodes — a flat pass over the
     top-level items would silently miss them).
   - Optionally filter by a `query` string (case-insensitive substring match on
     label) and/or a `taskType` string.
   - Enforce a maximum result count (`MAX_TASKS_RETURNED = 500`) and include
     truncation metadata when the limit is hit.
   - Return a structured JSON payload wrapped in a `LanguageModelTextPart`.
4. Register the tool during extension activation via `vscode.lm.registerTool`.
5. Ship with 100 % unit-test coverage of `getTasksTool.ts`.
6. Add documentation under `docs/features/`.

### `workspaceTasks_runTask`

1. Contribute a second `languageModelTools` entry to `package.json`, referenceable
   via `#runWTask`.
2. Implement the tool as a class satisfying `vscode.LanguageModelTool<T>`.
3. The tool must:
   - Check `vscode.workspace.isTrusted` — refuse with an explanatory message if
     untrusted.
   - Accept a task `id` (preferred — stable portable ID from `#wTasks` output)
     and/or a `label` + optional `taskType` for looser lookup.
   - Look up the task via `TaskCacheService.getTask(id)` (exact) or by scanning
     leaf tasks by label (fuzzy).
   - If the label matches multiple tasks, return them as candidates and ask for an
     `id`.
   - Fold run-guard awareness into `prepareInvocation`: check
     `TaskRunGuardService.isGuarded()` and mention it in the confirmation message;
     then pass `skipGuard = true` to `TaskRunner.runTask()` to avoid a duplicate
     modal.
   - Call `TaskRunner.getInstance().runTask(item, undefined, true)` on confirmation.
   - Return a result indicating whether the task was submitted (task runs
     asynchronously — the tool does not wait for completion).
4. Register during extension activation alongside `workspaceTasks_getTasks`.
5. Ship with 100 % unit-test coverage of `runTaskTool.ts`.
6. Document under `docs/features/`.

---

## Self-Critique & Viability Assessment

**Strengths:**

- `TaskCacheService.getAllTasks()` aggregates every provider's discovered tasks; no
  new discovery logic is required.
- The VS Code LM Tools API is stable in VS Code >= 1.105.1 (the current engine
  floor), so no engine-version gate is needed.
- A `query` + `taskType` filter keeps the returned payload small for large
  monorepos, improving LLM context efficiency.
- `TaskRunner.runTask()` already handles task creation, guard checks, state
  management, and error handling — the run tool is a thin adapter, not a new
  execution layer.

**Risks / Weaknesses:**

- **Nested task trees (MUST-FIX confirmed)**: Multiple providers — including
  `jupyterTaskProvider`, `bitbucketPipelinesTaskProvider`, `circleCiTaskProvider`,
  `gitlabCiTaskProvider`, `githubActionsTaskProvider`, and `taskfileTaskProvider` —
  return group `TaskItem`s that contain actual runnable tasks as `.children`. Since
  `getAllTasks()` returns only the top-level provider items (not their children), the
  tool must walk the full tree recursively to collect all leaf tasks.
- **Cold-start staleness**: If the task cache has not yet been populated (extension
  just activated), `getAllTasks()` returns `[]`. The tool detects `isLoading()` and
  surfaces that state along with an explanatory message.
- **Untrusted workspace**: Must guard with `vscode.workspace.isTrusted` per project
  Task Provider Guidelines.
- **Payload size**: The optional `query`/`taskType` parameters and a hard
  `MAX_TASKS_RETURNED = 500` cap mitigate token-window overflow.
- **`runTask` is a state-changing operation**: Must always show a confirmation
  dialog via `prepareInvocation`. VS Code guarantees a generic confirmation is always
  shown for extension tools; `prepareInvocation` customises it with task-specific
  context.
- **Double guard confirmation**: `TaskRunner.runTask()` calls
  `TaskRunGuardService.confirmIfNeeded()`, which would produce a second modal after
  the LM tool's confirmation. Fix: when the task was **resolved in `prepareInvocation`**,
  check `isGuarded()` there and annotate the confirmation message; then pass
  `skipGuard = true` to `runTask()`. However, when `prepareInvocation` fell back to a
  generic message (task not found at that point) or when `invoke` is called
  programmatically without a prior `prepareInvocation` call, `invoke` must check
  `isGuarded()` itself and pass `skipGuard = false` to ensure the guard modal fires.
- **Task runs asynchronously**: The tool returns immediately after
  `vscode.tasks.executeTask()` is called. The LLM should be told the task was
  *started*, not *completed*.

**Verdict:** Two focused tools with well-defined responsibilities. Primary
engineering effort is the recursive tree walk in `getTasks` and the multi-path
task-lookup + guard-fold logic in `runTask`.

---

## Key Design Decisions

### `workspaceTasks_getTasks` tool identity

| Field | Value |
|---|---|
| `name` | `workspaceTasks_getTasks` |
| `displayName` | `Get Workspace Tasks` |
| `toolReferenceName` | `wTasks` |
| `icon` | `$(list-flat)` |
| `canBeReferencedInPrompt` | `true` |

> **Why `wTasks` not `workspaceTasks`?** Short, distinctive, and scoped to this
> extension. Avoids collisions with other extensions' tools without being verbose.

### `workspaceTasks_runTask` tool identity

| Field | Value |
|---|---|
| `name` | `workspaceTasks_runTask` |
| `displayName` | `Run Workspace Task` |
| `toolReferenceName` | `runWTask` |
| `icon` | `$(run)` |
| `canBeReferencedInPrompt` | `true` |

> **Why `runWTask` not `runTask`?** VS Code's built-in task command palette and
> other extensions likely register `runTask`-like identifiers. Prefixing with `WT`
> (Workspace Tasks) prevents collisions.

### `workspaceTasks_getTasks` input schema

```jsonc
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional case-insensitive substring to filter task labels."
    },
    "taskType": {
      "type": "string",
      "description": "Optional task type to filter by (e.g. 'npm', 'gulp', 'shell')."
    }
  }
}
```

### `workspaceTasks_getTasks` output format

```jsonc
{
  "isLoading": false,
  "isTrusted": true,
  "explanation": null,
  "truncated": false,
  "totalBeforeTruncation": 42,
  "tasks": [
    {
      "id": "my-app:package.json:build",
      "label": "build",
      "type": "npm",
      "source": "package.json",
      "workspaceFolder": "my-app"
    }
  ]
}
```

When `isLoading` is `true` or `isTrusted` is `false`, `tasks` is `[]` and
`explanation` contains a human-readable description of why no tasks were returned.

### `workspaceTasks_runTask` input schema

```jsonc
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable portable task ID from workspaceTasks_getTasks output. Preferred."
    },
    "label": {
      "type": "string",
      "description": "Task label to look up. May match multiple tasks."
    },
    "taskType": {
      "type": "string",
      "description": "Task type to disambiguate label matches (e.g. 'npm', 'shell')."
    }
  }
}
```

At least one of `id` or `label` must be provided (enforced at runtime; the LLM
instruction in `modelDescription` is sufficient for the happy path).

### `workspaceTasks_runTask` output format

```jsonc
// Success:
{
  "started": true,
  "taskId": "my-app:package.json:build",
  "label": "build",
  "type": "npm",
  "message": "Task 'build' started successfully. It is running asynchronously in the terminal."
}

// Failure — ambiguous label:
{
  "started": false,
  "message": "Multiple tasks match label 'build'. Provide the 'id' parameter.",
  "candidates": [
    { "id": "my-app:package.json:build", "label": "build", "type": "npm", "source": "package.json" }
  ]
}

// Failure — not found:
{ "started": false, "message": "No task found. Use #wTasks to list available tasks." }

// Failure — untrusted workspace:
{ "started": false, "message": "This workspace is not trusted." }
```

### Task lookup priority (in `runTask`)

1. If `id` provided → `TaskCacheService.getInstance().getTask(id)` (O(1) exact)
   - If not found AND no `label` given → return specific error:
     `"Task with ID '${id}' not found. The cache may still be loading. Use #wTasks to discover current IDs."`
2. Else if `label` provided → collect leaf tasks, filter by exact label match
   (case-insensitive), narrow by `taskType` if provided
3. If no exact match found, **do not silently fall back to substring match**.
   Instead return `{started: false, candidates: [...substring matches], message:
   "No exact match for 'X'. Did you mean one of these? Provide the 'id' for precision."}`
4. One exact result → proceed; multiple exact results → ambiguous error with candidates;
   zero exact and zero substring → not-found error

### Run-guard fold

`prepareInvocation` resolves the task and builds the confirmation message:

```
Run task 'label'?
Type: `type`  |  Source: `source`
⚠️ This task is marked as guarded.   // only when isGuarded() is true
```

`invoke` applies the following guard logic to avoid double-confirmation while
preserving security:
- If the task was resolved in `prepareInvocation` (happy path), the guard warning
  was already shown in the confirmation message → call `runTask(item, undefined, true)`
  (`skipGuard = true`).
- If `prepareInvocation` fell back to a generic message OR `invoke` is called
  programmatically (no prior `prepareInvocation`), `invoke` must check
  `TaskRunGuardService.getInstance().isGuarded(item)` and call
  `runTask(item, undefined, !isGuarded)` — allowing the guard modal to fire if needed.

To distinguish these two paths, `RunTaskTool` stores the resolved task ID on a
private field (`_pendingTaskId: string | undefined`) during `prepareInvocation`. If
`_pendingTaskId` matches the resolved item's `id` in `invoke`, `skipGuard = true`;
otherwise `skipGuard = false`.

If `prepareInvocation` cannot resolve the task, it falls back to:
```typescript
return {
  invocationMessage: 'Running workspace task...',
  confirmationMessages: {
    title: 'Run Workspace Task',
    message: new vscode.MarkdownString('Run the requested workspace task?'),
  },
};
```
The authoritative lookup always happens in `invoke`.

### Shared utility module

Both tools share recursive collection logic, extracted to `src/tools/taskToolsUtils.ts`:

```typescript
export interface TaskSummary { id: string | null; label: string; type: string; source: string | null; workspaceFolder?: string; }
export function isLeafTask(item: TaskItem): boolean
export function collectLeafTasks(items: TaskItem[]): TaskItem[]
export function toSummary(item: TaskItem): TaskSummary
```

**Critical**: `collectLeafTasks` uses an `else` branch to prevent double-adding nodes
that are both leaf (have a `task`) AND have children (dependency sub-nodes):
```typescript
if (isLeafTask(item)) {
  result.push(item);
} else if (item.children && item.children.length > 0) {
  result.push(...collectLeafTasks(item.children));
}
```
Without the `else`, compound tasks with `dependsOn` children would add both the
compound task AND its non-runnable dependency visualisation nodes.

`toSummary` returns `id: item.id ?? null` (not empty string) so callers can
distinguish "no stable ID" from "empty ID".

### Sorting (`getTasks` only)

Results are sorted deterministically by `(type, label)` ascending so that repeated
invocations return a stable order.

### `prepareInvocation` for `getTasks`

Returns `invocationMessage: 'Fetching available workspace tasks...'` with no
confirmation dialog. The tool is read-only and poses no risk to the workspace.

---

## Files To Create / Modify

### New files

| File | Purpose |
|---|---|
| `src/tools/taskToolsUtils.ts` | Shared helpers: `collectLeafTasks`, `isLeafTask`, `toSummary`, `TaskSummary` |
| `src/tools/getTasksTool.ts` | `GetTasksTool` class + `IGetTasksParameters` interface |
| `src/tools/runTaskTool.ts` | `RunTaskTool` class + `IRunTaskParameters` interface |
| `src/tools/index.ts` | Barrel exporting `registerLmTools(context)` |
| `src/test/suite/taskToolsUtils.test.ts` | Unit tests — `taskToolsUtils.ts` (100 % coverage) |
| `src/test/suite/getTasksTool.test.ts` | Unit tests — `getTasksTool.ts` (100 % coverage) |
| `src/test/suite/runTaskTool.test.ts` | Unit tests — `runTaskTool.ts` (100 % coverage) |
| `docs/features/lm-tool.md` | User-facing documentation for both tools |

### Modified files

| File | Change |
|---|---|
| `package.json` | Add two `contributes.languageModelTools` entries |
| `src/extension.ts` | `import { registerLmTools }` and call on activation |
| `docs/features/index.md` | Add link to `lm-tool.md` |
| `README.md` | Add one-liner about LM tools in features section |

---

## Implementation Steps

### Step 1 — `package.json` contributions

Add to `contributes.languageModelTools`:

```jsonc
[
  {
    "name": "workspaceTasks_getTasks",
    "displayName": "Get Workspace Tasks",
    "canBeReferencedInPrompt": true,
    "toolReferenceName": "wTasks",
    "icon": "$(list-flat)",
    "userDescription": "Lists all tasks available in the current workspace.",
    "modelDescription": "Returns a JSON array of all runnable tasks in the workspace (id, label, type, source file, workspace folder). Use when the user asks which tasks are available or wants to find a task by name. Apply 'query' to filter by label substring and 'taskType' to filter by type. When 'isLoading' is true, re-invoke after a delay. When 'truncated' is true, apply filters. Results sorted by type then label.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Case-insensitive label substring filter." },
        "taskType": { "type": "string", "description": "Task type filter (e.g. 'npm', 'shell')." }
      }
    }
  },
  {
    "name": "workspaceTasks_runTask",
    "displayName": "Run Workspace Task",
    "canBeReferencedInPrompt": true,
    "toolReferenceName": "runWTask",
    "icon": "$(run)",
    "userDescription": "Runs a task from the workspace. Use #wTasks first to discover available task IDs.",
    "modelDescription": "Executes a workspace task by its stable ID (preferred) or by label + optional taskType. Provide 'id' from workspaceTasks_getTasks for precise lookup. If only 'label' is given and multiple tasks match, the tool returns candidates. The task runs asynchronously; the tool returns immediately. Always use workspaceTasks_getTasks first to get the task ID.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "Stable task ID from workspaceTasks_getTasks. Preferred." },
        "label": { "type": "string", "description": "Task label. May match multiple tasks." },
        "taskType": { "type": "string", "description": "Task type to narrow label matches." }
      }
    }
  }
]
```

### Step 2 — `src/tools/taskToolsUtils.ts`

Shared helpers used by both tools. Key functions:

- `isLeafTask(item)` — returns `true` when `collapsibleState === None` OR `item.task !== undefined`
- `collectLeafTasks(items)` — recursive walk collecting all leaf tasks
- `toSummary(item)` — maps a `TaskItem` to a `TaskSummary` (id, label, type, source, workspaceFolder)

### Step 3 — `src/tools/getTasksTool.ts`

`GetTasksTool` class:

- `prepareInvocation` → returns `invocationMessage` only (no confirmation, read-only)
- `invoke`:
  1. Early exit if `token.isCancellationRequested`
  2. Check `vscode.workspace.isTrusted`
  3. Check `TaskCacheService.getInstance().isLoading()`
  4. Collect leaf tasks via `collectLeafTasks(cache.getAllTasks())`
  5. Filter by `query` and `taskType`
  6. Sort by `(type, label)`
  7. Truncate at `MAX_TASKS_RETURNED = 500`
  8. Return `LanguageModelToolResult` with JSON payload

### Step 4 — `src/tools/runTaskTool.ts`

`RunTaskTool` class:

- `prepareInvocation` → resolves task (best effort), builds confirmation message with
  task details; falls back to generic if not found
- `invoke`:
  1. Early exit if `token.isCancellationRequested`
  2. Check `vscode.workspace.isTrusted`
  3. Resolve task using updated priority (see Task lookup priority section)
  4. Return ambiguous/no-exact-match error with candidates if needed
  5. Return specific not-found error if zero candidates
  6. Determine `skipGuard` via `_pendingTaskId` match (see Run-guard fold section)
  7. Call `TaskRunner.getInstance().runTask(item, undefined, skipGuard)`
  7. Return success/failure result

### Step 5 — `src/tools/index.ts`

```typescript
import * as vscode from 'vscode';
import { GetTasksTool } from './getTasksTool';
import { RunTaskTool } from './runTaskTool';

export function registerLmTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('workspaceTasks_getTasks', new GetTasksTool()),
    vscode.lm.registerTool('workspaceTasks_runTask', new RunTaskTool()),
  );
}
```

### Step 6 — Wire up in `extension.ts`

In `activate()`, after `loadCommands(context)`:

```typescript
import { registerLmTools } from './tools/index';
// ...
registerLmTools(context);
```

### Step 7 — Tests

#### `src/test/suite/taskToolsUtils.test.ts`

| Scenario | Assertion |
|---|---|
| `isLeafTask` — `None` collapsible state | returns `true` |
| `isLeafTask` — `Expanded` with `task` set | returns `true` |
| `isLeafTask` — `Expanded` without `task` | returns `false` |
| `collectLeafTasks` — flat list of leaves | all items collected |
| `collectLeafTasks` — nested (group with children) | children collected recursively |
| `collectLeafTasks` — mixed (some leaf, some group) | only leaves collected |
| `collectLeafTasks` — empty array | returns `[]` |
| `collectLeafTasks` — leaf item with children (compound task) | item added, children NOT recursed (else branch) |
| `toSummary` — item with `taskFileUri` in workspace | `source` = relative path |
| `toSummary` — item with `taskFileUri` outside workspace | `source` = absolute path |
| `toSummary` — item with no file URI | `source: null` |
| `toSummary` — multi-root workspace | `workspaceFolder` present |
| `toSummary` — single-root workspace | `workspaceFolder` absent |

#### `src/test/suite/getTasksTool.test.ts`

| Scenario | Assertion |
|---|---|
| Untrusted workspace | `isTrusted: false`, `tasks: []`, `explanation` set |
| Cache loading | `isLoading: true`, `tasks: []`, `explanation` set |
| No filter — flat tasks | all leaf tasks returned |
| No filter — nested tasks | children collected recursively |
| `query` filter (case-insensitive) | only matching labels |
| `taskType` filter (case-insensitive) | only matching types |
| Both filters | intersection applied |
| No matches | `tasks: []` |
| Truncation — >500 tasks | `truncated: true`, correct count, 500 results |
| Truncation — <=500 tasks | `truncated: false` |
| Sorting determinism | two invocations return identical order |
| CancellationToken cancelled | fast return, `explanation: 'Cancelled.'` |
| Internal error | error result with `explanation` set |
| `prepareInvocation` | returns correct `invocationMessage` |
| Result JSON is valid | parses without error |

#### `src/test/suite/runTaskTool.test.ts`

| Scenario | Assertion |
|---|---|
| Untrusted workspace | `started: false`, message contains "not trusted" |
| Task found by exact `id` | task started, `started: true` |
| Task found by `label` exact match (single) | task started |
| Task found by `label` substring (single) | task started |
| Task found by `label` + `taskType` | task started |
| `label` matches multiple tasks | `started: false`, `candidates` list |
| `id` not found, falls through to `label` | resolved via label |
| `id` not found, no `label` | `started: false`, specific ID-not-found message |
| `label` has no exact match, substring match exists | `started: false`, candidates returned with "Did you mean..." message |
| Neither `id` nor `label` provided | `started: false`, not-found message |
| `TaskRunner.runTask()` returns `false` | `started: false`, blocked message |
| `TaskRunner.runTask()` throws | error result |
| CancellationToken cancelled | fast return, `started: false` |
| `prepareInvocation` — task found, not guarded | confirmation with task details, `_pendingTaskId` stored |
| `prepareInvocation` — task found, guarded | message includes guard warning, `_pendingTaskId` stored |
| `prepareInvocation` — task not found | generic fallback message, `_pendingTaskId` not set |
| `prepareInvocation` not called (programmatic) + guarded task | `invoke` checks `isGuarded`, `skipGuard=false`, guard modal shown |
| `_pendingTaskId` set but cache changed (TOCTOU) → different task resolved | `skipGuard=false` (id mismatch), guard modal fires if needed |
| Result JSON is valid | parses without error |

### Step 8 — Documentation (`docs/features/lm-tool.md`)

Cover:

- **Overview**: What the two tools do and when to use them
- **Usage in chat**: `#wTasks` and `#runWTask` reference names
- **Typical workflow**: discover tasks with `#wTasks`, run with `#runWTask`
- **Example agent prompts**: "Which tasks are available?", "Run the build task",
  "Run the npm build task in the my-app workspace folder"
- **Input parameters** for each tool with annotated JSON examples
- **Response schema** for each tool
- **Guarded tasks**: how the run-guard integrates with the LM tool confirmation
- **Limitations**: tasks run asynchronously (no completion notification), 500-task
  cap in `getTasks`, untrusted workspace blocks all operations

---

## Test Coverage Requirements

| File | Target |
|---|---|
| `src/tools/taskToolsUtils.ts` | 100 % |
| `src/tools/getTasksTool.ts` | 100 % |
| `src/tools/runTaskTool.ts` | 100 % |
| `src/tools/index.ts` | 100 % |

Run with:
```sh
npm run vscode:test:coverage
```

---

## Documentation Checklist

- [ ] `docs/features/lm-tool.md` — new feature page (both tools)
- [ ] `docs/features/index.md` — add link to `lm-tool.md`
- [ ] `README.md` — add one-liner about LM tools in features section

---

## Rubber-Duck Critique Summary

### Round 1 — `getTasks` only

A sub-agent review of the original `getTasks`-only plan:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `getAllTasks()` only returns top-level items; nested tasks silently missed | **MUST-FIX** | Recursive `collectLeafTasks()` extracted to `taskToolsUtils.ts` |
| 2 | No task `id` in output | **MUST-FIX** | Added `id: item.id ?? null` to `TaskSummary` |
| 3 | Ambiguous empty `source` string | **SHOULD-FIX** | `source` changed to `string | null` |
| 4 | No payload size limit | **SHOULD-FIX** | `MAX_TASKS_RETURNED = 500` + truncation metadata |
| 5 | `CancellationToken` ignored | **SHOULD-FIX** | Early-exit check at start of `invoke` |
| 6 | No error handling in `invoke` | **SHOULD-FIX** | `try/catch` wrapping entire body |
| 7 | `toolReferenceName: "tasks"` collision risk | **SHOULD-FIX** | Renamed to `"wTasks"` |
| 8 | Cold-start returns empty silently | **SHOULD-FIX** | Added `explanation` field |
| 9 | Non-deterministic sort order | **SHOULD-FIX** | `sort((a,b) => typeComp || labelComp)` |
| 10 | Missing test scenarios | **SHOULD-FIX** | 7 additional test scenarios added |

### Round 2 — Both tools (full plan review)

A second sub-agent review of the combined plan identified the following issues:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `confirmationMessages` needs explicit `title`/`message` split per VS Code API | **MUST-FIX** | Plan updated to show `{ title: "...", message: new vscode.MarkdownString(...) }` shape |
| 2 | Guard bypass when `prepareInvocation` falls back to generic + resolved task is guarded | **MUST-FIX** | `_pendingTaskId` field used to detect fallback path; `invoke` checks `isGuarded` and uses `skipGuard=false` when not pre-resolved |
| 3 | `isTrusted: false` hard-coded in catch block masks real cause | **MUST-FIX** | Fixed to use `vscode.workspace.isTrusted` in error result |
| 4 | `collectLeafTasks` double-adds compound tasks that have both `task` AND children | **MUST-FIX** | Changed to `if (isLeaf) push; else if (children) recurse` (exclusive branches) |
| 5 | `invoke` can be called without prior `prepareInvocation` (programmatic use) | **MUST-FIX** | `invoke` checks `_pendingTaskId` match; falls back to `skipGuard=false` if not pre-resolved |
| 6 | Label substring fallback silently runs unintended task (single match) | **SHOULD-FIX** | Removed silent fallback; returns candidates with "Did you mean..." message instead |
| 7 | `id` not found + no `label` gives generic "no task" message | **SHOULD-FIX** | Specific message: "Task with ID 'X' not found. Use #wTasks to discover current IDs." |
| 8 | `id ?? ''` sentinel value misleading | **SHOULD-FIX** | Changed to `id ?? null` with `string | null` type |
| 9 | TOCTOU: cache can change between `prepareInvocation` and `invoke` | **SHOULD-FIX** | `_pendingTaskId` check detects mismatch; defaults to `skipGuard=false` when IDs differ |
| 10 | `taskType` ignored when task resolved by `id` | **SHOULD-FIX** | Deferred to implementation — document that `taskType` is only a label-resolution hint |
| 11 | `additionalProperties: false` missing from input schemas | **SHOULD-FIX** | Added to both tool schemas in Step 1 |
| 12 | Missing test: programmatic invoke without prepareInvocation + guarded task | **SHOULD-FIX** | Added to runTaskTool test scenarios |
| 13 | `modelDescription` for `runTask` must state fire-and-forget | **SHOULD-FIX** | Added "task runs asynchronously; tool returns immediately" to modelDescription |
| 14 | Input schema allows `{}` (no id/label) | **SHOULD-FIX** | Added validation note; modelDescription instructs model to always provide id or label |

---

## Open Questions

1. **Pagination vs truncation**: Truncation at 500 + `query`/`taskType` filters is
   simpler and sufficient. Full pagination deferred.
2. **`id` stability**: The portable ID encodes type + label + source path. Stable
   so long as the task source file does not move. Acceptable for MVP.
3. **`taskType` validation when resolved by `id`**: Currently `taskType` is only a
   label-resolution disambiguator. A mismatch between `taskType` and the `id`-resolved
   task's actual type is silently ignored. Document this in `modelDescription`.
4. **`workspaceTasks_getTaskHistory`** and **`workspaceTasks_getFavorites`**: Remain
   as potential future tools. Out of scope for this implementation.
