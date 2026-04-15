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

```text
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

## Phase 2 Findings

Phase 2 results were captured after a manual refresh triggered by the user because **shell tasks did not appear on first launch**. Two separate runs are in the log — the first-launch run (17:39) and the manual-refresh run (17:40).

### 1. First-launch returns 0 files for all shell types — critical regression

```
# First launch (17:39:24 – 17:39:34, ~10 s)
Found 0 candidate file(s) for shell type: bash
Found 0 candidate file(s) for shell type: python
... (all 10 types return 0 files)
Completed — 0 total shell task(s) loaded in 10335ms
```

All 10 shell types completed in ~10,334 ms and found **zero files**, even though the workspace contains `.sh`, `.py`, `.ps1`, and other script files that appeared correctly on the subsequent manual refresh. The user had to manually trigger a refresh before shell tasks appeared.

**Root cause (hypothesis):** `TaskCacheService.refresh()` runs at extension startup before `TaskFilesService` has finished building its initial workspace file index. `findFiles` returns an empty (or uninitialized-cache) result and all providers store empty task lists. Because no file-change events fire after the initial scan completes, there is nothing to trigger a second refresh — the empty result persists until the user forces one.

The ~10 s vs ~15 s timing difference (10 s vs the normal 15 s scan) suggests `TaskFilesService` may be returning early from an unbuilt cache rather than waiting for the scan — either by returning an empty iterable immediately, or by hitting a timeout/early-resolution path.

**Action (pre-Phase 3 blocker):** Investigate `TaskFilesService` initialization vs `TaskCacheService.refresh()` startup ordering. The fix is most likely one of:
- Have `TaskFilesService` emit a `onDidInitialScanComplete` event, and have `TaskCacheService` subscribe to re-run `refresh()` once after the initial scan finishes.
- Ensure `TaskFilesService.initialize()` completes (or begins its scan) before `TaskCacheService.refresh()` is called in the extension activation sequence.

This is a **blocking pre-condition for Phase 3**: loading placeholders are only useful if tasks eventually appear — if the first refresh silently returns empty, the placeholders will spin forever and then vanish without tasks materializing.

### 2. Shebang cache and in-flight deduplication work correctly

On the manual-refresh run, the expected cache behaviour was observed:

```
# sh won the concurrent race and read all 12 .sh files:
sh:   0 task(s) from 12 file(s) in 15184ms (12 shebang reads, 0 cache hits)

# bash got 12 free cache hits from sh's reads (in-flight deduplication worked):
bash: 12 task(s) from 12 file(s) in 15186ms (0 shebang reads, 12 cache hits)
```

Total `.sh` file opens dropped from **24** (12 bash + 12 sh in the baseline) to **12** — a 50% reduction for that file type. The winning type varies by OS scheduler timing (sh won this run; bash would win in others), but the outcome is correct either way: only one `open()` call per file per refresh.

### 3. `other` log suppression confirmed working

The `[INFO] other: 0 task(s) in 0ms` noise line present in the baseline is absent from the Phase 2 output. ✓

### 4. Total wall-clock time unchanged (by design)

```
Baseline:  15,483 ms
Phase 2:   15,270 ms  (manual-refresh run)
```

The ~200 ms difference is noise. As documented in the plan, Phase 2's cache benefit applies to **subsequent refreshes**, not the initial scan. The ~15 s is still dominated by `TaskFilesService.findFiles`. This is expected.

### 5. Stray `ruby` log still present

```
[DEBUG] Provider ruby (type: ruby) is disabled. Skipping.
```

This log appears in both the baseline and Phase 2 output without a `[ShellTaskProvider]` prefix. The ghost `ruby` provider registration has not yet been traced. This remains a **pre-Phase 3 blocker** (see Baseline Finding #3 and Further Consideration #5).

---

## Phase 3 Findings

Phase 3 results were captured on the first launch after Phase 3 was shipped (19:10 run). No manual refresh was required.

### 1. First-launch race confirmed fixed ✓

```
# Phase 3 first launch (19:10:12 – 19:10:28)
[ShellTaskProvider] Found 12 candidate file(s) for shell type: bash
[ShellTaskProvider] Found 12 candidate file(s) for shell type: sh
[ShellTaskProvider] Found 4 candidate file(s) for shell type: python
...
Completed — 27 total shell task(s) loaded in 15419ms
```

All 10 shell types found their expected files on the very first launch — no manual refresh required. The `onDidInitialScanComplete` event + conditional `invalidateCache()` approach in `TaskCacheService.initialize()` successfully eliminated the Phase 2 startup race. The fix triggers one catch-up refresh only when `getCachedPathCount() === 0` and registered patterns exist, preventing infinite re-invalidation cycles.

### 2. Ghost `ruby` log absent ✓

The stray `[DEBUG] Provider ruby (type: ruby) is disabled. Skipping.` message present in both the baseline and Phase 2 logs does not appear anywhere in the Phase 3 output. The source was traced to `WorkspaceTasksProvider.getTasks()` (line 46) which checks `isTaskTypeEnabled()` for each entry in the `.workspace-tasks.json` config file — if that file references `ruby` as a task type and the `ruby` type is disabled in extension settings, the debug log fires. Its absence in Phase 3 confirms there is no orphaned `ruby` provider registration in `TaskCacheService`; the log was workspace-config-specific and does not affect `loadingProviders`. **No code change needed.** Loading placeholders are safe.

### 3. Cache working correctly (bash won the race this time) ✓

```
bash: 12 task(s) from 12 file(s) in 14961ms (12 shebang reads, 0 cache hits)
sh:   0 task(s) from 12 file(s) in 15232ms  (0 shebang reads, 12 cache hits)
```

In Phase 2, `sh` won the race and did 12 reads; `bash` got 12 hits. In Phase 3, `bash` finished 271ms ahead of `sh` and did 12 reads; `sh` got 12 hits. The winner varies by OS scheduler, but the outcome is always correct: only 12 `open()` calls for the 12 `.sh` files, down from 24 at baseline. Total `.sh` file reads halved. ✓

### 4. `other` log still suppressed ✓

The Phase 3 output contains no `[INFO] other: 0 task(s) in 0ms` line. Suppression from Phase 2 is intact.

### 5. Total wall-clock time stable

```
Baseline:  15,483 ms
Phase 2:   15,270 ms  (manual-refresh run)
Phase 3:   15,419 ms  (first launch — no race)
```

All three runs are within ~200 ms of each other, consistent with noise. The dominant cost (~14.5 s) remains `TaskFilesService.findFiles`. Phase 3's changes (loading state events, `withProgress`, `onDidInitialScanComplete` subscription) add no measurable overhead.

### 6. Extension activation gap: 4 seconds before first discovery

```
19:10:08.815Z  extension activating
19:10:12.938Z  Starting shell task discovery
```

There is a consistent ~4-second gap between extension activation log and the start of shell task discovery. This reflects the sequential initialization chain in `extension.ts` (`TaskFilesService.initialize()` → service setup → provider registration → `taskTreeDataProvider.refresh()`). This is not a regression — it matches expected startup overhead on first load. However, it means loading placeholders will be visible in the tree for the full ~15s discovery window on cold starts, which is the intended UX.

### 7. Loading state event design note

The implementation fires `_onDidLoadingStateChange` only on idle→loading (first provider starts) and loading→idle (last provider finishes) transitions, rather than per-provider as the plan specified. This was a necessary optimization: firing once per provider (30+ events per `refresh()` cycle) caused the extension host to become unresponsive during tests due to the cascade of `organizeTasks()` calls each event triggered. The transition-only design delivers the same observable behaviour — placeholders appear when loading starts, disappear when it ends — with two tree refreshes instead of N×2.

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

### Pre-conditions (must be resolved before Phase 3 work begins)

Two issues discovered in Phase 2 results must be addressed first:

**A. First-launch empty results (critical)**

Investigate the `TaskFilesService` initialization race. Before implementing loading placeholders, the underlying task discovery must work correctly on first launch. The recommended fix is to have `TaskFilesService` emit a `onDidInitialScanComplete` (or equivalent) event after its initial workspace file index is built, and have `TaskCacheService` subscribe to automatically trigger a single follow-up `refresh()` when that event fires if the initial refresh produced empty results. Alternatively, delay `TaskCacheService.refresh()` until `TaskFilesService.initialize()` signals readiness.

**Files to investigate:** `src/services/taskFilesService.ts`, `src/services/taskCacheService.ts`, `src/extension.ts` (activation sequence).

**B. Ghost `ruby` provider log (must understand before placeholder injection)**

Trace the source of `[DEBUG] Provider ruby (type: ruby) is disabled. Skipping.` — this log fires without a `[ShellTaskProvider]` prefix during every refresh. If an orphaned `ruby` provider is registered in `TaskCacheService`'s provider list, Phase 3's `loadingProviders` set will include a `ruby` entry that races with the `shell` provider's internal `ruby` sub-type, producing a phantom loading placeholder. Confirm whether an orphaned registration exists and, if so, remove it; if not, suppress or redirect the log.

**Files to investigate:** `src/services/taskCacheService.ts` (provider registration), `src/extension.ts` (provider setup), `src/taskProvider.ts` (`enabled` getter).

---

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

### Step 4.1 — `src/test/suite/shellTaskProvider.test.ts` *(pending)*

Tests for Phase 1 and Phase 2 code paths. These have **not yet been written** and represent the primary remaining work for Phase 4.

New tests to add:
- **Parallel shebang reads**: mock `checkForShebang` to be a spy, provide multiple `.py` files, verify the spy is called for all files and all results are included in task output regardless of resolution order
- **Cross-type deduplication under parallel execution**: provide a `.sh` file that matches both `bash` and `sh` types; verify exactly one task is produced and it belongs to the `bash` type (first in precedence order)
- **Shebang cache hit**: call `getTasks()` twice with the same files and same mtime; verify `fs.promises.open` is called only once per file (second call hits cache)
- **Cross-type cache sharing (`sh` hits `bash`'s reads)**: mock `bash` and `sh` both finding the same `.sh` file; after first `getTasks()`, verify `sh`'s call to `checkForShebang` hits the cache (stat is called but `open` is not called again)
- **Shebang cache invalidation on mtime change**: call `getTasks()` twice with the mtime changed between calls; verify `fs.promises.open` is called twice
- **`clearShebangCache()` method**: verify method exists and resets cached state (second `getTasks()` call after `clearShebangCache()` reads all files again)
- **`other` log suppression**: verify no `other`-related info log is produced when `shellEnabledTaskTypes.other = true` but `shellAdditionalExtensions` is empty

### Step 4.2 — `src/test/suite/taskCacheService.test.ts` *(done in Phase 3)*

Added 10 tests covering loading state lifecycle:
- `isLoading()` returns false when no providers are refreshing
- `isLoading()` returns true while a `refreshProvider` call is in-flight
- `getLoadingProviders()` contains the active provider type during `refreshProvider`
- `onDidLoadingStateChange` fires only on idle→loading and loading→idle transitions (not per-provider)
- `getLoadingProviders()` is empty after `refresh()` completes
- `isLoading()` returns false after `refresh()` with multiple providers
- `hasTasksForProviderType()` returns false before tasks are committed
- `hasTasksForProviderType()` returns true after tasks are committed
- `hasTasksForProviderType()` returns false for empty provider result
- `isLoading()` returns true while `refresh()` is in-flight

### Step 4.3 — `src/test/suite/taskTreeDataProvider.test.ts` *(done in Phase 3)*

Added 7 tests covering loading placeholder behaviour:
- Loading placeholder appears for in-flight provider with no tasks
- Loading placeholder uses `loading~spin` icon
- Loading placeholder has `contextValue === 'loadingPlaceholder'`
- No placeholder appears when provider has tasks committed
- No placeholders appear when `loadingProviders` is empty
- Placeholder is inserted before workspace-folder groups
- `onDidLoadingStateChange` subscription fires tree data change

### Step 4.4 — `src/test/suite/taskFilesService.test.ts` *(done in Phase 3)*

Added 7 tests covering `onDidInitialScanComplete` and new helper methods:
- `onDidInitialScanComplete` fires once after the first successful `_doBuildCache`
- `onDidInitialScanComplete` fires only once even if cache is rebuilt multiple times
- `onDidInitialScanComplete` does not fire until a cache build actually completes
- `getCachedPathCount()` returns 0 when cache not built
- `getCachedPathCount()` returns the size of `cachedPaths`
- `hasRegisteredPatterns()` returns false when no patterns registered
- `hasRegisteredPatterns()` returns true when patterns are registered

---

## Relevant Files

| File | Change |
|---|---|
| `src/providers/shellTaskProvider.ts` | Parallelize `getTasks()`, add shebang cache, cache hit/miss logging, suppress empty `other` log (Phases 1–2) |
| `src/services/taskFilesService.ts` | `onDidInitialScanComplete` event, `getCachedPathCount()`, `hasRegisteredPatterns()` (Phase 3 pre-condition A) |
| `src/services/taskCacheService.ts` | Loading state tracking, `onDidLoadingStateChange`, `isLoading()`, `getLoadingProviders()`, `hasTasksForProviderType()`, `initialize()` subscription, `withProgress` status bar (Phase 3, Steps 3.1, 3.4) |
| `src/taskTreeDataProvider.ts` | Subscribe to loading events + inject placeholders (Phase 3, Steps 3.2–3.3) |
| `src/test/suite/shellTaskProvider.test.ts` | Tests for parallel execution, deduplication, shebang cache, cross-type cache sharing, `other` suppression *(Phase 4, Step 4.1 — pending)* |
| `src/test/suite/taskCacheService.test.ts` | 10 tests for loading state lifecycle *(done in Phase 3)* |
| `src/test/suite/taskTreeDataProvider.test.ts` | 7 tests for loading placeholder items *(done in Phase 3)* |
| `src/test/suite/taskFilesService.test.ts` | 7 tests for `onDidInitialScanComplete` and helper methods *(done in Phase 3)* |

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
5. **Ghost `ruby` provider — resolved** — Phase 3 logs confirm the stray `[DEBUG] Provider ruby (type: ruby) is disabled. Skipping.` message is absent. It was traced to `WorkspaceTasksProvider.getTasks()` checking `isTaskTypeEnabled()` for workspace task config entries that reference the `ruby` type. It is not an orphaned provider registration, does not affect `loadingProviders`, and requires no code change.
6. **`findFiles` as the remaining dominant cost** — Phase 3 results confirm that ~15 s of load time is still dominated by `TaskFilesService`'s initial workspace scan. The first-launch race (Phase 3 Pre-condition A) is now resolved. Phase 3's loading placeholders and progress indicator make this wait visible to users rather than silently blocking. If further load-time improvements are needed, the next target should be `TaskFilesService` scan parallelism or incremental indexing — outside this plan's scope.
7. **Loading state event throttling** — the plan originally specified firing `_onDidLoadingStateChange` on every provider entry/exit (N×2 events per `refresh()`). The implementation fires only on idle→loading and loading→idle transitions (2 events total per `refresh()` cycle). This was required to prevent the extension host from hanging under test due to the cascade of `organizeTasks()` tree rebuilds each event triggered. The observable UX is identical.
8. **4-second activation gap** — Phase 3 logs reveal a consistent ~4s gap between extension activation and the start of shell task discovery. This is initialization overhead (services, providers, first `refresh()` call). Loading placeholders are visible for this period, which matches the intended UX. If activation time becomes a concern in future, the extension activation sequence in `extension.ts` could be audited for unnecessary sequential await chains.
