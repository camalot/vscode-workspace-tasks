import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';

export class MiseTaskProvider extends TomlTaskProvider {
  constructor() {
    super('mise', constants.GLOB_MISE);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_MISE];
  }

  protected getScriptsPath(): string[] {
    // can be tasks or tasks.*. this should probably be changed to return an array.
    return ['tasks.*'];
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
        defaultValue: 'mise',
        configName: 'mise',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }
}
