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
    // Accept both legacy comma-delimited constant values and explicit glob arrays.
    // cargo-make can use arbitrary *.toml files as task definitions.
    const patterns = constants.GLOB_CARGO_MAKE
      .split(',')
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 0);

    if (!patterns.includes('**/*.toml')) {
      patterns.push('**/*.toml');
    }

    return patterns.length > 0 ? patterns : ['**/*.toml'];
  }

  protected getScriptsPath(): string[] {
    return ['tasks'];
  }

  protected override findScriptLine(content: string, taskName: string): number {
    const lines = content.split('\n');
    const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*\\[tasks\\.(?:"${escaped}"|'${escaped}'|${escaped})\\]`, 'i');

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return i;
      }
    }

    return 0;
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
