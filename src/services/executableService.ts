import * as vscode from 'vscode';
import * as path from 'path';

export interface ExecutableOptions {
  /**
   * The configuration key to lookup the executable path.
   * e.g. "workspaceTasks.just.path"
   */
  configKey: string;
  /**
   * The default value if configuration is missing.
   * e.g. "just"
   */
  defaultValue: string;
  /**
   * The expected base name of the command to check for extension on Windows.
   * e.g. "just"
   */
  configName: string;
  /**
   * If true, relative paths will be resolved to absolute paths against the workspace folder.
   * Default is false.
   */
  resolveToAbsolutePath?: boolean;

  windowsExecutableExtension?: string;
  windowsEnforceExtension?: boolean;
}

export interface ExecutableResult {
  command: string;
  cwd: string;
}

export class ExecutableService {
  private static instance: ExecutableService;

  private constructor() { }

  public static getInstance(): ExecutableService {
    if (!ExecutableService.instance) {
      ExecutableService.instance = new ExecutableService();
    }
    return ExecutableService.instance;
  }

  /**
   * Resolves the executable command and working directory based on configuration and platform.
   * @param options The options for resolution.
   * @param resourceUri The resource URI to determine the workspace folder.
   */
  public getCommand(options: ExecutableOptions, resourceUri?: vscode.Uri): ExecutableResult {
    const config = vscode.workspace.getConfiguration();
    let command = config.get<string>(options.configKey) || options.defaultValue;

    // Determine workspace folder
    let workspaceFolder: vscode.WorkspaceFolder | undefined;
    if (resourceUri) {
      workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
    }
    if (!workspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceFolder = vscode.workspace.workspaceFolders[0];
    }

    const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
    let cwd = workspaceRoot;

    // Handle relative path resolution if requested
    if (options.resolveToAbsolutePath && !path.isAbsolute(command)) {
      command = path.join(workspaceRoot, command);
    }

    // Windows specific handling
    if (process.platform === 'win32' && options.windowsEnforceExtension !== false) {
      // Check if path ends with configName (case-insensitive)
      // And does not end with .exe
      // logic: if path ends with "just" -> "just.exe"
      const cmdLower = command.toLowerCase();
      const nameLower = options.configName.toLowerCase();

      const ext = options.windowsExecutableExtension ? options.windowsExecutableExtension.toLowerCase() : '.exe';

      if (cmdLower.endsWith(nameLower) && !cmdLower.endsWith(ext)) {
        command += ext;
      }
    }

    return { command, cwd };
  }
}
