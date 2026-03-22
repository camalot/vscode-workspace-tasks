import * as vscode from 'vscode';
import { TaskProvider, BaseTaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { FilteredTaskService } from '../services/filteredTaskService';

export class VscodeTaskProvider extends BaseTaskProvider implements TaskProvider {
  private readonly addedTasks: Set<string> = new Set<string>();
  private readonly filesService = TaskFilesService.getInstance();
  private readonly iconService = TaskIconService.getInstance();
  private readonly filteredTaskService = FilteredTaskService.getInstance();

  constructor() {
    super('vscode', constants.GLOB_VSCODE);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    this.addedTasks.clear();
    const tasks: TaskItem[] = await this.getSystemTasks();
    const workspaceFiles = await this.filesService.findFiles([constants.GLOB_VSCODE]);

    const files: vscode.Uri[] = [...workspaceFiles];

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

      let fileUri: vscode.Uri | undefined;
      if (isUserProfileTask) {
        // User profile tasks might not be in the default user tasks.json
        // We use undefined to indicate it's a user task without a known direct path.
        fileUri = undefined;
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
      item.description = isUserProfileTask ? 'User Tasks' : (fileUri ? vscode.workspace.asRelativePath(fileUri) : vscodeTask.source);
      // Store the native vscode.Task so createTaskForItem can use it directly
      // (guarded by instanceof check to avoid treating raw JSON as a vscode.Task)
      item.task = vscodeTask;
      if (isUserProfileTask) {
        item.taskOrigin = 'user';
      }


      let text = '';
      if (fileUri) {
        try {
          const document = await vscode.workspace.openTextDocument(fileUri);
          text = document.getText();
        } catch {
          // File may not exist (e.g. user tasks.json on a machine that has none)
          this.logger.debug(`[VscodeTaskProvider] - Could not open file: ${fileUri.fsPath}`);
        }
      }

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`"${label}"`)) {
          item.startLine = i;
          break;
        }
      }

      if (isUserProfileTask) {
        item.onOpenActionCommand = {
          command: 'workbench.action.tasks.openUserTasks',
          title: 'Open User Tasks',
          arguments: [],
        };
      } else {
        item.onOpenActionCommand = {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open File',
          arguments: [fileUri, item.startLine || 0],
        };
      }

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
