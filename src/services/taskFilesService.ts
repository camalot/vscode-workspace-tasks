import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import ignore from 'ignore';
import micromatch from 'micromatch';
import { LoggerService } from './loggerService';
import { TaskCacheService } from './taskCacheService';

interface IgnoreFile {
  folderUri: vscode.Uri;
  ig: ignore.Ignore; // ignore instance
}

export class TaskFilesService {
  private static instance: TaskFilesService;
  private globalIgnore: ignore.Ignore;
  private ignoreFiles: IgnoreFile[] = [];
  private configWatcher?: vscode.Disposable;
  private fileWatcher?: vscode.Disposable;
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();
  private registeredPatterns: Set<string> = new Set();
  private cachedPaths: Set<string> | null = null;
  private cacheInvalidated = true;

  private constructor() {
    this.globalIgnore = ignore();
  }

  public static getInstance(): TaskFilesService {
    if (!TaskFilesService.instance) {
      TaskFilesService.instance = new TaskFilesService();
    }
    return TaskFilesService.instance;
  }

  public registerPatterns(patterns: string[]): void {
    for (const p of patterns) {
      this.registeredPatterns.add(p);
    }
  }

  private async buildCache(): Promise<void> {
    await this.syncIgnoreFiles();

    const patterns = Array.from(this.registeredPatterns);
    if (patterns.length === 0) {
      this.cachedPaths = new Set();
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
      this.logger.debug(`[TaskFilesService] Cache built with ${this.cachedPaths.size} files from combined pattern: ${combinedPattern}`);
    } catch (err) {
      this.logger.error(`[TaskFilesService] Error building cache: ${err}`);
      this.cachedPaths = new Set();
      this.cacheInvalidated = false;
    }
  }

  public invalidateCache(): void {
    this.cachedPaths = null;
    this.cacheInvalidated = true;
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
        if (this.shouldIgnore(uri) || this.isIgnoredByLoadedRules(uri)) {
          continue;
        }
        if (this.context && await this.isIgnoredByDiskRules(uri)) {
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
      files = await vscode.workspace.findFiles('**/.tasksignore', '**/node_modules/**,**/.git/**');
    } catch {
      return;
    }

    const folders = new Set(files.map((f) => this.normalizePathForComparison(path.dirname(f.fsPath))));
    this.ignoreFiles = this.ignoreFiles.filter((f) => folders.has(this.normalizePathForComparison(f.folderUri.fsPath)));

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

  private async isIgnoredByDiskRules(uri: vscode.Uri): Promise<boolean> {
    if (uri.scheme !== 'file') {
      return false;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const workspaceRoot = workspaceFolder
      ? this.normalizePathForComparison(workspaceFolder.uri.fsPath)
      : undefined;

    let currentDir = path.dirname(uri.fsPath);
    const targetPath = this.normalizePathForComparison(uri.fsPath);

    while (true) {
      const currentNormalized = this.normalizePathForComparison(currentDir);

      const ignoreFile = vscode.Uri.file(path.join(currentDir, '.tasksignore'));
      try {
        const bytes = await vscode.workspace.fs.readFile(ignoreFile);
        const content = new TextDecoder().decode(bytes);
        const rules = content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

        if (rules.length > 0) {
          const ig = ignore();
          ig.add(rules);
          if (targetPath.startsWith(`${currentNormalized}${path.sep}`)) {
            const rel = targetPath.slice(currentNormalized.length + 1).replace(/\\/g, '/');
            if (rel && ig.ignores(rel)) {
              return true;
            }
          }
        }
      } catch {
        // Ignore file not present/readable at this level
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }

      if (workspaceRoot && !currentNormalized.startsWith(workspaceRoot)) {
        break;
      }

      currentDir = parentDir;
    }

    return false;
  }

  private normalizePathForComparison(inputPath: string): string {
    let normalized = path.normalize(inputPath);
    // Normalize Windows long-path prefixes (e.g. "\\?\D:\\repo\\file")
    normalized = normalized.replace(/^\\\\\?\\/, '');
    normalized = normalized.replace(/^\/\/\?\//, '');
    // VS Code URIs on Windows can sometimes yield paths like "\\d:\\repo\\file"
    // while other APIs return "d:\\repo\\file". Normalize both to the same shape.
    normalized = normalized.replace(/^[/\\]+(?=[a-zA-Z]:[/\\])/, '');
    return normalized.toLowerCase();
  }

  private isIgnoredByLoadedRules(uri: vscode.Uri): boolean {
    const targetPath = this.normalizePathForComparison(uri.fsPath);

    for (const ignoreFile of this.ignoreFiles) {
      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
      if (targetPath === ignoreFolder || !targetPath.startsWith(`${ignoreFolder}${path.sep}`)) {
        continue;
      }

      const relativePath = targetPath.slice(ignoreFolder.length + 1).replace(/\\/g, '/');
      if (!relativePath) {
        continue;
      }

      if (ignoreFile.ig.ignores(relativePath)) {
        return true;
      }
    }

    return false;
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
    } catch (e) {
      this.logger.error('[TaskFilesService] Failed to read workspaceTasks.exclude', e);
    }

    // Find all .tasksignore files in the workspace
    const files = await vscode.workspace.findFiles('**/.tasksignore', '**/node_modules/**,**/.git/**');
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
        await this.initialize(this.context!);
        isInvalidated = true;
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

    context.subscriptions.push(
      vscode.workspace.onDidCreateFiles(() => this.invalidateCache()),
      vscode.workspace.onDidDeleteFiles(() => this.invalidateCache()),
      vscode.workspace.onDidRenameFiles(() => this.invalidateCache()),
    );

    this.invalidateCache();
  }

  private async loadIgnoreFile(uri: vscode.Uri) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      const rules = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

      if (rules.length > 0) {
        const ig = ignore();
        ig.add(rules);

        // Remove existing if any (reload)
        this.removeIgnoreFile(uri);

        this.ignoreFiles.push({
          folderUri: vscode.Uri.file(path.dirname(uri.fsPath)),
          ig: ig,
        });
        // Sort by path length descending so we check deepest nested ignore files first?
        // Actually we just want to find the one that applies.
        // Gitignore logic: check from file up to root.
      }
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

  public shouldIgnore(uri: vscode.Uri): boolean {
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

      if (uriPath === ignoreFolder) {
        return false;
      }

      return uriPath.startsWith(`${ignoreFolder}${path.sep}`);
    });

    // Sort by longest path (closest to file)
    applicableIgnores.sort((a, b) => b.folderUri.fsPath.length - a.folderUri.fsPath.length);

    for (const ignoreFile of applicableIgnores) {
      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
      const filePath = this.normalizePathForComparison(uri.fsPath);

      if (!filePath.startsWith(`${ignoreFolder}${path.sep}`)) {
        continue;
      }

      const relativePath = filePath.slice(ignoreFolder.length + 1);
      const normalizedPath = relativePath.replace(/\\/g, '/');

      // Check if ignored (skip empty paths)
      if (normalizedPath && ignoreFile.ig.ignores(normalizedPath)) {
        return true;
      }
    }

    return false;
  }
}
