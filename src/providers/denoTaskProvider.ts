import * as vscode from 'vscode';
import constants from '../libs/constants';
import { ExecutableResult, ExecutableService } from '../services/executableService';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { BaseTaskProvider } from '../taskProvider';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class DenoTaskProvider extends BaseTaskProvider {
  constructor() {
    super('deno', constants.GLOB_DENO);
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    // const packageJsonTasks = await super.getTasks();

    // deno format:
    /*
      {
        "tasks": {
          "cool": "echo 'This is a cool task!'",
          "build": "deno build --allow-net mod.ts",
          "test": "deno test --allow-net tests/",
          "start": "deno run --allow-net mod.ts"
        }
      }
    */
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_DENO]);
    const iconService = TaskIconService.getInstance();

    for (const file of files) {
      if (filesService.shouldIgnore(file)) {
        continue;
      }
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const iconPath = iconService.getTaskIcon(this.type);

        // Simple parsing for now
        const json = JSON.parse(content);
        if (json.tasks) {
          for (const script of Object.keys(json.tasks)) {
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
        this.logger.warn(`[DenoTaskProvider] Error parsing Deno configuration file (deno.json/deno.jsonc): ${file.fsPath}`, e);
      }
    }

    // ...packageJsonTasks,
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const executableService = ExecutableService.getInstance();
    return executableService.getCommand(
      {
        defaultValue: 'deno',
        configName: 'deno',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: denoCmd, args: denoInitialArgs, cwd: denoCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const denoArgs = denoInitialArgs ? [...denoInitialArgs] : [];
    denoArgs.push('task');
    denoArgs.push(...splitArgs(args));
    if (item.taskFileUri) {
      denoArgs.push('--config', item.taskFileUri.fsPath);
    }
    denoArgs.push(taskLabel);

    const full = `${denoCmd} ${denoArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(denoCmd, denoArgs, { cwd: denoCwd });
    const task = new vscode.Task(
      { type: 'deno', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'deno',
      shellExec,
    );
    return { task, command: full, cwd: denoCwd, native: false };
  }
}
