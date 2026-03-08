import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { TaskProvider, BaseTaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Returns the path to the VS Code user-level tasks.json file for the current platform.
 * - Windows: %APPDATA%\Code\User\tasks.json
 * - macOS:   ~/Library/Application Support/Code/User/tasks.json
 * - Linux:   ~/.config/Code/User/tasks.json
 */
export function getUserTasksPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Code', 'User', 'tasks.json');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'tasks.json');
  } else {
    return path.join(os.homedir(), '.config', 'Code', 'User', 'tasks.json');
  }
}

export class VscodeTaskProvider extends BaseTaskProvider implements TaskProvider {
  private readonly addedTasks: Set<string> = new Set<string>();
  private readonly filesService = TaskFilesService.getInstance();
  private readonly iconService = TaskIconService.getInstance();
  private readonly filteredTaskService = FilteredTaskService.getInstance();

  constructor() {
    super('vscode', constants.GLOB_VSCODE);
  }

  /**
   * Returns a vscode.Uri for the user-level tasks.json if it exists, otherwise undefined.
   */
  async getUserTasksUri(): Promise<vscode.Uri | undefined> {
    const userTasksPath = getUserTasksPath();
    const userTasksUri = vscode.Uri.file(userTasksPath);
    try {
      await vscode.workspace.fs.stat(userTasksUri);
      return userTasksUri;
    } catch {
      return undefined;
    }
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    this.addedTasks.clear();
    const tasks: TaskItem[] = await this.getSystemTasks();
    const workspaceFiles = await this.filesService.findFiles([constants.GLOB_VSCODE]);

    // Also include the user-level tasks.json if it exists and is not already in workspace files
    const userTasksUri = await this.getUserTasksUri();
    const files: vscode.Uri[] = [...workspaceFiles];
    if (userTasksUri) {
      const userPath = userTasksUri.fsPath;
      const alreadyIncluded = workspaceFiles.some(f => f.fsPath === userPath);
      if (!alreadyIncluded) {
        files.push(userTasksUri);
      }
    }

    for (const file of files) {
      this.logger.debug(`[VscodeTaskProvider] Processing tasks file: ${file.fsPath}`);
      try {
        const iconPath = this.iconService.getTaskIcon(this.type);

        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        // Simple regex to strip comments.
        // WARNING: This is naive and can break if comments are inside strings.
        // But for standard tasks.json it's usually fine.
        const jsonText = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*/gm, '') // Line comments
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']'); // Trailing commas cleanup (partial)

        // A safer way would be to treat it as standard JSON if possible, catch error and log.
        // Or require a jsonc parser dependency. For now, try/catch with naive cleaning.

        let json;
        try {
          json = JSON.parse(text); // Try strict JSON first
        } catch {
          // If strict fails, try cleaning comments
          json = JSON.parse(jsonText);
        }

        if (json && json.tasks && Array.isArray(json.tasks)) {
          for (const task of json.tasks) {

            const label = task.label || 'Unnamed Task';
            const item = new TaskItem(
              label,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              file,
              undefined,
              iconPath,
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            // Mark whether this task comes from the global user tasks.json
            if (userTasksUri && file.fsPath === userTasksUri.fsPath) {
              item.taskOrigin = 'user';
            }
            // We do NOT set defaultIconPath, so it uses resourceUri (iconUri)

            // Find line number (approximate)
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`"${label}"`)) {
                item.startLine = i;
                break;
              }
            }

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0],
            };

            // NOTE: We do NOT set item.task to the raw JSON object here.
            // item.task must only be set to a proper vscode.Task instance.
            // The factory's case 'vscode' handler will resolve the registered task when needed.

            if (this.addedTasks.has(item.id!)) {
              this.logger.debug(`[VscodeTaskProvider] - Skipping duplicate task: ${item.id}`);
              continue;
            }

            // is the task hidden?
            if (this.isHiddenTask(task)) {
              if (!this.filteredTaskService.isUnhidden(item.id!) && !this.filteredTaskService.isFiltered(item.id!)) {
                this.logger.debug(`[VscodeTaskProvider] - Hiding task: ${item.id}`);
                this.filteredTaskService.hideTask(item);
              }
            }

            this.addedTasks.add(item.id!);
            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`Error parsing tasks.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];

    // get the system registered tasks
    const allTasks: vscode.Task[] = await vscode.tasks.fetchTasks();

    // Include both workspace tasks and user-level tasks (source 'Workspace' or 'User').
    // Note: user profile tasks also have source 'Workspace' in real VSCode.
    const vscodeTasks = allTasks.filter((t => t.source === 'Workspace' || t.source === 'User'));
    this.logger.debug(`[VscodeTaskProvider] Fetched ${vscodeTasks.length} system tasks from VSCode.`);

    // Fetch user tasks URI once for reuse
    const userTasksUri = await this.getUserTasksUri();

    for (const vscodeTask of vscodeTasks) {
      this.logger.debug(`[VscodeTaskProvider] - Processing Task: ${vscodeTask.name}, Source: ${vscodeTask.source}`);
      const label = vscodeTask.name || 'Unnamed Task';

      // Determine the correct file URI based on the task's workspace folder scope.
      // Workspace-folder tasks have an object scope with a .uri property (vscode.WorkspaceFolder).
      // User profile tasks have a numeric scope (TaskScope.Global=1 or TaskScope.Workspace=2),
      // NOT a WorkspaceFolder object. Checking typeof lets us distinguish them reliably without
      // depending on a specific enum value that may vary across VSCode versions.
      const rawScope = vscodeTask.scope;
      const workspaceFolderScope: vscode.WorkspaceFolder | undefined =
        rawScope !== null &&
        rawScope !== undefined &&
        typeof rawScope === 'object' &&
        (rawScope as vscode.WorkspaceFolder).uri !== undefined
          ? rawScope as vscode.WorkspaceFolder
          : undefined;
      const isUserProfileTask = workspaceFolderScope === undefined || vscodeTask.source === 'User';

      let fileUri: vscode.Uri;
      if (isUserProfileTask) {
        // User profile tasks live in the global user tasks.json
        fileUri = userTasksUri ?? vscode.Uri.file(getUserTasksPath());
      } else if (vscodeTask.definition._source) {
        // Use the _source property if available (more specific than folder default)
        fileUri = typeof vscodeTask.definition._source === 'string'
          ? vscode.Uri.file(vscodeTask.definition._source)
          : vscodeTask.definition._source;
      } else {
        // Workspace folder task — use the folder's .vscode/tasks.json
        fileUri = vscode.Uri.joinPath(workspaceFolderScope!.uri, '.vscode', 'tasks.json');
      }

      const item = new TaskItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        fileUri,
        undefined,
        this.iconService.getTaskIcon(this.type),
      );
      item.taskFileUri = fileUri;
      item.description = fileUri ? vscode.workspace.asRelativePath(fileUri) : vscodeTask.source;
      // Store the native vscode.Task so createTaskForItem can use it directly
      // (guarded by instanceof check to avoid treating raw JSON as a vscode.Task)
      item.task = vscodeTask;
      if (isUserProfileTask) {
        item.taskOrigin = 'user';
      }


      let text = '';
      try {
        const document = await vscode.workspace.openTextDocument(fileUri);
        text = document.getText();
      } catch {
        // File may not exist (e.g. user tasks.json on a machine that has none)
        this.logger.debug(`[VscodeTaskProvider] - Could not open file: ${fileUri.fsPath}`);
      }

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`"${label}"`)) {
          item.startLine = i;
          break;
        }
      }

      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, item.startLine || 0],
      };

      if (this.isHiddenTask(vscodeTask)) {
        if (!this.filteredTaskService.isUnhidden(item.id!) && !this.filteredTaskService.isFiltered(item.id!)) {
          this.logger.debug(`[VscodeTaskProvider] - Hiding system task: ${item.id}`);
          this.filteredTaskService.hideTask(item);
        }
      }

      tasks.push(item);
      this.addedTasks.add(item.id!);
    }
    return tasks;
  }

  private isHiddenTask(task: any): boolean {
    if (!task) {
      return false;
    }
    const isTrue = (val: any) => val === true || val === 'true';
    return (
      (task.runOptions && isTrue(task.runOptions.hide)) ||
      isTrue(task.hide) ||
      (task.presentation && (isTrue(task.presentation.hide) || isTrue(task.presentation.hidden)))
    );
  }
}
