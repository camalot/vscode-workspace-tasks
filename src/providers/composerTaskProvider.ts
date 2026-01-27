import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import * as path from 'path';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';

export class ComposerTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('composer', constants.GLOB_COMPOSER);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const filesService = TaskFilesService.getInstance();
    const tasks: TaskItem[] = [];
    const files = await filesService.findFiles(
      [constants.GLOB_COMPOSER]
    );
    const iconService = TaskIconService.getInstance();

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ""), 'composer.json'));
        const iconPath = iconService.getTaskTypeIcon(this.type, fallback);

        const json = JSON.parse(content);
        if (json.scripts) {
          for (const script of Object.keys(json.scripts)) {
            const item = new TaskItem(
              script,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconPath?.DisplayUri || file,
              undefined,
              iconPath?.TaskIcon || undefined
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

            item.onSingleClickCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0]
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        console.error(`Error parsing composer.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      configKey: 'applicationPath.composer',
      defaultValue: 'composer',
      configName: 'composer',
      resolveToAbsolutePath: false,
      windowsExecutableExtension: '.bat',
      windowsEnforceExtension: true
    }, workspaceUri);
  }
}
