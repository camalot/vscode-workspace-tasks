import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';

export class GruntTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('grunt', constants.GLOB_GRUNT);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      configKey: 'applicationPath.grunt',
      defaultValue: 'npx grunt',
      configName: 'grunt',
      resolveToAbsolutePath: false,
      windowsExecutableExtension: undefined,
      windowsEnforceExtension: false
    }, workspaceUri);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();

    const files = await filesService.findFiles([constants.GLOB_GRUNT]);

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const lines = content.split('\n');

        const iconUri = iconService.getTaskTypeIcon('grunt', file);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];


          // Look for grunt.registerTask('name'...) or grunt.registerMultiTask('name'...)
          const match = line.match(/grunt\.register(?:Task|MultiTask)\(\s*['"`]([\w\-:\.]+)['"`]/);
          if (match) {
            const taskName = match[1];

            const item = new TaskItem(
              taskName,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );

            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.command = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i]
            };

            tasks.push(item);
          }
        }

      } catch (e) {
        console.error(`Error parsing Gruntfile: ${file.fsPath}`, e);
      }
    }

    return tasks;
  }
}
