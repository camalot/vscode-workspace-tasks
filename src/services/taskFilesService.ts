import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import ignore from 'ignore';
import micromatch from 'micromatch';
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
      // micromatch comparisons are case-insensitive on all platforms (mirrors Windows behaviour).
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
  private lastExcludes: string[] = []; // tracks last-applied exclude list to suppress no-op config events
  private ignoreFiles: IgnoreFile[] = [];
  private configWatcher?: vscode.Disposable;
  private fileWatcher?: vscode.Disposable;
  private fileEventsWatcher?: vscode.Disposable;
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();
  private registeredPatterns: Set<string> = new Set();
  private cachedPaths: Set<string> | null = null;
  private cacheInvalidated = true;
  private buildCacheInFlight: Promise<void> | null = null;
  private cacheGeneration = 0;

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
    } catch (err) {
      const cacheBuildDurationMs = Date.now() - cacheBuildStartMs;
      this.logger.error(`[TaskFilesService] Error building cache after ${cacheBuildDurationMs}ms: ${err}`);
      if (generation !== this.cacheGeneration) { return; }
      this.cachedPaths = new Set();
      this.cacheInvalidated = false;
    }
  }

  public invalidateCache(): void {
    this.cachedPaths = null;
    this.cacheInvalidated = true;
    this.cacheGeneration++;
    // Drop any in-flight build so the next findFiles() call starts a fresh scan.
    // The generation increment ensures that if the old build still completes it
    // will detect the mismatch and discard its results.
    this.buildCacheInFlight = null;

    // Refresh the task cache to discover or hide tasks based on new ignore rules
    TaskCacheService.getInstance().refresh();
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
      if (this.cacheInvalidated || this.cachedPaths === null) {
        await this.buildCache();
      }

      const allPaths = Array.from(this.cachedPaths!);

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

    // Direct query for uncovered patterns (not pre-registered / dynamic)
    if (uncovered.length > 0) {
      if (this.context) {
        await this.syncIgnoreFiles();
      }
      const combinedPattern = uncovered.length > 1 ? `{${uncovered.join(',')}}` : uncovered[0];
      const excludeGlob = exclude && exclude.length > 0 ? exclude.join(',') : undefined;
      const uris = await vscode.workspace.findFiles(combinedPattern, excludeGlob);
      const depthFiltered = this.filterByDepth(uris);
      for (const uri of depthFiltered) {
        if (this.shouldIgnore(uri)) {
          continue;
        }
        results.push(uri);
      }
    }

    return results;
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

    const folders = new Set(files.map((f) => this.normalizePathForComparison(path.dirname(f.fsPath))));
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
    this.configWatcher?.dispose();
    this.configWatcher = undefined;
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
    this.fileEventsWatcher?.dispose();
    this.fileEventsWatcher = undefined;
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.globalIgnore = ignore();
    this.ignoreFiles = [];

    // Add patterns from extension configuration (workspaceTasks.exclude)
    try {
      const config = vscode.workspace.getConfiguration('workspaceTasks');
      const excludes = config.get<string[]>('exclude', []);
      this.globalIgnore.add('**/node_modules/**'); // Always ignore node_modules
      this.globalIgnore.add('**/.git/**'); // Always ignore .git
      this.globalIgnore.add('**/__pycache__/**'); // Always ignore __pycache__
      this.globalIgnore.add('**/.vscode-test/**');
      if (Array.isArray(excludes) && excludes.length > 0) {
        this.globalIgnore.add(excludes);
      }
      this.lastExcludes = Array.isArray(excludes) ? [...excludes] : [];
    } catch (e) {
      this.logger.error('[TaskFilesService] Failed to read workspaceTasks.exclude', e);
    }

    // Find all .tasksignore files in the workspace
      const files = await vscode.workspace.findFiles('**/.tasksignore');
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
    watcher.onDidChange((uri) => {
      this.loadIgnoreFile(uri);
      this.invalidateCache();
    });
    watcher.onDidCreate((uri) => {
      this.loadIgnoreFile(uri);
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
        if (rule.taskName === taskName || rule.taskName === '*') {
          if (micromatch.isMatch(relativePath, rule.filePattern, { dot: true })) {
            return !rule.negated;
          }
        }
      }
    }

    return this.isFileIgnoredByFileRules(fileUri);
  }
}
