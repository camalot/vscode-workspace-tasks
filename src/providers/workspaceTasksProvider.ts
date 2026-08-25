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

  override getFilePatterns(): string[] {
    // Only the workspace configuration files pattern; dynamic glob_include patterns
    // are resolved at runtime and fall back to direct vscode.workspace.findFiles
    return this.mergeFilePatterns([this.filePattern!]);
  }

  async getTasks(): Promise<TaskItem[]> {
    // Check if workspace task type is enabled
    if (!this.enabled) {
      return [];
    }
    const totalStart = Date.now();
    const tasks: TaskItem[] = [];
    const service = WorkspaceTasksService.getInstance();
    const iconService = TaskIconService.getInstance();
    const filesService = TaskFilesService.getInstance();
    const filteredTaskService = FilteredTaskService.getInstance();

    const providers = await service.getProviders();
    this.logger.debug(`[WorkspaceTasksProvider] Found ${providers.length} provider(s) to process.`);

    // ── Phase 1: Collect provider metadata in parallel ────────────────────────
    // service.getTasks() is a config-cache lookup (no I/O after first load) so
    // running them concurrently is safe and avoids repeated async round-trips.
    const metaResults = await Promise.all(
      providers.map(async (provider) => {
        const config = service.getLanguageConfig(provider);
        if (!config) {
          this.logger.warn(`No configuration found for provider: ${provider}. Skipping.`);
          return null;
        }
        // Use the taskType from the config if available, otherwise fall back to the provider key.
        const effectiveType = config.taskType || provider;
        if (!TaskConfigService.getInstance().isTaskTypeEnabled(effectiveType)) {
          this.logger.debug(`Provider ${provider} (type: ${effectiveType}) is disabled. Skipping.`);
          return null;
        }
        const taskDefs = await service.getTasks(provider);
        const glob_include = config.globs?.include || [];
        const glob_exclude = config.globs?.exclude || [];
        const exclude_joined = glob_exclude.concat(constants.GLOB_GLOBAL_EXCLUDE);
        let langId = provider || 'shell';
        if (provider === this.type) {
          langId = 'shell';
        }
        this.logger.debug(`[WorkspaceTasksProvider] Provider "${provider}": ${taskDefs.length} task definition(s), ${glob_include.length} include glob(s).`);
        return { provider, config, taskDefs, glob_include, exclude_joined, langId };
      }),
    );

    // Keep only valid (non-null / non-disabled) entries — preserves original provider order.
    const metas = metaResults.filter((m): m is NonNullable<typeof m> => m !== null);

    // ── Phase 2: Fire all file searches concurrently ──────────────────────────
    // Providers with no globs resolve immediately with null (treated as no-file path).
    // With Fix 2, all dynamic globs are pre-registered → every search is a cache hit after
    // the first cold build, so concurrent calls cost nothing beyond one shared filesystem scan.
    const findStart = Date.now();
    const fileResults = await Promise.all(
      metas.map(({ glob_include, exclude_joined }) => {
        if (glob_include.length === 0) {
          return Promise.resolve(null as vscode.Uri[] | null);
        }
        return filesService.findFiles(glob_include, exclude_joined);
      }),
    );
    this.logger.debug(`[WorkspaceTasksProvider] Parallel file search for ${metas.length} provider(s) completed in ${Date.now() - findStart}ms.`);

    // ── Phase 3: Build task items in original provider order ─────────────────
    for (let i = 0; i < metas.length; i++) {
      const { provider, config, taskDefs, langId } = metas[i];
      const files = fileResults[i];

      // No-file path: tasks declared without any associated file
      if (files === null) {
        // if there are no include / exclude globs, BUT there are tasks
        // then the tasks be added without any file association.
        // the tasks will appear in the tree view but won't be linked to any specific file.
        // the "type" of the task will be the language ID. If the language ID is not recognized, it will default to 'shell'.
        if (taskDefs.length > 0) {
          const noFileResolved = iconService.resolveWorkspaceTaskTypeIcon(provider, config.iconUri);
          const noFileIconPath = noFileResolved.TaskIcon ?? iconService.getTaskIcon('task');
          const noFileDisplayUri = !noFileResolved.TaskIcon ? noFileResolved.DisplayUri : undefined;

          for (const taskDef of taskDefs) {
            // Use sourceUri if available (the .workspace-tasks.json file)
            const resourceUri = taskDef.sourceUri;
            const item = new TaskItem(
              taskDef.label,
              vscode.TreeItemCollapsibleState.None,
              this.type, // Unique task type
              resourceUri,
              undefined,
              noFileIconPath,
            );
            if (noFileDisplayUri) {
              item.iconDisplayUri = noFileDisplayUri;
            }
            item.taskFileUri = resourceUri;
            item.taskSource = provider;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [resourceUri, taskDef.line || 0],
            };
            if (this.isHiddenTask(taskDef)) {
              if (!filteredTaskService.isUnhidden(item.id!) && !filteredTaskService.isFiltered(item.id!)) {
                filteredTaskService.hideTask(item);
              }
            }
            tasks.push(item);
            if (taskDef.confirm) {
              item.guardedByDefinition = true;
            }
          }
          this.logger.debug(`[WorkspaceTasksProvider] Provider "${provider}" (no-file path) added ${taskDefs.length} task(s).`);
        }
        continue;
      }

      // File path: one task item per (file × taskDef)
      const fileResolved = iconService.resolveWorkspaceTaskTypeIcon(langId, config.iconUri);
      const fileDisplayUri = !fileResolved.TaskIcon ? fileResolved.DisplayUri : undefined;

      for (const file of files) {
        this.logger.debug(`[${this.type}TaskProvider] Processing file: ${file.fsPath} for provider: ${provider}`);
        const fileIconPath = fileResolved.TaskIcon ?? iconService.getTaskIcon(langId, file);
        const fileItemDisplayUri = !fileResolved.TaskIcon ? fileDisplayUri : undefined;

        for (const taskDef of taskDefs) {
          const item = new TaskItem(
            taskDef.label,
            vscode.TreeItemCollapsibleState.None,
            langId, // Use the language ID as the type
            file,
            undefined,
            fileIconPath,
          );
          if (fileItemDisplayUri) {
            item.iconDisplayUri = fileItemDisplayUri;
          }
          item.taskFileUri = file;
          item.taskSource = provider;
          item.description = vscode.workspace.asRelativePath(file);
          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0],
          };
          if (this.isHiddenTask(taskDef)) {
            if (!filteredTaskService.isUnhidden(item.id!) && !filteredTaskService.isFiltered(item.id!)) {
              filteredTaskService.hideTask(item);
            }
          }
          tasks.push(item);
          if (taskDef.confirm) {
            item.guardedByDefinition = true;
          }
        }
      }
      this.logger.debug(`[WorkspaceTasksProvider] Provider "${provider}" added ${taskDefs.length} task(s) from ${files.length} file(s).`);
    }

    this.logger.info(`[WorkspaceTasksProvider] getTasks() completed: ${tasks.length} total task(s) loaded in ${Date.now() - totalStart}ms.`);
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
