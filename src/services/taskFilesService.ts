import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import ignore from 'ignore';

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
    return uris.filter(uri => !this.shouldIgnore(uri));
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.globalIgnore = ignore();
    this.ignoreFiles = [];

    // Add patterns from extension configuration (workspaceTasks.exclude)
    try {
      const config = vscode.workspace.getConfiguration('workspaceTasks');
      const excludes = config.get<string[]>('exclude', []);
      this.globalIgnore.add("**/node_modules/**"); // Always ignore node_modules
      this.globalIgnore.add("**/.git/**"); // Always ignore .git
      this.globalIgnore.add("**/__pycache__/**"); // Always ignore __pycache__
      if (Array.isArray(excludes) && excludes.length > 0) {
        this.globalIgnore.add(excludes);
      }
    } catch (e) {
      console.error('Failed to read workspaceTasks.exclude', e);
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
    watcher.onDidChange(uri => this.loadIgnoreFile(uri));
    watcher.onDidCreate(uri => this.loadIgnoreFile(uri));
    watcher.onDidDelete(uri => this.removeIgnoreFile(uri));
    this.fileWatcher = watcher;
  }

  private async loadIgnoreFile(uri: vscode.Uri) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      const rules = content.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

      if (rules.length > 0) {
        const ig = ignore();
        ig.add(rules);

        // Remove existing if any (reload)
        this.removeIgnoreFile(uri);

        this.ignoreFiles.push({
          folderUri: vscode.Uri.file(path.dirname(uri.fsPath)),
          ig: ig
        });
        // Sort by path length descending so we check deepest nested ignore files first?
        // Actually we just want to find the one that applies.
        // Gitignore logic: check from file up to root.
      }
    } catch (e) {
      console.error(`Failed to load .tasksignore at ${uri.fsPath}`, e);
    }
  }

  private removeIgnoreFile(uri: vscode.Uri) {
    const folderPath = path.dirname(uri.fsPath);
    this.ignoreFiles = this.ignoreFiles.filter(f => f.folderUri.fsPath !== folderPath);
  }

  public shouldIgnore(uri: vscode.Uri): boolean {
    // 1. Check Global Ignore (absolute/workspace relative check)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) { return false; } // Should we ignore files outside workspace?

    const workspaceRelativePath = vscode.workspace.asRelativePath(uri, false);
    if (this.globalIgnore.ignores(workspaceRelativePath)) {
      return true;
    }

    // 2. Check closest .tasksignore
    // Find all ignore files that are parents of this uri
    const applicableIgnores = this.ignoreFiles.filter(ig => {
      const relative = path.relative(ig.folderUri.fsPath, uri.fsPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });

    // Sort by longest path (closest to file)
    applicableIgnores.sort((a, b) => b.folderUri.fsPath.length - a.folderUri.fsPath.length);

    for (const ignoreFile of applicableIgnores) {
      const relativePath = path.relative(ignoreFile.folderUri.fsPath, uri.fsPath);
      // relativePath is like "tools/ant/bin" if ignore file is at "vscode-project" and file is in "vscode-project/tools/ant/bin"
      // path.relative returns platform specific separators. ignore expects /
      const normalizedPath = relativePath.split(path.sep).join('/');
      if (ignoreFile.ig.ignores(normalizedPath)) {
        return true;
      }
    }

    return false;
  }
}
