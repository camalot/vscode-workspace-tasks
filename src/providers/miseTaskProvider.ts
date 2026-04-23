import * as path from 'path';
import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class MiseTaskProvider extends TomlTaskProvider {
  constructor() {
    super('mise', constants.GLOB_MISE);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_MISE];
  }

  protected getScriptsPath(): string[] {
    return ['tasks'];
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

  /**
   * Computes the mise config_root directory from a discovered config file URI.
   *
   * The config_root is the directory from which `mise run` must be invoked so
   * that mise resolves the correct config file. Each supported file pattern sits
   * at a different depth relative to the config_root:
   *
   *   mise.toml / .mise.toml / mise.*.toml     → config_root = dirname(file)
   *   mise/config.toml                          → config_root = dirname(dirname(file))
   *   .mise/config.toml                         → config_root = dirname(dirname(file))
   *   .config/mise.toml                         → config_root = dirname(dirname(file))
   *   .config/mise/config.toml                  → config_root = dirname(dirname(dirname(file)))
   *   .config/mise/conf.d/<name>.toml           → config_root = dirname × 4
   */
  public static getConfigRoot(fileUri: vscode.Uri): string {
    const filePath = fileUri.fsPath;
    const fileName = path.basename(filePath);
    const fileDir = path.dirname(filePath);
    const parentName = path.basename(fileDir);
    const grandParentDir = path.dirname(fileDir);
    const grandParentName = path.basename(grandParentDir);
    const greatGrandParentDir = path.dirname(grandParentDir);
    const greatGrandParentName = path.basename(greatGrandParentDir);

    // .config/mise/conf.d/<name>.toml
    if (parentName === 'conf.d' && grandParentName === 'mise' && greatGrandParentName === '.config') {
      return path.dirname(greatGrandParentDir);
    }

    // .config/mise/config.toml
    if (parentName === 'mise' && grandParentName === '.config') {
      return path.dirname(grandParentDir);
    }

    // mise/config.toml  or  .mise/config.toml
    if ((parentName === 'mise' || parentName === '.mise') && fileName === 'config.toml') {
      return grandParentDir;
    }

    // .config/mise.toml
    if (parentName === '.config' && fileName === 'mise.toml') {
      return grandParentDir;
    }

    // mise.toml, .mise.toml, mise.local.toml, mise.*.toml, mise.*.local.toml, etc.
    return fileDir;
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: miseCmd, args: miseInitialArgs, cwd: miseDefaultCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const miseCwd = item.taskFileUri
      ? MiseTaskProvider.getConfigRoot(item.taskFileUri)
      : miseDefaultCwd;
    const miseArgs = miseInitialArgs ? [...miseInitialArgs] : [];
    miseArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${miseCmd} ${miseArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(miseCmd, miseArgs, { cwd: miseCwd });
    const task = new vscode.Task(
      { type: 'mise', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'mise',
      shellExec,
    );
    return { task, command: full, cwd: miseCwd, native: false };
  }
}
