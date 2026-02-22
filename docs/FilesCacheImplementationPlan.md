# File Cache Performance Improvement Plan

## Feedback on the Proposal

The core idea is **sound** and would produce a meaningful performance improvement. Currently, every enabled task provider calls `filesService.findFiles()`, which in turn calls `vscode.workspace.findFiles()` — a non-trivial filesystem operation. With 25+ registered providers, this means 25+ separate filesystem scans per task refresh cycle. Batching them into a single scan and serving subsequent requests from an in-memory cache eliminates almost all of that I/O redundancy.

However, there are several **non-trivial complications** that must be addressed:

### Complication 1 — Per-provider exclude patterns

Not all `findFiles` calls are equivalent. `ShellTaskProvider` passes a hard-coded extra exclude (`GLOB_SHELL_EXCLUDE = **/.venv/**`) on every call. A global combined fetch cannot honour those per-call excludes at the API level. They must be re-applied as a post-fetch filter step when the cache is queried.

### Complication 2 — Dynamic / late-computed glob patterns

Some providers compute their glob patterns at task-discovery time rather than at registration time:

- `ShellTaskProvider` — iterates enabled shell types **and** user-configured `shellAdditionalExtensions` from VS Code settings, building per-extension globs dynamically.
- `TomlTaskProvider` subclasses (`PoeTaskProvider`, `PoetryTaskProvider`, `CargoMakeTaskProvider`) — call `this.getGlobPatterns()` at discovery time.
- `WorkspaceTasksProvider` — reads configured include/exclude globs from settings at discovery time.

These providers cannot simply register a static pattern upfront. The cache must either:

- (a) use sufficiently broad "umbrella" patterns that cover all possible values, or
- (b) accept that these providers remain uncached, or
- (c) allow providers to register a **pattern resolver** (a function) called at cache-build time.

Option (a) is the simplest and safest. For example, `ShellTaskProvider`'s dynamic extensions are already captured by its constructor-built `**/*.{sh,bash,zsh,...}` pattern — the additional user extensions just need their own broad catch-all like `**/*.*` restricted to the configured depth. However, this would result in overfetching. Option (c) is cleaner long-term.

### Complication 3 — Cache invalidation triggers

The cache will become stale when any of the following change:

| Event | Current handling | Cache impact |
| --- | --- | --- |
| File created/deleted/renamed | None (re-scans on refresh) | Cache must be cleared/rebuilt |
| `workspaceTasks.exclude` changes | `initialize()` re-runs | Cache must be rebuilt |
| `workspaceTasks.taskDiscovery.fetchDepth` changes | Checked at filter time | Cache must be rebuilt |
| `.tasksignore` file changes | File watcher in service | Cache must be rebuilt |
| A task provider is enabled/disabled | None (checked at provider level) | Cache is still valid (ignore-filter approach handles this) |
| Workspace folders added/removed | None | Cache must be rebuilt |

### Complication 4 — Post-fetch glob matching

When a provider is no longer calling `vscode.workspace.findFiles(pattern)`, it needs to filter the cached URIs by its own glob pattern in user-space. `vscode.workspace.findFiles` uses VS Code's internal matcher. The equivalent in user-space is [`minimatch`](https://github.com/isaacs/minimatch) or [`micromatch`](https://github.com/micromatch/micromatch). One of these must be added as a dependency and used for cache filtering.

### Complication 5 — Memory footprint

In very large monorepos, the combined glob set may return tens of thousands of URIs. This is inherently bounded by `taskDiscovery.fetchDepth`, but the cache should store only `fsPath` strings (not full `vscode.Uri` objects) to keep overhead minimal, reconstructing `Uri` objects on demand.

---

## Implementation Steps

### Step 0 — Add `micromatch` as a dependency

`micromatch` is the de-facto standard for glob matching in Node.js and is already used transitively by many toolchains. It will be used to re-filter cached paths against provider-specific patterns.

```bash
npm install micromatch
npm install --save-dev @types/micromatch
```

---

### Step 1 — Add a pattern registration mechanism to `BaseTaskProvider`

Providers must be able to declare their glob patterns before task discovery begins. Extend `BaseTaskProvider` to include a method that returns the set of glob patterns it needs, separate from the per-call `filePattern` string.

**File:** `src/taskProvider.ts`

Add a method to the `TaskProvider` interface and `BaseTaskProvider`:

```typescript
/**
 * Returns the glob patterns this provider needs for file discovery.
 * Called once at cache-build time. The default implementation reads
 * `this.filePattern`. Providers with dynamic patterns must override this.
 */
getFilePatterns(): string[] {
  return this.filePattern ? [this.filePattern] : [];
}
```

Providers with dynamic patterns (`ShellTaskProvider`, `TomlTaskProvider` subclasses) must override this method to return their full set of possible patterns (ideally at configuration-read time).

---

### Step 2 — Add a static pattern registry to `TaskFilesService`

Add a method to `TaskFilesService` that accepts patterns from providers during extension activation.

**File:** `src/services/taskFilesService.ts`

```typescript
private registeredPatterns: Set<string> = new Set();

/**
 * Called by each provider during registration to declare the glob
 * patterns it will query. Used to build the combined fetch.
 */
public registerPatterns(patterns: string[]): void {
  for (const p of patterns) {
    this.registeredPatterns.add(p);
  }
}
```

---

### Step 3 — Add the URI cache and a `buildCache()` method

**File:** `src/services/taskFilesService.ts`

```typescript
private cachedPaths: Set<string> | null = null;
private cacheInvalidated = true;

/**
 * Performs the single combined vscode.workspace.findFiles call using
 * all registered patterns, then applies global-ignore and depth filtering.
 * Result is stored in `cachedPaths`.
 */
private async buildCache(): Promise<void> {
  await this.syncIgnoreFiles();

  const patterns = Array.from(this.registeredPatterns);
  if (patterns.length === 0) {
    this.cachedPaths = new Set();
    return;
  }

  const combinedPattern = `{${patterns.join(',')}}`;
  const raw = await vscode.workspace.findFiles(combinedPattern);
  const depthFiltered = this.filterByDepth(raw);

  const result = new Set<string>();
  for (const uri of depthFiltered) {
    if (this.shouldIgnore(uri) || this.isIgnoredByLoadedRules(uri)) {
      continue;
    }
    if (this.context && await this.isIgnoredByDiskRules(uri)) {
      continue;
    }
    result.add(uri.fsPath);
  }

  this.cachedPaths = result;
  this.cacheInvalidated = false;
}

public invalidateCache(): void {
  this.cachedPaths = null;
  this.cacheInvalidated = true;
}
```

---

### Step 4 — Change `findFiles` to query the cache

Replace the existing `findFiles` implementation with one that:

1. Ensures the cache is built (calls `buildCache()` if stale).
2. Filters cached paths against the requested patterns using `micromatch`.
3. Re-applies any caller-supplied `exclude` patterns.
4. Reconstructs `vscode.Uri` objects for the matched paths.

**File:** `src/services/taskFilesService.ts`

```typescript
import micromatch from 'micromatch';

public async findFiles(pattern: string[], exclude?: string[]): Promise<vscode.Uri[]> {
  // If there are no registered patterns, fall back to the old behaviour
  // (handles callers that run before registration is complete).
  if (this.registeredPatterns.size === 0) {
    if (this.context) {
      await this.syncIgnoreFiles();
    }
    const uris = await vscode.workspace.findFiles(
      pattern.join(','),
      exclude ? exclude.join(',') : undefined,
    );
    // ... existing depth / ignore filtering ...
    return filtered;
  }

  if (this.cacheInvalidated || this.cachedPaths === null) {
    await this.buildCache();
  }

  const allPaths = Array.from(this.cachedPaths!);

  // Filter to paths matching the requested patterns
  const matched = micromatch(allPaths, pattern, { dot: true, matchBase: false });

  // Apply caller-supplied excludes
  const excluded = exclude && exclude.length > 0
    ? micromatch(matched, exclude, { dot: true })
    : [];
  const excludeSet = new Set(excluded);

  return matched
    .filter((p) => !excludeSet.has(p))
    .map((p) => vscode.Uri.file(p));
}
```

> **Note:** `micromatch` works on absolute paths. The patterns in `constants.ts` are workspace-relative globs. You will need to either expand the patterns to absolute paths for each workspace folder, or convert cached paths to workspace-relative paths before matching. The latter is simpler — maintain a parallel `Map<string, string>` of `fsPath → workspaceRelativePath` alongside the cache.

---

### Step 5 — Wire pattern registration into provider setup

**File:** `src/providers/index.ts`

After instantiating each provider (but before `getTasks()` is ever called), call `TaskFilesService.getInstance().registerPatterns(provider.getFilePatterns())`.

```typescript
const filesService = TaskFilesService.getInstance();
for (const ProviderClass of providers) {
  const provider = new ProviderClass();
  filesService.registerPatterns(provider.getFilePatterns());
  // ... existing vscode.tasks.registerTaskProvider(...) call
}
```

---

### Step 6 — Wire cache invalidation into existing watchers

**File:** `src/services/taskFilesService.ts`

Every place that currently calls `initialize()` or re-loads ignore files should also call `invalidateCache()`. Additionally:

- In `initialize()`, after rebuilding global ignore / loading `.tasksignore` files, call `invalidateCache()`.
- In the `createFileSystemWatcher` callbacks for `.tasksignore`, call `invalidateCache()` after `loadIgnoreFile()` / `removeIgnoreFile()`.
- Add a `vscode.workspace.onDidCreateFiles`, `onDidDeleteFiles`, and `onDidRenameFiles` watcher in `initialize()` that calls `invalidateCache()`.

```typescript
context.subscriptions.push(
  vscode.workspace.onDidCreateFiles(() => this.invalidateCache()),
  vscode.workspace.onDidDeleteFiles(() => this.invalidateCache()),
  vscode.workspace.onDidRenameFiles(() => this.invalidateCache()),
);
```

> These three events fire for user-visible file changes. They are coarse-grained (any file change invalidates the full cache), which is acceptable given the cache rebuild cost is a single `findFiles` call.

---

### Step 7 — Handle `ShellTaskProvider`'s dynamic patterns correctly

`ShellTaskProvider` computes patterns at discovery time based on the current value of `workspaceTasks.shellAdditionalExtensions`. Override `getFilePatterns()` in `ShellTaskProvider` to read `shellAdditionalExtensions` at registration time and include those extensions in the returned patterns.

Also, ensure that any change to `workspaceTasks.shellAdditionalExtensions` configuration triggers a re-registration + `invalidateCache()`. This can be done in the existing `onDidChangeConfiguration` handler in `initialize()` by checking `e.affectsConfiguration('workspaceTasks.shellAdditionalExtensions')` and calling `rebuildRegisteredPatterns()` — a new helper that iterates all provider instances and re-collects their patterns.

---

### Step 8 — Update tests

**File:** `src/test/suite/workspaceTasksService.test.ts` (and any related test files)

- Tests that previously mocked `vscode.workspace.findFiles` must now also seed or mock `TaskFilesService.cachedPaths` (or mock `buildCache()`), since `vscode.workspace.findFiles` will only be called once during cache construction rather than per-provider.
- Add tests for:
  - `buildCache()` — verifies the combined pattern is constructed correctly, ignore rules are applied.
  - `findFiles()` with cache hit — verifies `micromatch` filtering works for each provider's pattern.
  - `findFiles()` with cache miss — verifies `buildCache()` is re-triggered.
  - `invalidateCache()` — verifies subsequent `findFiles` call triggers a rebuild.
  - Cache is rebuilt after `onDidCreateFiles` / `onDidDeleteFiles` / `onDidRenameFiles`.
  - Cache is rebuilt after `.tasksignore` change.
  - Per-provider exclude patterns still filter results correctly when served from cache.

---

### Step 9 — Update documentation

**File:** `docs/TaskFiltering.md`

Document the new caching behaviour: the combined fetch, when the cache is invalidated, and any observable behaviour differences (e.g., a file created while a task discovery is in progress will be found on the next refresh, not the current one — same as before, but now explicit).

---

## Summary of Changed Files

| File | Change |
| --- | --- |
| `package.json` | Add `micromatch` dependency |
| `src/taskProvider.ts` | Add `getFilePatterns()` to interface and base class |
| `src/services/taskFilesService.ts` | Add `registeredPatterns`, cache fields, `buildCache()`, `invalidateCache()`, `registerPatterns()`, update `findFiles()` |
| `src/providers/index.ts` | Call `registerPatterns()` during provider setup |
| `src/providers/shellTaskProvider.ts` | Override `getFilePatterns()` to include dynamic extensions |
| `src/providers/tomlTaskProvider.ts` | Override `getFilePatterns()` in subclasses to return computed patterns |
| `src/test/suite/taskFilesService.test.ts` | New/updated tests for cache logic |

---

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `micromatch` glob syntax differs from VS Code's internal glob matcher | Validate that all patterns in `constants.ts` produce identical results with both matchers; add unit tests comparing output |
| Combined pattern string becomes extremely long in large setups | Use a `RelativePattern` array and iterate `vscode.workspace.findFiles` per workspace folder if a string length limit is hit |
| Cache is stale during long-running task discovery | Cache is built once at the start of a discovery cycle; individual tasks within the cycle read from the same snapshot, which is consistent and predictable |
| Path normalisation differences between cache keys and `micromatch` input | Normalise all stored paths to forward slashes before storing and before matching |
