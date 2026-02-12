import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { WorkspaceTasksService } from '../services/workspaceTasksService';
import { TaskConfigService } from '../services/taskConfigService';
import constants from '../libs/constants';
import * as path from 'path';
import { TaskIconService } from '../services/taskIconService';
import { TaskFilesService } from '../services/taskFilesService';
import { FilteredTaskService } from '../services/filteredTaskService';

export class WorkspaceTasksProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('workspace-task', constants.GLOB_WORKSPACE);
  }

  async getTasks(): Promise<TaskItem[]> {
    // Check if workspace task type is enabled
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const service = WorkspaceTasksService.getInstance();
    const iconService = TaskIconService.getInstance();
    const filesService = TaskFilesService.getInstance();
    const filteredTaskService = FilteredTaskService.getInstance();

    const providers = await service.getProviders();
    for (const provider of providers) {
      // Check if this specific provider type is enabled
      if (!TaskConfigService.getInstance().isTaskTypeEnabled(provider)) {
        this.logger.debug(`Provider ${provider} is disabled. Skipping.`);
        continue;
      }

      const config = service.getLanguageConfig(provider);
      if (!config) {
        this.logger.warn(`No configuration found for provider: ${provider}. Skipping.`);
        continue;
      }
      // Ensure we await the tasks definition since getTasks is async
      const taskDefs = await service.getTasks(provider);

      const glob_include = config.globs?.include || [];
      const glob_exclude = config.globs?.exclude || [];
      const exclude_joined = glob_exclude.concat(constants.GLOB_GLOBAL_EXCLUDE);

      let langId = provider || 'shell';
      if (provider === this.type) {
        langId = 'shell';
      }

      // if there are no include / exclude globs, BUT there are tasks
      // then the tasks be added without any file association.
      // the tasks will appear in the tree view but won't be linked to any specific file.
      // the "type" of the task will be the language ID. If the language ID is not recognized, it will default to 'shell'.
      if ((!glob_include || glob_include.length === 0) && taskDefs.length > 0) {
        for (const taskDef of taskDefs) {
          // Use sourceUri if available (the .workspace-tasks.json file)
          const resourceUri = taskDef.sourceUri;

          const iconPath = iconService.getTaskIcon('task');

          const item = new TaskItem(
            taskDef.label,
            vscode.TreeItemCollapsibleState.None,
            this.type, // Unique task type
            resourceUri,
            undefined,
            iconPath,
          );
          item.taskFileUri = resourceUri;
          item.taskSource = provider;

          // Default click action: Open file at line
          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [resourceUri, taskDef.line || 0],
          };

          // is the task hidden?
          if (this.isHiddenTask(taskDef)) {
            if (!filteredTaskService.isUnhidden(item.id!) && !filteredTaskService.isFiltered(item.id!)) {
              filteredTaskService.hideTask(item);
            }
          }

          tasks.push(item);
        }
        continue;
      }

      const files = await filesService.findFiles(glob_include, exclude_joined);
      for (const file of files) {
        this.logger.debug(`[${this.type}TaskProvider] Processing file: ${file.fsPath} for provider: ${provider}`);
        const iconPath = iconService.getTaskIcon(langId, file);

        for (const taskDef of taskDefs) {
          const item = new TaskItem(
            taskDef.label,
            vscode.TreeItemCollapsibleState.None,
            langId, // Use the language ID as the type
            file,
            undefined,
            iconPath,
          );
          item.taskFileUri = file;

          // Mark this item as backed by a workspace-defined task so TaskRunner
          // can resolve the declared command rather than using the default type handler
          item.taskSource = provider;
          item.description = vscode.workspace.asRelativePath(file);

          // We'll set command to simple open file for double click,
          // but execution will be handled by TaskRunner via context/type
          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0],
          };

          // is the task hidden?
          if (this.isHiddenTask(taskDef)) {
            if (!filteredTaskService.isUnhidden(item.id!) && !filteredTaskService.isFiltered(item.id!)) {
              filteredTaskService.hideTask(item);
            }
          }

          tasks.push(item);
        }
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
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
