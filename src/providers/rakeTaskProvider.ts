import * as vscode from 'vscode';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { TaskStateManager } from '../taskStateManager';
import { CreatedTask, splitArgs } from '../libs/taskCreationUtils';

const execFileAsync = promisify(execFile);

export class RakeTaskProvider extends BaseTaskProvider implements TaskProvider {
  private readonly iconService = TaskIconService.getInstance();
  private _rakeNotFoundWarned = false;

  constructor() {
    super('rake', constants.GLOB_RAKE);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[RakeTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_RAKE]);

    for (const file of files) {
      try {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        if (!workspaceFolder) {
          continue;
        }

        const contentBuffer = await vscode.workspace.fs.readFile(file);
        const content = Buffer.from(contentBuffer).toString('utf8');
        const taskLineMap = this.buildTaskLineMap(content);

        const fileDir = path.dirname(file.fsPath);
        const rakeCmd = this.getCommand(workspaceFolder.uri);

        const listInvocation = this.buildRakeTaskListInvocation(rakeCmd, file.fsPath);

        // Run rake --tasks --file <path> to list tasks for this specific file.
        // Use execFile so configured executable args (e.g. "bundle exec rake")
        // are preserved and paths with spaces are handled safely.
        const { stdout } = await execFileAsync(
          listInvocation.command,
          listInvocation.args,
          {
            cwd: fileDir,
            timeout: 10000, // 10 second timeout
          }
        );

        const taskLines = this.parseRakeOutput(stdout);
        const iconPath = this.iconService.getTaskIcon(this.type);

        for (const taskLine of taskLines) {
          const startLine = taskLineMap.get(taskLine.name) ?? 0;
          const item = new TaskItem(
            taskLine.name,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            file,
            undefined,
            iconPath
          );

          item.taskFileUri = file;
          item.startLine = startLine;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = taskLine.description || taskLine.name;

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, startLine],
          };

          tasks.push(item);
        }
      } catch (error) {
        // Fall back to static parsing so users still get best-effort tasks when CLI fails.
        const errorCode = (error as { code?: string })?.code;
        if (errorCode === 'ENOENT') {
          if (!this._rakeNotFoundWarned) {
            this._rakeNotFoundWarned = true;
            this.logger.warn(
              "[RakeTaskProvider] 'rake' executable not found. Falling back to static file parsing. Install rake or configure 'applicationPath.rake' in settings.",
            );
          }
        } else {
          this.logger.warn(`[RakeTaskProvider] Falling back to static parsing for ${file.fsPath}.`, error);
        }

        try {
          const contentBuffer = await vscode.workspace.fs.readFile(file);
          const content = Buffer.from(contentBuffer).toString('utf8');
          tasks.push(...this.parseRakeFileFallback(content, file));
        } catch (fallbackError) {
          this.logger.error(`[RakeTaskProvider] Failed static parse fallback for ${file.fsPath}:`, fallbackError);
        }
      }
    }

    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    let systemTasks: vscode.Task[] = [];
    try {
      systemTasks = await vscode.tasks.fetchTasks({ type: 'rake' });
    } catch (error) {
      this.logger.warn('[RakeTaskProvider] Failed to fetch rake system tasks.', error);
      return [];
    }
    this.logger.debug(`[RakeTaskProvider] Fetched ${systemTasks.length} system tasks.`);

    for (const task of systemTasks) {
      const label = task.name || 'Unnamed Task';
      let fileUri: vscode.Uri | undefined;
      const taskScope = task.scope as vscode.WorkspaceFolder;

      // Try to find the Rakefile in the workspace
      if (taskScope && taskScope.uri) {
        const filesService = TaskFilesService.getInstance();
        const files = await filesService.findFiles([constants.GLOB_RAKE]);

        // Find the first Rakefile in this workspace folder
        fileUri = files.find(f => {
          const fileWorkspace = vscode.workspace.getWorkspaceFolder(f);
          return fileWorkspace?.uri.toString() === taskScope.uri.toString();
        });
      }

      const item = new TaskItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        fileUri,
      );

      item.metadata = { systemTaskName: task.name };
      item.description = fileUri ? vscode.workspace.asRelativePath(fileUri) : task.source;

      if (fileUri) {
        item.taskFileUri = fileUri;
        item.onOpenActionCommand = {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open File',
          arguments: [fileUri, 0],
        };
      }

      const id = TaskStateManager.getInstance().getTaskId(item);
      const iconPath = this.iconService.getTaskIcon(this.type);
      item.task = task;
      item.defaultIconPath = iconPath;
      tasks.push(item);
    }

    return tasks;
  }

  public async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    if (!item.taskFileUri) {
      return undefined;
    }

    const taskLabel = item.originalLabel || String(item.label);
    const { command: rakeCmd, args: providerArgs } = this.getCommand(item.taskFileUri);
    const rakeArgs = [...(providerArgs ?? [])];

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.taskFileUri);
    const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(item.taskFileUri.fsPath);
    const configPath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, item.taskFileUri.fsPath) || path.basename(item.taskFileUri.fsPath)
      : item.taskFileUri.fsPath;

    rakeArgs.push('--file', configPath, taskLabel, ...splitArgs(args));

    const shellExec = new vscode.ShellExecution(rakeCmd, rakeArgs, { cwd });
    const task = new vscode.Task(
      { type: 'rake', task: taskLabel, path: item.taskFileUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'rake',
      shellExec,
    );
    return { task, command: `${rakeCmd} ${rakeArgs.join(' ')}`, cwd, native: false };
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.rake',
        defaultValue: 'rake',
        configName: 'rake',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.bat',
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  private buildRakeTaskListInvocation(rakeCmd: ExecutableResult, filePath: string): { command: string; args: string[] } {
    return {
      command: rakeCmd.command,
      args: [...rakeCmd.args, '--tasks', '--file', filePath],
    };
  }

  /**
   * Parses the output from `rake --tasks` or `rake -AT` command
   * Expected format:
   * rake about                              # List versions of all Rails frameworks and the environment
   * rake db:create                          # Creates the database from DATABASE_URL
   */
  private parseRakeOutput(output: string): Array<{ name: string; description?: string }> {
    const tasks: Array<{ name: string; description?: string }> = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match lines like: "rake task_name    # Description"
      const match = line.match(/^rake\s+([^\s]+)\s*(?:#\s*(.*))?$/);
      if (match) {
        const taskName = match[1];
        const description = match[2]?.trim();

        tasks.push({
          name: taskName,
          description: description,
        });
      }
    }

    return tasks;
  }

  private parseRakeFileFallback(content: string, fileUri: vscode.Uri): TaskItem[] {
    const tasks: TaskItem[] = [];
    const lines = content.split(/\r?\n/);
    const iconPath = this.iconService.getTaskIcon(this.type);
    const taskPattern = /^\s*task\s+[:'\"]?([A-Za-z0-9_:-]+)['\":]?\s*/;

    let pendingDesc: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) {
        pendingDesc = undefined;
        continue;
      }

      const descMatch = trimmed.match(/^desc\s+['\"]([^'\"]+)['\"]/);
      if (descMatch) {
        pendingDesc = descMatch[1];
        continue;
      }

      const taskMatch = trimmed.match(taskPattern);
      if (taskMatch) {
        const taskName = taskMatch[1].replace(/:$/, '');
        const item = new TaskItem(
          taskName,
          vscode.TreeItemCollapsibleState.None,
          this.type,
          fileUri,
          undefined,
          iconPath,
        );
        item.taskFileUri = fileUri;
        item.startLine = i;
        item.description = vscode.workspace.asRelativePath(fileUri);
        item.tooltip = pendingDesc ? `${taskName}: ${pendingDesc} (static parse)` : `${taskName} (static parse)`;
        item.onOpenActionCommand = {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open File',
          arguments: [fileUri, i],
        };
        tasks.push(item);
        pendingDesc = undefined;
      } else if (trimmed.length > 0) {
        pendingDesc = undefined;
      }
    }

    return tasks;
  }

  private buildTaskLineMap(content: string): Map<string, number> {
    const map = new Map<string, number>();
    const lines = content.split(/\r?\n/);
    const taskPattern = /^\s*task\s+[:'\"]?([A-Za-z0-9_:-]+)['\":]?\s*/;

    for (let i = 0; i < lines.length; i++) {
      const taskMatch = lines[i].trim().match(taskPattern);
      if (taskMatch) {
        map.set(taskMatch[1].replace(/:$/, ''), i);
      }
    }

    return map;
  }
}
