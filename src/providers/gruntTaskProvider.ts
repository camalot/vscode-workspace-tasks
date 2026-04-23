import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as path from 'path';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class GruntTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('grunt', constants.GLOB_GRUNT);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.grunt',
        defaultValue: 'npx grunt',
        configName: 'grunt',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: undefined,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
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

        const iconPath = iconService.getTaskIcon('grunt');

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
              file,
              undefined,
              iconPath,
            );

            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i],
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`[GruntTaskProvider] Error parsing Gruntfile: ${file.fsPath}`, e);
      }
    }

    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = item.originalLabel || item.label;
    const { command: gruntCmd, args: gruntInitialArgs, cwd: gruntCwd } = this.getCommand(workspaceFolder?.uri);

    const gruntArgs: string[] = gruntInitialArgs ? [...gruntInitialArgs] : [];
    if (taskLabel && taskLabel.length > 0) {
      gruntArgs.push(taskLabel);
    }

    const dir = path.dirname(resourceUri.fsPath);
    const rel = path.relative(gruntCwd, dir);
    const fileName = path.basename(resourceUri.fsPath).toLowerCase();
    if ((rel.length > 0 && rel !== '.') || fileName !== 'gruntfile.js') {
      gruntArgs.push('--gruntfile', resourceUri.fsPath);
    }

    gruntArgs.push(...splitArgs(args));

    const task = new vscode.Task(
      { type: 'grunt', target: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'grunt',
      new vscode.ShellExecution(gruntCmd, gruntArgs, { cwd: gruntCwd }),
    );
    return { task, command: `${gruntCmd} ${gruntArgs.join(' ')}`.trim(), cwd: gruntCwd, native: false };
  }
}
