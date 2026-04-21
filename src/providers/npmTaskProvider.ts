import * as vscode from 'vscode';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { PackageJsonTaskProvider } from './packageJsonTaskProvider';
import { PackageYamlTaskProvider } from './packageYamlTaskProvider';
import { TaskItem } from '../taskItem';
import { TaskIconService } from '../services/taskIconService';
import { TaskStateManager } from '../taskStateManager';
import { TaskFilesService } from '../services/taskFilesService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class NpmTaskProvider extends PackageJsonTaskProvider {
  private readonly iconService = TaskIconService.getInstance();

  constructor() {
    super('npm', constants.GLOB_NODEJS);
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    let systemTasks = [];
    try {
      systemTasks = await vscode.tasks.fetchTasks({ type: 'npm' });
    } catch (error) {
      this.logger.warn('[NpmTaskProvider] Failed to fetch npm system tasks.', error);
      return [];
    }
    this.logger.debug(`[NpmTaskProvider] Fetched ${systemTasks.length} system tasks.`);

    const filesService = TaskFilesService.getInstance();
    const documentsCache: Map<string, vscode.TextDocument> = new Map();
    const contentCache: Map<string, string> = new Map();
    const jsonCache: Map<string, any> = new Map();
    for (const task of systemTasks) {

      let label = task.name || 'Unnamed Task';
      let fileUri: vscode.Uri | undefined;
      const taskScope = task.scope as vscode.WorkspaceFolder;

      // npm tasks are often named "script - relative/path"
      if (label.includes(' - ')) {
        const lastIndex = label.lastIndexOf(' - ');
        const path = label.substring(lastIndex + 3);
        if (taskScope && taskScope.uri) {
          fileUri = vscode.Uri.joinPath(taskScope.uri, path, 'package.json');
          label = label.substring(0, lastIndex);
        }
      }

      if (!fileUri && taskScope && taskScope.uri) {
        fileUri = vscode.Uri.joinPath(taskScope.uri, 'package.json');
      }

      // Skip tasks from files excluded by .tasksignore
      if (fileUri && filesService.shouldIgnore(fileUri)) {
        this.logger.debug(`[NpmTaskProvider] Skipping ignored task file: ${fileUri.fsPath}`);
        continue;
      }

      // Load and cache document content
      let document: vscode.TextDocument;
      if (fileUri) {
        const fileKey = fileUri.toString();
        if (documentsCache.has(fileKey)) {
          document = documentsCache.get(fileKey)!;
        } else {
          document = await vscode.workspace.openTextDocument(fileUri);
          documentsCache.set(fileKey, document);
        }

        if (!contentCache.has(fileKey)) {
          contentCache.set(fileKey, document.getText());
        }
        if (!jsonCache.has(fileKey)) {
          try {
            jsonCache.set(fileKey, JSON.parse(contentCache.get(fileKey)!));
          } catch (e) {
            jsonCache.set(fileKey, null);
          }
        }
      }

      const content = fileUri ? contentCache.get(fileUri.toString())! : undefined;
      const json = fileUri ? jsonCache.get(fileUri.toString()) : null;


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
      }

      if (content && json && json.scripts && json.scripts[label]) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`"${label}"`)) {
            item.startLine = i;
            break;
          }
        }
      } else {
        // Could not verify script exists in package.json, skip
        item.startLine = 0;
      }

      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, item.startLine || 0],
      };

      const id = TaskStateManager.getInstance().getTaskId(item);
      if (this.addedTasks.has(id)) {
        continue;
      }

      const iconPath = this.iconService.getTaskIcon(this.type);
      item.task = task;
      item.defaultIconPath = iconPath;
      tasks.push(item);
      this.addedTasks.add(id);
    }

    return tasks;
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'npm',
        configName: 'npm',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  /**
   * Creates a runnable vscode.Task for an npm script TaskItem.
   * Uses the `cwd` derived from the package.json location (via resolveTaskContext)
   * rather than the workspace root returned by getCommand(), so that scripts in
   * sub-packages run from their own directory.
   */
  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { cwd, resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: npmCmd, args: npmInitialArgs } = this.getCommand(workspaceFolder?.uri);
    const npmArgs = npmInitialArgs ? [...npmInitialArgs] : [];
    const taskLabel = item.originalLabel || item.label;
    const normalizedLabel = (taskLabel || '').trim().toLowerCase();
    const extraArgs = splitArgs(args);

    // Special-case common install labels to map to `npm install` instead of `npm run <label>`
    if (
      normalizedLabel === 'install dependencies' ||
      normalizedLabel === 'install' ||
      normalizedLabel === 'install dependencies (npm install)'
    ) {
      npmArgs.push('install', ...extraArgs);
      const full = `${npmCmd} ${npmArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(npmCmd, npmArgs, { cwd });
      const task = new vscode.Task(
        { type: 'npm', script: 'install', path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'npm',
        shellExec,
      );
      return { task, command: full, cwd, native: false };
    }

    npmArgs.push('run', taskLabel, ...extraArgs);
    const full = `${npmCmd} ${npmArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(npmCmd, npmArgs, { cwd });
    const task = new vscode.Task(
      { type: 'npm', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'npm',
      shellExec,
    );
    return { task, command: full, cwd, native: false };
  }
}

export class PnpmTaskProvider extends PackageYamlTaskProvider {
  constructor() {
    super('pnpm', constants.GLOB_PNPM);
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
        defaultValue: 'pnpm',
        configName: 'pnpm',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { cwd, resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: pnpmCmd, args: pnpmInitialArgs } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;
    const pnpmArgs = pnpmInitialArgs ? [...pnpmInitialArgs] : [];
    pnpmArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${pnpmCmd} ${pnpmArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(pnpmCmd, pnpmArgs, { cwd });
    const task = new vscode.Task(
      { type: 'pnpm', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'pnpm',
      shellExec,
    );

    return { task, command: full, cwd, native: false };
  }
}

export class YarnTaskProvider extends PackageJsonTaskProvider {
  constructor() {
    super('yarn', constants.GLOB_NODEJS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'yarn',
        configName: 'yarn',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { cwd, resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: yarnCmd, args: yarnInitialArgs } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;
    const yarnArgs = yarnInitialArgs ? [...yarnInitialArgs] : [];
    yarnArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${yarnCmd} ${yarnArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(yarnCmd, yarnArgs, { cwd });
    const task = new vscode.Task(
      { type: 'yarn', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'yarn',
      shellExec,
    );

    return { task, command: full, cwd, native: false };
  }
}

export class BunTaskProvider extends PackageJsonTaskProvider {
  private readonly iconService = TaskIconService.getInstance();

  constructor() {
    super('bun', constants.GLOB_NODEJS);
    this.logger.debug('BunTaskProvider initialized');
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        defaultValue: 'bun',
        configName: 'bun',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    let systemTasks: vscode.Task[] = [];
    try {
      systemTasks = await vscode.tasks.fetchTasks({ type: 'bun' });
    } catch (error) {
      this.logger.warn('[BunTaskProvider] Failed to fetch bun system tasks.', error);
      return [];
    }
    this.logger.debug(`[BunTaskProvider] Fetched ${systemTasks.length} system tasks.`);

    const filesService = TaskFilesService.getInstance();
    const documentsCache: Map<string, vscode.TextDocument> = new Map();
    const contentCache: Map<string, string> = new Map();
    const jsonCache: Map<string, any> = new Map();
    for (const task of systemTasks) {

      let label = task.name || 'Unnamed Task';
      let fileUri: vscode.Uri | undefined;
      const taskScope = task.scope as vscode.WorkspaceFolder;

      // bun tasks are often named "script - relative/path"
      if (label.includes(' - ')) {
        const lastIndex = label.lastIndexOf(' - ');
        const path = label.substring(lastIndex + 3);
        if (taskScope && taskScope.uri) {
          fileUri = vscode.Uri.joinPath(taskScope.uri, path, 'package.json');
          label = label.substring(0, lastIndex);
        }
      }

      if (!fileUri && taskScope && taskScope.uri) {
        fileUri = vscode.Uri.joinPath(taskScope.uri, 'package.json');
      }

      // Skip tasks from files excluded by .tasksignore
      if (fileUri && filesService.shouldIgnore(fileUri)) {
        this.logger.debug(`[BunTaskProvider] Skipping ignored task file: ${fileUri.fsPath}`);
        continue;
      }

      // Load and cache document content
      let document: vscode.TextDocument;
      if (fileUri) {
        const fileKey = fileUri.toString();
        if (documentsCache.has(fileKey)) {
          document = documentsCache.get(fileKey)!;
        } else {
          document = await vscode.workspace.openTextDocument(fileUri);
          documentsCache.set(fileKey, document);
        }

        if (!contentCache.has(fileKey)) {
          contentCache.set(fileKey, document.getText());
        }
        if (!jsonCache.has(fileKey)) {
          try {
            jsonCache.set(fileKey, JSON.parse(contentCache.get(fileKey)!));
          } catch (e) {
            jsonCache.set(fileKey, null);
          }
        }
      }

      const content = fileUri ? contentCache.get(fileUri.toString())! : undefined;
      const json = fileUri ? jsonCache.get(fileUri.toString()) : null;


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
      }

      if (content && json && json.scripts && json.scripts[label]) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`"${label}"`)) {
            item.startLine = i;
            break;
          }
        }
      } else {
        // Could not verify script exists in package.json, skip
        item.startLine = 0;
      }

      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, item.startLine || 0],
      };

      const id = TaskStateManager.getInstance().getTaskId(item);
      if (this.addedTasks.has(id)) {
        continue;
      }

      const iconPath = this.iconService.getTaskIcon(this.type);
      item.task = task;
      item.defaultIconPath = iconPath;
      tasks.push(item);
      this.addedTasks.add(id);
    }

    return tasks;
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { cwd, resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: bunCmd, args: bunInitialArgs } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;
    const bunArgs = bunInitialArgs ? [...bunInitialArgs] : [];
    bunArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${bunCmd} ${bunArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(bunCmd, bunArgs, { cwd });
    const task = new vscode.Task(
      { type: 'bun', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'bun',
      shellExec,
    );

    return { task, command: full, cwd, native: false };
  }
}
