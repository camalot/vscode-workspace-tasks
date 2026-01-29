import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableResult } from '../services/executableService';

export abstract class PackageJsonTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor(type: string, globPattern: string) {
    super(type, globPattern);
  }

  public abstract getCommand(workspaceUri?: vscode.Uri): ExecutableResult;

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_NODEJS]);

    for (const file of files) {
      if (filesService.shouldIgnore(file)) { continue; }

      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const iconUri = iconService.getTaskTypeIcon(this.type, file);

        // Simple parsing for now
        const json = JSON.parse(content);
        if (json.scripts) {
          for (const script of Object.keys(json.scripts)) {
            const item = new TaskItem(
              script,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);

            // Find line number
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`"${script}"`)) {
                item.startLine = i;
                break;
              }
            }

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0]
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        console.error(`Error parsing package.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }
}
