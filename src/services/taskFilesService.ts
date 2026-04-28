import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import ignore from 'ignore';
import micromatch from 'micromatch';
import constants from '../libs/constants';
import { LoggerService } from './loggerService';
import { TaskCacheService } from './taskCacheService';

interface TaskIgnoreRule {
  /** The file-path glob portion (the part before `@`). */
  filePattern: string;
  /** The exact task name (the part after `@`). */
  taskName: string;
  /** True when the original line started with `!`. */
  negated: boolean;
}

interface IgnoreFile {
  folderUri: vscode.Uri;
  ig: ignore.Ignore; // ignore instance
  taskRules: TaskIgnoreRule[];
}

function parseIgnoreLines(lines: string[]): {
  fileRules: string[];
  taskRules: TaskIgnoreRule[];
} {
  const fileRules: string[] = [];
  const taskRules: TaskIgnoreRule[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    const negated = line.startsWith('!');
    const body = negated ? line.slice(1) : line;

    const atIndex = body.indexOf('@');
    if (atIndex === -1) {
      // Standard file-level rule — lowercase to align with normalizePathForComparison so that
      // micromatch comparisons are case-insensitive on all platforms (mirrors Windows behavior).
      fileRules.push(negated ? '!' + body.toLowerCase() : body.toLowerCase());
    } else {
      // Task-level rule: split on the first `@`
      // Lowercase the file-path portion to match normalizePathForComparison.
      // taskName (after '@') is NOT lowercased — script names are case-sensitive.
      const filePattern = body.slice(0, atIndex).toLowerCase();
      const taskName = body.slice(atIndex + 1);
      if (filePattern && taskName) {
        taskRules.push({ filePattern, taskName, negated });
      } else {
        // Malformed rule (e.g. "@taskname" or "file@") — treat as a file-level rule
        // so the user gets visible feedback via gitignore matching failure rather than silence.
        fileRules.push(negated ? '!' + body.toLowerCase() : body.toLowerCase());
      }
    }
  }

  return { fileRules, taskRules };
}

export class TaskFilesService {
  private static instance: TaskFilesService;
  private globalIgnore: ignore.Ignore;
  private ignoreList: string[] = [];
  private lastExcludes: string[] = []; // tracks last-applied exclude list to suppress no-op config events
  private ignoreFiles: IgnoreFile[] = [];
  private configWatcher?: vscode.Disposable;
  private fileWatcher?: vscode.Disposable;
  private fileEventsWatcher?: vscode.Disposable;
  private _saveDebounceTimer?: ReturnType<typeof setTimeout>;
  private _pendingProviderTypes: Set<string> = new Set();
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();
  private registeredPatterns: Set<string> = new Set();
  private cachedPaths: Set<string> | null = null;
  private cacheInvalidated = true;
  private buildCacheInFlight: Promise<void> | null = null;
  private cacheGeneration = 0;
  private initialScanFired = false;

  // ── Uncovered-pattern batch coalescing ──────────────────────────────────────
  // When multiple concurrent findFiles() calls have patterns that are NOT in
  // registeredPatterns, they would each trigger their own vscode.workspace.findFiles
  // walk.  Instead, calls arriving in the same microtask checkpoint are collected
  // into a single queue entry and dispatched together as one combined query.
  private uncoveredBatchQueue: Array<{
    patterns: string[];
    exclude: string[];
    resolve: (uris: vscode.Uri[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  private uncoveredBatchScheduled = false;
  private _onDidInitialScanComplete = new vscode.EventEmitter<void>();
  public readonly onDidInitialScanComplete: vscode.Event<void> = this._onDidInitialScanComplete.event;

  /** Returns the number of files in the current valid cache, or 0 if the cache is empty/unbuilt. */
  public getCachedPathCount(): number {
    return this.cachedPaths?.size ?? 0;
  }

  /** Returns true if any file patterns have been registered with the service. */
  public hasRegisteredPatterns(): boolean {
    return this.registeredPatterns.size > 0;
  }

  private constructor() {
    this.globalIgnore = ignore();
  }

  public static getInstance(): TaskFilesService {
    if (!TaskFilesService.instance) {
      TaskFilesService.instance = new TaskFilesService();
    }
    return TaskFilesService.instance;
  }

  private getRelativePathIfInside(parentNormalized: string, childNormalized: string): string | undefined {
    if (parentNormalized === childNormalized) {
      return '';
    }
    const prefix = parentNormalized.endsWith('/') ? parentNormalized : parentNormalized + '/';
    if (childNormalized.startsWith(prefix)) {
      return childNormalized.slice(prefix.length);
    }
    return undefined;
  }

  public registerPatterns(patterns: string[]): void {
    for (const p of patterns) {
      this.registeredPatterns.add(p);
    }
  }

  private async buildCache(): Promise<void> {
    // Coalesce concurrent requests: if a build is already in flight, join it rather
    // than launching a redundant parallel scan (e.g. when all providers fire at startup).
    if (this.buildCacheInFlight !== null) {
      return this.buildCacheInFlight;
    }
    this.buildCacheInFlight = this._doBuildCache().finally(() => {
      this.buildCacheInFlight = null;
    });
    return this.buildCacheInFlight;
  }

  private async _doBuildCache(): Promise<void> {
    const cacheBuildStartMs = Date.now();
    const generation = this.cacheGeneration;
    await this.syncIgnoreFiles();

    const patterns = Array.from(this.registeredPatterns);
    if (patterns.length === 0) {
      if (generation !== this.cacheGeneration) { return; }
      this.cachedPaths = new Set();
      this.cacheInvalidated = false;
      this.logger.debug('[TaskFilesService] No registered patterns; cache marked valid (empty).');
      return;
    }

    // Expand inside braces so we don't have nested braces like {**/*.{sh,bash},**/package.json}
    // which vscode.workspace.findFiles might not support
    let expandedPatterns: string[] = [];
    for (const p of patterns) {
        const expanded = micromatch.braces(p, { expand: true });
        expandedPatterns.push(...expanded);
    }

    const combinedPattern = expandedPatterns.length > 1
        ? `{${expandedPatterns.join(',')}}`
        : expandedPatterns[0];

    try {
      const raw = await vscode.workspace.findFiles(combinedPattern);
      const depthFiltered = this.filterByDepth(raw);

      const result = new Set<string>();
      for (const uri of depthFiltered) {
        if (this.shouldIgnore(uri)) {
          continue;
        }
        result.add(uri.fsPath);
      }

      if (generation !== this.cacheGeneration) { return; }
      this.cachedPaths = result;
      this.cacheInvalidated = false;
      const cacheBuildDurationMs = Date.now() - cacheBuildStartMs;
      this.logger.debug(
        `[TaskFilesService] Cache built with ${this.cachedPaths.size} files from combined pattern: ${combinedPattern} in ${cacheBuildDurationMs}ms`,
      );
      if (!this.initialScanFired) {
        this.initialScanFired = true;
        queueMicrotask(() => this._onDidInitialScanComplete.fire());
      }
    } catch (err) {
      const cacheBuildDurationMs = Date.now() - cacheBuildStartMs;
      this.logger.error(`[TaskFilesService] Error building cache after ${cacheBuildDurationMs}ms: ${err}`);
      if (generation !== this.cacheGeneration) { return; }
      this.cachedPaths = new Set();
      this.cacheInvalidated = false;
      if (!this.initialScanFired) {
        this.initialScanFired = true;
        queueMicrotask(() => this._onDidInitialScanComplete.fire());
      }
    }
  }

  public invalidateCache(): void {
    this.markCacheStale();
    // Refresh the task cache to discover or hide tasks based on new ignore rules
    TaskCacheService.getInstance().refresh();
  }

  /**
   * Marks the file cache as stale so the next `findFiles()` call triggers a rebuild,
   * without firing a tree refresh via `TaskCacheService`. Use this when registering
   * new patterns before the initial cache build (e.g. during config load at startup)
   * where the full `invalidateCache()` side-effect would be premature or recursive.
   */
  public markCacheStale(): void {
    this.cachedPaths = null;
    this.cacheInvalidated = true;
    this.cacheGeneration++;
    // Drop any in-flight build so the next findFiles() call starts a fresh scan.
    // The generation increment ensures that if the old build still completes it
    // will detect the mismatch and discard its results.
    this.buildCacheInFlight = null;
  }

  public rebuildRegisteredPatterns(): void {
    const providers = TaskCacheService.getInstance().getProviders();
    this.registeredPatterns.clear();
    for (const provider of providers) {
      if (provider.getFilePatterns) {
        this.registerPatterns(provider.getFilePatterns());
      }
    }
  }

  public async findFiles(pattern: string[], exclude?: string[]): Promise<vscode.Uri[]> {
    // Separate pattern list into those covered by the cache and those that are not.
    // A pattern is "covered" if it was pre-registered (so the cache contains all matching files).
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const p of pattern) {
      if (this.registeredPatterns.has(p)) {
        covered.push(p);
      } else {
        uncovered.push(p);
      }
    }

    const results: vscode.Uri[] = [];

    // Serve covered patterns from the cache
    if (covered.length > 0 && this.registeredPatterns.size > 0) {
      // Loop to handle the rare race where markCacheStale() increments cacheGeneration
      // while _doBuildCache() is awaiting, causing that build to detect a mismatch
      // and return early without setting cachedPaths. Without the loop, findFiles()
      // would resume with cachedPaths === null and throw "object null is not iterable".
      while (this.cacheInvalidated || this.cachedPaths === null) {
        await this.buildCache();
      }

      const allPaths = Array.from(this.cachedPaths);

      // Normalize to forward-slashes for micromatch (Windows-safe)
      const allPathsNormalized = allPaths.map(p => p.replace(/\\/g, '/'));
      const pathMap = new Map<string, string>();
      allPaths.forEach((p, i) => pathMap.set(allPathsNormalized[i], p));

      // Expand brace expressions before matching so micromatch handles them correctly
      const expandedCovered: string[] = [];
      for (const p of covered) {
        expandedCovered.push(...micromatch.braces(p, { expand: true }));
      }

      const matchedNormalized = micromatch(allPathsNormalized, expandedCovered, { dot: true });

      const excludedNormalized = exclude && exclude.length > 0
        ? new Set(micromatch(matchedNormalized, exclude, { dot: true }))
        : new Set<string>();

      for (const p of matchedNormalized) {
        if (!excludedNormalized.has(p)) {
          results.push(vscode.Uri.file(pathMap.get(p)!));
        }
      }
    }

    // Uncovered patterns: coalesce concurrent callers via microtask batching.
    // All findFiles() calls issued in the same async turn (e.g. from Promise.all)
    // enqueue their uncovered patterns here.  A single queueMicrotask fires after
    // all have enqueued, dispatching ONE vscode.workspace.findFiles for the union
    // of all uncovered patterns and distributing results back per caller.
    if (uncovered.length > 0) {
      const uncoveredResults = await new Promise<vscode.Uri[]>((resolve, reject) => {
        this.uncoveredBatchQueue.push({ patterns: uncovered, exclude: exclude ?? [], resolve, reject });
        if (!this.uncoveredBatchScheduled) {
          this.uncoveredBatchScheduled = true;
          queueMicrotask(() => { this._flushUncoveredBatch(); });
        }
      });
      results.push(...uncoveredResults);
    }

    return results;
  }

  /**
   * Flushes the pending uncovered-pattern batch queue.  Called via queueMicrotask so
   * that all concurrent findFiles() callers within the same async turn have had a
   * chance to enqueue their patterns before the single VS Code query fires.
   */
  private _flushUncoveredBatch(): void {
    const batch = this.uncoveredBatchQueue.splice(0);
    this.uncoveredBatchScheduled = false;
    if (batch.length === 0) { return; }

    // Deduplicate patterns across all queued requests.
    const allPatterns = [...new Set(batch.flatMap((b) => b.patterns))];

    // Compute the intersection of all exclude lists.  Patterns common to every
    // request can be applied in the VS Code query itself; per-request extras that
    // did not appear in every list are applied in memory when distributing results.
    const allExcludeSets = batch.map((b) => new Set(b.exclude));
    const commonExcludes = [...allExcludeSets[0]].filter((e) =>
      allExcludeSets.every((s) => s.has(e)),
    );

    const combinedPattern =
      allPatterns.length > 1 ? `{${allPatterns.join(',')}}` : allPatterns[0];
    const excludeGlob = commonExcludes.length > 0 ? commonExcludes.join(',') : undefined;

    void (async () => {
      try {
        if (this.context) {
          await this.syncIgnoreFiles();
        }

        const uris = await vscode.workspace.findFiles(combinedPattern, excludeGlob);
        const depthFiltered = this.filterByDepth(uris);
        const accepted: vscode.Uri[] = [];
        for (const uri of depthFiltered) {
          if (!this.shouldIgnore(uri)) {
            accepted.push(uri);
          }
        }

        if (batch.length === 1) {
          this.logger.debug(
            `[TaskFilesService] uncoveredBatch: 1 request, ${allPatterns.length} pattern(s) → ${accepted.length} file(s).`,
          );
        } else {
          this.logger.debug(
            `[TaskFilesService] uncoveredBatch: ${batch.length} requests coalesced into 1 query, ` +
            `${allPatterns.length} unique pattern(s) → ${accepted.length} file(s) ` +
            `(${batch.length - 1} extra vscode.workspace.findFiles call(s) avoided).`,
          );
        }

        // Distribute results to each queued request, applying per-request filtering.
        for (const entry of batch) {
          // When only one request is in the batch, VS Code has already filtered against
          // the combined pattern, so all accepted files belong to this request — no
          // secondary micromatch pass is needed (and would break workspace-relative patterns).
          // For multi-request batches, we use micromatch to assign files to the correct
          // caller.  This works reliably for the common `**/pattern.ext` glob style.
          let matched: vscode.Uri[];
          if (batch.length === 1) {
            matched = accepted;
          } else {
            const expandedPatterns = entry.patterns.flatMap((p) =>
              micromatch.braces(p, { expand: true }),
            );
            matched = accepted.filter((uri) =>
              micromatch.isMatch(uri.fsPath.replace(/\\/g, '/'), expandedPatterns, { dot: true }),
            );
          }

          // Apply any per-request excludes that were not in the common set.
          const extraExcludes = entry.exclude.filter((e) => !commonExcludes.includes(e));
          const filtered =
            extraExcludes.length > 0
              ? matched.filter(
                  (uri) =>
                    !micromatch.isMatch(
                      uri.fsPath.replace(/\\/g, '/'),
                      extraExcludes,
                      { dot: true },
                    ),
                )
              : matched;
          entry.resolve(filtered);
        }
      } catch (err) {
        for (const entry of batch) {
          entry.reject(err);
        }
      }
    })();
  }

  private async syncIgnoreFiles(): Promise<void> {
    if (!this.context) {
      return;
    }

    let files: vscode.Uri[] = [];
    try {
      files = await vscode.workspace.findFiles('**/.tasksignore', '{**/node_modules/**,**/.git/**,**/.vscode-test/**}');
    } catch {

    }

    // Do NOT prune ignoreFiles here: a freshly-created .tasksignore may not be
    // indexed by VS Code yet, so findFiles would miss it and the filter would
    // delete an entry that was correctly loaded by the file watcher or
    // waitForIgnoreFile in tests.  Actual deletions are handled by the
    // onDidDelete watcher handler (removeIgnoreFile), so this filter is
    // redundant and causes a timing race.

    for (const file of files) {
      const folder = this.normalizePathForComparison(path.dirname(file.fsPath));
      const alreadyLoaded = this.ignoreFiles.some(
        (f) => this.normalizePathForComparison(f.folderUri.fsPath) === folder,
      );
      if (!alreadyLoaded) {
        await this.loadIgnoreFile(file);
      }
    }
  }

  private normalizePathForComparison(inputPath: string): string {
    let normalized = path.normalize(inputPath);
    // Normalize Windows long-path prefixes (e.g. "\\?\D:\\repo\\file")
    normalized = normalized.replace(/^\\\\\?\\/, '');
    normalized = normalized.replace(/^\/\/\?\//, '');
    // VS Code URIs on Windows can sometimes yield paths like "\\d:\\repo\\file"
    // while other APIs return "d:\\repo\\file". Normalize both to the same shape.
    normalized = normalized.replace(/^[/\\]+(?=[a-zA-Z]:[/\\])/, '');
    // Use forward slashes consistently so getRelativePathIfInside works on all platforms.
    return normalized.toLowerCase().replace(/\\/g, '/');
  }

  private filterByDepth(uris: vscode.Uri[]): vscode.Uri[] {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const fetchDepth = config.get<number | null>('taskDiscovery.fetchDepth', null);

    if (fetchDepth === null) {
      return uris;
    }

    return uris.filter((uri) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        return true;
      }

      const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
      // relativePath is the path from the workspace root to the file.
      // e.g. "package.json" -> depth 0
      // e.g. "sub/package.json" -> depth 1
      // count the number of separators to determine the depth
      const depth = relativePath.split(path.sep).length - 1;
      return depth <= fetchDepth;
    });
  }

  public dispose(): void {
    clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = undefined;
    this._pendingProviderTypes.clear();
    this.configWatcher?.dispose();
    this.configWatcher = undefined;
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
    this.fileEventsWatcher?.dispose();
    this.fileEventsWatcher = undefined;
    this.registeredPatterns.clear();
    this.cachedPaths = null;
    this.cacheInvalidated = true;
    this.buildCacheInFlight = null;
    this.cacheGeneration = 0;
    this.initialScanFired = false;
    this.ignoreFiles = [];
    this.globalIgnore = ignore();
    this.ignoreList = [];
    this.lastExcludes = [];
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.globalIgnore = ignore();
    this.ignoreFiles = [];
    this.ignoreList = [];
    this.lastExcludes = [];
    clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = undefined;
    this._pendingProviderTypes.clear();

    // Add patterns from extension configuration (workspaceTasks.exclude)
    try {
      const config = vscode.workspace.getConfiguration('workspaceTasks');
      const excludes = config.get<string[]>('exclude', []);
      this.globalIgnore.add('**/node_modules/**'); // Always ignore node_modules
      this.ignoreList.push('**/node_modules/**');
      this.globalIgnore.add('**/.git/**'); // Always ignore .git
      this.ignoreList.push('**/.git/**');
      this.globalIgnore.add('**/__pycache__/**'); // Always ignore __pycache__
      this.ignoreList.push('**/__pycache__/**');
      this.globalIgnore.add('**/.vscode-test/**');
      this.ignoreList.push('**/.vscode-test/**');
      this.globalIgnore.add('**/vendor/bundle/**'); // Always ignore vendor/bundle
      this.ignoreList.push('**/vendor/bundle/**');

      if (Array.isArray(excludes) && excludes.length > 0) {
        this.globalIgnore.add(excludes);
        this.ignoreList.push(...excludes);
      }
      this.lastExcludes = Array.isArray(excludes) ? [...excludes] : [];
    } catch (e) {
      this.logger.error('[TaskFilesService] Failed to read workspaceTasks.exclude', e);
    }

    // Find all .tasksignore files in the workspace
      const files = await vscode.workspace.findFiles('**/.tasksignore', this.ignoreList.join(','));
    for (const file of files) {
      await this.loadIgnoreFile(file);
    }

    // Watch for configuration changes to refresh excludes
    if (this.configWatcher) {
      this.configWatcher.dispose();
      this.configWatcher = undefined;
    }
    this.configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
      let isInvalidated = false;
      if (e.affectsConfiguration('workspaceTasks.exclude')) {
        // Only reinitialize if the exclude list actually changed to avoid
        // spurious initialize() calls (e.g. from test teardowns that reset
        // the setting to its current value).
        const newExcludes = vscode.workspace.getConfiguration('workspaceTasks').get<string[]>('exclude', []);
        const newKey = JSON.stringify([...(newExcludes ?? [])].sort());
        const oldKey = JSON.stringify([...this.lastExcludes].sort());
        if (newKey !== oldKey) {
          await this.initialize(this.context!);
          isInvalidated = true;
        }
      }
      if (e.affectsConfiguration('workspaceTasks.shellAdditionalExtensions')) {
        // dynamic patterns updated, invalidate
        this.rebuildRegisteredPatterns();
        this.invalidateCache();
        isInvalidated = true;
      }
      if (!isInvalidated && e.affectsConfiguration('workspaceTasks.taskDiscovery.fetchDepth')) {
        this.invalidateCache();
      }
    });

    // Watch for .tasksignore changes
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/.tasksignore');
    watcher.onDidChange(async (uri) => {
      await this.loadIgnoreFile(uri);
      this.invalidateCache();
    });
    watcher.onDidCreate(async (uri) => {
      await this.loadIgnoreFile(uri);
      this.invalidateCache();
    });
    watcher.onDidDelete((uri) => {
      this.removeIgnoreFile(uri);
      this.invalidateCache();
    });
    this.fileWatcher = watcher;

    if (this.fileEventsWatcher) {
      this.fileEventsWatcher.dispose();
      this.fileEventsWatcher = undefined;
    }
    this.fileEventsWatcher = vscode.Disposable.from(
      vscode.workspace.onDidCreateFiles((e) => {
        if (this.anyFileMatchesRegisteredPatterns(e.files)) {
          this.invalidateCache();
        }
      }),
      vscode.workspace.onDidDeleteFiles((e) => {
        if (this.anyFileMatchesRegisteredPatterns(e.files)) {
          this.invalidateCache();
        }
      }),
      vscode.workspace.onDidRenameFiles((e) => {
        const uris = e.files.flatMap((f) => [f.oldUri, f.newUri]);
        if (this.anyFileMatchesRegisteredPatterns(uris)) {
          this.invalidateCache();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const uri = document.uri;

        // Only process real on-disk files
        if (uri.scheme !== 'file') {
          return;
        }

        // Taskfile-specific hot-reload (preserve existing targeted behavior)
        if (this.isTaskfileUri(uri)) {
          TaskCacheService.getInstance().refreshProvider('taskfile').catch((e) => {
            this.logger.error('[TaskFilesService] Failed to refresh taskfile provider after Taskfile save', e);
          });
          return; // early return prevents double-trigger via general handler below
        }

        // General: debounced targeted refresh for the providers that own the saved file.
        // Saving a file does not change which files exist, so the file-path cache does
        // not need to be invalidated — only the affected providers need to re-read
        // their tasks from the updated file content.
        if (this.anyFileMatchesRegisteredPatterns([uri])) {
          const matchingTypes = this.getProviderTypesForUri(uri);
          if (matchingTypes.length > 0) {
            this.logger.debug(`[TaskFilesService] Task file saved, scheduling provider refresh for [${matchingTypes.join(', ')}]: ${uri.fsPath}`);
            for (const type of matchingTypes) {
              this._pendingProviderTypes.add(type);
            }
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = setTimeout(() => {
              const types = Array.from(this._pendingProviderTypes);
              this._pendingProviderTypes.clear();
              this.logger.debug(`[TaskFilesService] Executing debounced provider refresh after save: [${types.join(', ')}]`);
              for (const type of types) {
                TaskCacheService.getInstance().refreshProvider(type).catch((e) => {
                  this.logger.error(`[TaskFilesService] Failed to refresh provider ${type} after save`, e);
                });
              }
            }, 300);
          }
        }
      }),
    );

    this.invalidateCache();
  }

  private async loadIgnoreFile(uri: vscode.Uri) {
    try {
      // Use vscode.workspace.fs.readFile to read directly from disk, bypassing
      // VS Code's text document cache which can return stale/empty content for
      // recently written files (leading to empty ignore rules).
      const rawBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(rawBytes).toString('utf-8');
      const lines = content.split(/\r?\n/);
      const { fileRules, taskRules } = parseIgnoreLines(lines);

      // Remove existing if any (reload)
      this.removeIgnoreFile(uri);

      const ig = ignore();
      if (fileRules.length > 0) {
        ig.add(fileRules);
      }

      this.ignoreFiles.push({
        folderUri: vscode.Uri.file(path.dirname(uri.fsPath)),
        ig: ig,
        taskRules: taskRules,
      });
    } catch (e) {
      this.logger.error(`[TaskFilesService] Failed to load .tasksignore at ${uri.fsPath}`, e);
    }
  }

  private removeIgnoreFile(uri: vscode.Uri) {
    const folderPath = this.normalizePathForComparison(path.dirname(uri.fsPath));
    this.ignoreFiles = this.ignoreFiles.filter(
      (f) => this.normalizePathForComparison(f.folderUri.fsPath) !== folderPath,
    );
  }

  /**
   * Returns true if any of the given URIs matches at least one of the registered task file patterns.
   * Used to avoid invalidating the cache on unrelated file system changes.
   */
  private anyFileMatchesRegisteredPatterns(uris: readonly vscode.Uri[]): boolean {
    if (this.registeredPatterns.size === 0) {
      return false;
    }
    const patterns = Array.from(this.registeredPatterns);
    return uris.some((uri) => {
      const normalized = uri.fsPath.replace(/\\/g, '/');
      return micromatch.isMatch(normalized, patterns, { dot: true });
    });
  }

  /**
   * Returns the provider `type` strings for every registered provider whose
   * file patterns match the given URI.  Used by the save-event handler to
   * determine which providers need to be refreshed when a task file is saved.
   */
  private getProviderTypesForUri(uri: vscode.Uri): string[] {
    const providers = TaskCacheService.getInstance().getProviders();
    const normalized = uri.fsPath.replace(/\\/g, '/');
    const types: string[] = [];
    for (const provider of providers) {
      if (!provider.getFilePatterns) { continue; }
      const patterns = provider.getFilePatterns();
      if (patterns.length === 0) { continue; }
      if (micromatch.isMatch(normalized, patterns, { dot: true })) {
        const type = (provider as any).type as string | undefined;
        if (type && !types.includes(type)) {
          types.push(type);
        }
      }
    }
    return types;
  }

  private isTaskfileUri(uri: vscode.Uri): boolean {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const additionalPatterns = config.get<string[]>('taskfile.additionalFilePatterns', []);
    const patterns = [constants.GLOB_TASKFILE, ...additionalPatterns];
    const normalized = uri.fsPath.replace(/\\/g, '/');
    return micromatch.isMatch(normalized, patterns, { dot: true });
  }

  public shouldIgnore(uri: vscode.Uri): boolean {
    if (!this.isFileIgnoredByFileRules(uri)) {
      return false;
    }

    const uriPath = this.normalizePathForComparison(uri.fsPath);
    const applicableIgnores = this.ignoreFiles.filter((ig) => {
      const ignoreFolder = this.normalizePathForComparison(ig.folderUri.fsPath);
      const relRaw = this.getRelativePathIfInside(ignoreFolder, uriPath);
      return relRaw !== undefined && relRaw !== '';
    });

    for (const ignoreFile of applicableIgnores) {
      if (!ignoreFile.taskRules || ignoreFile.taskRules.length === 0) {
        continue;
      }

      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
      const relRaw = this.getRelativePathIfInside(ignoreFolder, uriPath);
      if (relRaw === undefined || relRaw === '') {
        continue;
      }
      const relativePath = relRaw.replace(/\\/g, '/');

      for (let i = ignoreFile.taskRules.length - 1; i >= 0; i--) {
        const rule = ignoreFile.taskRules[i];
        if (rule.negated) {
          if (micromatch.isMatch(relativePath, rule.filePattern, { dot: true })) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private isFileIgnoredByFileRules(uri: vscode.Uri): boolean {
    // 1. Check Global Ignore (absolute/workspace relative check)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      // Workspace folder not found, but still check .tasksignore files
      // This can happen in test environments or for files outside the workspace
      // Skip global ignore check and proceed to .tasksignore check
    } else {
      const workspaceRelativePath = vscode.workspace.asRelativePath(uri, false);
      // Normalize to forward slashes for ignore matching
      const normalizedWorkspaceRelativePath = workspaceRelativePath.split(path.sep).join('/');
      if (this.globalIgnore.ignores(normalizedWorkspaceRelativePath)) {
        return true;
      }
    }

    // 2. Check closest .tasksignore
    // Find all ignore files that are parents of this uri
    const uriPath = this.normalizePathForComparison(uri.fsPath);
    const applicableIgnores = this.ignoreFiles.filter((ig) => {
      const ignoreFolder = this.normalizePathForComparison(ig.folderUri.fsPath);
      const relRaw = this.getRelativePathIfInside(ignoreFolder, uriPath);
      return relRaw !== undefined && relRaw !== '';
    });

    // Sort by longest path (closest to file)
    applicableIgnores.sort((a, b) => b.folderUri.fsPath.length - a.folderUri.fsPath.length);

    for (const ignoreFile of applicableIgnores) {
      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
      const filePath = this.normalizePathForComparison(uri.fsPath);

      const relRaw = this.getRelativePathIfInside(ignoreFolder, filePath);
      if (relRaw === undefined || relRaw === '') {
        continue;
      }

      const normalizedPath = relRaw.replace(/\\/g, '/');

      // Check if ignored (skip empty paths)
      if (normalizedPath && ignoreFile.ig.ignores(normalizedPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Returns true if the named task from the given file URI should be excluded
   * based on `.tasksignore` task-level rules.
   *
   * Evaluation order mirrors rule declaration order (last match wins), consistent
   * with gitignore semantics.
   *
   * @param fileUri  The URI of the file that contains the task.
   * @param taskName The exact task name as it appears in the source file.
   */
  public shouldIgnoreTask(fileUri: vscode.Uri, taskName: string): boolean {
    const targetPath = this.normalizePathForComparison(fileUri.fsPath);

    // Collect applicable ignore files (same ancestor logic as shouldIgnore())
    const applicableIgnores = this.ignoreFiles.filter((ig) => {
      const ignoreFolder = this.normalizePathForComparison(ig.folderUri.fsPath);
      return this.getRelativePathIfInside(ignoreFolder, targetPath) !== undefined;
    });

    applicableIgnores.sort((a, b) => b.folderUri.fsPath.length - a.folderUri.fsPath.length);

    for (const ignoreFile of applicableIgnores) {
      if (!ignoreFile.taskRules || ignoreFile.taskRules.length === 0) {
        continue;
      }

      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
      const relRaw = this.getRelativePathIfInside(ignoreFolder, targetPath);
      if (relRaw === undefined || relRaw === '') {
        continue;
      }
      const relativePath = relRaw.replace(/\\/g, '/');

      // Check rules in reverse definition order (last match wins)
      for (let i = ignoreFile.taskRules.length - 1; i >= 0; i--) {
        const rule = ignoreFile.taskRules[i];
        const taskNameMatches = rule.taskName === taskName
          || rule.taskName === '*'
          || micromatch.isMatch(taskName, rule.taskName, { dot: true });
        if (taskNameMatches) {
          if (micromatch.isMatch(relativePath, rule.filePattern, { dot: true })) {
            return !rule.negated;
          }
        }
      }
    }

    return this.isFileIgnoredByFileRules(fileUri);
  }
}
