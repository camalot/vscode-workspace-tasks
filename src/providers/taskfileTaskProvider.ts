import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { LoggerService } from '../services/loggerService';
import { TaskCacheService } from '../services/taskCacheService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

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

export class TaskfileTaskProvider extends BaseTaskProvider implements TaskProvider {
  private globalTaskfileWatchers: vscode.FileSystemWatcher[] = [];
  private globalWatcherDebounce?: NodeJS.Timeout;

  constructor() {
    super('taskfile', constants.GLOB_TASKFILE);
  }

  private disposeGlobalTaskfileWatchers(): void {
    for (const watcher of this.globalTaskfileWatchers) {
      watcher.dispose();
    }
    this.globalTaskfileWatchers = [];
    if (this.globalWatcherDebounce) {
      clearTimeout(this.globalWatcherDebounce);
      this.globalWatcherDebounce = undefined;
    }
  }

  private scheduleGlobalRefresh(): void {
    if (this.globalWatcherDebounce) {
      clearTimeout(this.globalWatcherDebounce);
    }
    this.globalWatcherDebounce = setTimeout(() => {
      TaskCacheService.getInstance().refresh();
    }, 150);
  }

  private reconcileGlobalTaskfileWatchers(homeDir: string, discoveredPath?: string): void {
    this.disposeGlobalTaskfileWatchers();

    const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
    const watchTargets = new Set<string>(variants.map((v) => path.join(homeDir, v)));
    if (discoveredPath) {
      watchTargets.add(discoveredPath);
    }

    for (const filePath of watchTargets) {
      const pattern = new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath));
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = () => this.scheduleGlobalRefresh();
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      this.globalTaskfileWatchers.push(watcher);
    }
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.taskfile',
        defaultValue: 'task', // executable is named 'task'
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

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[TaskfileTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const customPatterns = config.get<string[]>('taskfile.additionalFilePatterns', []);
    const patterns = [constants.GLOB_TASKFILE, ...customPatterns];

    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles(patterns);

    // Deduplicate by Taskfile path and always use --taskfile for explicit, deterministic discovery.
    const taskfileMap = new Map<string, vscode.Uri>();
    for (const file of files) {
      if (!taskfileMap.has(file.fsPath)) {
        taskfileMap.set(file.fsPath, file);
      }
    }

    const results = await Promise.all(
      Array.from(taskfileMap.values()).map((uri) =>
        this._loadTasksFromDirectory(path.dirname(uri.fsPath), uri, iconService),
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
    const cmdArgs = [...(args ?? []), '--taskfile', representativeFile.fsPath, '--list-all', '--no-status', '--json'];

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
    const showAliases = vscode.workspace.getConfiguration('workspaceTasks').get<boolean>('taskfile.showAliases', true);

    for (const entry of output.tasks ?? []) {
      const taskFileUri = entry.location?.taskfile
        ? vscode.Uri.file(entry.location.taskfile)
        : fallbackUri;
      const aliases = entry.aliases ?? [];
      const hasAliases = showAliases && aliases.length > 0;

      const item = new TaskItem(
        entry.name,
        hasAliases ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
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
        aliases,
        summary: entry.summary ?? '',
      };
      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [taskFileUri, item.startLine],
      };

      if (hasAliases) {
        for (const alias of aliases) {
          const aliasItem = new TaskItem(
            alias,
            vscode.TreeItemCollapsibleState.None,
            'taskfile',
            taskFileUri,
            undefined,
            iconPath,
          );
          aliasItem.taskFileUri = taskFileUri;
          aliasItem.description = vscode.workspace.asRelativePath(taskFileUri);
          aliasItem.tooltip = `Alias for: ${entry.name}`;
          aliasItem.startLine = item.startLine;
          aliasItem.metadata = {
            isAlias: true,
            primaryTask: entry.name,
          };
          aliasItem.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [taskFileUri, item.startLine],
          };
          aliasItem.parent = item;
          item.children.push(aliasItem);
        }
      }

      tasks.push(item);
    }
    return tasks;
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      this.disposeGlobalTaskfileWatchers();
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[TaskfileTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const discoverGlobal = config.get<boolean>('taskfile.discoverGlobalTaskfile', false);
    if (!discoverGlobal) {
      this.disposeGlobalTaskfileWatchers();
      return [];
    }

    const homeDir = os.homedir();
    const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
    const globalTaskfilePath = variants.map((v) => path.join(homeDir, v)).find((p) => fs.existsSync(p));

    // Keep watcher coverage current even when no global Taskfile exists yet.
    this.reconcileGlobalTaskfileWatchers(homeDir, globalTaskfilePath);

    if (!globalTaskfilePath) {
      return [];
    }

    const iconService = TaskIconService.getInstance();
    const { command, args } = this.getCommand(vscode.Uri.file(globalTaskfilePath));
    const cmdArgs = [...(args ?? []), '--taskfile', globalTaskfilePath, '--list-all', '--no-status', '--json'];

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd: homeDir, timeout: 10000 });
      const items = this.parseOutput(stdout, homeDir, iconService);

      for (const item of items) {
        item.metadata = {
          ...(item.metadata ?? {}),
          isGlobalTask: true,
          globalTaskfilePath,
        };
      }

      return items;
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to list global tasks in ${homeDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = item.originalLabel || item.label;
    const { command: taskCmd, args: taskInitialArgs, cwd: taskCwd } = this.getCommand(workspaceFolder?.uri);

    const taskArgs = taskInitialArgs ? [...taskInitialArgs] : [];
    const globalTaskfilePath = typeof item.metadata?.globalTaskfilePath === 'string'
      ? item.metadata.globalTaskfilePath
      : undefined;

    if (globalTaskfilePath) {
      taskArgs.push('--taskfile', globalTaskfilePath);
    } else if (item.taskFileUri) {
      taskArgs.push('--taskfile', item.taskFileUri.fsPath);
    }

    taskArgs.push(taskLabel, ...splitArgs(args));

    const full = `${taskCmd} ${taskArgs.join(' ')}`;
    const taskFileCwd = item.taskFileUri ? path.dirname(item.taskFileUri.fsPath) : taskCwd;
    const shellExec = new vscode.ShellExecution(taskCmd, taskArgs, { cwd: taskFileCwd });

    const task = new vscode.Task(
      { type: 'taskfile', task: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'taskfile',
      shellExec,
    );
    return { task, command: full, cwd: taskFileCwd, native: false };
  }
}
