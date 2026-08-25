import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import * as path from 'path';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class ComposerTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('composer', constants.GLOB_COMPOSER);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const files = await this.getMatchingFiles();
    const iconService = TaskIconService.getInstance();

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'composer.json'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);

        const json = JSON.parse(content);
        if (json.scripts) {
          for (const script of Object.keys(json.scripts)) {
            const item = new TaskItem(
              script,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              file,
              undefined,
              iconPath,
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
              arguments: [file, item.startLine || 0],
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`[ComposerTaskProvider] Error parsing composer.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    // Composer does not have system-wide tasks, so return an empty array
    return [];
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.composer',
        defaultValue: 'composer',
        configName: 'composer',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.bat',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: composerCmd, args: composerInitialArgs, cwd: composerCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const composerArgs = composerInitialArgs ? [...composerInitialArgs] : [];
    composerArgs.push('run-script', taskLabel);
    const extraArgs = splitArgs(args);
    if (extraArgs.length > 0) {
      composerArgs.push('--', ...extraArgs);
    }

    const full = `${composerCmd} ${composerArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(composerCmd, composerArgs, { cwd: composerCwd });
    const task = new vscode.Task(
      { type: 'composer', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'composer',
      shellExec,
    );
    return { task, command: full, cwd: composerCwd, native: false };
  }
}
