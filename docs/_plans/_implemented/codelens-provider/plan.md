# Plan: Task CodeLens Provider

**Status:** Draft (post rubber-duck review)
**Branch:** v1.10.1
**Area:** Editor / Task Execution

---

## 1. Objective

Register a `vscode.CodeLensProvider` that displays inline action lenses above task definitions in
task source files. For any file that contains **one or more** runnable tasks with an identifiable
line position (`startLine`), each task definition receives a row of lenses that mirror the
action-bar buttons shown on tree-view task items (Run, Run with Args, Favorites, Compound Task,
Hide / Unhide — excluding "Open File" since the user is already viewing that file). The set of
lenses shown respects the same per-action `workspaceTasks.task.actionBar.*` configuration flags
used by the tree view.

---

## 2. Rubber Duck Review Summary

The initial draft was reviewed by a sub-agent, which identified the following issues that were
incorporated into this revised plan:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** `getRunnableTasksForFile` excludes hidden tasks, making the "Unhide" lens architecturally impossible as written | Critical | Switch to `TaskCacheService.getTasksForFile(uri)` with manual leaf/hide filtering so hidden tasks remain visible in showHiddenMode |
| **C2** `TaskStateManager.onDidStateChange` exists and IS public — the draft's OQ4 was incorrect | Critical | Removed OQ4; confirmed `onDidStateChange` subscription in §5.1; added debounce/filter per H5 |
| **C3** GitHub Actions job scan (`l.trim().startsWith(jobId + ':')`) matches keys at any YAML depth | Critical | Scoped the scan to direct children of `jobs:` by checking 2-space indentation |
| **H1** `CancellationToken` ignored in `provideCodeLenses` | High | Added `token.isCancellationRequested` guard after the file lookup |
| **H2** `actionBar.queue` (JSON key) was mislabelled `actionBar.compoundTask` in the draft | High | Corrected throughout — the JSON property name is **`queue`** |
| **H3** OQ1 and OQ5 were unresolved blocking decisions | High | Finalised: `codeLens.enabled` is **window-scoped**; "Add to Compound Task" lens is hidden when `contextValue` contains `queuedTask` |
| **H4** `resolveCodeLens` not planned | High | Explicitly decided: **not needed** — all lens data is synchronously available at `provideCodeLenses` time |
| **H5** `onDidStateChange` fires for every task; no filter | High | Subscription filters events to tasks whose `taskFileUri` matches a currently visible editor |
| **H6** `{ scheme: 'file' }` selector calls `provideCodeLenses` for every open file | High | Added `hasTasksForFile(uri)` fast-path early return before the full lookup |
| **M1** Multiple tasks with `startLine = 0` stack lenses at line 0 | Medium | Documented as known edge case; no deduplication — VS Code stacks them vertically, which is acceptable for the rare provider-fallback scenario |
| **M2** Redundant `l.startsWith('on:') \|\| l === 'on:'` in event scan pseudocode | Medium | Simplified to `l.trimStart().startsWith('on:')` |
| **M4** `dispose()` spec was vague | Medium | Explicit disposal contract specified in §5.1 |
| **M5** Run-guard (`guardedByDefinition`) not addressed | Medium | **Deferred**: lens label is "Run Task" regardless of guard; guard dialog fires normally when command executes (consistent with editor title-bar buttons) |
| **M6** Configuration group placement unspecified | Medium | Specified: add under the **Display** configuration group in `package.json` |
| **M7** NLS strings not provided | Medium | Example keys and English strings included in §6.1 |
| **L2** `startLine = 0` is falsy — filter must use `!== undefined` | Low | Confirmed: filter uses `startLine !== undefined` — correct |
| **L3** Docs omit list of task types without CodeLens support | Low | Feature doc now includes an explicit "Not yet supported" table |
| **L4** README change not scoped | Low | Specific section identified |
| **L5** Docs architecture undecided | Low | Decided: `docs/features/codelens.md` for the feature page; `docs/configuration/general.md` for the setting |

Issues considered but **not adopted**:

| Issue | Reason |
|---|---|
| **M3** T17 described as vacuous because `getRunnableTasksForFile` excludes hidden tasks | Moot after C1 fix — with the revised task-gathering approach T17 now tests a real code path |
| **M1** Deduplication of tasks at the same `startLine` | VS Code renders stacked CodeLens rows correctly; deduplication would complicate the provider and risk hiding legitimate tasks (e.g., alias tasks) that share a definition line |

---

## 3. Background

### 3.1 Current Task-Location Support

`TaskItem` exposes a `startLine: number | undefined` property that providers set to indicate the
0-based line where a task is defined. The extension already uses this in `onOpenActionCommand` to
jump to the correct location when opening a file. The CodeLens provider reads this property to
determine where to attach lenses.

### 3.2 Provider `startLine` Inventory

| Provider | `startLine` Status | Notes |
|---|---|---|
| `antTaskProvider` | ❌ Missing | XML; opens at line 0 — deferred |
| `bitbucketPipelinesTaskProvider` | ❌ Missing | YAML; no line tracking — deferred |
| `cakeTaskProvider` | ✅ Set | Line-by-line scan |
| `cargoMakeTaskProvider` | ✅ Set | Extends `TomlTaskProvider` |
| `circleCiTaskProvider` | ✅ Set | Uses `yaml.parse` CST `.line` |
| `cmakeTaskProvider` | ✅ Set | Line-by-line scan |
| `composerTaskProvider` | ✅ Set | Line-by-line scan |
| `denoTaskProvider` | ✅ Set | Line-by-line scan |
| `githubActionsTaskProvider` | ⚠️ Partial | `lineNo` computed for jobs but **not assigned to `item.startLine`**; events have no line detection — **fixed in this plan** |
| `gitlabCiTaskProvider` | ⚠️ Hardcoded 0 | CLI (`--list-json`) emits no line numbers — deferred |
| `gradleTaskProvider` | ✅ Set | Line-by-line scan |
| `gruntTaskProvider` | ✅ Set | Line-by-line scan |
| `gulpTaskProvider` | ✅ Set | Line-by-line scan |
| `jupyterTaskProvider` | ❌ N/A | Notebook cells; no meaningful text line |
| `justfileTaskProvider` | ✅ Set | |
| `makefileTaskProvider` | ✅ Set | Line-by-line scan |
| `mavenTaskProvider` | ❌ Missing | Lifecycle phases lack file-line mappings — deferred |
| `miseTaskProvider` | ✅ Set | Extends `TomlTaskProvider` (confirmed via `TomlTaskProvider.findScriptLine`) |
| `msbuildTaskProvider` | ✅ Set | `findTargetStartLine()` |
| `npmTaskProvider` | ✅ Set | Line-by-line scan |
| `packageJsonTaskProvider` | ✅ Set | Line-by-line scan |
| `packageYamlTaskProvider` | ✅ Set | Extends `PackageJsonTaskProvider` |
| `pipenvTaskProvider` | ✅ Set | Extends `TomlTaskProvider` |
| `poeTaskProvider` | ✅ Set | `findTaskLineInContent()` |
| `poetryTaskProvider` | ✅ Set | `findScriptLineInContent()` |
| `rakeTaskProvider` | ❌ Missing | CLI-based; `rake --tasks` emits no line numbers — deferred |
| `shellTaskProvider` | ❌ N/A | Entire file is the task; no sub-task definition line |
| `taskfileTaskProvider` | ✅ Set | CLI-provided `location.line` |
| `tomlTaskProvider` | ✅ Set | `findScriptLine()` text scan |
| `vscodeTaskProvider` | ✅ Set | Line-by-line scan |
| `workspaceTasksProvider` | ❌ N/A | System/virtual tasks; no backing file |

### 3.3 Providers Fixed in This Plan

**`githubActionsTaskProvider.ts`** — two changes:

- **Jobs:** the already-computed `lineNo` is not assigned to `item.startLine`. The fix assigns it.
  The scan is restricted to lines that are direct children of `jobs:` (indented exactly 2 spaces,
  relative to the `jobs:` key at column 0) to avoid false positives at deeper YAML nesting.

- **Events:** scan for each event key at the correct 2-space indentation under the `on:` block;
  fall back to the `on:` line itself when the specific event key is not found.

### 3.4 Providers Deferred to Future Plans

| Provider | Challenge | Suggested Approach |
|---|---|---|
| `antTaskProvider` | XML parser config lacks line-number output | Enable `localeRange` / `getSource` in `fast-xml-parser` |
| `bitbucketPipelinesTaskProvider` | YAML step/stage nesting; no line tracking | Use `yaml` CST (`yaml.parseDocument` with `{ keepSourceTokens: true }`) to extract `.range` offsets |
| `gitlabCiTaskProvider` | `--list-json` CLI output has no line info | Fall back to YAML text scan after CLI enumeration |
| `mavenTaskProvider` | Standard lifecycle phases are not literally defined in `pom.xml` | Best-effort XML scan for `<id>`/`<goal>` elements; lifecycle phases get line 0 |
| `rakeTaskProvider` | `rake --tasks` is CLI-only; no source parsing | Parse the `Rakefile` for `task :name` / `desc`+`task` patterns |

---

## 4. Requirements

1. **Any task file** — CodeLens shown for any file with one or more located leaf tasks (visible
   or hidden in show-hidden mode).

2. **Per-task lenses** — Each qualifying task gets one or more lenses at its `startLine`, one per
   enabled action.

3. **Respects `actionBar` configuration** — The same `workspaceTasks.task.actionBar.*` flags
   (`run`, `runWithArgs`, `favorite`, `queue`, `hide`, `unhide`) that control tree-view inline
   buttons control which lenses are shown. Note: the JSON property name for the compound-task
   button is **`queue`** (not `compoundTask`).

4. **"Open File" excluded** — `actionBar.openFile` lenses are omitted since the file is already
   open.

5. **Favorites awareness** — When `actionBar.favorite` is enabled, the lens shows
   **"Remove from Favorites"** if the task is already favorited, and **"Add to Favorites"**
   otherwise.

6. **Running-state awareness** — When a task is currently running, the "Run Task" lens is replaced
   by a **"Stop Task"** lens, and "Run with Args" is omitted.

7. **Hidden-task handling** — When `filteredService.isShowHiddenMode()` is `true`, hidden leaf
   tasks at known line positions receive a lens row containing only the **"Unhide Task"** action
   (when `actionBar.unhide` is enabled). Hidden tasks in normal (non-show-hidden) mode are
   excluded entirely.

8. **Workspace trust** — No lenses are shown when `vscode.workspace.isTrusted` is `false`.

9. **Master on/off switch** — `workspaceTasks.codeLens.enabled` (boolean, default `true`,
   **window-scoped**) allows users to disable all CodeLens lenses at once.

10. **Cache-aware invalidation** — Lenses refresh automatically when:
    - `TaskCacheService.onDidUpdate` fires
    - `vscode.workspace.onDidChangeConfiguration` fires for `workspaceTasks.*`
    - `FilteredTaskService.onDidChange` fires
    - `TaskStateManager.onDidStateChange` fires **for a task whose `taskFileUri` matches a
      currently visible editor** (filtered to avoid global invalidation storms)

11. **Already-queued tasks** — Tasks whose `contextValue` contains `queuedTask` show
    **"Remove from Compound Task"** instead of "Add to Compound Task" (mirrors tree-view
    behaviour).

12. **CancellationToken honoured** — `provideCodeLenses` checks `token.isCancellationRequested`
    after the file-task lookup and returns `[]` early if cancelled.

13. **`resolveCodeLens` not implemented** — All lens data (labels, commands, ranges) is
    synchronously available at `provideCodeLenses` time; the two-phase API provides no benefit
    here.

14. **100% line and branch coverage** for all new source files.

---

## 5. Architecture

### 5.1 New File: `src/taskCodeLensProvider.ts`

```typescript
import * as vscode from 'vscode';
import { TaskCacheService } from './services/taskCacheService';
import { FilteredTaskService } from './services/filteredTaskService';
import { FavoritesService } from './services/favoritesService';
import { TaskStateManager } from './taskStateManager';
import { isLeafTask } from './tools/taskToolsUtils';

export class TaskCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private readonly _subscriptions: vscode.Disposable[] = [];

  constructor(_context: vscode.ExtensionContext) {
    this._subscriptions.push(
      // Invalidate on cache update
      TaskCacheService.getInstance().onDidUpdate(() =>
        this._onDidChangeCodeLenses.fire()
      ),
      // Invalidate on any workspaceTasks config change
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workspaceTasks')) {
          this._onDidChangeCodeLenses.fire();
        }
      }),
      // Invalidate on hide/show state change
      FilteredTaskService.getInstance().onDidChange(() =>
        this._onDidChangeCodeLenses.fire()
      ),
      // Invalidate on task status change, but only when the task's file is open
      TaskStateManager.getInstance().onDidStateChange(({ id }) => {
        const task = TaskCacheService.getInstance().getTask(id);
        if (task?.taskFileUri) {
          const openUris = vscode.window.visibleTextEditors.map(
            (e) => e.document.uri.toString()
          );
          if (openUris.includes(task.taskFileUri.toString())) {
            this._onDidChangeCodeLenses.fire();
          }
        }
      }),
    );
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!vscode.workspace.isTrusted) { return []; }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    if (!config.get<boolean>('codeLens.enabled', true)) { return []; }

    // Fast path: O(1) Map check before heavier work
    if (!TaskCacheService.getInstance().hasTasksForFile(document.uri)) { return []; }

    if (token.isCancellationRequested) { return []; }

    const allTasks = TaskCacheService.getInstance().getTasksForFile(document.uri);
    const filteredService = FilteredTaskService.getInstance();
    const showHidden = filteredService.isShowHiddenMode();

    // All leaf tasks with a known location
    const locatedTasks = allTasks.filter(
      (t) => isLeafTask(t) && t.startLine !== undefined,
    );

    const visibleTasks = locatedTasks.filter(
      (t) => !filteredService.isFilteredOrHasFilteredParent(t),
    );
    const hiddenTasks = showHidden
      ? locatedTasks.filter((t) => filteredService.isFilteredOrHasFilteredParent(t))
      : [];

    if (visibleTasks.length + hiddenTasks.length === 0) { return []; }

    const actionBar = config.get<Record<string, boolean>>('task.actionBar') ?? {};
    const lenses: vscode.CodeLens[] = [];

    for (const task of visibleTasks) {
      lenses.push(...this._buildVisibleLensRow(task, actionBar));
    }
    for (const task of hiddenTasks) {
      lenses.push(...this._buildHiddenLensRow(task, actionBar));
    }
    return lenses;
  }

  private _buildVisibleLensRow(
    task: import('./taskItem').TaskItem,
    actionBar: Record<string, boolean>,
  ): vscode.CodeLens[] {
    const range = new vscode.Range(task.startLine!, 0, task.startLine!, 0);
    const lenses: vscode.CodeLens[] = [];
    const status = TaskStateManager.getInstance().getStatus(task.id ?? '');
    const isFavorite = FavoritesService.getInstance().isFavorite(task.id ?? '');
    const isQueued = task.contextValue?.includes('queuedTask') ?? false;

    if (actionBar['run'] !== false) {
      if (status === 'running') {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(debug-stop) Stop Task',
          command: 'workspaceTasks.stopTask',
          arguments: [task],
        }));
      } else {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(debug-start) Run Task',
          command: 'workspaceTasks.runTask',
          arguments: [task],
        }));
      }
    }

    if (actionBar['runWithArgs'] !== false && status !== 'running') {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(debug-continue) Run with Args',
        command: 'workspaceTasks.runTaskWithArgs',
        arguments: [task],
      }));
    }

    if (actionBar['favorite'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: isFavorite ? '$(star-full) Remove from Favorites' : '$(star) Add to Favorites',
        command: isFavorite
          ? 'workspaceTasks.removeFromFavorites'
          : 'workspaceTasks.addToFavorites',
        arguments: [task],
      }));
    }

    if (actionBar['queue'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: isQueued
          ? '$(trash) Remove from Compound Task'
          : '$(list-unordered) Add to Compound Task',
        command: isQueued
          ? 'workspaceTasks.removeFromCompoundTask'
          : 'workspaceTasks.addToCompoundTask',
        arguments: [task],
      }));
    }

    if (actionBar['hide'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(eye-closed) Hide Task',
        command: 'workspaceTasks.hideTask',
        arguments: [task],
      }));
    }

    return lenses;
  }

  private _buildHiddenLensRow(
    task: import('./taskItem').TaskItem,
    actionBar: Record<string, boolean>,
  ): vscode.CodeLens[] {
    if (actionBar['unhide'] === false) { return []; }
    const range = new vscode.Range(task.startLine!, 0, task.startLine!, 0);
    return [new vscode.CodeLens(range, {
      title: '$(eye) Unhide Task',
      command: 'workspaceTasks.unhideTask',
      arguments: [task],
    })];
  }

  public dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    for (const d of this._subscriptions) { d.dispose(); }
    this._subscriptions.length = 0;
  }
}
```

### 5.2 Helper: `TaskCacheService.hasTasksForFile(uri)`

Add to `src/services/taskCacheService.ts` if not already present:

```typescript
public hasTasksForFile(uri: vscode.Uri): boolean {
  return this.fileTaskMap.has(uri.toString());
}
```

Used for the O(1) fast-path in `provideCodeLenses` to short-circuit non-task files before
doing any further work.

### 5.3 Provider Registration in `extension.ts`

```typescript
import { TaskCodeLensProvider } from './taskCodeLensProvider';

// inside activate(), after EditorTaskActionService initialisation:
const codeLensProvider = new TaskCodeLensProvider(context);
context.subscriptions.push(
  vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
  codeLensProvider,
);
```

`{ scheme: 'file' }` targets all local files. The `hasTasksForFile` fast-path keeps the cost
for non-task files to a single Map lookup per `provideCodeLenses` call.

### 5.4 `githubActionsTaskProvider.ts` — `startLine` Fix

#### Jobs (assign already-computed `lineNo` and restrict scan depth)

```typescript
// Find jobs: at column 0
const jobsLineIndex = lines.findIndex((l) => /^jobs\s*:/.test(l));

// Find the job key as a direct child of jobs: (exactly 2-space indent)
const lineNo = lines.findIndex(
  (l, i) =>
    i > jobsLineIndex &&
    /^  \S/.test(l) &&                           // direct child of jobs:
    l.trimStart().startsWith(`${jobId}:`),
);

const jobItem = new TaskItem(/* ... */);
jobItem.startLine = lineNo >= 0 ? lineNo : 0;    // ← assigned (was missing)
jobItem.metadata = { type: 'job', jobId };
```

#### Events (line detection under `on:`)

```typescript
// Find the on: block at column 0
const onLineIndex = lines.findIndex((l) => /^on\s*:/.test(l.trimStart()));

// Find the specific event as a direct child of on: (2-space indent)
const eventLineIndex = lines.findIndex(
  (l, i) =>
    i > onLineIndex &&
    /^  \S/.test(l) &&
    l.trimStart().startsWith(`${event}:`),
);

item.startLine =
  eventLineIndex >= 0 ? eventLineIndex :
  onLineIndex >= 0    ? onLineIndex    : 0;
```

---

## 6. File Changes

| File | Change |
|---|---|
| `src/taskCodeLensProvider.ts` | **New** — `TaskCodeLensProvider` class |
| `src/services/taskCacheService.ts` | Add `hasTasksForFile(uri): boolean` method |
| `src/extension.ts` | Import and register `TaskCodeLensProvider` |
| `src/providers/githubActionsTaskProvider.ts` | Assign `item.startLine` for jobs (restricted depth scan) and events |
| `package.json` | Add `workspaceTasks.codeLens.enabled` in the **Display** configuration group |
| `package.nls.json` | Add NLS strings (see §6.1) |
| `src/test/suite/taskCodeLensProvider.test.ts` | **New** unit tests (see §7) |
| `src/test/suite/githubActionsTaskProvider.test.ts` | Add tests for `startLine` on job/event items (see §7.2) |
| `src/test/suite/taskCacheService.test.ts` | Add test for `hasTasksForFile` method |
| `docs/configuration/general.md` | Document `codeLens.enabled` setting |
| `docs/features/codelens.md` | **New** feature page (see §8) |
| `README.md` | Add "Inline CodeLens task actions" in the **Features** section |

### 6.1 NLS Strings to Add to `package.nls.json`

```json
"config.workspaceTasks.codeLens.enabled": "Show inline CodeLens task actions in task source files.",
"config.workspaceTasks.codeLens.enabled.markdown": "When enabled, shows **Run**, **Run with Args**, **Favorites**, **Compound Task**, and **Hide/Unhide** task actions as inline CodeLens lenses above each task definition in task source files. Respects the `workspaceTasks.task.actionBar.*` visibility settings."
```

### 6.2 `package.json` Configuration Entry

Add to the **Display & Interaction** group (`"title": "%config.group.displayInteraction.title%"`) after the existing
`workspaceTasks.task.actionBar` entry:

```json
"workspaceTasks.codeLens.enabled": {
  "title": "%config.workspaceTasks.codeLens.enabled%",
  "type": "boolean",
  "default": true,
  "scope": "window",
  "description": "%config.workspaceTasks.codeLens.enabled%",
  "markdownDescription": "%config.workspaceTasks.codeLens.enabled.markdown%"
}
```

---

## 7. Test Plan

All new code targets **100% line and branch coverage**. Tests live in
`src/test/suite/taskCodeLensProvider.test.ts` (new) and additions to
`src/test/suite/githubActionsTaskProvider.test.ts`.

### 7.1 `TaskCodeLensProvider` Unit Tests

| # | Scenario | Expected |
|---|---|---|
| T01 | `provideCodeLenses` — untrusted workspace | Returns `[]` |
| T02 | `provideCodeLenses` — `codeLens.enabled = false` | Returns `[]` |
| T03 | `provideCodeLenses` — file not in task cache (`hasTasksForFile = false`) | Returns `[]` immediately (fast path) |
| T04 | `provideCodeLenses` — cancellation token already cancelled | Returns `[]` |
| T05 | `provideCodeLenses` — file with 0 located leaf tasks | Returns `[]` |
| T06 | `provideCodeLenses` — file with 1 visible task with `startLine`; all `actionBar` flags default | Returns correct lenses for that single task |
| T07 | `provideCodeLenses` — file with 2 visible tasks, both with `startLine`; all `actionBar` flags default | Returns correct set of lenses for both tasks |
| T08 | `provideCodeLenses` — task with `startLine = 0` (valid falsy value) | `startLine !== undefined` keeps it; lenses appear at line 0 |
| T09 | `provideCodeLenses` — `actionBar.run = false` | No "Run Task" or "Stop Task" lens |
| T10 | `provideCodeLenses` — `actionBar.runWithArgs = false` | No "Run with Args" lens |
| T11 | `provideCodeLenses` — `actionBar.favorite = false` | No favorites lens |
| T12 | `provideCodeLenses` — `actionBar.queue = false` | No compound task lens |
| T13 | `provideCodeLenses` — `actionBar.hide = false` | No "Hide Task" lens |
| T14 | `provideCodeLenses` — task is favorited | Shows "Remove from Favorites" |
| T15 | `provideCodeLenses` — task is not favorited | Shows "Add to Favorites" |
| T16 | `provideCodeLenses` — task status = `running` | Shows "Stop Task"; "Run with Args" omitted |
| T17 | `provideCodeLenses` — task status ≠ `running` | Shows "Run Task" + "Run with Args" |
| T18 | `provideCodeLenses` — task `contextValue` contains `queuedTask` | Shows "Remove from Compound Task"; "Add to Compound Task" absent |
| T19 | `provideCodeLenses` — task `contextValue` does NOT contain `queuedTask` | Shows "Add to Compound Task" |
| T20 | `provideCodeLenses` — task is hidden + `showHiddenMode = true` | Shows "Unhide Task" lens |
| T21 | `provideCodeLenses` — task is hidden + `showHiddenMode = false` | Hidden task excluded; no lens |
| T22 | `provideCodeLenses` — `actionBar.unhide = false` + hidden task in show-hidden mode | No "Unhide" lens returned |
| T23 | `provideCodeLenses` — 1 visible + 1 hidden (showHidden=true) | Lenses generated for both tasks |
| T24 | `provideCodeLenses` — 1 visible + 1 hidden (showHidden=false) | Only visible task gets lenses; hidden task excluded |
| T25 | `onDidChangeCodeLenses` fires when `TaskCacheService.onDidUpdate` fires | Invalidation emitted |
| T26 | `onDidChangeCodeLenses` fires when `workspaceTasks.*` config changes | Invalidation emitted |
| T27 | `onDidChangeCodeLenses` fires when `FilteredTaskService.onDidChange` fires | Invalidation emitted |
| T28 | `onDidChangeCodeLenses` fires when `onDidStateChange` fires for a task whose file is in a visible editor | Invalidation emitted |
| T29 | `onDidChangeCodeLenses` does NOT fire when `onDidStateChange` fires for a task in a non-visible file | No invalidation |
| T30 | Each lens `range.start.line` equals `task.startLine` | Range line matches `startLine` |
| T31 | Each lens `command.arguments[0]` is the task item | Arguments contain task |
| T32 | Each lens uses the correct command ID | e.g., `workspaceTasks.runTask` |
| T33 | `dispose()` disposes all subscription disposables and clears the array | Subscriptions cleaned up |
| T34 | `dispose()` disposes the `_onDidChangeCodeLenses` emitter | Emitter disposed |

### 7.2 GitHub Actions `startLine` Tests (additions to existing file)

| # | Scenario | Expected |
|---|---|---|
| G01 | Job item — job key found at 2-space indent under `jobs:` | `item.startLine` matches the line index |
| G02 | Job item — job key exists but only at deeper nesting (not a direct child of `jobs:`) | `item.startLine === 0` (fallback) |
| G03 | Job item — `jobs:` section absent from file | `item.startLine === 0` |
| G04 | Event item (`push`) — event key found at 2-space indent under `on:` | `item.startLine` matches line of `push:` |
| G05 | Event item — event key not found; `on:` line exists | `item.startLine` equals `on:` line index |
| G06 | Event item — neither event key nor `on:` found | `item.startLine === 0` |

### 7.3 `TaskCacheService.hasTasksForFile` Test (addition to existing file)

| # | Scenario | Expected |
|---|---|---|
| H01 | URI is in `fileTaskMap` | Returns `true` |
| H02 | URI is NOT in `fileTaskMap` | Returns `false` |

---

## 8. Documentation

### 8.1 New Feature Page: `docs/features/codelens.md`

Contents:
- Summary of the feature and when lenses appear
- Screenshot / GIF placeholder
- Full table of **supported task types** at launch (from §3.2)
- **"Not yet supported"** table (from §3.4) with explanation that those providers lack line-position
  data, and that dedicated follow-up plans will address each
- Configuration reference: `codeLens.enabled`, `task.actionBar.*`
- Relationship to editor title-bar buttons (CodeLens is complementary; both can be active simultaneously for the same file)

### 8.2 Configuration: `docs/configuration/general.md`

Add `workspaceTasks.codeLens.enabled`:
- Description, default (`true`), scope (window)
- Example JSON snippet

### 8.3 README Update

In the existing **Features** section, add the bullet:

> - **Inline CodeLens actions** — Run, Run with Args, Favorites, Compound Task, and Hide/Unhide appear directly above each task definition in task source files.

---

## 9. Future Work

The following task types need a separate plan to add `startLine` support before CodeLens can show
lenses for their tasks:

| Provider | Suggested Plan Name |
|---|---|
| `antTaskProvider` | "Ant Provider Line-Location Support" |
| `bitbucketPipelinesTaskProvider` | "Bitbucket Pipelines Line-Location Support" |
| `gitlabCiTaskProvider` | "GitLab CI Line-Location Support" |
| `mavenTaskProvider` | "Maven Provider Line-Location Support" |
| `rakeTaskProvider` | "Rake Provider Line-Location Support" |

---

## 10. Resolved Design Decisions

| # | Question | Decision |
|---|---|---|
| OQ1 | Scope for `codeLens.enabled` | **Window-scoped** — consistent with all other display settings |
| OQ2 | Performance of per-call `getTasksForFile()` Map lookup | Acceptable — O(1); `hasTasksForFile` short-circuits non-task files before any deeper work |
| OQ3 | `{ scheme: 'file' }` selector breadth | Accepted for v1 — `hasTasksForFile` fast-path minimises per-file cost; a precise per-language/glob selector is a v2 follow-up |
| OQ4 | `TaskStateManager.onDidStateChange` availability | **Available and public** — subscription added with visible-editor filter to prevent global invalidation storms |
| OQ5 | "Add to Compound Task" for already-queued tasks | **Context-aware**: tasks with `contextValue` containing `queuedTask` show "Remove from Compound Task" instead; mirrors tree-view behaviour |
