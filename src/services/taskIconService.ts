import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface TaskIcon {
  light: vscode.Uri;
  dark: vscode.Uri;
}

export interface TaskIconUri {
  TaskIcon?: TaskIcon;
  DisplayUri?: vscode.Uri;
}

// gets an icon for a task based on its type, e.g., "gulp", "ant", "script"
// if the context is available, it will use the extension's icon resources if possible
// otherwise it will return undefined
export class TaskIconService {
  private static instance: TaskIconService;
  private context?: vscode.ExtensionContext;

  constructor() {}

  public static getInstance(): TaskIconService {
    if (!TaskIconService.instance) {
      TaskIconService.instance = new TaskIconService();
    }
    return TaskIconService.instance;
  }

  public initialize(context: vscode.ExtensionContext): TaskIconService {
    this.context = context;
    return this;
  }

  private mapLookup(type: string, map: { [key: string]: string }): string {
    // create generic map and merge with provided map
    const genericMap: { [key: string]: string } = {
      'npm': 'npm',
      'node': 'npm',
      'nodejs': 'npm',
      'yarn': 'npm',
      'dockerfile': 'docker',
      'docker-compose': 'docker'
    };
    const combinedMap = { ...genericMap, ...map };
    return combinedMap[type.toLowerCase()] || type;
  }

  public getTaskTypeIcon(type: string, fallback?: vscode.Uri): TaskIconUri | undefined {
    if (!this.context) {
      return {
        TaskIcon: undefined,
        DisplayUri: fallback || undefined,
      };
    }
    const mappedType = this.mapLookup(type, {});
    let iconUri: TaskIcon | vscode.Uri | undefined = {
      light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', `${mappedType}.svg`)),
      dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', `${mappedType}.svg`)),
    };

    if (!fs.existsSync(iconUri.light.fsPath) || !fs.existsSync(iconUri.dark.fsPath)) {
      iconUri = undefined;
    }

    return {
      TaskIcon: iconUri as TaskIcon | undefined,
      DisplayUri: fallback || undefined,
    };
  }

  public getTaskIcon(
    type: string,
    fallback?: vscode.Uri,
  ): string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const iconType = config.get<string>('task.iconType', 'type');

    if (iconType === 'gear') {
      return new vscode.ThemeIcon('settings-gear');
    } else if (iconType === 'run') {
      return new vscode.ThemeIcon('play');
    } else if (iconType === 'file') {
      // return vscode.ThemeIcon.File;
      return undefined;
    } else if (iconType === 'custom') {
      const customPath = config.get<string>('task.iconTypeCustom', '');
      if (customPath) {
        // if customPath matches /\$\([a-zA-Z0-9_-]+\)/, treat it as a ThemeIcon
        const themeIconMatch = customPath.match(/^\$\(([a-zA-Z0-9_-]+)\)$/);
        if (themeIconMatch) {
          const iconName = themeIconMatch[1];
          return new vscode.ThemeIcon(iconName);
        }
        // Try to resolve path
        // Check if absolute
        let uri: vscode.Uri | undefined;
        if (path.isAbsolute(customPath)) {
          uri = vscode.Uri.file(customPath);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
          // Resolve relative to first workspace folder (simplification)
          uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, customPath);
        }

        if (uri && fs.existsSync(uri.fsPath)) {
          return uri;
        }
      }
      // Fallback to type if custom fails
    }

    // Default 'type' behavior
    const typeIcon = this.getTaskTypeIcon(type, fallback);
    return typeIcon?.TaskIcon;
  }
}
