import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { findFilesByGlobAndLanguage } from '../libs/fileUtils';
import { WorkspaceTasksService } from '../services/workspaceTasksService';
import { TaskConfigService } from '../services/taskConfigService';
import constants from '../libs/constants';
import * as path from 'path';

export class WorkspaceTasksProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('workspace-task');
  }

  async getTasks(): Promise<TaskItem[]> {
    // Check if workspace task type is enabled
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const service = WorkspaceTasksService.getInstance();

    const providers = await service.getProviders();
    for (const provider of providers) {
      // Check if this specific provider type is enabled
      if (!TaskConfigService.getInstance().isTaskTypeEnabled(provider)) {
        continue;
      }

      const config = service.getLanguageConfig(provider);
      if (!config) {
        continue;
      }
      // Ensure we await the tasks definition since getTasks is async
      const taskDefs = await service.getTasks(provider);

      const glob_include = config.globs?.include || [];
      const glob_exclude = config.globs?.exclude || [];
      const exclude_joined = glob_exclude.concat(constants.GLOB_GLOBAL_EXCLUDE).join(',');

      let langId = provider || 'shell';
      if (provider === this.type) {
        langId = 'shell';
      }

      // if there are no include / exclude globs, BUT there are tasks
      // then the tasks be added without any file association.
      // the tasks will appear in the tree view but won't be linked to any specific file.
      // the "type" of the task will be the language ID. If the language ID is not recognized, it will default to 'shell'.
      if ((!glob_include || glob_include.length === 0) && taskDefs.length > 0) {
        console.debug(`Creating task items for provider ${provider} without specific file association`);
        for (const taskDef of taskDefs) {
          console.debug(`Creating task item for provider ${provider} with task ${taskDef.label} without specific file association`);

          // Use sourceUri if available (the .workspace-tasks.json file)
          const resourceUri = taskDef.sourceUri;

          let iconPath: { light: vscode.Uri; dark: vscode.Uri } | undefined;
          if (this.context) {
             iconPath = {
                light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', 'task.svg')),
                dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', 'task.svg'))
             };
          }

          const item = new TaskItem(
            taskDef.label,
            vscode.TreeItemCollapsibleState.None,
            this.type, // Unique task type
            resourceUri,
            undefined,
            iconPath
          );
          item.taskSource = provider;

          // Default click action: Open file at line
          item.command = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [resourceUri, taskDef.line || 0]
          };

          tasks.push(item);
        }
        continue;
      }

      console.debug(`Searching files for provider ${provider} with include globs: ${glob_include.join(',')} and exclude globs: ${glob_exclude.join(',')}`);

      // Join globs safely
      const includePattern = glob_include.length > 1 ? `{${glob_include.join(',')}}` : glob_include.join(',');

      const files = await findFilesByGlobAndLanguage(
        includePattern,
        exclude_joined,
        provider
      );
      for (const file of files) {
        for (const taskDef of taskDefs) {
          console.debug(`Creating task item for file ${file.fsPath} with task ${taskDef.label}`);
          const item = new TaskItem(
            taskDef.label,
            vscode.TreeItemCollapsibleState.None,
            langId, // Use the language ID as the type
            file
          );

          // Mark this item as backed by a workspace-defined task so TaskRunner
          // can resolve the declared command rather than using the default type handler
          item.taskSource = provider;

          item.description = vscode.workspace.asRelativePath(file);

          // We'll set command to simple open file for double click,
          // but execution will be handled by TaskRunner via context/type
          item.command = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0]
          };

          tasks.push(item);
        }
      }
    }
    return tasks;
  }
}
