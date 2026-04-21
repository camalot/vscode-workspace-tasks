import * as vscode from 'vscode';
import { TomlTaskProvider } from './tomlTaskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { TaskConfigService } from '../services/taskConfigService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class CargoMakeTaskProvider extends TomlTaskProvider {
  constructor() {
    super('cargo-make', constants.GLOB_CARGO_MAKE);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_CARGO_MAKE];
  }

  protected getScriptsPath(): string[] {
    return ['tasks'];
  }

  get enabled(): boolean {
    // cargo make depends on cargo being enabled as well
    const configService = TaskConfigService.getInstance();
    return configService.isTaskTypeEnabled(this.type) && configService.isTaskTypeEnabled("cargo");
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();

    const cargoCommand = execService.getCommand(
      {
        configKey: 'applicationPath.cargo',
        defaultValue: 'cargo',
        configName: 'cargo',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );

    return {
      command: `${cargoCommand.command}`,
      args: [
        'make'
      ],
      cwd: cargoCommand.cwd,
    };
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const relativeResourceUri = vscode.workspace.asRelativePath(resourceUri, false);
    const { command: cargoMakeCmd, args: cargoMakeInitialArgs, cwd: cargoMakeCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const cargoMakeArgs = cargoMakeInitialArgs ? [...cargoMakeInitialArgs] : [];
    cargoMakeArgs.push('--makefile', relativeResourceUri, taskLabel, ...splitArgs(args));

    const full = `${cargoMakeCmd} ${cargoMakeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(cargoMakeCmd, cargoMakeArgs, { cwd: cargoMakeCwd });
    const task = new vscode.Task(
      { type: 'cargo-make', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'cargo-make',
      shellExec,
    );
    return { task, command: full, cwd: cargoMakeCwd, native: false };
  }
}
