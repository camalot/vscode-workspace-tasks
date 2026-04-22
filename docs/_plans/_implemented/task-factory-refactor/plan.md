# Plan: Refactor `taskFactory` — Provider-Owned Task Creation

## TL;DR

`taskFactory.ts` is a ~1,400-line file dominated by a single `switch` statement with 30+ cases. Each
case instantiates a provider class, calls `provider.getCommand()`, manually assembles CLI arguments,
and constructs a `vscode.Task`. This logic belongs in the provider, not in the factory.

This plan migrates task-creation responsibility into each provider via a new optional `createTask()`
method on `BaseTaskProvider`, introduces a lightweight `TaskProviderRegistry`, and reduces
`taskFactory.ts` to a thin dispatcher (~100 lines). The migration is fully phased so no breaking
changes are introduced at any step.

---

## Self-Critique & Viability Assessment

This plan was rubber-ducked with an independent architectural review agent. The major findings and
the decisions taken in response are recorded below.

### Critique: Registry initialization creates a new god-module

**Risk**: Moving all 30 `import` statements from `taskFactory.ts` into a registry initializer
doesn't eliminate the monolith — it relocates it.

**Decision**: Providers are registered via an explicit `registerAllProviders()` function in
`src/providers/index.ts`, called once during extension activation. The factory does not import
providers directly. The registry gets `clear()` and `unregister()` methods for test isolation.
Lazy loading of provider modules is out of scope but the design does not preclude it.

### Critique: Not all task types fit the "provider → `createTask()`" model

**Risk**: `shell`, `jupyter`, `vscode`, `venv`, `dockerfile`, and `workspace-task` do not follow
the standard `getCommand()` pattern. Forcing them into `createTask()` creates awkward abstractions
(e.g., `JupyterTaskProvider` uses `CustomExecution`, not `ShellExecution`; `vscode` calls
`vscode.tasks.fetchTasks()`).

**Decision**: **Two-track dispatch** is used inside `_buildTask()`:

1. **Provider-based track**: For all types with a `FooTaskProvider` that exposes `getCommand()`,
   the registry is used — `provider.createTask(item, args)` is called.
2. **Special-case track**: For `shell`, `jupyter`, `vscode`, `venv`, `dockerfile`,
   `workspace-task`, the logic is extracted into private helper functions (`_createShellTask`,
   `_createJupyterTask`, etc.) rather than being left in a 1,400-line switch. These helpers live
   in `taskFactory.ts` and are not expected to move to providers.

### Critique: Providers may diverge in behavior without a contract

**Risk**: 25+ providers independently implementing `createTask()` with no shared contract will
create inconsistency in argument splitting, cwd resolution, error handling, and task definitions.

**Decision**: A **Provider Contract** (see [§ Provider Contract](#provider-contract)) is
documented in this plan and enforced via shared utilities and a test helper. Each migration PR
must include tests that use the standard assertion helper.

### Critique: `buildShellTask()` doesn't cover all execution forms

**Risk**: Ant uses both string-form and array-form `ShellExecution` depending on `ansicon`. Jupyter
uses `CustomExecution`. The utility would need `executionForm` parameters or end up covering nothing.

**Decision**: `buildShellTask()` is scoped to the **standard array-form** `ShellExecution` and is
the default helper. Providers that need a string-form execution (ant+ansicon) construct the
`ShellExecution` directly; `buildShellTask()` is not forced on them. Providers using
`CustomExecution` (jupyter) implement `createTask()` fully without the helper.

### Critique: Phase 0 should validate the design with one real provider

**Decision**: npm is migrated as part of Phase 0 alongside the infrastructure. This proves the
design before 25 more providers are migrated.

### Additional identified bugs

Four bugs were identified during code reading and are documented as separate files:

| File | Bug |
|------|-----|
| `bugs/bug-yarn-bun-pnpm-unused-cwd.md` | `yarnCwd`/`bunCwd`/`pnpmCwd`/`npmCwd` destructured but silently discarded |
| `bugs/bug-shell-dead-resourceuri-guard.md` | Dead `!resourceUri` guard allows shell tasks to execute the workspace root folder as a script |
| `bugs/bug-github-actions-duplicate-input-handling.md` | `workflow_dispatch` input collection is copy-pasted verbatim in two branches |
| `bugs/bug-venv-py-extension-stripping.md` | `.py` extension stripped from Python scripts whose name contains "activate"/"deactivate" |

These bugs are fixed as part of Phase 0 (see [§ Bug Fixes in Phase 0](#bug-fixes-in-phase-0)).

---

## Requirements

1. All 30+ task types continue to work identically after refactoring (no behavioral change).
2. Adding a new task type requires only adding a provider with `createTask()` and registering it —
   no changes to `taskFactory.ts`.
3. `createTaskForItem()` public API signature is unchanged.
4. `CreatedTask` interface is unchanged.
5. All existing `taskFactory*.test.ts` tests pass throughout every phase.
6. New code achieves 100% branch coverage per the project guidelines.
7. `KNOWN_TASK_TYPES` remains accurate (derived from registry after full migration).

---

## Architecture

### Current State

```
taskFactory.ts
  └─ _buildTask(item, args)
       └─ switch(item.taskType)
            ├─ case 'npm':    new NpmTaskProvider() → getCommand() → build task
            ├─ case 'yarn':   new YarnTaskProvider() → getCommand() → build task
            ├─ ...26 more cases...
            └─ default: return undefined
```

### Target State

```
taskFactory.ts (~100 lines)
  └─ _buildTask(item, args)
       ├─ [early returns: native vscode.Task, taskSource/workspace-task]
       ├─ Track 1 — registry lookup
       │    └─ provider = TaskProviderRegistry.get(item.taskType)
       │         └─ provider.createTask(item, args)  ←── logic lives here now
       └─ Track 2 — special-case helpers (shell, jupyter, vscode, venv, dockerfile)
            ├─ _createShellTask(item, args, ctx)
            ├─ _createJupyterTask(item, ctx)
            ├─ _createVscodeTask(item, ctx)
            ├─ _createVenvTask(item, args, ctx)
            └─ _createDockerfileTask(item, args, ctx)

providers/
  ├─ npmTaskProvider.ts     + createTask()
  ├─ yarnTaskProvider.ts    + createTask()
  ├─ ...25 more providers   + createTask()
  └─ index.ts               registerAllProviders()

libs/
  └─ taskCreationUtils.ts
       ├─ resolveTaskContext(item) → { cwd, resourceUri, workspaceFolder }
       ├─ splitArgs(args?)         → string[]
       └─ buildShellTask(...)      → CreatedTask

taskProviderRegistry.ts
  └─ TaskProviderRegistry (singleton)
       ├─ register(type, provider)
       ├─ get(type) → BaseTaskProvider | undefined
       ├─ getKnownTypes() → ReadonlySet<string>
       ├─ clear()             ← for test teardown
       └─ unregister(type)    ← for test teardown
```

---

## Provider Contract

Every provider that implements `createTask()` **must** follow this contract:

### 1. Signature
```typescript
async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined>
```

### 2. Context Resolution
Use `resolveTaskContext(item)` from `taskCreationUtils` to obtain `{ cwd, resourceUri, workspaceFolder }`.
If the provider needs a non-standard `cwd` (e.g., `mise` uses `getConfigRoot()`), document why and
override only `cwd`.

### 3. Argument Splitting
Use `splitArgs(args)` from `taskCreationUtils` to convert the raw user-supplied args string into an
array. Never call `args.split(' ')` directly in a provider.

### 4. Workspace Trust
Before calling `ExecutableService` or spawning any process, check:
```typescript
if (!vscode.workspace.isTrusted) { return undefined; }
```
This matches the project's Task Provider Guidelines.

### 5. Return Value
- Return a `CreatedTask` on success.
- Return `undefined` when the task cannot be built (e.g., missing required file URI). Never throw.

### 6. Task Definition Shape
Use the established definition shape for the task type:
- `script`-style types (npm, yarn, etc.): `{ type, script: taskLabel, path: resourceUri.fsPath }`
- `target`-style types (ant, grunt, make): `{ type, target: taskLabel, path: resourceUri.fsPath }`
- CI types (github-actions, gitlab-ci): `{ type, task: taskLabel, path: resourceUri.fsPath }`

### 7. `native: false`
All tasks created by providers set `native: false`. The factory sets `native: true` only for
pre-existing `vscode.Task` instances.

### 8. No Environment Injection
Providers do not inject env vars. That remains the responsibility of `createTaskForItem()` in the
factory (unchanged).

---

## Shared Utilities (`src/libs/taskCreationUtils.ts`)

### `resolveTaskContext(item: TaskItem)`

```typescript
interface TaskContext {
  effectiveResourceUri: vscode.Uri | undefined;  // item.taskFileUri ?? item.resourceUri
  resourceUri: vscode.Uri;                        // effectiveResourceUri ?? fallbackWorkspaceUri
  cwd: string;                                    // dirname of effectiveResourceUri, or workspace root
  workspaceFolder: vscode.WorkspaceFolder | undefined;
}

export function resolveTaskContext(item: TaskItem): TaskContext
```

Extracted from the top of `_buildTask()`. All the fallback logic lives in one place. The
`effectiveResourceUri` field is exposed so providers (and the `shell` helper) can check it directly
before using `resourceUri`.

### `splitArgs(args?: string): string[]`

Splits a user-provided args string into an array with basic quote awareness. Handles:
- Empty/undefined → `[]`
- Single-space separated tokens → normal split
- Single- and double-quoted tokens with spaces → kept as a single element

### `buildShellTask(options: BuildShellTaskOptions): CreatedTask`

```typescript
interface BuildShellTaskOptions {
  type: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  resourceUri: vscode.Uri;
  definitionOverride?: vscode.TaskDefinition;
}

export function buildShellTask(options: BuildShellTaskOptions): CreatedTask
```

Constructs a `vscode.Task` with array-form `ShellExecution`. Providers that require string-form
execution or non-standard definitions call `new vscode.Task(...)` directly and are not expected to
use this helper.

---

## `TaskProviderRegistry` (`src/taskProviderRegistry.ts`)

```typescript
export class TaskProviderRegistry {
  private static instance: TaskProviderRegistry;
  private registry = new Map<string, BaseTaskProvider>();

  static getInstance(): TaskProviderRegistry
  register(type: string, provider: BaseTaskProvider): void
  get(type: string): BaseTaskProvider | undefined
  getKnownTypes(): ReadonlySet<string>
  clear(): void          // for tests
  unregister(type: string): void  // for tests
}
```

---

## `BaseTaskProvider` Changes (`src/taskProvider.ts`)

Add one optional method with a default `undefined` return:

```typescript
export abstract class BaseTaskProvider implements TaskProvider {
  // ... existing members unchanged ...

  /**
   * Creates a runnable vscode.Task for the given TaskItem.
   * Provider-based task types override this. Special-case types (shell, jupyter,
   * vscode, venv, dockerfile) are handled by private helpers in taskFactory.ts
   * and do NOT override this method.
   *
   * Implementations must follow the Provider Contract in docs/_plans/task-factory-refactor/plan.md.
   */
  createTask(_item: TaskItem, _args?: string): Promise<CreatedTask | undefined> {
    return Promise.resolve(undefined);
  }
}
```

The `CreatedTask` import is added to `taskProvider.ts` (it is currently only in `taskFactory.ts`).

---

## Modified `_buildTask()` Skeleton

```typescript
async function _buildTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
  if (!item) return undefined;

  // Native vscode.Task (e.g. from getSystemTasks)
  if (item.task instanceof vscode.Task) {
    return { task: item.task, native: true };
  }

  const ctx = resolveTaskContext(item);
  const { cwd, resourceUri } = ctx;
  const taskLabel = item.originalLabel || item.label;

  // Workspace-declared task takes priority
  if (item.taskSource) {
    return _createWorkspaceDeclaredTask(item, args, ctx);
  }

  // Track 1 — provider-based types
  const registry = TaskProviderRegistry.getInstance();
  const provider = registry.get(item.taskType);
  if (provider) {
    try {
      return await provider.createTask(item, args);
    } catch (err) {
      LoggerService.getInstance().error(`[taskFactory] provider.createTask failed for '${item.taskType}': ${err}`);
      return undefined;
    }
  }

  // Track 2 — special-case helpers
  switch (item.taskType) {
    case 'shell':      return _createShellTask(item, args, ctx);
    case 'jupyter':    return _createJupyterTask(item, ctx);
    case 'vscode':     return _createVscodeTask(item, ctx);
    case 'venv':       return _createVenvTask(item, args, ctx);
    case 'dockerfile': return _createDockerfileTask(item, args, ctx);
    default:           return undefined;
  }
}
```

> **Note**: During the migration phases, the special-case switch also temporarily contains the
> legacy cases for any providers not yet migrated. Legacy cases are removed when each provider's
> `createTask()` is complete and tested.

---

## Bug Fixes in Phase 0

The following bugs are fixed as part of Phase 0, before any provider migration begins. Fixing them
first prevents the same bugs from being copied into provider `createTask()` implementations.

| Bug | Fix |
|-----|-----|
| Unused `*Cwd` from `getCommand()` | During provider migration, verify which `cwd` is authoritative. Default to the provider's `getCommand()` cwd; override with `effectiveResourceUri` cwd only when justified and documented. |
| Dead `!resourceUri` guard in `shell`/`msbuild` | Replace `if (!resourceUri)` with `if (!ctx.effectiveResourceUri)` in the `_createShellTask` and `msbuild` helpers. |
| Duplicate GitHub Actions input collection | Extract `_collectWorkflowDispatchInputs()` helper in `_createGithubActionsTask()`. |
| `venv` `.py` extension stripping | Remove or restrict to exact basename check (`activate.py` / `deactivate.py` only). |

---

## Phases

### Phase 0: Infrastructure + npm proof-of-concept

**Goal**: All infrastructure in place; one provider (npm) fully migrated to validate the design.

**Files created/modified:**

| File | Change |
|------|--------|
| `src/taskProviderRegistry.ts` | New — singleton registry |
| `src/libs/taskCreationUtils.ts` | New — `resolveTaskContext`, `splitArgs`, `buildShellTask` |
| `src/taskProvider.ts` | Add `createTask()` default method; import `CreatedTask` |
| `src/taskFactory.ts` | Add two-track dispatch; extract `_createShellTask`, `_createJupyterTask`, `_createVscodeTask`, `_createVenvTask`, `_createDockerfileTask`; fix 4 bugs; migrate npm |
| `src/providers/npmTaskProvider.ts` | Add `createTask()` |
| `src/providers/index.ts` | Add `registerAllProviders()` |
| `src/extension.ts` | Call `registerAllProviders()` during activation |

**Tests added/modified:**

| Test file | Coverage |
|-----------|----------|
| `src/test/suite/taskProviderRegistry.test.ts` | New — register, get, getKnownTypes, clear, unregister |
| `src/test/suite/taskCreationUtils.test.ts` | New — resolveTaskContext edge cases, splitArgs, buildShellTask |
| `src/test/suite/taskFactoryNpm.test.ts` | Update to also exercise npm via `provider.createTask()` |
| `src/test/suite/taskFactoryShell.test.ts` | Update after _createShellTask extraction + bug fix |
| `src/test/suite/taskFactoryVscode.test.ts` | Update after _createVscodeTask extraction |

All existing `taskFactory*.test.ts` tests must continue passing unchanged.

---

### Phase 1: Simple Provider Migration

**Goal**: Migrate the ~12 "simple" providers that follow the pattern:
`getCommand() → push subcommand → push taskLabel → push args`.

**Providers** (one PR per provider or batched by similarity):

| Provider | Notes |
|----------|-------|
| `yarn` | Identical pattern to npm; verify `yarnCwd` decision |
| `bun` | Identical pattern; verify `bunCwd` decision |
| `pnpm` | Identical pattern; verify `pnpmCwd` decision |
| `deno` | Adds `--config` flag; slightly different |
| `mise` | Overrides `cwd` via `MiseTaskProvider.getConfigRoot()` |
| `maven` | Goal-based; no subcommand needed |
| `gradle` | Goal-based |
| `composer` | Uses `run-script` subcommand with `--` separator for args |
| `pipenv` | Uses `run` subcommand |
| `poe` | No subcommand needed |
| `poetry` | Uses `run` subcommand |
| `cargo-make` | Passes `--makefile` flag with relative path |

For each provider:
1. Write test for `provider.createTask()` **first** (red).
2. Implement `createTask()` in the provider (green).
3. Remove the corresponding `case` from the legacy switch in `_buildTask()`.
4. Run full test suite.

**Shared test helper** (`src/test/suite/helpers/providerTestHelper.ts`):

```typescript
export async function assertProviderCreatesTask(
  provider: BaseTaskProvider,
  item: TaskItem,
  expectedCommand: string,
  expectedCwd: string,
  args?: string
): Promise<void>
```

---

### Phase 2: Complex Provider Migration

**Goal**: Migrate providers with non-trivial arg building or complex metadata handling.

| Provider | Notes |
|----------|-------|
| `ant` | Dual ShellExecution forms (ansicon/non-ansicon); uses `getCommandArgs()` |
| `grunt` | Conditional `--gruntfile` flag based on relative path |
| `gulp` | Conditional `--gulpfile` flag; uses `npx gulp` (not provider's command) |
| `makefile` | cwd is always `dirname(resourceUri.fsPath)` |
| `justfile` | Passes `--justfile` flag explicitly |
| `cmake` | Computes `buildPath` and `buildType` from provider config methods |
| `cake` | Passes `resourceUri.fsPath` as first arg before `--target=` |
| `taskfile` | Conditional `--taskfile` from `globalTaskfilePath` or `taskFileUri` |
| `msbuild` | Uses `getCommandArgs()` on provider; fix dead guard (already done in Phase 0) |
| `github-actions` | Complex metadata handling; uses `_collectWorkflowDispatchInputs()` extracted in Phase 0 |
| `gitlab-ci` | Reads config vars from VS Code configuration |
| `circleci` | `circleArgs.push('local', 'execute', ...)` |
| `bitbucket` | Multi-shape metadata (step/stage/pipeline) |

---

### Phase 3: Cleanup

**Goal**: Remove all remnants of the original switch.

1. Delete the legacy `switch (item.taskType)` block from `_buildTask()` (the special-case switch
   with 5 entries remains).
2. Remove all direct provider imports from `taskFactory.ts` (imports were already moved to
   `providers/index.ts` in Phase 0; the factory only imports the registry).
3. Update `KNOWN_TASK_TYPES` to be derived from `TaskProviderRegistry.getInstance().getKnownTypes()`
   plus the 5 special-case types. Or remove it and derive inline as needed.
4. Remove the `JupyterTerm` class from `taskFactory.ts` into `providers/jupyterTaskProvider.ts`
   (it was always logically part of that provider).
5. Run full test suite and coverage check (`npm run vscode:test:coverage`).

---

## Testing

### Principles

- All existing tests pass throughout every phase — this is the primary safety net.
- New code targets 100% branch coverage.
- Tests for `createTask()` use the shared `assertProviderCreatesTask` helper.

### New Test Files

| File | What it covers |
|------|---------------|
| `taskProviderRegistry.test.ts` | Registry lifecycle; `get`, `register`, `getKnownTypes`, `clear` |
| `taskCreationUtils.test.ts` | `resolveTaskContext` (no workspace, single-root, multi-root, nested URIs); `splitArgs` (empty, quoted, backslash, `=`); `buildShellTask` (paths with spaces, custom definitions) |
| `helpers/providerTestHelper.ts` | Shared assertion helper; not a test itself |

### Per-Provider Tests

Each provider's `createTask()` is covered by either:

- An updated existing `taskFactory*.test.ts` file, or
- A new `taskFactory<Provider>.test.ts` file for providers that previously had no factory test.

Minimum coverage per provider:

- Happy path: correct command, args, and cwd returned.
- `args` parameter: extra args appended in the right position.
- `isTrusted = false`: returns `undefined` (workspace trust check).
- Missing `resourceUri`: returns `undefined` where applicable.

### Regression Guard

A new integration test `taskFactoryRegression.test.ts` creates a TaskItem for every known type and
calls `createTaskForItem()`, asserting that a non-undefined task is returned and that the task has a
`ShellExecution` (or `CustomExecution` for jupyter, or `native: true` for vscode). This guards
against accidentally breaking a type during migration.

---

## Dependencies & No Breaking Changes

| Concern | Verdict |
|---------|---------|
| `createTaskForItem()` public signature | **Unchanged** |
| `CreatedTask` interface | **Unchanged** |
| `injectArgs()` export | **Unchanged** |
| `KNOWN_TASK_TYPES` export | **Unchanged** (re-derived in Phase 3, same values) |
| `BaseTaskProvider` — existing methods | **Unchanged** |
| Provider file paths / class names | **Unchanged** |
| Existing test files | **All must pass at every phase** |

---

## File Inventory

### New Files

```
src/taskProviderRegistry.ts
src/libs/taskCreationUtils.ts
src/test/suite/taskProviderRegistry.test.ts
src/test/suite/taskCreationUtils.test.ts
src/test/suite/helpers/providerTestHelper.ts
src/test/suite/taskFactoryRegression.test.ts
docs/_plans/task-factory-refactor/plan.md  ← this file
docs/_plans/task-factory-refactor/bugs/bug-yarn-bun-pnpm-unused-cwd.md
docs/_plans/task-factory-refactor/bugs/bug-shell-dead-resourceuri-guard.md
docs/_plans/task-factory-refactor/bugs/bug-github-actions-duplicate-input-handling.md
docs/_plans/task-factory-refactor/bugs/bug-venv-py-extension-stripping.md
```

### Modified Files

```
src/taskProvider.ts                        (add createTask default method)
src/taskFactory.ts                         (two-track dispatch; 4 bug fixes; extract helpers)
src/providers/index.ts                     (add registerAllProviders())
src/extension.ts                           (call registerAllProviders())
src/providers/npmTaskProvider.ts           (Phase 0)
src/providers/yarnTaskProvider.ts          (Phase 1)
src/providers/bunTaskProvider.ts           (Phase 1)
... (all providers, Phases 1–2)
```

---

## Open Questions / Future Scope

1. **Lazy provider loading**: The registry design is compatible with lazy `import()` per type, but
   this is out of scope for this refactor. File as a separate enhancement if startup performance
   becomes a concern.
2. **`docker-compose` / future providers**: New providers only need to add `createTask()` and call
   `registry.register()` — no `taskFactory.ts` modification required.
3. **`splitArgs` completeness**: The initial implementation handles basic quoting. If complex
   argument syntax is needed (nested quotes, escape sequences), a dedicated shell-tokenization
   library (e.g., `shell-quote`) could be adopted. For now, basic quote awareness is sufficient.
