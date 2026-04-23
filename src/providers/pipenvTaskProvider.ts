import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class PipenvTaskProvider extends TomlTaskProvider {
  constructor() {
    super('pipenv', constants.GLOB_PIPENV);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_PIPENV];
  }

  protected getScriptsPath(): string[] {
    return ['scripts'];
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
        configKey: 'applicationPath.pipenv',
        defaultValue: 'pipenv',
        configName: 'pipenv',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: pipenvCmd, args: pipenvInitialArgs, cwd: pipenvCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const pipenvArgs = pipenvInitialArgs ? [...pipenvInitialArgs] : [];
    pipenvArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${pipenvCmd} ${pipenvArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(pipenvCmd, pipenvArgs, { cwd: pipenvCwd });
    const task = new vscode.Task(
      { type: 'pipenv', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'pipenv',
      shellExec,
    );
    return { task, command: full, cwd: pipenvCwd, native: false };
  }
}
