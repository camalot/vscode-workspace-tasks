import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';

export class PipenvTaskProvider extends TomlTaskProvider {
  constructor() {
    super('pipenv', constants.GLOB_PIPENV);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_PIPENV];
  }

  protected getScriptsPath(): string {
    return 'scripts';
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
}
