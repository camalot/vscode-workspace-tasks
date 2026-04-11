import * as vscode from 'vscode';
import { TaskProvider, BaseTaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { FilteredTaskService } from '../services/filteredTaskService';

interface VscodeTaskDependencyObject {
  task?: string;
}

interface VscodeTaskDefinition {
  label?: string;
  dependsOn?: string | VscodeTaskDependencyObject | Array<string | VscodeTaskDependencyObject>;
}

interface VscodeTasksFile {
  tasks?: VscodeTaskDefinition[];
}

function parseDependsOnLabels(dependsOn: VscodeTaskDefinition['dependsOn']): string[] {
  const labels: string[] = [];

  if (typeof dependsOn === 'string') {
    labels.push(dependsOn);
    return labels;
  }

  if (Array.isArray(dependsOn)) {
    for (const dep of dependsOn) {
      if (typeof dep === 'string') {
        labels.push(dep);
      } else if (dep && typeof dep.task === 'string') {
        labels.push(dep.task);
      }
    }
    return labels;
  }

  if (dependsOn && typeof dependsOn.task === 'string') {
    labels.push(dependsOn.task);
  }

  return labels;
}

function getDependsOnMap(text: string): Map<string, string[]> {
  let parsed: VscodeTasksFile;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonText = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*/gm, '')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    parsed = JSON.parse(jsonText);
  }

  const dependsOnMap = new Map<string, string[]>();
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  for (const task of tasks) {
    if (!task.label) {
      continue;
    }
    dependsOnMap.set(task.label.toLowerCase(), parseDependsOnLabels(task.dependsOn));
  }

  return dependsOnMap;
}

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
    const start = Date.now();
    const tasks: TaskItem[] = [];
    const taskTextByFile = new Map<string, string>();
    const dependsOnByFile = new Map<string, Map<string, string[]>>();

    // Phase 1: fetch all registered VS Code tasks.
    // Include both workspace tasks and user-level tasks (source 'Workspace' or 'User').
    // Note: user profile tasks also have source 'Workspace' in real VSCode.
    const allTasks: vscode.Task[] = await vscode.tasks.fetchTasks();
    const vscodeTasks = allTasks.filter((t => t.source === 'Workspace' || t.source === 'User'));
    this.logger.debug(`[VscodeTaskProvider] Fetched ${vscodeTasks.length} system tasks from VSCode.`);

    // Phase 2: resolve file URI and scope metadata for every task (synchronous).
    // Workspace-folder tasks have an object scope with a .uri property (vscode.WorkspaceFolder).
    // User profile tasks have a numeric scope (TaskScope.Global=1 or TaskScope.Workspace=2),
    // NOT a WorkspaceFolder object. Checking typeof lets us distinguish them reliably without
    // depending on a specific enum value that may vary across VSCode versions.
    interface VscodeTaskMeta {
      vscodeTask: vscode.Task;
      label: string;
      fileUri: vscode.Uri | undefined;
      isUserProfileTask: boolean;
    }
    const taskMetas: VscodeTaskMeta[] = vscodeTasks.map((vscodeTask) => {
      const label = vscodeTask.name || 'Unnamed Task';
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
      if (!isUserProfileTask) {
        if (vscodeTask.definition._source) {
          // Use the _source property if available (more specific than folder default)
          fileUri = typeof vscodeTask.definition._source === 'string'
            ? vscode.Uri.file(vscodeTask.definition._source)
            : vscodeTask.definition._source;
        } else {
          // Workspace folder task — use the folder's .vscode/tasks.json
          fileUri = vscode.Uri.joinPath(workspaceFolderScope!.uri, '.vscode', 'tasks.json');
        }
      }
      return { vscodeTask, label, fileUri, isUserProfileTask };
    });

    // Phase 3 (Fix 5a): open all unique task files in parallel rather than one-at-a-time inside
    // the serial processing loop. A cold openTextDocument call can take 385ms+; batching them
    // with Promise.all turns N sequential waits into a single concurrent wait.
    const uniqueFileUris = new Map<string, vscode.Uri>();
    for (const { fileUri } of taskMetas) {
      if (fileUri) {
        uniqueFileUris.set(fileUri.toString(), fileUri);
      }
    }
    await Promise.all(
      [...uniqueFileUris.values()].map(async (uri) => {
        const key = uri.toString();
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          const text = document.getText();
          taskTextByFile.set(key, text);
          if (text) {
            try {
              dependsOnByFile.set(key, getDependsOnMap(text));
            } catch {
              // Ignore parse errors and continue without compound metadata.
            }
          }
        } catch {
          // File may not exist (e.g. user tasks.json on a machine that has none)
          this.logger.debug(`[VscodeTaskProvider] - Could not open file: ${uri.fsPath}`);
          taskTextByFile.set(key, '');
        }
      }),
    );

    // Phase 4 (Fix 5b): build per-file line-number index for all expected task labels.
    // Groups all labels per file, then splits each file's text exactly once and scans for every
    // label in a single pass — O(lines + labels) per file instead of O(lines × tasks).
    const labelsByFile = new Map<string, string[]>();
    for (const { fileUri, label } of taskMetas) {
      if (!fileUri) {
        continue;
      }
      const key = fileUri.toString();
      if (!labelsByFile.has(key)) {
        labelsByFile.set(key, []);
      }
      labelsByFile.get(key)!.push(label);
    }
    const lineNumberByFile = new Map<string, Map<string, number>>();
    for (const [key, labels] of labelsByFile) {
      const text = taskTextByFile.get(key) ?? '';
      const lines = text.split('\n');
      const fileLineMap = new Map<string, number>();
      lineNumberByFile.set(key, fileLineMap);
      const remaining = new Set(labels);
      for (let i = 0; i < lines.length && remaining.size > 0; i++) {
        for (const lbl of remaining) {
          if (lines[i].includes(`"${lbl}"`)) {
            fileLineMap.set(lbl, i);
            remaining.delete(lbl);
            break;
          }
        }
      }
    }

    // Phase 5: build TaskItems from pre-fetched data (entirely synchronous).
    for (const { vscodeTask, label, fileUri, isUserProfileTask } of taskMetas) {
      this.logger.debug(`[VscodeTaskProvider] - Processing Task: ${vscodeTask.name}, Source: ${vscodeTask.source}`);

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

      if (fileUri) {
        const fileKey = fileUri.toString();
        const dependsOnMap = dependsOnByFile.get(fileKey);
        if (dependsOnMap) {
          const dependsOnLabels = dependsOnMap.get((label || '').toLowerCase()) ?? [];
          if (dependsOnLabels.length > 0) {
            item.metadata = {
              ...(item.metadata || {}),
              dependsOnLabels,
            };
          }
        }
        item.startLine = lineNumberByFile.get(fileKey)?.get(label);
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

    const byFileAndLabel = new Map<string, TaskItem>();
    for (const task of tasks) {
      if (!task.taskFileUri) {
        continue;
      }
      const key = `${task.taskFileUri.toString()}::${(task.originalLabel || task.label).toLowerCase()}`;
      if (!byFileAndLabel.has(key)) {
        byFileAndLabel.set(key, task);
      }
    }

    const buildChildren = (
      parent: TaskItem,
      labels: string[],
      lineage: Set<string>,
    ): TaskItem[] => {
      const children: TaskItem[] = [];
      const parentFileKey = parent.taskFileUri?.toString();
      if (!parentFileKey) {
        return children;
      }

      for (const label of labels) {
        const normalized = (label || '').toLowerCase();
        if (!normalized) {
          continue;
        }
        if (lineage.has(normalized)) {
          continue;
        }

        const target = byFileAndLabel.get(`${parentFileKey}::${normalized}`);
        if (!target) {
          continue;
        }

        const targetDepends = Array.isArray(target.metadata?.dependsOnLabels) ? target.metadata.dependsOnLabels : [];
        const child = new TaskItem(
          target.label,
          targetDepends.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          target.taskType,
          target.taskFileUri,
          target.command,
          target.defaultIconPath,
        );
        child.originalLabel = target.originalLabel || target.label;
        child.startLine = target.startLine;
        child.task = target.task;
        child.taskFileUri = target.taskFileUri;
        child.taskSource = target.taskSource;
        child.taskOrigin = target.taskOrigin;
        child.description = target.description;
        child.metadata = {
          ...(target.metadata || {}),
          dependsOnLabels: targetDepends,
        };

        const nextLineage = new Set(lineage);
        nextLineage.add(normalized);
        child.children = buildChildren(child, targetDepends, nextLineage);
        for (const grandChild of child.children) {
          grandChild.parent = child;
        }
        child.parent = parent;
        children.push(child);
      }

      return children;
    };

    for (const task of tasks) {
      const dependsOnLabels = Array.isArray(task.metadata?.dependsOnLabels) ? task.metadata.dependsOnLabels : [];
      if (dependsOnLabels.length === 0) {
        continue;
      }
      (task as any).collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      task.children = buildChildren(task, dependsOnLabels, new Set([task.label.toLowerCase()]));
      for (const child of task.children) {
        child.parent = task;
      }
    }

    this.logger.info(`[VscodeTaskProvider] getSystemTasks() completed: ${tasks.length} task(s) in ${Date.now() - start}ms`);
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
