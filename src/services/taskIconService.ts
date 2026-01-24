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

  constructor() {

  }

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

  public getTaskTypeIcon(type: string, fallback?: vscode.Uri): TaskIconUri | undefined {
    if (!this.context) {
      return {
        TaskIcon: undefined,
        DisplayUri: fallback || undefined
      };
    }
    let iconUri: TaskIcon | vscode.Uri | undefined = {
      light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', `${type}.svg`)),
      dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', `${type}.svg`))
    };

    if (!fs.existsSync(iconUri.light.fsPath) || !fs.existsSync(iconUri.dark.fsPath)) {
      iconUri = undefined;
    }

    return {
      TaskIcon: iconUri as TaskIcon | undefined,
      DisplayUri: fallback || undefined
    };

  }
}
