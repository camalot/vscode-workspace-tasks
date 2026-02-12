import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { TaskStateManager } from '../taskStateManager';

export class GolangTaskProvider extends BaseTaskProvider implements TaskProvider {
  private readonly iconService = TaskIconService.getInstance();
  private readonly addedTasks: Set<string> = new Set<string>();

  constructor() {
    super('go', constants.GLOB_GO);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const filesService = TaskFilesService.getInstance();
    const goFiles = await filesService.findFiles([this.filePattern || constants.GLOB_GO]);

    if (!goFiles || goFiles.length === 0) {
      // No go.mod files, nothing to provide
      return [];
    }

    this.addedTasks.clear();

    return this.getSystemTasks();
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const systemTasks = (await vscode.tasks.fetchTasks()).filter((t) => t.source === 'go');
    this.logger.debug(`[GolangTaskProvider] Fetched ${systemTasks.length} system tasks.`);

    for (const task of systemTasks) {
      const label = task.name || 'Unnamed Task';
      let fileUri: vscode.Uri | undefined;
      const taskScope = task.scope as vscode.WorkspaceFolder;

      // if scope is a workspace folder, associate go.mod from that folder
      if (taskScope && taskScope.uri) {
        fileUri = vscode.Uri.joinPath(taskScope.uri, 'go.mod');
      }

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

      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, 0],
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
}
