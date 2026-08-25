import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

/**
 * Provides tasks discovered from Cake build script files (`*.cake`).
 *
 * Cake is a cross-platform build automation tool using a C# DSL. Tasks are
 * declared in `.cake` files using `Task("TaskName")` syntax.
 *
 * The extension scans every `*.cake` file in the workspace and extracts
 * any top-level `Task("...")` declarations. Each discovered task can be run
 * via `dotnet cake <scriptFile> --target=<TaskName>`.
 *
 * Cake must be installed as a .NET tool (`dotnet tool install Cake.Tool`).
 * No application path configuration is required since Cake is expected to
 * be installed via the .NET package manager.
 */
export class CakeTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('cake', constants.GLOB_CAKE);
  }

  /**
   * Returns the command used to invoke Cake scripts.
   * Cake is run via `dotnet cake` with no configurable executable path.
   * @param workspaceUri Optional workspace URI for determining the working directory.
   */
  public getCommand(workspaceUri?: vscode.Uri): { command: string; args: string[]; cwd: string } {
    const cwd =
      workspaceUri?.fsPath ??
      (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : process.cwd());
    return {
      command: 'dotnet',
      args: ['cake'],
      cwd,
    };
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

        const iconPath = iconService.getTaskIcon('cake');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match Task("TaskName") or Task('TaskName') at the start of a line (possibly with leading whitespace)
          const match = line.match(/^\s*Task\s*\(\s*["']([^"']+)["']\s*\)/);
          if (match) {
            const taskName = match[1];

            const item = new TaskItem(
              taskName,
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
        this.logger.error(`[CakeTaskProvider] Error parsing Cake script: ${file.fsPath}`, e);
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
    const { command: cakeCmd, args: cakeInitialArgs, cwd: cakeCwd } = this.getCommand(workspaceFolder?.uri);

    const cakeArgs = cakeInitialArgs ? [...cakeInitialArgs] : [];
    cakeArgs.push(resourceUri.fsPath, `--target=${taskLabel}`, ...splitArgs(args));

    const full = `${cakeCmd} ${cakeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(cakeCmd, cakeArgs, { cwd: cakeCwd });
    const task = new vscode.Task(
      { type: 'cake', target: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'cake',
      shellExec,
    );
    return { task, command: full, cwd: cakeCwd, native: false };
  }
}
