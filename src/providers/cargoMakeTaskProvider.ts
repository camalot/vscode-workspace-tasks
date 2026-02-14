import * as vscode from 'vscode';
import { TomlTaskProvider } from './tomlTaskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { TaskConfigService } from '../services/taskConfigService';

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
}
