import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { parse } from 'smol-toml';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class PoeTaskProvider extends TomlTaskProvider {
  constructor() {
    super('poe', constants.GLOB_POE);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_POE];
  }

  protected getScriptsPath(): string[] {
    return ['tool.poe.tasks', 'tool.poe.tasks.*'];
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles(this.getGlobPatterns());

    for (const file of files) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const textContent = new TextDecoder().decode(content);
        let tomlObj: any;

        try {
          tomlObj = parse(textContent);
        } catch (e) {
          this.logger.warn(`[PoeTaskProvider] Error parsing TOML file ${file.fsPath}:`, e);
          continue;
        }

        // Check [tool.poe.tasks] section
        const poeTasks = tomlObj?.tool?.poe?.tasks;

        if (!poeTasks || typeof poeTasks !== 'object') {
          continue;
        }

        const iconPath = iconService.getTaskIcon(this.type);

        for (const [name, taskDef] of Object.entries(poeTasks)) {
          // Skip private tasks (starting with underscore)
          if (name.startsWith('_')) {
            continue;
          }

          const taskDescription = this.getTaskDescription(taskDef);

          const item = new TaskItem(name, vscode.TreeItemCollapsibleState.None, this.type, file, undefined, iconPath);

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = `${name}: ${taskDescription}`;

          // Find the line number in the file
          item.startLine = this.findTaskLineInContent(textContent, name);

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, item.startLine || 0],
          };

          tasks.push(item);
        }
      } catch (err) {
        this.logger.warn(`[PoeTaskProvider] Error processing file ${file.fsPath}:`, err);
      }
    }
    return tasks;
  }

  /**
   * Gets a human-readable description of the task based on its definition
   * @param taskDef The task definition which can be a string, array, or object
   * @returns A description string
   */
  private getTaskDescription(taskDef: any): string {
    if (typeof taskDef === 'string') {
      // Simple command task
      return taskDef;
    } else if (Array.isArray(taskDef)) {
      // Sequence task (array of task references)
      return `sequence: [${taskDef.join(', ')}]`;
    } else if (typeof taskDef === 'object' && taskDef !== null) {
      // Table-based task definition
      if (taskDef.cmd) {
        return `cmd: ${taskDef.cmd}`;
      } else if (taskDef.shell) {
        return `shell: ${taskDef.shell}`;
      } else if (taskDef.script) {
        return `script: ${taskDef.script}`;
      } else if (taskDef.expr) {
        return `expr: ${taskDef.expr}`;
      } else if (taskDef.sequence) {
        const seq = Array.isArray(taskDef.sequence) ? taskDef.sequence.join(', ') : JSON.stringify(taskDef.sequence);
        return `sequence: [${seq}]`;
      } else if (taskDef.parallel) {
        const par = Array.isArray(taskDef.parallel) ? taskDef.parallel.join(', ') : JSON.stringify(taskDef.parallel);
        return `parallel: [${par}]`;
      } else if (taskDef.switch) {
        return `switch: ${JSON.stringify(taskDef.switch)}`;
      } else if (taskDef.ref) {
        return `ref: ${taskDef.ref}`;
      } else if (taskDef.help) {
        // If task has only help text, show that
        return taskDef.help;
      } else {
        return JSON.stringify(taskDef);
      }
    }
    return 'unknown task type';
  }

  /**
   * Finds the line number where a task is defined in the TOML content
   * @param content The TOML file content
   * @param taskName The name of the task to find
    * @returns The 0-based line number, or 0 if not found
   */
  private findTaskLineInContent(content: string, taskName: string): number {
    const lines = content.split('\n');
    let inSection = false;
    const sectionHeader = '[tool.poe.tasks]';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if we're entering the [tool.poe.tasks] section
      if (line === sectionHeader) {
        inSection = true;
        continue;
      }

      // Check if we've left the section (new section starts)
      if (inSection && line.startsWith('[') && line.endsWith(']')) {
        break;
      }

      // Look for the task name in the section
      // Handle both simple tasks (task = "cmd") and table tasks ([tool.poe.tasks.taskname])
      if (inSection && (line.startsWith(`${taskName} =`) || line.startsWith(`${taskName}.`))) {
        return i;
      }

      // Also check for table syntax: [tool.poe.tasks.taskname]
      if (line === `[tool.poe.tasks.${taskName}]` || line === `[tool.poe.tasks."${taskName}"]`) {
        return i;
      }
    }

    return 0;
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
        configKey: 'applicationPath.poe',
        defaultValue: 'poe',
        configName: 'poe',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: poeCmd, args: poeInitialArgs, cwd: poeCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const poeArgs = poeInitialArgs ? [...poeInitialArgs] : [];
    poeArgs.push(taskLabel, ...splitArgs(args));

    const full = `${poeCmd} ${poeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(poeCmd, poeArgs, { cwd: poeCwd });
    const task = new vscode.Task(
      { type: 'poe', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'poe',
      shellExec,
    );
    return { task, command: full, cwd: poeCwd, native: false };
  }
}
