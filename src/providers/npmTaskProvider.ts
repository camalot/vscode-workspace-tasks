import * as vscode from 'vscode';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { PackageJsonTaskProvider } from './packageJsonTaskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { FilteredTaskService } from '../services/filteredTaskService';
import { TaskStateManager } from '../taskStateManager';

export class NpmTaskProvider extends PackageJsonTaskProvider {
  private readonly filesService = TaskFilesService.getInstance();
  private readonly iconService = TaskIconService.getInstance();
  private readonly filteredTaskService = FilteredTaskService.getInstance();

  constructor() {
    super('npm', constants.GLOB_NODEJS);
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const systemTasks = (await vscode.tasks.fetchTasks()).filter((t) => t.source === 'npm');
    this.logger.debug(`[NpmTaskProvider] Fetched ${systemTasks.length} system tasks.`);

    const documentsCache: Map<string, vscode.TextDocument> = new Map();
    const contentCache: Map<string, string> = new Map();
    const jsonCache: Map<string, any> = new Map();
    for (const task of systemTasks) {

      let label = task.name || 'Unnamed Task';
      let fileUri: vscode.Uri | undefined;
      const taskScope = task.scope as vscode.WorkspaceFolder;

      // npm tasks are often named "script - relative/path"
      if (label.includes(' - ')) {
        const lastIndex = label.lastIndexOf(' - ');
        const path = label.substring(lastIndex + 3);
        if (taskScope && taskScope.uri) {
          fileUri = vscode.Uri.joinPath(taskScope.uri, path, 'package.json');
          label = label.substring(0, lastIndex);
        }
      }

      if (!fileUri && taskScope && taskScope.uri) {
        fileUri = vscode.Uri.joinPath(taskScope.uri, 'package.json');
      }

      // Load and cache document content
      let document: vscode.TextDocument;
      if (fileUri) {
        const fileKey = fileUri.toString();
        if (documentsCache.has(fileKey)) {
          document = documentsCache.get(fileKey)!;
        } else {
          document = await vscode.workspace.openTextDocument(fileUri);
          documentsCache.set(fileKey, document);
        }

        if (!contentCache.has(fileKey)) {
          contentCache.set(fileKey, document.getText());
        }
        if (!jsonCache.has(fileKey)) {
          try {
            jsonCache.set(fileKey, JSON.parse(contentCache.get(fileKey)!));
          } catch (e) {
            jsonCache.set(fileKey, null);
          }
        }
      }

      const content = fileUri ? contentCache.get(fileUri.toString())! : undefined;
      const json = fileUri ? jsonCache.get(fileUri.toString()) : null;


      const item = new TaskItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        fileUri,
      );
      item.metadata = { systemTaskName: task.name };
      item.description = fileUri ? vscode.workspace.asRelativePath(fileUri) : task.source;

      if (fileUri) {
        item.taskFileUri = fileUri;
      }

      if (content && json && json.scripts && json.scripts[label]) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`"${label}"`)) {
            item.startLine = i;
            break;
          }
        }
      } else {
        // Could not verify script exists in package.json, skip
        item.startLine = 0;
      }

      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, item.startLine || 0],
      };

      const id = TaskStateManager.getInstance().getTaskId(item);
      if (this.addedTasks.has(id)) {
        continue;
      }

      const iconPath = this.iconService.getTaskIcon(this.type);
      item.task = task;
      item.defaultIconPath = iconPath;
      tasks.push(item);
      this.addedTasks.add(id);
    }

    return tasks;
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'npm',
        configName: 'npm',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }
}

export class PnpmTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('pnpm', constants.GLOB_NODEJS);
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'pnpm',
        configName: 'pnpm',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }
}

export class YarnTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('yarn', constants.GLOB_NODEJS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'yarn',
        configName: 'yarn',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }
}
