import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import ignore from 'ignore';
import { LoggerService } from './loggerService';

interface IgnoreFile {
  folderUri: vscode.Uri;
  ig: any; // ignore instance
}

export class TaskFilesService {
  private static instance: TaskFilesService;
  private globalIgnore: any;
  private ignoreFiles: IgnoreFile[] = [];
  private configWatcher?: vscode.Disposable;
  private fileWatcher?: vscode.Disposable;
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();

  private constructor() {
    this.globalIgnore = ignore();
  }

  public static getInstance(): TaskFilesService {
    if (!TaskFilesService.instance) {
      TaskFilesService.instance = new TaskFilesService();
    }
    return TaskFilesService.instance;
  }

  public async findFiles(pattern: string[], exclude?: string[]): Promise<vscode.Uri[]> {
    // use vscode.workspace.findFiles with the provided pattern and exclude, then filter using the ignore rules
    const uris = await vscode.workspace.findFiles(pattern.join(','), exclude ? exclude.join(',') : undefined);
    const depthFiltered = this.filterByDepth(uris);
    const filtered: vscode.Uri[] = [];
    for (const uri of depthFiltered) {
      if (this.shouldIgnore(uri)) {
        continue;
      }
      filtered.push(uri);
    }
    return filtered;
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
      if (e.affectsConfiguration('workspaceTasks.exclude')) {
        await this.initialize(this.context!);
      }
    });

    // Watch for .tasksignore changes
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/.tasksignore');
    watcher.onDidChange((uri) => this.loadIgnoreFile(uri));
    watcher.onDidCreate((uri) => this.loadIgnoreFile(uri));
    watcher.onDidDelete((uri) => this.removeIgnoreFile(uri));
    this.fileWatcher = watcher;
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

    const uriPathNormalized = this.normalizePathForComparison(uri.fsPath).split(path.sep).join('/');

    for (const ignoreFile of applicableIgnores) {
      const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath).split(path.sep).join('/');

      if (!uriPathNormalized.startsWith(`${ignoreFolder}/`)) {
        continue;
      }

      const relativePath = uriPathNormalized.slice(ignoreFolder.length + 1);

      // Check if ignored (skip empty paths)
      if (relativePath && ignoreFile.ig.ignores(relativePath)) {
        return true;
      }
    }

    return false;
  }


  // private isIgnoredByLoadedRules(uri: vscode.Uri): boolean {
  //   const targetPath = this.normalizePathForComparison(uri.fsPath);

  //   for (const ignoreFile of this.ignoreFiles) {
  //     const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
  //     if (targetPath === ignoreFolder || !targetPath.startsWith(`${ignoreFolder}${path.sep}`)) {
  //       continue;
  //     }

  //     const relativePath = targetPath.slice(ignoreFolder.length + 1).replace(/\\/g, '/');
  //     if (!relativePath) {
  //       continue;
  //     }

  //     if (ignoreFile.ig.ignores(relativePath)) {
  //       return true;
  //     }
  //   }

  //   return false;
  // }
}
