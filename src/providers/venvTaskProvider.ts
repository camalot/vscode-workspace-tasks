import * as vscode from 'vscode';
import * as path from 'path';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';

export class VenvTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('venv', constants.GLOB_VENV);
  }
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_VENV]);

    for (const file of files) {
      const label = path.basename(file.fsPath);

      // Fake URI to force .py icon
      const iconUri = iconService.getTaskTypeIcon('python', file.with({ path: file.path + '.py' }));

      const item = new TaskItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        iconUri?.DisplayUri || file,
        undefined,
        iconUri?.TaskIcon || undefined
      );

      item.taskFileUri = file;
      item.description = vscode.workspace.asRelativePath(file);
      item.command = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [file, 0]
      };

      tasks.push(item);
    }
    return tasks;
  }
}
