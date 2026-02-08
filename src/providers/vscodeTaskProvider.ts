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
    const tasks: TaskItem[] = await this.getSystemTasks();
    const files = await this.filesService.findFiles([constants.GLOB_VSCODE]);

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

            item.task = task;

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
    const vscodeTasks = (await vscode.tasks.fetchTasks()).filter((t => t.source === 'Workspace'));
    this.logger.debug(`[VscodeTaskProvider] Fetched ${vscodeTasks.length} system tasks from VSCode.`);

    for (const vscodeTask of vscodeTasks) {
      this.logger.debug(`[VscodeTaskProvider] - Processing Task: ${vscodeTask.name}, Source: ${vscodeTask.source}`);
      const label = vscodeTask.name || 'Unnamed Task';

      // Determine the correct file URI based on the task's workspace folder scope
      let fileUri: vscode.Uri;
      const taskScope = vscodeTask.scope as vscode.WorkspaceFolder | undefined;
      if (taskScope && taskScope.uri) {
        // Task belongs to a specific workspace folder
        fileUri = vscode.Uri.joinPath(taskScope.uri, '.vscode', 'tasks.json');
      } else if (vscodeTask.definition._source) {
        // Use the _source property if available
        fileUri = typeof vscodeTask.definition._source === 'string'
          ? vscode.Uri.file(vscodeTask.definition._source)
          : vscodeTask.definition._source;
      } else {
        // Fallback to first workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        fileUri = workspaceFolder
          ? vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json')
          : vscode.Uri.file('.vscode/tasks.json');
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


      const document = await vscode.workspace.openTextDocument(fileUri);
      const text = document.getText();

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
