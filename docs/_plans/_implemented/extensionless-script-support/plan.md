# Plan: Extensionless Shell Script Discovery

## TL;DR

Add support for discovering shell scripts that have no file extension but contain a shebang line
(`#!`). These files are surfaced under the existing **shell** task type. Because discovery requires
scanning the entire workspace and reading the first two bytes of every extensionless file, the
feature has significant I/O overhead and is **disabled by default** behind a dedicated opt-in
setting.

---

## Requirements

- Scan for files that have **no extension** within each open workspace folder.
- A file is only accepted as a shell script task if its first two bytes are `#!`
  (the shebang magic bytes). Files without a shebang are silently skipped.
- Accepted files appear in the treeview under the **shell** task type (same parent group as
  `bash`, `sh`, `zsh`, etc.).
- The interpreter used to execute the file is derived from the shebang interpreter path (the
  remainder of the first line after `#!`), mirroring how existing shell types with
  `useShebang: true` work. The shebang line is parsed at run-time by `TaskFactory` to build the
  terminal command.
- Discovery runs **asynchronously and independently** from the rest of shell-type discovery so
  that the potentially long-running scan does not block or delay the existing typed-extension
  results. The treeview refreshes a second time when extensionless results become available.
- A new boolean setting `workspaceTasks.shellScripts.extensionless.enabled` (default `false`)
  gates the entire feature. It integrates into `shellEnabledTaskTypes` as a new `extensionless`
  key so that the existing enable/disable UI in Settings works consistently.
- Exclusion globs that already apply to shell discovery (`GLOB_SHELL_EXCLUDE`, common dirnames
  like `node_modules`, `.git`) also apply here.
- The shebang cache (`ShellTaskProvider.shebangCache`) is reused for extensionless files so
  repeated refreshes are fast.

---

## Key Design Decisions

### Why a separate `enabled` setting?

The standard `workspaceTasks.shellEnabledTaskTypes` object already gates built-in shell types.
Rather than add a standalone boolean that bypasses this pattern, the extensionless type is added
as a new key `extensionless` inside `shellEnabledTaskTypes` (default: `false`). This keeps the
Settings UI consistent and allows users to disable it the same way they disable `python` or
`ruby` scripts.

A dedicated constant `EXTENSIONLESS_SHELL_TYPE = 'extensionless'` is defined and referenced
everywhere to avoid magic strings.

### File scan strategy

VS Code's `vscode.workspace.findFiles` API only supports glob patterns. There is no first-class
glob that matches "files with no extension". The closest reliable patterns are:

- For single-name files in the workspace root: a top-level scan with `'*'`.
- For nested files: `'**/*'` filtered post-scan.

Because `'**/*'` will return every file in the workspace, the result set must be filtered to keep
only files whose **basename contains no dot**, i.e. `path.extname(file.fsPath) === ''`. This is
done in memory after `findFiles` returns.

Additionally, a directory-name allowlist within the filter quickly rejects obvious non-script
directories (`node_modules`, `.git`, `.venv`, `dist`, `out`, `build`, `coverage`, `.vscode`,
`.vscode-test`) before the shebang read, keeping actual I/O minimal.

### Async-independent stream

The existing `getTasks()` in `ShellTaskProvider` already uses `Promise.allSettled` to fan-out
all built-in shell types concurrently. Extensionless discovery is **not** included in that
`Promise.allSettled` fan-out. Instead:

1. `getTasks()` kicks off extensionless discovery as a background `Promise` (fire-and-forget
   from `getTasks()`'s perspective).
2. When the background promise resolves, `ShellTaskProvider` emits an `onDidChangeTasks` event
   (a new `EventEmitter<void>` inside the provider, following the same pattern used by
   `WorkspaceTasksProvider`) that triggers a selective treeview refresh of the `shell` group.
3. A small result buffer (`extensionlessResults: TaskItem[]`) is stored on the provider
   instance. Subsequent `getTasks()` calls (e.g. forced refresh by the user) return the buffered
   results synchronously from that field until the next background scan completes.

This design ensures:
- The treeview populates instantly with typed-extension shell scripts.
- Extensionless scripts trickle in without a noticeable delay to other types.
- No `Promise` is left dangling without error handling — the background promise has a top-level
  `.catch` that logs and stores an empty result.

### Interpreter resolution

When a shebang is found the full first line is read (up to 255 bytes) to extract the interpreter
path. Examples:

| Shebang | Effective command |
|---|---|
| `#!/bin/bash` | `/bin/bash ./script` |
| `#!/usr/bin/env python3` | `python3 ./script` (env-stripped) |
| `#!/usr/bin/env -S node --experimental-vm-modules` | `node --experimental-vm-modules ./script` |

The `/usr/bin/env` prefix is stripped when building the terminal command so the terminal inherits
`PATH`. The interpreter string is stored in `TaskItem.metadata.interpreter` exactly like existing
shell types, so `TaskFactory` can build the command without knowing the file has no extension.

`metadata.subType` is set to `'extensionless'`, which is used for icon lookups. Because no
dedicated `extensionless.svg` exists, `TaskIconService.mapLookup` falls through to `ThemeIcon.File`
which gives a file icon — appropriate for an unknown-type script.

### `checkForShebangAndReadInterpreter` helper

A new sibling to the existing `checkForShebang` is added:

```typescript
private async checkForShebangAndReadInterpreter(
  uri: vscode.Uri,
): Promise<{ hasShebang: boolean; interpreter: string; fromCache: boolean }>
```

It reads the first 255 bytes (enough for any realistic shebang line) rather than the existing 2
bytes, so the interpreter can be parsed in the same read. Cache entries for extensionless files
add an `interpreter` field alongside `hasShebang` and `mtime`:

```typescript
private shebangCache = new Map<string, { hasShebang: boolean; interpreter: string; mtime: number }>();
```

The existing `checkForShebang` is updated to call the new helper and discard `interpreter`,
keeping backward compatibility.

### `getFilePatterns()` and `TaskFilesService`

`getFilePatterns()` currently returns glob patterns that `TaskFilesService` uses to pre-warm its
cache. Because `'**/*'` is too broad to register, the extensionless branch does **not** add a
pattern to `getFilePatterns()`. The `findFiles` call for extensionless files therefore goes
directly to `vscode.workspace.findFiles` without a cache warm-up. This is acceptable because the
scan is infrequent (only runs when the feature is enabled).

### Task sub-type name shown in the treeview

Extensionless tasks are placed in a sub-group named **Extensionless** within the shell type
group. The sub-type label is `extensionless`, which maps to `"Extensionless Shell Scripts"` in
`TASK_TYPE_LABEL_MAP` (or equivalent labelling used for the treeview group item).

---

## New Setting

### `workspaceTasks.shellEnabledTaskTypes.extensionless`

| Property | Value |
|---|---|
| **Key path in `shellEnabledTaskTypes`** | `extensionless` |
| **Type** | `boolean` |
| **Default** | `false` |
| **Scope** | `resource` |

When `true`, the extension scans the workspace for files with no extension and reads each file's
first line to detect a shebang (`#!`). Files containing a shebang are added to the **shell**
task type under an **Extensionless** sub-group. The interpreter is determined from the shebang
line.

Set to `false` (the default) to skip extensionless file scanning entirely.

---

## Implementation Phases

### Phase 1 — Settings (`package.json` / `package.nls.json`)

**Files to change:**

- `package.json`
  - Add `extensionless` key with `"type": "boolean"` and `"default": false` to the
    `workspaceTasks.shellEnabledTaskTypes` object properties.
  - Add the same key to the default value object of `workspaceTasks.shellEnabledTaskTypes`.

- `package.nls.json`
  - Add `config.workspaceTasks.shellEnabledTaskTypes.extensionless` string:
    `"Extensionless Shell Scripts (shebang required, disabled by default due to discovery overhead)"`

**Details:**

- Place the `extensionless` entry at the end of the properties list, after `other`, to match
  the existing ordering pattern (alphabetical built-ins first, then special cases at the end).
- Default value in the `default` object must be `false`.

---

### Phase 2 — `ShellTaskProvider` — shebang cache extension

**File to change:** `src/providers/shellTaskProvider.ts`

1. Extend the shebang cache entry type to include `interpreter`:
   ```typescript
   private shebangCache = new Map<string, { hasShebang: boolean; interpreter: string; mtime: number }>();
   ```

2. Add `checkForShebangAndReadInterpreter(uri)` private method:
   - Reads up to 255 bytes using the same mtime-cache / in-flight-coalescing pattern as
     `checkForShebang`.
   - Parses the shebang line: splits on whitespace, strips `/usr/bin/env` and any `env` flags
     (`-S`, `--`), takes the first remaining token as the interpreter bare name.
   - Stores `{ hasShebang, interpreter, mtime }` in `shebangCache`.
   - Returns `{ hasShebang, interpreter, fromCache }`.

3. Refactor `checkForShebang` to call `checkForShebangAndReadInterpreter` internally and discard
   `interpreter`, keeping the existing return signature unchanged.

4. Add a new `EventEmitter` field and expose its event:
   ```typescript
   private readonly _onDidChangeExtensionlessTasks = new vscode.EventEmitter<void>();
   public readonly onDidChangeExtensionlessTasks = this._onDidChangeExtensionlessTasks.event;
   ```

5. Add `private extensionlessResults: TaskItem[] = []` to hold the last completed scan.

6. Add constant at the top of the file:
   ```typescript
   const EXTENSIONLESS_SHELL_TYPE = 'extensionless';
   ```

7. Add the `EXTENSIONLESS_GLOB_EXCLUDE` constant in `src/libs/constants.ts`:
   ```typescript
   GLOB_EXTENSIONLESS_EXCLUDE: [
     '**/node_modules/**', '**/.git/**', '**/.venv/**',
     '**/dist/**', '**/out/**', '**/build/**',
     '**/coverage/**', '**/.vscode/**', '**/.vscode-test/**',
   ]
   ```

---

### Phase 3 — `ShellTaskProvider` — extensionless discovery method

**File to change:** `src/providers/shellTaskProvider.ts`

Add `private async _processExtensionlessScripts(): Promise<TaskItem[]>` method:

1. Read `enabledTypes` config; if `extensionless` is falsy, return `[]` immediately.
2. Also check `TaskConfigService.getInstance().isTaskTypeEnabled('shell')` — if shell itself is
   disabled, skip.
3. Call `vscode.workspace.findFiles('**/*', <combined-exclude-glob>)` — the exclude glob
   combines `GLOB_GLOBAL_EXCLUDE` with `GLOB_EXTENSIONLESS_EXCLUDE`.
4. Filter the returned URIs: keep only URIs where `path.extname(uri.fsPath) === ''` and where
   the path does not contain a known skip-directory segment.
5. For each candidate URI, call `this.checkForShebangAndReadInterpreter(uri)` in a
   `Promise.allSettled` fan-out (same parallelization pattern as `_processShellType`).
6. For each result where `hasShebang === true`, call `createShellTaskItem(file, interpreter,
   EXTENSIONLESS_SHELL_TYPE, true)`.
7. Return the collected `TaskItem[]`.

---

### Phase 4 — `ShellTaskProvider.getTasks()` — async integration

**File to change:** `src/providers/shellTaskProvider.ts`

1. After resolving built-in types (existing `Promise.allSettled` block), append the buffered
   `this.extensionlessResults` to `tasks` (if any).

2. Start the background extensionless scan:
   ```typescript
   const extensionlessScanPromise = this._processExtensionlessScripts()
     .then((items) => {
       this.extensionlessResults = items;
       this._onDidChangeExtensionlessTasks.fire();
     })
     .catch((err) => {
       this.logger.warn(`[ShellTaskProvider] extensionless scan failed: ${err}`);
       this.extensionlessResults = [];
     });
   ```

3. Do **not** `await` this promise within `getTasks()`.

---

### Phase 5 — `providers/index.ts` — subscribe to extensionless refresh event

**File to change:** `src/providers/index.ts`

When `ShellTaskProvider` is instantiated and registered, subscribe to
`providerInstance.onDidChangeExtensionlessTasks`:

```typescript
if (providerInstance instanceof ShellTaskProvider) {
  context.subscriptions.push(
    providerInstance.onDidChangeExtensionlessTasks(() => {
      taskTreeDataProvider.refresh('shell');
    }),
  );
}
```

`taskTreeDataProvider.refresh` already accepts an optional type string for selective refresh.
If no selective refresh exists, a full `_onDidChangeTreeData.fire(undefined)` is acceptable as a
fallback.

---

### Phase 6 — `TaskFactory` — ensure extensionless scripts execute correctly

**File to change:** `src/taskFactory.ts`

Review how `TaskFactory` uses `metadata.interpreter` and `metadata.useShebang` to build the
terminal command. Confirm that:

- When `useShebang === true` and `interpreter` is non-empty, the command is built as
  `<interpreter> <relativeFilePath>`.
- When `interpreter === ''` and `useShebang === true`, the command is `<relativeFilePath>`
  (direct execution, relying on the OS kernel to read the shebang).

If the current code already handles this correctly (likely — it mirrors the existing `bash` /
`python` useShebang paths), no change is needed. Document the finding in this phase.

---

### Phase 7 — Tests

#### `src/test/suite/shellTaskProvider.test.ts`

Add a new `suite('Extensionless shell script discovery', ...)` block. Required test cases:

| Test | Description |
|---|---|
| `extensionless disabled (default): _processExtensionlessScripts returns []` | Set `shellEnabledTaskTypes.extensionless = false`; assert return is empty. |
| `extensionless enabled: files without shebang are skipped` | Mock `findFiles` to return extensionless URIs; mock `checkForShebangAndReadInterpreter` to return `hasShebang: false`; assert no tasks emitted. |
| `extensionless enabled: file with shebang produces TaskItem with correct interpreter` | Return one extensionless URI from `findFiles` mock; mock shebang reader to return `hasShebang: true, interpreter: 'node'`; assert resulting `TaskItem.metadata.interpreter === 'node'` and `subType === 'extensionless'` and `useShebang === true`. |
| `extensionless enabled: /usr/bin/env prefix is stripped from interpreter` | Shebang `#!/usr/bin/env python3`; assert `interpreter === 'python3'`. |
| `extensionless enabled: /usr/bin/env -S flags are stripped` | Shebang `#!/usr/bin/env -S node --experimental-vm-modules`; assert `interpreter === 'node'`. |
| `extensionless enabled: files with known extensions are excluded by post-scan filter` | `findFiles` returns a mix of `.sh` files and extensionless files; assert only extensionless files reach shebang check. |
| `getTasks returns buffered extensionless results on second call` | First call starts background scan; simulate completion by resolving the internal promise; assert second call returns the previously buffered items. |
| `onDidChangeExtensionlessTasks fires after scan completes` | Spy on `_onDidChangeExtensionlessTasks.fire`; await the background-scan completion; assert it was called once. |

#### `src/test/suite/shellTaskProvider.test.ts` — shebang cache

| Test | Description |
|---|---|
| `checkForShebangAndReadInterpreter: cache hit returns cached interpreter` | Write result to `shebangCache` manually; assert second call doesn't re-read disk and returns cached `interpreter`. |
| `checkForShebangAndReadInterpreter: mtime change invalidates cache` | Mutate `mtime` in the cache entry; assert the file is re-read. |

---

### Phase 8 — Documentation

**Files to change:**

- `docs/configuration/task-discovery/discovery.md`
  - Add `extensionless` to the `shellEnabledTaskTypes` property table and supported-types list.
  - Add a subsection explaining the performance implications and the opt-in requirement.

- `docs/features/task-environment-variables.md` — no change needed.

- `docs/task-types/` — if a per-type shell-script page exists, update it to mention extensionless
  discovery.

- `README.md` — optionally update the shell task discovery description to mention extensionless
  support (one sentence).

---

## Rubber Duck Review Checklist

Before implementation validate:

1. **`findFiles('**/*')` scope**: Does VS Code honour workspace-folder scoping when
   `workspaceFolders` has multiple roots? Confirm the call returns only files within open
   workspace folders — or add explicit per-folder iteration to avoid scanning unrelated paths.

2. **Hidden-file filtering**: Files like `.env`, `.gitignore` have a leading dot but no
   extension (`path.extname('.env') === ''`). These must be excluded. The filter condition
   should be:
   ```typescript
   path.extname(uri.fsPath) === '' && !path.basename(uri.fsPath).startsWith('.')
   ```

3. **Symlinks and special files**: `findFiles` may return symlinks or FIFOs. The
   `checkForShebangAndReadInterpreter` method should short-circuit on `stat.isFile() === false`
   before attempting any read.

4. **Result ordering**: The existing typed-extension results are deterministic (sorted by
   `BUILT_IN_SHELLS` order). Extensionless results appear after a background scan — ordering
   within that batch is not guaranteed unless explicitly sorted. Sort by `file.fsPath` for
   deterministic display.

5. **Clearing the buffer on workspace change**: `extensionlessResults` must be cleared (set to
   `[]`) when `TaskFilesService.invalidateCache()` is called or when a workspace folder is
   added/removed, so stale results from a previous workspace do not persist.

6. **`processedFiles` deduplication**: Extensionless results are added to the `processedFiles`
   set in `getTasks()` so that a later file-system change that temporarily gives a file both a
   path match and an extensionless match (unlikely but possible during rename) does not produce
   duplicates.

7. **Max shebang read size**: 255 bytes is sufficient for realistic shebang lines but should be
   documented as a constant (`MAX_SHEBANG_READ_BYTES = 255`) for future maintainability.

8. **Background promise leak on dispose**: If `ShellTaskProvider` is disposed while an
   extensionless scan is in flight, the `_onDidChangeExtensionlessTasks.fire()` call after
   disposal may attempt to notify a torn-down treeview. Add a guard (`this._disposed` flag) in
   the `.then()` callback.

---

## Files Modified Summary

| File | Change |
|---|---|
| `package.json` | Add `extensionless: false` to `shellEnabledTaskTypes` default and property definition |
| `package.nls.json` | Add NLS string for `shellEnabledTaskTypes.extensionless` |
| `src/libs/constants.ts` | Add `GLOB_EXTENSIONLESS_EXCLUDE` constant and `MAX_SHEBANG_READ_BYTES` |
| `src/providers/shellTaskProvider.ts` | Extend shebang cache type; add `checkForShebangAndReadInterpreter`; add `extensionlessResults` buffer; add `_onDidChangeExtensionlessTasks` emitter; add `_processExtensionlessScripts`; update `getTasks()` |
| `src/providers/index.ts` | Subscribe to `onDidChangeExtensionlessTasks`; call selective treeview refresh |
| `src/taskFactory.ts` | Review / confirm extensionless execution path (likely no change) |
| `src/test/suite/shellTaskProvider.test.ts` | 10 new tests across two suites |
| `docs/configuration/task-discovery/discovery.md` | Document `extensionless` key in `shellEnabledTaskTypes` |
