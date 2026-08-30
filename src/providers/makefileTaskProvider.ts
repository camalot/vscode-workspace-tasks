import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as path from 'path';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class MakefileTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('makefile', constants.GLOB_MAKE);
  }
  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.make',
        defaultValue: 'make',
        configName: 'make',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const iconService = TaskIconService.getInstance();

    const files = await this.getMatchingFiles();

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const lines = content.split('\n');

        const iconPath = iconService.getTaskIcon('makefile');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Basic Makefile target parsing
          const match = line.match(/^([a-zA-Z0-9_\-\.]+):/);
          if (match) {
            const target = match[1];
            if (target === '.PHONY') {
              continue;
            }

            const item = new TaskItem(
              target,
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
        this.logger.error(`[MakefileTaskProvider] Error parsing Makefile: ${file.fsPath}`, e);
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
    const makeFileCwd = path.dirname(resourceUri.fsPath);
    const { command: makeCmd, args: makeInitialArgs } = this.getCommand(workspaceFolder?.uri);

    const makeArgs = makeInitialArgs ? [...makeInitialArgs] : [];
    makeArgs.push(taskLabel, ...splitArgs(args));

    const full = `${makeCmd} ${makeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(makeCmd, makeArgs, { cwd: makeFileCwd });
    const task = new vscode.Task(
      { type: 'process', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'makefile',
      shellExec,
    );
    return { task, command: full, cwd: makeFileCwd, native: false };
  }
}
