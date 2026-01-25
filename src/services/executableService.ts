import * as vscode from 'vscode';
import * as path from 'path';
import { configuration } from '../libs/configuration';

export interface ExecutableOptions {
  /**
   * The configuration key to lookup the executable path.
   * e.g. "workspaceTasks.just.path"
   */
  configKey?: string;
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
  args: string[];
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
    // Prefer a configured value but always fallback to the provided defaultValue if the configuration
    // is missing or empty. Using configuration.get with a default avoids returning undefined.
    let commandConfig = options.defaultValue;
    if (options.configKey) {
      const configured = configuration.get<string>(options.configKey, options.defaultValue);
      commandConfig = (configured ?? options.defaultValue).toString();
    }

    // If the resolved command is empty or whitespace, fall back to the default value
    if (!commandConfig || commandConfig.trim().length === 0) {
      commandConfig = options.defaultValue;
    }

    // Parse command and args
    // We only perform basic parsing splitting by spaces unless it is quoted.
    // If resolvedToAbsolutePath is true, we treat it as a single path unless it is clearly a command line string?
    // Actually, even if resolveToAbsolutePath is true, if the user provided "npx grunt", it won't be absolute.

    // helper to parse
    const { command, args } = this.parseCommandString(commandConfig);
    let finalCommand = command;

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
    if (options.resolveToAbsolutePath && !path.isAbsolute(finalCommand)) {
      finalCommand = path.join(workspaceRoot, finalCommand);
    }

    // Windows specific handling
    if (process.platform === 'win32' && options.windowsEnforceExtension !== false) {
      // Check if path ends with configName (case-insensitive)
      // And does not end with .exe
      // logic: if path ends with "just" -> "just.exe"
      const cmdLower = finalCommand.toLowerCase();
      const nameLower = options.configName.toLowerCase();

      const ext = options.windowsExecutableExtension ? options.windowsExecutableExtension.toLowerCase() : '.exe';

      if (cmdLower.endsWith(nameLower) && !cmdLower.endsWith(ext)) {
        finalCommand += ext;
      }
    }

    return { command: finalCommand, args, cwd };
  }

  public getVscodeCommand(command: string, extensionId: string): string | undefined {
    const extension = vscode.extensions.getExtension(extensionId);
    if (!extension) {
      return undefined;
    }
    return command;
  }

  private parseCommandString(initial: string): { command: string, args: string[] } {
      const args: string[] = [];
      let current = '';
      let inQuote = false;
      let quoteChar = '';

      for (let i = 0; i < initial.length; i++) {
          const char = initial[i];
          if (inQuote) {
              if (char === quoteChar) {
                  inQuote = false;
              } else {
                  current += char;
              }
          } else {
              if (char === '"' || char === "'") {
                  inQuote = true;
                  quoteChar = char;
              } else if (char === ' ') {
                  if (current.length > 0) {
                      args.push(current);
                      current = '';
                  }
              } else {
                  current += char;
              }
          }
      }
      if (current.length > 0) {
          args.push(current);
      }

      if (args.length === 0) return { command: '', args: [] };
      return { command: args[0], args: args.slice(1) };
  }
}
