# Plan: Task Run Guard / Confirmation

## TL;DR

Allow users to mark specific tasks as "guarded." When a guarded task is triggered from any
execution path — tree view, Quick Open, queue, or compound task — the extension prompts for
confirmation before running. Three complementary guard sources combine into a single precedence
chain:

1. **Solution C — Manual toggle** (workspaceState, per user per workspace): highest priority;
   context-menu "Add Run Guard" / "Remove Run Guard" on any task item.
2. **Solution B — Definition flag** (`.workspace-tasks.json` `"confirm": true`): mid priority;
   declarative, source-controlled, only for custom workspace tasks.
3. **Solution A — Pattern matching** (settings `confirmPatterns` string array): lowest priority;
   broadest coverage; works for any task type including discovered tasks.

A visual `!` badge (via `FileDecorationProvider`) marks guarded items directly in the tree. The
guard integrates into compound task sequential execution — if the user cancels any step, the
compound task stops. Parallel compound tasks show individual modal dialogs per guarded task
(Phase 1 limitation; a pre-flight batch confirm is a Phase 2 enhancement).

---

## Self-Critique & Viability Assessment

*(Rubber-duck review completed. 6 blocking issues and 5 advisory issues found and resolved.)*

- **Sequential compound task fix truncated existing logic (BLOCKING)** — The original draft's
  `!ran → break` snippet replaced the whole `try-catch` that catches `executeTask` throws and the
  failure-status check that stops the sequence on task failure. **Fix:** the `!ran` guard is
  inserted *inside* the existing try-catch, before `waitForTask()`.
- **Parallel compound task path also stripped its try-catch (BLOCKING)** — Same root cause. Fixed
  by adding the `!ran → return` guard inside `async (item) => { try { ... } catch { ... } }`.
- **`when` condition matched compound-task group items (BLOCKING)** — `compoundTask` and
  `favoriteCompoundTask` contextValues end in `Task`, so `viewItem =~ /[Tt]ask$/` triggered on
  group nodes. **Fix:** added `viewItem !~ /[Cc]ompound/` exclusion.
- **Guard contextValue prefix applied to group items (BLOCKING)** — Phase 5 originally lived at
  the end of `updateContextValue()`, which runs for both leaf and group items. Also created a
  circular import between `TaskItem` and `TaskRunGuardService`. **Fix:** moved guard prefix
  application to `getTreeItem()` in `taskTreeDataProvider.ts` with a leaf-only `collapsibleState`
  check. This removes the circular dependency entirely.
- **Double tree refresh on guard toggle (BLOCKING)** — Commands called `refresh()` directly AND
  `onDidChangeGuards` subscribed to another `refresh()`. **Fix:** commands do not call `refresh()`
  themselves; the event subscription in `extension.ts` is the sole trigger (matching
  `FavoritesService` / `FilteredTaskService` pattern).
- **Dynamic `require()` does not defer resolution in webpack (BLOCKING)** — Webpack inlines all
  `require()` calls at build time. **Fix:** the circular dependency is eliminated by moving guard
  prefix out of `TaskItem`, so the decorator can use static imports for both `TaskCacheService`
  and `TaskRunGuardService` without a circular chain.
- **Decorator badge missing for compound-task clone IDs (SHOULD-FIX)** — `TaskCacheService
  .getTaskById()` is keyed on canonical IDs; compound-task clone IDs are prefixed. **Fix:**
  `TaskRunGuardService.isGuardedById(taskId)` strips `fav:` and `compound-task:<name>:` prefixes
  before lookup. The decorator calls `isGuardedById` for simple manual-guard checks and also calls
  the full `isGuarded(cacheItem)` if a cache item is found.
- **`_refreshPatterns()` fires `onDidChangeGuards` via the caller (ALREADY HANDLED)** — The
  config-change handler already calls `this._onDidChangeGuards.fire()` after `_refreshPatterns()`.
  This was a critic misread of the existing code; no change needed.
- **`runTaskWithArgs` prompted for args before the guard (SHOULD-FIX)** — User entered args then
  got a cancel dialog. **Fix:** `RunTaskWithArgsCommand.run()` calls `confirmIfNeeded()` before
  `showInputBox()`, and passes `skipGuard: true` to `runTask()` to prevent a second dialog.
- **Guard on restart is inappropriate friction (SHOULD-FIX)** — User explicitly clicked Restart.
  **Fix:** `runTask()` gains an optional `skipGuard?: boolean` parameter; `restartTask.ts` passes
  `true`.
- **`jupyterTask` not listed in when-condition docs (MINOR)** — The regex `guarded[A-Za-z]*[Tt]ask$`
  already matches `guardedJupyterTask`. Added to contextValue docs.
- **Pattern-match target vs. ID consistency (MINOR)** — `originalLabel` is the constructor `label`
  argument before any grouping; it is stable and the right choice for pattern matching.

---

## Design Overview

### Guard Source Priority

| Priority | Source | Mechanism |
|---|---|---|
| 1 (highest) | Solution C — Manual | `workspaceState.get('workspaceTasks.guardedTasks', [])` |
| 2 | Solution B — Definition | `FileTaskDefinition.confirm === true` → `TaskItem.guardedByDefinition` |
| 3 (lowest) | Solution A — Pattern | `workspaceTasks.task.confirmPatterns` regex array match vs. `originalLabel` |

`isGuarded(item)` returns `true` if **any** source matches. All three are checked independently;
highest-priority source wins in the sense that a match at any level is sufficient.

### Architecture Sketch

```
TaskRunGuardService (singleton)
  ├── manualGuardIds: Set<string>  ← workspaceState
  ├── patterns: RegExp[]           ← settings (rebuilt on config change)
  └── isGuarded(item): boolean     ← checks C then B then A

TaskRunner.runTask(item)
  └─ [NEW] confirmed = await guardService.confirmIfNeeded(item)
     if (!confirmed) return false  ← early exit, nothing runs

TaskItem.updateContextValue()
  └─ [NEW] if guardService.isGuarded(this): prefix contextValue with 'guarded'

TaskRunGuardDecorationProvider (new)
  └─ badge: '!' + ThemeColor('list.warningForeground') for guarded task URIs

Commands (Solution C)
  ├── workspaceTasks.addRunGuard    ← shown when viewItem !~ /guarded/
  └── workspaceTasks.removeRunGuard ← shown when viewItem =~ /guarded/
```

### Compound Task Integration

- **Sequential mode**: if `runTask(item)` returns `false` (guard cancelled), exit the sequential
  loop immediately. The remaining tasks are not run. The compound task is considered stopped.
- **Parallel mode**: each task's `runTask()` is called independently. If the user cancels a guard
  modal for one task, only that task is skipped; others that were confirmed still run. Because
  `showWarningMessage({ modal: true })` blocks UI, parallel guard dialogs appear sequentially in
  practice. Documented as a Phase 1 limitation.
- **`waitForTask` safety**: `waitForTask()` is only called when `runTask()` returns `true` (task
  was actually started). This prevents the 1-hour timeout from triggering on cancelled tasks.

---

## Phases

### Phase 1 — Extend `TaskItem` with `guardedByDefinition`

**File:** `src/taskItem.ts`

Add one optional property to the `TaskItem` class (after the existing `metadata` property):

```ts
/** Set to true when the task definition file includes `"confirm": true` (Solution B). */
public guardedByDefinition?: boolean;
```

No constructor change needed — the property defaults to `undefined` (falsy).

---

### Phase 2 — Solution B: `FileTaskDefinition.confirm` + JSON Schema

**File:** `src/services/workspaceTasksService.ts` — add to `FileTaskDefinition` interface:

```ts
/** When true the task will prompt for confirmation before running (Solution B guard). */
confirm?: boolean;
```

**File:** `res/schemas/workspace-tasks.schema.json` — inside the `tasks.items.properties` block,
add:

```json
"confirm": {
  "type": "boolean",
  "description": "When true, the task will prompt for confirmation before it runs.",
  "default": false
}
```

**File:** `src/providers/workspaceTasksProvider.ts` — in both `TaskItem`-creation paths (no-file
and file path), after `tasks.push(item)`:

```ts
if (taskDef.confirm) {
  item.guardedByDefinition = true;
}
```

---

### Phase 3 — Solution A: Settings Contribution + Pattern Helpers

**File:** `package.json` — in `contributes.configuration.properties`:

```json
"workspaceTasks.task.confirmPatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "markdownDescription": "Array of strings (treated as regular expressions, case-insensitive) matched against task labels. Tasks whose labels match any pattern will prompt for confirmation before running. Example: `[\"deploy.*\", \"db:drop\", \"terraform apply\"]`",
  "scope": "resource"
}
```

Also add the two new commands:

```json
{
  "command": "workspaceTasks.addRunGuard",
  "title": "Add Run Guard",
  "icon": "$(shield)",
  "category": "Workspace Tasks"
},
{
  "command": "workspaceTasks.removeRunGuard",
  "title": "Remove Run Guard",
  "icon": "$(shield)",
  "category": "Workspace Tasks"
}
```

And context menu entries in `view/item/context` (for both `workspaceTasksView` and
`workspaceTasksExplorer`):

```json
{
  "command": "workspaceTasks.addRunGuard",
  "when": "view =~ /workspaceTasks(View|Explorer)/ && viewItem =~ /[Tt]ask$/ && viewItem !~ /guarded/ && viewItem !~ /[Cc]ompound/",
  "group": "9_guard@1"
},
{
  "command": "workspaceTasks.removeRunGuard",
  "when": "view =~ /workspaceTasks(View|Explorer)/ && viewItem =~ /guarded[A-Za-z]*[Tt]ask$/",
  "group": "9_guard@1"
}
```

> The `viewItem !~ /[Cc]ompound/` exclusion prevents the Add Run Guard entry from appearing on
> `compoundTask` and `favoriteCompoundTask` group items, which also end in `Task` but represent
> groups rather than executable tasks.
>
> The `9_guard` group number keeps guard items near the bottom of the context menu, below the
> existing filter/hide group.

---

### Phase 4 — `TaskRunGuardService`

**File:** `src/services/taskRunGuardService.ts` *(new)*

```ts
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';

const GUARD_STATE_KEY = 'workspaceTasks.guardedTasks';
const PATTERNS_SETTING = 'workspaceTasks.task.confirmPatterns';

export class TaskRunGuardService {
  private static _instance: TaskRunGuardService;
  private _context!: vscode.ExtensionContext;
  private _manualGuardIds: Set<string> = new Set();
  private _patterns: RegExp[] = [];
  private _onDidChangeGuards: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeGuards: vscode.Event<void> = this._onDidChangeGuards.event;

  private constructor() {}

  static getInstance(): TaskRunGuardService {
    if (!TaskRunGuardService._instance) {
      TaskRunGuardService._instance = new TaskRunGuardService();
    }
    return TaskRunGuardService._instance;
  }

  initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    // Load Solution C manual guards from workspaceState
    const stored = context.workspaceState.get<string[]>(GUARD_STATE_KEY, []);
    this._manualGuardIds = new Set(stored);
    // Load Solution A patterns from settings
    this._refreshPatterns();
    // Refresh patterns when settings change
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(PATTERNS_SETTING)) {
          this._refreshPatterns();
          this._onDidChangeGuards.fire();
        }
      })
    );
  }

  /** True if the item is guarded by any source (C > B > A). */
  isGuarded(item: TaskItem): boolean {
    // Solution C — manual workspaceState toggle
    if (this._manualGuardIds.has(item.id ?? '')) { return true; }
    // Solution B — definition-level flag from .workspace-tasks.json
    if (item.guardedByDefinition === true) { return true; }
    // Solution A — pattern matching against the task's original label
    const label = item.originalLabel ?? (typeof item.label === 'string' ? item.label : '');
    return this._patterns.some((p) => p.test(label));
  }

  /**
   * If the item is guarded, shows a modal confirmation dialog.
   * Returns true to proceed, false if the user cancelled.
   */
  async confirmIfNeeded(item: TaskItem): Promise<boolean> {
    if (!this.isGuarded(item)) { return true; }
    const label = item.originalLabel ?? (typeof item.label === 'string' ? item.label : 'this task');
    const choice = await vscode.window.showWarningMessage(
      `Run guarded task "${label}"?`,
      { modal: true },
      'Run Task'
    );
    return choice === 'Run Task';
  }

  /** Add a manual guard (Solution C). */
  async addGuard(item: TaskItem): Promise<void> {
    const id = item.id ?? '';
    if (!id || this._manualGuardIds.has(id)) { return; }
    this._manualGuardIds.add(id);
    await this._save();
    this._onDidChangeGuards.fire();
  }

  /** Remove a manual guard (Solution C). */
  async removeGuard(item: TaskItem): Promise<void> {
    const id = item.id ?? '';
    if (!this._manualGuardIds.has(id)) { return; }
    this._manualGuardIds.delete(id);
    await this._save();
    this._onDidChangeGuards.fire();
  }

  /** True if item has an explicit manual guard (regardless of pattern/definition). */
  isManuallyGuarded(id: string): boolean {
    return this._manualGuardIds.has(id);
  }

  private async _save(): Promise<void> {
    await this._context.workspaceState.update(GUARD_STATE_KEY, [...this._manualGuardIds]);
  }

  private _refreshPatterns(): void {
    const raw = vscode.workspace.getConfiguration('workspaceTasks').get<string[]>(PATTERNS_SETTING, []);
    this._patterns = [];
    for (const entry of raw) {
      try {
        this._patterns.push(new RegExp(entry, 'i'));
      } catch {
        // Skip invalid regex patterns silently (logged via existing logger in the extension)
      }
    }
  }
}
```

---

### Phase 5 — `TaskTreeDataProvider.getTreeItem()` — Guard Context Value Projection

**File:** `src/taskTreeDataProvider.ts` — `getTreeItem()` method

The current implementation returns `element` unchanged. Extend it to return a lightweight
projection for guarded leaf tasks so the `when` condition sees the `guarded`-prefixed `contextValue`,
without mutating the cached `TaskItem`:

```ts
getTreeItem(element: TaskItem): vscode.TreeItem {
  // Only apply guard logic to leaf task nodes
  if (
    element.collapsibleState === vscode.TreeItemCollapsibleState.None &&
    TaskRunGuardService.getInstance().isGuarded(element)
  ) {
    const base = element.contextValue ?? '';
    // Return a projection — cached element is never mutated.
    // VS Code uses element: T for tree identity; the returned TreeItem is consumed only
    // for rendering and context-menu when-condition evaluation.
    return {
      label:                    element.label,
      id:                       element.id,
      iconPath:                 element.iconPath,
      description:              element.description,
      tooltip:                  element.tooltip,
      contextValue:             'guarded' + base.charAt(0).toUpperCase() + base.slice(1),
      command:                  element.command,
      collapsibleState:         element.collapsibleState,
      resourceUri:              element.resourceUri,
      accessibilityInformation: element.accessibilityInformation,
      checkboxState:            element.checkboxState,
    };
  }
  return element;
}
```

> **Why not in `updateContextValue()`?** That method is called from the `TaskItem` constructor,
> which runs during `TaskCacheService.getTasks()`, which is called during tree refresh — before
> `TaskRunGuardService` is necessarily initialized. Moving the logic to `getTreeItem()` also
> eliminates the `TaskItem` → `TaskRunGuardService` circular import.
>
> **Why a projection?** If `element.contextValue` were mutated directly in `getTreeItem()`, removing
> a guard and triggering a refresh could leave the cached object with a stale 'guardedTask' value
> if `organizeTasks()` does not call `updateContextValue()` for every persistent cache item on
> every refresh. The projection ensures the cache object is never modified and the correct value is
> always derived fresh on each render call.
>
> **Applicable contextValues**: `task`, `favoriteTask`, `recentTask`, `runningTask`,
> `runningFavoriteTask`, `filteredTask`, `queuedTask`, `jupyterTask`, and their combinations —
> all become `guarded<CapitalizedValue>`. The leaf-only check (`collapsibleState === None`)
> prevents the prefix from being applied to group nodes like `compoundTask` or `favorites`.

---

### Phase 6 — `TaskRunner`: Guard Check, Return Type, and Compound Task Integration

**File:** `src/taskRunner.ts`

**Change 1**: `runTask()` signature change

Change return type `Promise<void>` → `Promise<boolean>`. Add an optional `skipGuard?: boolean`
parameter for callers that already confirmed the guard (e.g., `runTaskWithArgs`, `restartTask`):

```ts
public async runTask(item: TaskItem, args?: string, skipGuard = false): Promise<boolean>
```

Insert guard check before `TaskStateManager.getInstance().clearAllBlocks()` (before any side
effects — no recent task added, no status change, no execution):

```ts
// Guard check (must be before any state mutations)
if (!skipGuard) {
  const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
  if (!confirmed) {
    return false; // User declined — task not run, state unchanged
  }
}
```

Change each early-exit path (e.g., task not resolved) to `return false;`. Add `return true;` at
the end of the normal execution path.

**Change 2**: `runCompoundTask()` — sequential path

The existing sequential structure is a `try-catch` that also checks for `'failure'` status after
`waitForTask`. Insert the guard-cancelled check *inside* the existing structure:

```ts
try {
  const ran = await this.runTask(item);
  if (!ran) { break; }                   // guard cancelled → stop sequence
  const status = await this.waitForTask(item);
  if (status === 'failure') {
    vscode.window.showErrorMessage(...);
    break;
  }
} catch (e) {
  vscode.window.showErrorMessage(...);
  break;
}
```

**Change 3**: `runCompoundTask()` — parallel path

The existing parallel structure also wraps each item in a `try-catch`. Insert the guard-cancelled
check inside that structure:

```ts
Promise.all(items.map(async (item) => {
  try {
    const ran = await this.runTask(item);
    if (!ran) { return; }                // guard cancelled → skip this item
    await this.waitForTask(item);
  } catch (e) {
    vscode.window.showErrorMessage(...);
  }
}))
```

**Change 4**: `runTaskWithArgs.ts` — guard before argument prompt

A guard dialog after the user has already entered arguments is inverted UX. Move the guard check
before `showInputBox` in `RunTaskWithArgsCommand.run()`:

```ts
async run(item: TaskItem): Promise<void> {
  // Confirm guard BEFORE prompting for arguments
  const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
  if (!confirmed) { return; }
  // Now prompt for args
  const args = await vscode.window.showInputBox({ ... });
  if (!args) { return; }
  // skipGuard = true because we already confirmed above
  await TaskRunner.getInstance().runTask(item, args, true);
}
```

**Change 5**: `restartTask.ts` — guard skipped for explict restart

Restart is a user-initiated action; showing a confirmation guard after an explicit restart click
is unnecessary friction. Pass `skipGuard: true`:

```ts
// Inside restartTask.ts, wherever runTask is called:
await TaskRunner.getInstance().runTask(item, undefined, true);
```

> **Other callers of `runTask()`** (`RunTaskCommand`, etc.) receive `Promise<boolean>` instead of
> `Promise<void>`. TypeScript allows ignoring a non-`void` return where `void` was expected, so
> these callers need no code changes. The guard dialog will fire normally for them.

---

### Phase 7 — Commands: `addRunGuard.ts` + `removeRunGuard.ts`

**File:** `src/commands/addRunGuard.ts` *(new)*

```ts
import { BaseCommand } from '../common/baseCommand';
import { TaskItem } from '../taskItem';
import { TaskRunGuardService } from '../services/taskRunGuardService';

export class AddRunGuardCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('addRunGuard', context);
  }
  async run(item: TaskItem): Promise<void> {
    if (!item) { return; }
    await TaskRunGuardService.getInstance().addGuard(item);
    // No explicit refresh() here — onDidChangeGuards fires → extension.ts subscription
    // calls taskTreeDataProvider.refresh(). This is the same pattern as FavoritesService
    // and FilteredTaskService to prevent double-refresh.
  }
}
```

**File:** `src/commands/removeRunGuard.ts` *(new)* — identical structure, calls `removeGuard()`.

**File:** `src/commands/index.ts` — add both to `loadCommands()`.

---

### Phase 8 — `TaskRunGuardDecorationProvider`

**File:** `src/services/taskRunGuardDecorationProvider.ts` *(new)*

Because Phase 5 moved the guard-prefix logic out of `TaskItem.updateContextValue()` and into
`TaskTreeDataProvider.getTreeItem()`, `TaskItem` no longer imports `TaskRunGuardService`. The
dependency chain is now acyclic:
`TaskRunGuardDecorationProvider` → `TaskCacheService` → `TaskItem` → *(no guard import)*.
`TaskRunGuardDecorationProvider` → `TaskRunGuardService` → `TaskItem` *(type-only)*.
All imports are therefore static (no dynamic `require`).

```ts
import * as vscode from 'vscode';
import { TaskRunGuardService } from './taskRunGuardService';
import { TaskCacheService } from './taskCacheService';

export class TaskRunGuardDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor() {
    // Subscribe once; fire the file-decorations event on any guard change so VS Code
    // re-evaluates provideFileDecoration for all workspace-tasks scheme URIs.
    TaskRunGuardService.getInstance().onDidChangeGuards(() => {
      this._onDidChange.fire(undefined as any);
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'workspace-tasks') { return undefined; }
    // The task ID is stored in uri.query (matching the FilteredTaskDecorationProvider pattern)
    const taskId = uri.query;
    if (!taskId) { return undefined; }

    // Attempt full guard evaluation using the cached TaskItem (all three guard sources).
    // Falls back to manual-guard-only check when the cache item cannot be found
    // (e.g., compound-task clone IDs — handled by isGuardedById's prefix stripping).
    const guardService = TaskRunGuardService.getInstance();
    const cacheItem = TaskCacheService.getInstance().getTaskById(taskId);
    const isGuarded = cacheItem
      ? guardService.isGuarded(cacheItem)
      : guardService.isGuardedById(taskId);

    if (!isGuarded) { return undefined; }

    return {
      badge: '!',
      color: new vscode.ThemeColor('list.warningForeground'),
      tooltip: 'This task requires confirmation before running',
      propagate: false,
    };
  }
}
```

**`isGuardedById(taskId: string): boolean`** — add to `TaskRunGuardService`:

```ts
/** Checks manual guards and pattern matching using only a task ID string.
 * Strips known ID prefixes (fav:, compound-task:<name>:) before lookup.
 * Used by the decoration provider for items not in the task cache. */
isGuardedById(taskId: string): boolean {
  // Normalize: strip known prefixes
  let id = taskId;
  if (id.startsWith('fav:')) { id = id.slice(4); }
  else if (id.startsWith('compound-task:')) {
    // Format: compound-task:<name>:<canonical-id>
    const thirdColon = id.indexOf(':', 'compound-task:'.length);
    if (thirdColon !== -1) { id = id.slice(thirdColon + 1); }
  }
  // Check manual guards against normalized canonical ID
  if (this._manualGuardIds.has(id)) { return true; }
  // Cannot resolve label from ID alone reliably — pattern guards require a TaskItem.
  // For decoration purposes, manual-guard-only is sufficient for clone items.
  return false;
}
```

---

### Phase 9 — `extension.ts`: Wire Everything Up

**File:** `src/extension.ts` — `activate()`

1. After `FilteredTaskService.getInstance().initialize(context)` (step 19 in current order),
   add:

   ```ts
   TaskRunGuardService.getInstance().initialize(context);
   ```

2. After `new FilteredTaskDecorationProvider()` registration, add:

   ```ts
   context.subscriptions.push(
     vscode.window.registerFileDecorationProvider(new TaskRunGuardDecorationProvider())
   );
   ```

3. Subscribe tree refresh to guard changes (in the same subscription block as `FilteredTaskService.onDidChange`):

   ```ts
   TaskRunGuardService.getInstance().onDidChangeGuards(() => {
     taskTreeDataProvider.refresh();
   });
   ```

---

## File Summary

| Status | File | Change |
|---|---|---|
| **New** | `src/services/taskRunGuardService.ts` | Core singleton service (with `isGuardedById`) |
| **New** | `src/services/taskRunGuardDecorationProvider.ts` | Visual `!` badge |
| **New** | `src/commands/addRunGuard.ts` | Solution C add command |
| **New** | `src/commands/removeRunGuard.ts` | Solution C remove command |
| **Modified** | `src/taskItem.ts` | Add `guardedByDefinition?` property only |
| **Modified** | `src/taskTreeDataProvider.ts` | Guard contextValue projection in `getTreeItem()` |
| **Modified** | `src/taskRunner.ts` | `skipGuard` param; guard check; `Promise<boolean>`; compound task breaks |
| **Modified** | `src/commands/runTaskWithArgs.ts` | Guard before `showInputBox`; pass `skipGuard: true` |
| **Modified** | `src/commands/restartTask.ts` | Pass `skipGuard: true` to `runTask()` |
| **Modified** | `src/services/workspaceTasksService.ts` | Add `confirm?` to `FileTaskDefinition` |
| **Modified** | `src/providers/workspaceTasksProvider.ts` | Set `item.guardedByDefinition` |
| **Modified** | `res/schemas/workspace-tasks.schema.json` | Add `"confirm"` property |
| **Modified** | `package.json` | Setting + 2 commands + context menu entries |
| **Modified** | `src/commands/index.ts` | Register new commands |
| **Modified** | `src/extension.ts` | Initialize service + register decorator + subscribe refresh |

---

## Test Plan

### New test file: `src/test/suite/taskRunGuardService.test.ts`

| Test | Assertion |
|---|---|
| `isGuarded` — no guards set | Returns `false` |
| `isGuarded` — manual guard (Solution C) | Returns `true` for guarded ID |
| `isGuarded` — definition flag (Solution B) | Returns `true` when `item.guardedByDefinition === true` |
| `isGuarded` — pattern match (Solution A) | Returns `true` when label matches a pattern |
| `isGuarded` — pattern miss | Returns `false` when label does not match |
| `isGuarded` — invalid regex in patterns | Does not throw; skips invalid entry |
| `addGuard` + `isManuallyGuarded` | ID added to workspaceState; `isManuallyGuarded` returns `true` |
| `removeGuard` | ID removed from workspaceState; `isGuarded` returns `false` |
| `addGuard` — duplicate | No duplicate stored; guard count stays 1 |
| `confirmIfNeeded` — not guarded | Returns `true` without showing dialog |
| `confirmIfNeeded` — guarded, user confirms | Returns `true` following mocked `showWarningMessage` |
| `confirmIfNeeded` — guarded, user cancels | Returns `false` following mocked `showWarningMessage` |
| Pattern matching is case-insensitive | Pattern `deploy` matches label `Deploy` |
| `originalLabel` used for pattern match | Not post-grouping label |

### Additions to `src/test/suite/taskRunner.test.ts`

| Test | Assertion |
|---|---|
| `runTask` — not guarded | Calls `executeTask`; returns `true` |
| `runTask` — guarded, user confirms | Calls `executeTask`; returns `true` |
| `runTask` — guarded, user cancels | Does NOT call `executeTask`; returns `false`; status unchanged |
| `runTask` — guarded + `skipGuard: true` | Skips dialog; calls `executeTask`; returns `true` |
| `runCompoundTask` sequential — guard cancelled at step 2 | Steps 3+ not run; existing try-catch preserved |
| `runCompoundTask` sequential — step 2 fails naturally | Still breaks on failure-status check |
| `runCompoundTask` parallel — guard cancelled for one item | Only that item skipped; others run |

### Additions to `src/test/suite/taskTreeDataProvider.test.ts`

| Test | Assertion |
|---|---|
| `getTreeItem` — not guarded leaf | Returns `element` unchanged |
| `getTreeItem` — guarded leaf task | Returns projection with `contextValue = 'guardedTask'` |
| `getTreeItem` — guarded favorite leaf | Returns projection with `contextValue = 'guardedFavoriteTask'` |
| `getTreeItem` — guarded group item | Returns `element` unchanged (no guard prefix on groups) |

---

## Confidence Gates & Edge Cases

| Concern | Mitigation |
|---|---|
| Pattern matching on renamed tasks | Silently stops matching — same behavior as a removed favorite. User must update `confirmPatterns`. Documented. |
| Guard on compound-task copy (fav/recent copy) | Copy item has the same `id` as the original before any prefix is added. `getTreeItem()` and `isGuarded()` receive the copy and check its `id` (which matches the original canonical ID at that point). |
| Guard on item inside compound task queue | These items have IDs prefixed `compound-task:name:<original-id>`. Pattern and definition guards fire on `originalLabel` regardless. Manual guards added via Solution C use the canonical ID via `addGuard(item)` — the item passed to the command is the queued copy whose ID already has the prefix. Phase 2 should normalize via `isGuardedById` prefix stripping. Interim: document that adding a manual guard via the context menu on a compound-task queue item requires the user to add the guard on the original item in the workspace tree instead. |
| Multiple parallel guard dialogs | VS Code serializes modal dialogs; second dialog appears only after first is dismissed. Acceptable Phase 1 behavior. |
| `runTask` return type breaks callers | TypeScript allows non-`void` return where `void` was expected. `RunTaskCommand` and others ignore the value, requiring no changes. |
| Invalid regex in `confirmPatterns` | `try-catch` in `_refreshPatterns()`; invalid entries skipped silently. |
| Circular dependency in decoration provider | Eliminated by moving guard prefix logic to `getTreeItem()`. Static imports throughout. |
| Guard removed while task is running | Guard check only fires at execution entry. In-flight tasks are unaffected. |
| `runTaskWithArgs` inverted UX | Guard fires before `showInputBox` in `RunTaskWithArgsCommand.run()`; `skipGuard: true` prevents double dialog in `runTask()`. |
| Restart should not re-confirm | `restartTask.ts` passes `skipGuard: true`; restart is explicit user intent. |
| Solution B `confirm: true` affects all users | Intentional. Individual users can add a Solution C guard override on their own (but Solution C cannot *suppress* a B/A guard in Phase 1 — a suppressGuard mechanism is a Phase 2 enhancement). |
| Status Bar task pins (future feature) | Will call `TaskRunner.runTask()` which already has the guard check. No additional wiring needed. |
