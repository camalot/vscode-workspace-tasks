import * as vscode from 'vscode';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { PackageJsonTaskProvider } from './packageJsonTaskProvider';

export class NpmTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('npm', constants.GLOB_NODEJS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      defaultValue: 'npm',
      configName: 'npm',
      resolveToAbsolutePath: false,
      windowsEnforceExtension: false
    }, workspaceUri);
  }
}

export class PnpmTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('pnpm', constants.GLOB_NODEJS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      defaultValue: 'pnpm',
      configName: 'pnpm',
      resolveToAbsolutePath: false,
      windowsEnforceExtension: false
    }, workspaceUri);
  }
}

export class YarnTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('yarn', constants.GLOB_NODEJS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      defaultValue: 'yarn',
      configName: 'yarn',
      resolveToAbsolutePath: false,
      windowsEnforceExtension: false
    }, workspaceUri);
  }
}
