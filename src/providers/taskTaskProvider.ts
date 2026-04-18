import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { LoggerService } from '../services/loggerService';

const execFileAsync = promisify(execFile);

interface TaskJsonEntry {
  name: string;
  task: string;
  desc?: string;
  summary?: string;
  aliases?: string[];
  location?: {
    line: number;
    column: number;
    taskfile: string;
  };
}

interface TaskJsonOutput {
  tasks: TaskJsonEntry[];
  location: string;
}

export class TaskFileTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('taskfile', constants.GLOB_TASKFILE);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.taskfile',
        defaultValue: 'taskfile',
        configName: 'taskfile',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_TASKFILE]);

    // Deduplicate by parent directory — task discovers all tasks within its cwd automatically;
    // multiple Taskfile variants in the same directory are handled by the CLI itself.
    const dirMap = new Map<string, vscode.Uri>();
    for (const file of files) {
      const dir = path.dirname(file.fsPath);
      if (!dirMap.has(dir)) {
        dirMap.set(dir, file);
      }
    }

    const results = await Promise.all(
      Array.from(dirMap.entries()).map(([dir, representativeFile]) =>
        this._loadTasksFromDirectory(dir, representativeFile, iconService),
      ),
    );

    return results.flat();
  }

  private async _loadTasksFromDirectory(
    dir: string,
    representativeFile: vscode.Uri,
    iconService: TaskIconService,
  ): Promise<TaskItem[]> {
    const { command, args } = this.getCommand(representativeFile);
    const cmdArgs = [...(args ?? []), '--list-all', '--no-status', '--json'];

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd: dir, timeout: 10000 });
      return this.parseOutput(stdout, dir, iconService);
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to list tasks in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Parses the JSON output from `taskfile --list-all --no-status --json` into `TaskItem` instances.
   * Extracted as a public method to enable direct unit-testing without spawning a process.
   */
  public parseOutput(stdout: string, dir: string, iconService?: TaskIconService): TaskItem[] {
    let output: TaskJsonOutput;
    try {
      output = JSON.parse(stdout) as TaskJsonOutput;
    } catch (parseErr: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to parse JSON output from ${dir}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
      return [];
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const tasks: TaskItem[] = [];
    const fallbackUri = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));
    const iconPath = svc.getTaskIcon('taskfile', fallbackUri);

    for (const entry of output.tasks ?? []) {
      const taskFileUri = entry.location?.taskfile
        ? vscode.Uri.file(entry.location.taskfile)
        : fallbackUri;

      const item = new TaskItem(
        entry.name,
        vscode.TreeItemCollapsibleState.None,
        'taskfile',
        taskFileUri,
        undefined,
        iconPath,
      );
      item.taskFileUri = taskFileUri;
      // description: relative path shown in tree view (consistent with other file-based providers)
      item.description = vscode.workspace.asRelativePath(taskFileUri);
      // tooltip: the human-readable task description from the Taskfile
      item.tooltip = entry.desc || entry.name;
      item.startLine = entry.location?.line ? entry.location.line - 1 : 0;
      item.metadata = {
        aliases: entry.aliases ?? [],
        summary: entry.summary ?? '',
      };
      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [taskFileUri, item.startLine],
      };
      tasks.push(item);
    }
    return tasks;
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }
}
