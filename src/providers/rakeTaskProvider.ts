import * as vscode from 'vscode';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { TaskStateManager } from '../taskStateManager';

const execAsync = promisify(exec);

export class RakeTaskProvider extends BaseTaskProvider implements TaskProvider {
  private readonly iconService = TaskIconService.getInstance();

  constructor() {
    super('rake', constants.GLOB_RAKE);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
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

        const fileDir = path.dirname(file.fsPath);
        const rakeCmd = this.getCommand(workspaceFolder.uri);

        // Run rake --tasks --file <path> to list tasks for this specific file
        const { stdout } = await execAsync(
          `"${rakeCmd.command}" --tasks --file "${file.fsPath}"`,
          {
            cwd: fileDir,
            timeout: 10000, // 10 second timeout
          }
        );

        const taskLines = this.parseRakeOutput(stdout);
        const iconPath = this.iconService.getTaskIcon(this.type);

        for (const taskLine of taskLines) {
          const item = new TaskItem(
            taskLine.name,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            file,
            undefined,
            iconPath
          );

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = taskLine.description || taskLine.name;

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0],
          };

          tasks.push(item);
        }
      } catch (error) {
        // Log the error but continue with other files
        this.logger.error(`[RakeTaskProvider] Failed to get tasks from ${file.fsPath}:`, error);
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
}
