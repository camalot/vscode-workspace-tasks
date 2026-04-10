# Plan: Shell Task Loading Performance Improvement

## Overview

Shell tasks load significantly later than other task types because `ShellTaskProvider.getTasks()` performs sequential per-file disk I/O (shebang checks) inside a `for...of` + `await` loop. For workspaces with many `.py`, `.sh`, `.rb`, or `.pl` files, this results in tens or hundreds of sequential disk reads before any shell tasks appear in the tree.

This plan addresses the bottleneck through three complementary efforts:

1. **Parallelize** the shell task discovery internals (highest impact)
2. **Cache** shebang check results across refreshes to avoid redundant reads
3. **Surface loading state** in the tree view so users see per-provider progress rather than a delayed bulk appearance

---

## Baseline Findings

Baseline logging was captured after Phase 1 was shipped. Key observations:

### 1. The dominant bottleneck is `TaskFilesService.findFiles`, not shebang reads

All 10 shell types started concurrently (Phase 1 working) but every type waited ~14.5 seconds for the initial `findFiles` call to return. Shebang checks completed in milliseconds afterward. The 15.5 s total load time is almost entirely `TaskFilesService`'s initial workspace scan, not disk I/O per shebang file.

**Impact on plan:** Phase 2's cache cannot reduce the initial `findFiles` wait. It does help on subsequent refreshes. The primary user-facing benefit of Phase 2 is eliminating the cross-type duplicate shebang reads described below.

### 2. `bash` and `sh` both shebang-check the same 12 files — 12 reads are wasted every refresh

```
bash: 12 task(s) from 12 file(s) in 15050ms
sh:   0 task(s) from 12 file(s) in 15290ms
```

Both types match `*.sh`. Since they run concurrently, `sh`'s shebang checks race against (and duplicate) `bash`'s. `sh` then produces zero tasks because `bash` wins deduplication. Phase 2's mtime-keyed cache turns `sh`'s 12 reads into instant cache hits on every refresh after the first.

### 3. Stray `ruby` disabled log from outside `ShellTaskProvider`

```
[DEBUG] Provider ruby (type: ruby) is disabled. Skipping.
```

This message has no `[ShellTaskProvider]` prefix and fires while `ShellTaskProvider` simultaneously logs and processes `ruby` normally (meaning `shellEnabledTaskTypes.ruby = true`). The message originates from `TaskCacheService` or `BaseTaskProvider.enabled`, which appears to be checking a separate provider registration for a standalone `ruby` provider that doesn't exist in the current provider list. This inconsistency must be understood before Phase 3 because Phase 3's loading placeholders are keyed to provider type names — a ghost `ruby` type could cause a phantom placeholder.

**Action (pre-Phase 3):** Locate the source of the stray log and verify there is no orphaned `ruby` provider registration that would interfere with the `loadingProviders` set.

### 4. `other` log fires when no additional extensions are configured

```
[INFO] other: 0 task(s) in 0ms
```

This is emitted whenever `shellEnabledTaskTypes.other = true` even when `shellAdditionalExtensions` is empty. It adds noise to the output channel with no actionable information. **Action:** suppress this log line when `shellAdditionalExtensions` is empty.

---

## Root Cause Analysis

### How task loading works today

All providers are launched concurrently by `TaskCacheService.refresh()` via `Promise.all(providers.map(...))`. Each provider resolves independently, and the tree incrementally re-renders as each one completes. This means the slow provider holds up its own section of the tree, not others — but Shell tasks appearing very late still creates a poor user experience.

### Why Shell is uniquely slow

```
ShellTaskProvider.getTasks()
  └─ for each shell type (bash, zsh, fish, pwsh, batch, python, perl, ruby, sh, nushell)  ← sequential (pre-Phase 1)
       ├─ await filesService.findFiles(patterns)           ← coalesced scan; ~14.5 s on first call
       └─ for each matched file                            ← sequential (pre-Phase 1)
            └─ await this.checkForShebang(file)           ← opens file handle, reads 2 bytes, closes
```

`checkForShebang()` performs a real disk read per file. For shell types with `useShebang: true` (`bash`, `python`, `ruby`, `perl`, `sh`, `zsh`), **every matched file** gets this treatment. In a workspace with 50 Python files, that is 50 sequential disk reads before any shell tasks appear.

After Phase 1, shebang reads within and across types run concurrently, but the `TaskFilesService` initial workspace scan still serialises the first `findFiles` call across all requestors — this is the remaining dominant cost.

Compare this with `NpmTaskProvider` (reads one `package.json`, emits N tasks) or `VscodeTaskProvider` (reads one `tasks.json`).

---

## Phase 1 — Parallelize `ShellTaskProvider` Internals

### Step 1.1 — Parallelize shebang checks within each shell type

**File**: `src/providers/shellTaskProvider.ts`, method `getTasks()`

**Current pattern (sequential)**:
```typescript
for (const file of files) {
  const hasShebang = await this.checkForShebang(file);  // N sequential disk reads
  // ...
}
```

**Replace with**:
```typescript
const results = await Promise.allSettled(
  files.map(async (file) => ({ file, hasShebang: await this.checkForShebang(file) }))
);
```

Use `Promise.allSettled` (not `Promise.all`) so a single unreadable file (bad permissions, deleted mid-scan) does not abort the entire batch — failed entries are treated as "no shebang found".

### Step 1.2 — Parallelize across all shell types

Replace the outer `for (const [type, def] of Object.entries(BUILT_IN_SHELLS))` loop with a `Promise.allSettled(...)` call. Each shell type becomes an independent async task that calls `findFiles()` and runs its batch shebang checks concurrently with all other types.

### Step 1.3 — Post-merge cross-type deduplication

The current `processedFiles: Set<string>` deduplicates files that match multiple shell types (e.g., `*.sh` matches both `bash` and `sh`). With parallel processing this must happen after collecting all results:

- Each parallel type task returns `{ type, items: { file: Uri, hasShebang: boolean }[] }`
- After `Promise.allSettled`, iterate the settled results in **the same deterministic order** as `Object.entries(BUILT_IN_SHELLS)` (insertion order — identical to today's behavior)
- Apply `processedFiles` dedup during that traversal

This preserves the existing deduplication precedence (the first type that claims a file wins) while running all I/O in parallel.

---

## Phase 2 — Shebang Result Cache

### Step 2.1 — Add an mtime-keyed shebang cache to `ShellTaskProvider`

Add a private field:
```typescript
private shebangCache = new Map<string, { hasShebang: boolean; mtime: number }>();
```

In `checkForShebang(uri: vscode.Uri)`:
1. For `file://` URIs, `stat` the file to get `mtimeMs`
2. Look up `uri.fsPath` in `shebangCache`
3. If cached **and** `mtime` matches → return cached `hasShebang`
4. Otherwise read the 2 bytes, update cache entry, return result

Virtual filesystem URIs (non-`file://` schemes) skip the cache and use the existing fallback logic unchanged.

### Step 2.2 — Cache invalidation

No additional wiring is required. Because the cache key includes `mtime`, a modified file automatically misses the cache on next read. The existing file watcher (1000 ms debounce) triggers `TaskCacheService.refreshProvider('shell')` on changes, which calls `getTasks()` again — stale entries are evicted by the mtime mismatch.

Expose a `clearShebangCache()` method for testability:
```typescript
public clearShebangCache(): void {
  this.shebangCache.clear();
}
```

### Step 2.3 — Log cache hits and misses at debug level

The baseline revealed that `sh` runs 12 redundant shebang reads that all produce results already computed by `bash` in the same refresh. After the cache is in place, these become hits. Add per-file debug logging inside `checkForShebang` so the cache's effectiveness is observable:

```typescript
this.logger.debug(`[ShellTaskProvider] shebang cache hit: ${uri.fsPath}`);
this.logger.debug(`[ShellTaskProvider] shebang cache miss (read): ${uri.fsPath}`);
```

Also log the aggregate hit/miss ratio per type in the existing per-type info line:

```
[INFO] bash: 12 task(s) from 12 file(s) in 15050ms (12 shebang reads, 0 cache hits)
[INFO] sh:   0 task(s) from 12 file(s) in 2ms    (0 shebang reads, 12 cache hits)
```

### Step 2.4 — Suppress the empty `other` log

From the baseline: `[INFO] other: 0 task(s) in 0ms` fires whenever `shellEnabledTaskTypes.other = true` but `shellAdditionalExtensions` is empty. Suppress this line when there are no configured additional extensions:

```typescript
if (enabledTypes['other'] && Object.keys(additional).length > 0) {
  // ... process and log
}
```

---

## Phase 3 — Loading State & Tree Indicators

### Step 3.1 — Track per-provider loading state in `TaskCacheService`

**File**: `src/services/taskCacheService.ts`

Add:
```typescript
private loadingProviders: Set<string> = new Set();
private _onDidLoadingStateChange = new vscode.EventEmitter<void>();
public readonly onDidLoadingStateChange = this._onDidLoadingStateChange.event;

public isLoading(): boolean {
  return this.loadingProviders.size > 0;
}

public getLoadingProviders(): ReadonlySet<string> {
  return this.loadingProviders;
}
```

In both `refresh()` and `refreshProvider()`, bracket each provider's `getTasks()` with:
```typescript
this.loadingProviders.add(type);
this._onDidLoadingStateChange.fire();
try {
  // ... await provider.getTasks() ...
} finally {
  this.loadingProviders.delete(type);
  this._onDidLoadingStateChange.fire();
}
```

### Step 3.2 — Subscribe in `TaskTreeDataProvider`

**File**: `src/taskTreeDataProvider.ts`, constructor

```typescript
TaskCacheService.getInstance().onDidLoadingStateChange(() => {
  this._onDidChangeTreeData.fire();
});
```

### Step 3.3 — Inject loading placeholder items in the tree

**File**: `src/taskTreeDataProvider.ts`, `getChildren()`

When `getChildren(undefined)` is called (root level), inspect `TaskCacheService.getInstance().getLoadingProviders()`. For each loading provider type that has **no tasks yet** in the cache, inject a loading placeholder `TaskItem`:

```typescript
const loadingPlaceholder = new TaskItem(
  `Loading ${type} tasks…`,
  vscode.TreeItemCollapsibleState.None,
  type,
);
loadingPlaceholder.iconPath = new vscode.ThemeIcon('loading~spin');
loadingPlaceholder.contextValue = 'loadingPlaceholder';
```

Placeholders are placed **after** Favorites / Recent / Compound groups and **before** workspace-folder groups. They disappear automatically on the next `_onDidChangeTreeData` fire once `loadingProviders` no longer includes that type.

### Step 3.4 — Status bar progress during initial load

**File**: `src/services/taskCacheService.ts`, method `refresh()`

Wrap the `Promise.all(promises)` in `vscode.window.withProgress`:
```typescript
await vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Window,
    title: 'Loading workspace tasks…',
    cancellable: false,
  },
  async (progress) => {
    const promises = this.providers.map(async (provider) => {
      const type = (provider as any).type;
      progress.report({ message: type });
      // ... existing per-provider logic ...
    });
    await Promise.all(promises);
  }
);
```

This surfaces a status bar spinner and the current provider name during the initial load without blocking the UI.

---

## Phase 4 — Tests

All new tests must achieve 100% coverage of new/modified code paths. The full test suite must pass with `npm test`.

### Step 4.1 — `src/test/suite/shellTaskProvider.test.ts`

New tests to add:
- **Parallel shebang reads**: mock `checkForShebang` to be a spy, provide multiple `.py` files, verify the spy is called for all files and all results are included in task output regardless of resolution order
- **Cross-type deduplication under parallel execution**: provide a `.sh` file that matches both `bash` and `sh` types; verify exactly one task is produced and it belongs to the `bash` type (first in precedence order)
- **Shebang cache hit**: call `getTasks()` twice with the same files and same mtime; verify `fs.promises.open` is called only once per file (second call hits cache)
- **Shebang cache miss on `sh` after `bash` (cross-type cache sharing)**: mock `bash` and `sh` both finding the same `.sh` file; after first `getTasks()`, verify `sh`'s second call to `checkForShebang` hits the cache (stat is called but `open` is not called again)
- **Shebang cache invalidation**: call `getTasks()` twice with the mtime changed between calls; verify `fs.promises.open` is called twice
- **`clearShebangCache()` method**: verify method exists and resets cached state
- **`other` log suppression**: verify no `other`-related info log is produced when `shellEnabledTaskTypes.other = true` but `shellAdditionalExtensions` is empty

### Step 4.2 — `src/test/suite/taskCacheService.test.ts`

New tests to add:
- **`isLoading()` during refresh**: mock a slow provider, assert `isLoading()` returns `true` while in-flight and `false` after `refresh()` resolves
- **`getLoadingProviders()` during refresh**: assert the active provider type appears in the set during its execution window
- **`onDidLoadingStateChange` fires on start**: spy on the event, verify it fires with the provider type added when `getTasks()` begins
- **`onDidLoadingStateChange` fires on completion**: verify it fires again when the provider type is removed after `getTasks()` resolves
- **All providers cleared after `refresh()`**: verify `getLoadingProviders()` is empty after `Promise.all` settles

### Step 4.3 — `src/test/suite/taskTreeDataProvider.test.ts`

New tests to add:
- **Loading placeholder appears**: mock `TaskCacheService.getLoadingProviders()` to return `new Set(['shell'])` and mock no cached shell tasks; assert root children contain a `loading~spin` item labelled `'Loading shell tasks…'`
- **Loading placeholder disappears**: after clearing loading state and firing the tree change event, assert no placeholder appears in root children
- **Placeholder has correct `contextValue`**: assert `contextValue === 'loadingPlaceholder'`

---

## Relevant Files

| File | Change |
|---|---|
| `src/providers/shellTaskProvider.ts` | Parallelize `getTasks()`, add shebang cache, cache hit/miss logging, suppress empty `other` log (Phases 1–2) |
| `src/services/taskCacheService.ts` | Loading state tracking + status bar progress (Phase 3, Steps 3.1, 3.4) |
| `src/taskTreeDataProvider.ts` | Subscribe to loading events + inject placeholders (Phase 3, Steps 3.2–3.3) |
| `src/test/suite/shellTaskProvider.test.ts` | Tests for parallel execution, deduplication, shebang cache, cross-type cache sharing, `other` suppression |
| `src/test/suite/taskCacheService.test.ts` | Tests for loading state lifecycle |
| `src/test/suite/taskTreeDataProvider.test.ts` | Tests for loading placeholder items |

---

## Verification

1. **Manual** — Open a workspace with 50+ `.py` / `.sh` files. Shell tasks should appear alongside other task types (no longer significantly delayed). A `loading~spin` spinner should be briefly visible in the tree while providers resolve, and a status bar message should appear during initial load.
2. **Automated** — `npm test` passes with all new tests included.
3. **Coverage** — `npm run vscode:test:coverage` shows ≥90% coverage on modified source files; newly written code targets 100%.

---

## Decisions & Scope

- **Included**: parallelization in `ShellTaskProvider`, mtime-based shebang result cache, per-provider loading state in `TaskCacheService`, loading placeholder `TaskItem`s in the tree, status bar progress during initial load
- **Excluded**: refactoring other providers (none exhibit the sequential per-file I/O pattern); changes to `TaskFilesService` file path cache (already coalesced and efficient); changes to provider registration order or priority

---

## Further Considerations

1. **`Promise.allSettled` vs `Promise.all`** — use `allSettled` for shebang batch checks so a single unreadable file does not abort the entire type; failed entries default to `hasShebang: false`
2. **Concurrency limit** — in extreme workspaces (1000+ script files) unconstrained `Promise.all` over file opens could exhaust OS file descriptors; add a simple semaphore (e.g., max 50 concurrent open calls) only if benchmarks demonstrate real fd exhaustion under normal usage
3. **Placeholder placement** — root-level placement (after Favorites/Recent/Compound, before workspace-folder groups) is preferred over nesting placeholders inside workspace-folder groups to avoid complications with the folder grouping logic in `organizeTasks()`
4. **Cross-type shebang cache sharing** — `bash` and `sh` both match `*.sh`; because they run concurrently in Phase 1, the first type to complete a shebang read for a given file populates the cache; the second type then gets a free hit. The cache is per-`ShellTaskProvider` instance (not per-type), so this sharing is automatic with no extra wiring.
5. **Ghost `ruby` provider** — before Phase 3, confirm whether a standalone `ruby` provider exists in the provider registry. If it does, its `type` string (`ruby`) would collide with `shellEnabledTaskTypes.ruby` during placeholder injection. If it does not, trace and remove the stray `Provider ruby (type: ruby) is disabled` log message to avoid confusion in future baseline captures.
6. **`findFiles` as the remaining dominant cost** — the baseline confirms that ~14.5 s of the 15.5 s total is the `TaskFilesService` initial workspace scan. Phases 2 and 3 do not reduce this. If further load-time improvements are needed after Phase 3, the next target should be `TaskFilesService` scan parallelism or incremental indexing — outside this plan's scope.
