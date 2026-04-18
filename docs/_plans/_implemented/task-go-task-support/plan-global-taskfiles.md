# Plan: Global Taskfiles Discovery

## TL;DR

Task supports a global `Taskfile.yml` at `$HOME/Taskfile.yml` (and case/extension variants) that
applies across all projects. This plan adds **opt-in** discovery of the global Taskfile via
`getSystemTasks()`. The feature is disabled by default (`workspaceTasks.taskfile.discoverGlobalTaskfile`
= `false`) because scanning outside the workspace carries performance and privacy implications.
When enabled, the global Taskfile is discovered once at startup, its tasks surfaced as system-level
entries, and the CLI's `--taskfile` flag is used during execution to ensure the correct file is
invoked regardless of the current working directory. After first discovery, watcher(s) are
attached to discovered `$HOME` Taskfile path(s). On file change/create/delete, global items are
refreshed and a new `$HOME` scan runs to detect newly available variant files.

---

## Requirements

- Global Taskfile discovery is **opt-in** via `workspaceTasks.taskfile.discoverGlobalTaskfile` (boolean,
  default `false`).
- When enabled, the extension checks for a Taskfile at `$HOME` using the standard variant list:
  `Taskfile.yml`, `taskfile.yml`, `Taskfile.yaml`, `taskfile.yaml`.
- Discovery uses `task --list-all --no-status --json` in the home directory (same approach as
  workspace discovery).
- Tasks from the global Taskfile are returned by `getSystemTasks()` and surfaced in the tree
  alongside other system-level tasks.
- Execution passes `--taskfile <absolute path>` so `task` always resolves the correct global file.
- After first discovery, file watcher(s) are attached to discovered `$HOME` Taskfile path(s).
- Watcher events (`change`, `create`, `delete`) trigger a refresh and a new `$HOME` scan so newly
  added Taskfile variants can be discovered.
- Achieve 100% test coverage for all new/changed code paths.

---

## Key Design Decisions

### `getSystemTasks()` vs `getTasks()`

`getSystemTasks()` is the correct home for global Taskfile tasks because:

- System tasks are scoped to the user level (not a workspace folder), consistent with how
  `NpmTaskProvider.getSystemTasks()` fetches VS Code's built-in npm tasks.
- The `RakeTaskProvider.getSystemTasks()` precedent: it also uses the VS Code task API to find
  tasks not discovered by file scanning.
- Global tasks should appear at the root of the tree, not scoped to a workspace folder.

### Home directory detection

Use `os.homedir()` (already available in Node.js). This is cross-platform and avoids hardcoding
`~/` expansion. The `ExecutableService` already expands `~/` in paths, but for constructing a URI
we use `os.homedir()` directly.

### Global Taskfile variant precedence

Task itself applies a precedence order when multiple variants exist in the same directory:
`Taskfile.yml` > `taskfile.yml` > `Taskfile.yaml` > `taskfile.yaml`. The discovery logic checks
all variants via `fs.existsSync` and uses the first one found (in Task's precedence order). The CLI
is then invoked in that directory — Task resolves its own precedence at runtime.

### `--taskfile` flag in execution

When running a global task, the current working directory may be a workspace subfolder that has its
own Taskfile. Without `--taskfile`, task would discover the workspace Taskfile instead of the global
one. Therefore execution for global tasks must pass `--taskfile <absolute path>`.

This flag is only applied to items whose `metadata.isGlobalTask === true`. The flag is added in
`taskFactory.ts`.

### Watchers after first discovery

After global discovery runs, the provider keeps watcher coverage for global Taskfile candidates in
`$HOME`.

- Watchers are attached to discovered file path(s).
- A watcher set for known variant filenames in `$HOME` is also maintained so new files can be
  detected (`Taskfile.yml`, `taskfile.yml`, `Taskfile.yaml`, `taskfile.yaml`).
- On any watcher event, the provider triggers a refresh path that re-scans `$HOME`, updates global
  task items, and reconciles watcher registrations.

This preserves precedence behavior while making global tasks reactive to edits and new files.

### Why opt-in and default false?

- Scanning `$HOME` is outside the workspace and surprises users who did not set up a global
  Taskfile. Discovering empty or unexpected tasks here is more confusing than missing them.
- Security: `$HOME/Taskfile.yml` could contain sensitive task definitions (deploy credentials etc.)
  that a user would not want to expose in VS Code's task tree unintentionally.
- Performance: `getSystemTasks()` is called on every refresh. Spawning `task` in `$HOME` on every
  refresh is low-cost but adds up in low-performance environments.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Opt-in default minimizes surprise. Users who want global tasks explicitly enable the feature.
- Using `getSystemTasks()` follows the established pattern without needing new infrastructure.
- The `--taskfile` flag in execution is robust against cwd changes.
- Watcher-based refresh keeps global tasks current without manual refresh in common edit flows.

**Risks / Weaknesses:**

- **Watcher lifecycle complexity:** Watchers must be disposed/recreated safely to avoid duplicate
  subscriptions and memory leaks.
- **Burst events:** Save operations may emit multiple file events; debounce should be used before
  re-running discovery.
- **`os.homedir()` on remote environments:** In SSH remote or container environments,
  `os.homedir()` returns the remote user's home, which is correct. However, a global Taskfile in
  the local machine's home would not be surfaced. This is expected behavior and should be
  documented.
- **`getSystemTasks()` is called for every provider on refresh:** The implementation must check
  `this.enabled` and the `discoverGlobalTaskfile` setting before doing any I/O, to avoid overhead
  when the feature is off.
- **Multiple workspace folders:** If the user has multiple workspace folders, global tasks should
  not be duplicated. Since `getSystemTasks()` returns a flat list, deduplication is handled by the
  tree data provider. Items should use a consistent `id` prefix (e.g., `task:global:<name>`).

**Verdict:** Viable, moderate complexity. Main challenges are `--taskfile` flag propagation in
execution and safe watcher lifecycle management. The opt-in default eliminates surprise.

---

## Implementation

### Phase 1 — Configuration

#### `package.json`

```json
"workspaceTasks.taskfile.discoverGlobalTaskfile": {
  "type": "boolean",
  "default": false,
  "description": "%config.workspaceTasks.taskfile.discoverGlobalTaskfile%",
  "scope": "resource"
}
```

#### `package.nls.json`

```json
"config.workspaceTasks.taskfile.discoverGlobalTaskfile": "When enabled, the extension discovers tasks from the global Taskfile at your home directory ($HOME/Taskfile.yml). Disabled by default."
```

### Phase 2 — Provider Changes

#### `src/providers/taskTaskProvider.ts`

**New imports:**

```typescript
import * as os from 'os';
import * as fs from 'fs';
import { Configuration } from '../libs/configuration';
import { TaskCacheService } from '../services/taskCacheService';
```

**Add watcher helpers and replace `getSystemTasks()` implementation:**

```typescript
private globalTaskfileWatchers: vscode.FileSystemWatcher[] = [];
private globalWatcherDebounce?: NodeJS.Timeout;

private disposeGlobalTaskfileWatchers(): void {
  for (const watcher of this.globalTaskfileWatchers) {
    watcher.dispose();
  }
  this.globalTaskfileWatchers = [];
}

private reconcileGlobalTaskfileWatchers(homeDir: string, discoveredPath?: string): void {
  this.disposeGlobalTaskfileWatchers();
  const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
  const watchTargets = new Set(variants.map(v => path.join(homeDir, v)));
  if (discoveredPath) {
    watchTargets.add(discoveredPath);
  }

  for (const filePath of watchTargets) {
    const pattern = new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onEvent = () => {
      if (this.globalWatcherDebounce) {
        clearTimeout(this.globalWatcherDebounce);
      }
      this.globalWatcherDebounce = setTimeout(() => {
        TaskCacheService.getInstance().refresh();
      }, 150);
    };
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    watcher.onDidDelete(onEvent);
    this.globalTaskfileWatchers.push(watcher);
  }
}

public async getSystemTasks(): Promise<TaskItem[]> {
  if (!this.enabled) {
    return [];
  }

  const config = Configuration.getInstance();
  const discoverGlobal = config.get<boolean>('task.discoverGlobalTaskfile') ?? false;
  if (!discoverGlobal) {
    return [];
  }

  const homeDir = os.homedir();
  const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
  const globalTaskfilePath = variants
    .map(v => path.join(homeDir, v))
    .find(p => fs.existsSync(p));

  // Keep watcher coverage current even when no global file exists yet.
  this.reconcileGlobalTaskfileWatchers(homeDir, globalTaskfilePath);

  if (!globalTaskfilePath) {
    return [];
  }

  const iconService = TaskIconService.getInstance();
  const { command, args } = this.getCommand();
  const cmdArgs = [...(args ?? []), '--list-all', '--no-status', '--json'];

  try {
    const { stdout } = await execFileAsync(command, cmdArgs, { cwd: homeDir, timeout: 10000 });
    const items = this.parseOutput(stdout, homeDir, iconService);

    // Mark items as global so taskFactory can pass --taskfile
    for (const item of items) {
      item.metadata = {
        ...(item.metadata ?? {}),
        isGlobalTask: true,
        globalTaskfilePath,
      };
    }

    return items;
  } catch (err: unknown) {
    LoggerService.getInstance().warn(
      `[task] Failed to list global tasks in ${homeDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
```

**Watcher behavior notes:**

- Watchers are created/reconciled after each global scan.
- File events trigger a debounced refresh (`TaskCacheService.refresh()`), which causes a fresh
  scan in `$HOME`.
- Re-scan updates global items and watcher targets, enabling discovery of new variant files.

#### `src/taskFactory.ts`

In `case 'task':`, after building `taskArgs`, add:

```typescript
// Pass --taskfile for global tasks to ensure the correct file is invoked
if (item.metadata?.isGlobalTask && item.metadata?.globalTaskfilePath) {
  taskArgs.unshift('--taskfile', item.metadata.globalTaskfilePath);
}
```

### Phase 3 — Tests

#### `src/test/suite/taskTaskProvider.test.ts`

New `getSystemTasks` sub-suite:

| Test | Description |
| ---- | ----------- |
| `getSystemTasks returns [] when provider disabled` | `enabled = false` |
| `getSystemTasks returns [] when discoverGlobalTaskfile is false` | Config off |
| `getSystemTasks returns [] when no global Taskfile exists` | No file at any variant path |
| `getSystemTasks discovers tasks from global Taskfile` | Mock `fs.existsSync`, mock `execFileAsync` via provider override → returns items |
| `getSystemTasks marks items with isGlobalTask metadata` | `item.metadata.isGlobalTask === true` |
| `getSystemTasks metadata.globalTaskfilePath is set` | Correct absolute path |
| `getSystemTasks returns [] when CLI fails` | Error path → `[]` |
| `getSystemTasks checks variants in Task precedence order` | First existing variant wins |
| `getSystemTasks registers watcher(s) after first scan` | Watchers created for `$HOME` variant targets |
| `watcher events trigger refresh` | Debounced `TaskCacheService.refresh()` is invoked |
| `watchers are reconciled on re-scan` | Old watchers disposed, current set re-registered |

**Mocking strategy for `fs.existsSync`:** Use `sinon.stub(fs, 'existsSync')` in test setup.

#### `src/test/suite/taskFactoryTask.test.ts`

| Test | Description |
| ---- | ----------- |
| `global task: --taskfile flag prepended to args` | `args[0] === '--taskfile'`, `args[1] === globalPath` |
| `global task: cwd is Taskfile directory (home dir)` | `cwd === os.homedir()` |
| `non-global task: no --taskfile flag` | Normal task unaffected |

#### `src/test/task-files/task/global-output.json`

New fixture with 2 global tasks (no `location.taskfile`, `dir` = home dir variant).

### Phase 4 — Documentation

#### `docs/task-types/task.md`

Add a **Global Taskfile** section after the **Supported File Patterns** section:

> ### Global Taskfile
>
> Task supports a global `Taskfile.yml` at your home directory (`$HOME/Taskfile.yml`). To
> discover tasks from your global Taskfile in the tree view, enable the setting:
>
> ```json
> { "workspaceTasks.taskfile.discoverGlobalTaskfile": true }
> ```
>
> **Note:** Global Taskfile candidates in `$HOME` are watched. On change/create/delete, global
> task entries are refreshed automatically and `$HOME` is re-scanned.

#### `sample/sample-workspace-tasks/task/`

Add a comment in `Taskfile.yml` noting that a `$HOME/Taskfile.yml` would be discovered when
`workspaceTasks.taskfile.discoverGlobalTaskfile` is enabled.

---

## File Change Summary

| File | Change |
| ---- | ------ |
| `src/providers/taskTaskProvider.ts` | Replace `getSystemTasks()` with global discovery |
| `src/taskFactory.ts` | Add `--taskfile` flag for global tasks |
| `package.json` | Add `workspaceTasks.taskfile.discoverGlobalTaskfile` |
| `package.nls.json` | Add NLS string |
| `src/test/suite/taskTaskProvider.test.ts` | New `getSystemTasks` test cases |
| `src/test/suite/taskFactoryTask.test.ts` | New global-task factory test cases |
| `src/test/task-files/task/global-output.json` | New fixture |
| `docs/task-types/task.md` | Add Global Taskfile section |

---

## Open Questions / Future Work

- **Watcher debounce/backoff tuning:** Determine ideal debounce timing for remote and low-resource
  environments.
- **Multiple global Taskfile locations:** Task v3 supports `XDG_CONFIG_HOME` on Linux/macOS.
  Future work could scan this location as well.
