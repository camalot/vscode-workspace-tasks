import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';
import { FavoritesService } from './favoritesService';
import { LoggerService } from './loggerService';
import { KNOWN_TASK_TYPES } from '../taskFactory';
import constants from '../libs/constants';

export type CompoundTaskExecutionType = 'sequential' | 'parallel';

interface SerializedTaskItem {
  id: string;
  label: string;
  taskType: string;
  resourceUri?: string;
  startLine?: number;
  originalLabel?: string;
  metadata?: any;
}

interface SerializedCompoundTask {
  executionType: CompoundTaskExecutionType;
  items: SerializedTaskItem[];
}

export interface CompoundTaskCancellationToken {
  cancelled: boolean;
}

export class CompoundTaskService {
  private static instance: CompoundTaskService;
  private compoundTasks: Map<string, TaskItem[]> = new Map();
  private compoundTaskTypes: Map<string, CompoundTaskExecutionType> = new Map();
  private runningCompoundTasks: Map<string, CompoundTaskCancellationToken> = new Map();
  private context: vscode.ExtensionContext | undefined;
  private readonly logger = LoggerService.getInstance();
  // The storage key remains as "savedQueues" for backwards compatibility with the old format and to avoid breaking existing data, but the feature is now called "compound tasks" in the UI and code.
  private readonly STORAGE_KEY = 'savedQueues';

  private _onCompoundTaskStateChanged = new vscode.EventEmitter<{ name: string; running: boolean }>();
  public readonly onCompoundTaskStateChanged = this._onCompoundTaskStateChanged.event;

  private constructor() {}

  public static getInstance(): CompoundTaskService {
    if (!CompoundTaskService.instance) {
      CompoundTaskService.instance = new CompoundTaskService();
    }
    return CompoundTaskService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    // Restore Compound Tasks from storage
    // Check for new persistence format first
    // Switch to workspaceState
    const savedCompoundTasks = context.workspaceState.get<Record<string, SerializedCompoundTask | SerializedTaskItem[]>>(this.STORAGE_KEY);

    let compoundTasksToLoad = savedCompoundTasks;
    let sourceIsGlobal = false;

    if (!compoundTasksToLoad) {
      const globalCompoundTasks = context.globalState.get<Record<string, SerializedCompoundTask | SerializedTaskItem[]>>(this.STORAGE_KEY);
        if (globalCompoundTasks) {
            compoundTasksToLoad = globalCompoundTasks;
            sourceIsGlobal = true;
        }
    }

    this.logger.debug(`[CompoundTaskService] Loading compound tasks from ${sourceIsGlobal ? 'globalState' : 'workspaceState'}.`);

    let hasMigration = sourceIsGlobal; // Valid reason to save back to workspaceState

    if (compoundTasksToLoad) {
      const keys = Object.keys(compoundTasksToLoad);
      this.logger.debug(`[CompoundTaskService] Found ${keys.length} compound task(s) in storage: [${keys.join(', ')}]`);

      Object.entries(compoundTasksToLoad).forEach(([compoundTaskName, value]) => {
        // Migrate from old format (array) to new format (SerializedCompoundTask object)
        let serializedCompoundTask: SerializedCompoundTask;
        if (Array.isArray(value)) {
          serializedCompoundTask = { executionType: 'sequential', items: value as SerializedTaskItem[] };
          hasMigration = true;
          this.logger.debug(`[CompoundTaskService] Migrating compound task '${compoundTaskName}' from legacy array format (${serializedCompoundTask.items.length} items).`);
        } else {
          serializedCompoundTask = value as SerializedCompoundTask;
        }

        this.compoundTaskTypes.set(compoundTaskName, serializedCompoundTask.executionType ?? 'sequential');

        this.logger.debug(`[CompoundTaskService] Loading compound task '${compoundTaskName}': ${serializedCompoundTask.items.length} item(s), executionType='${serializedCompoundTask.executionType ?? 'sequential'}'.`);
        serializedCompoundTask.items.forEach((item, idx) => {
          this.logger.debug(`[CompoundTaskService]   Item[${idx}]: id='${item.id}', label='${item.originalLabel || item.label}', taskType='${item.taskType}', resourceUri='${item.resourceUri ?? '(none)'}'`);
        });

        // Track if any IDs were migrated during deserialization
        const originalIds = serializedCompoundTask.items.map(q => q.id);
        const deserializedTasks = this.deserializeTasks(serializedCompoundTask.items);
        const newIds = deserializedTasks.map(t => TaskStateManager.getInstance().getTaskId(t));

        if (JSON.stringify(originalIds) !== JSON.stringify(newIds)) {
          hasMigration = true;
          this.logger.debug(`[CompoundTaskService] ID migration detected in '${compoundTaskName}'. Old IDs: [${originalIds.join(', ')}], New IDs: [${newIds.join(', ')}]`);
        }

        this.compoundTasks.set(compoundTaskName, deserializedTasks);
      });
    } else {
      // Legacy Migration: Check for old 'queueItems'
      // Legacy was definitely global?
      const legacyCompoundTasks = context.globalState.get<SerializedTaskItem[]>('queueItems', []);
      if (legacyCompoundTasks.length > 0) {
        const legacyName = context.globalState.get<string>('queueName', 'Compound Task');
        this.logger.debug(`[CompoundTaskService] Migrating legacy 'queueItems' to compound task '${legacyName}' with ${legacyCompoundTasks.length} item(s).`);
        this.compoundTasks.set(legacyName, this.deserializeTasks(legacyCompoundTasks));
        this.compoundTaskTypes.set(legacyName, 'sequential');
        hasMigration = true;
      } else {
        this.logger.debug('[CompoundTaskService] No compound tasks found in storage.');
      }
    }

    // If any IDs were migrated, save the normalized data back to storage (workspaceState)
    if (hasMigration) {
      this.saveCompoundTasks();
    }
  }

  /**
   * Marks a compound task as running and returns a cancellation token.
   * The token's `cancelled` property can be set to true to stop the compound task loop.
   */
  public markCompoundTaskRunning(name: string): CompoundTaskCancellationToken {
    const token: CompoundTaskCancellationToken = { cancelled: false };
    this.runningCompoundTasks.set(name, token);
    this._onCompoundTaskStateChanged.fire({ name, running: true });
    return token;
  }

  /**
   * Marks a compound task as stopped (completed normally).
   */
  public markCompoundTaskStopped(name: string): void {
    if (this.runningCompoundTasks.has(name)) {
      this.runningCompoundTasks.delete(name);
      this._onCompoundTaskStateChanged.fire({ name, running: false });
    }
  }

  /**
   * Returns true if the named compound task is currently running.
   */
  public isCompoundTaskRunning(name: string): boolean {
    return this.runningCompoundTasks.has(name);
  }

  /**
   * Cancels a running compound task (signals the loop to stop and no new tasks will start).
   */
  public cancelCompoundTask(name: string): void {
    const token = this.runningCompoundTasks.get(name);
    if (token) {
      token.cancelled = true;
      this.runningCompoundTasks.delete(name);
      this._onCompoundTaskStateChanged.fire({ name, running: false });
    }
  }

  public getAllCompoundTasks(): Map<string, TaskItem[]> {
    // Filter tasks to only include those in the current workspace or with accessible files.
    // Use taskFileUri only — resourceUri is a virtual workspace-tasks:// decoration URI set by
    // updateContextValue() and is never a real filesystem path.
    const filteredCompoundTasks = new Map<string, TaskItem[]>();
    for (const [name, tasks] of this.compoundTasks) {
      const validTasks = tasks.filter((task) => {
        const uri = task.taskFileUri;
        if (!uri) { return true; } // Keep tasks without a real file URI (e.g. workspace-level tasks)
        // Check if file exists and is in workspace
        const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
        return !!wsFolder;
      });
      if (validTasks.length > 0) {
        filteredCompoundTasks.set(name, validTasks);
      } else {
        this.logger.debug(`[CompoundTaskService] Compound task '${name}' has ${tasks.length} stored item(s) but none are valid in the current workspace — it will not be shown in the UI.`);
        tasks.forEach((task, idx) => {
          const uri = task.taskFileUri;
          this.logger.debug(`[CompoundTaskService]   Item[${idx}]: label='${task.originalLabel || task.label}', taskType='${task.taskType}', uri='${uri?.toString() ?? '(none)'}', inWorkspace=${uri ? !!vscode.workspace.getWorkspaceFolder(uri) : false}`);
        });
      }
    }
    return filteredCompoundTasks;
  }

  /**
   * Returns all stored compound tasks without workspace filtering.
   * Includes compound tasks that have no valid tasks in the current workspace (ghost tasks).
   */
  public getAllCompoundTasksRaw(): Map<string, TaskItem[]> {
    return new Map(this.compoundTasks);
  }

  /**
   * Removes compound tasks from storage that have no valid tasks in the current workspace.
   * This clears "ghost" compound tasks that are stored but invisible in the UI.
   * @returns The names of compound tasks that were purged.
   */
  public purgeInvalidCompoundTasks(): string[] {
    const purged: string[] = [];
    for (const [name, tasks] of this.compoundTasks) {
      const hasValidTask = tasks.some((task) => {
        const uri = task.taskFileUri; // taskFileUri is the real file path; resourceUri is a virtual decoration URI
        if (!uri) { return true; } // No real file URI → workspace-independent task, always valid
        return !!vscode.workspace.getWorkspaceFolder(uri);
      });
      if (!hasValidTask) {
        this.logger.debug(`[CompoundTaskService] Purging invalid compound task '${name}' (${tasks.length} stored item(s), none valid in workspace).`);
        purged.push(name);
      }
    }
    for (const name of purged) {
      this.compoundTasks.delete(name);
      this.compoundTaskTypes.delete(name);
    }
    if (purged.length > 0) {
      this.saveCompoundTasks();
      this.logger.debug(`[CompoundTaskService] Purged ${purged.length} invalid compound task(s): [${purged.join(', ')}]`);
    }
    return purged;
  }

  /**
   * Returns a diagnostic map of compound task name → items that are stored but cannot be run
   * because their URI is outside the current workspace.
   * Items with no URI are not included (they are considered workspace-independent).
   */
  public getInvalidItemsByCompoundTask(): Map<string, TaskItem[]> {
    const result = new Map<string, TaskItem[]>();
    for (const [name, tasks] of this.compoundTasks) {
      const invalid = tasks.filter((task) => {
        const uri = task.taskFileUri; // taskFileUri is the real file path; resourceUri is a virtual decoration URI
        return !!uri && !vscode.workspace.getWorkspaceFolder(uri);
      });
      if (invalid.length > 0) {
        result.set(name, invalid);
      }
    }
    return result;
  }

  /**
   * Returns whether a stored task item is definitely not runnable.
   * An item is considered definitely not runnable if:
   *  - It has no native vscode.Task set
   *  - It has no taskSource (to resolve via workspace tasks)
   *  - Its taskType is not in the set of task types handled by createTaskForItem
   */
  public isItemDefinitelyNotRunnable(item: TaskItem): boolean {
    if (item.task instanceof vscode.Task) { return false; }
    if ((item as any).taskSource) { return false; }
    const taskType = item.taskType || '';
    return !KNOWN_TASK_TYPES.has(taskType);
  }

  /**
   * Automatically removes items from within compound tasks that are definitively not runnable
   * (their taskType is not handled by any task provider and they have no taskSource).
   * Items with out-of-workspace URIs are NOT removed automatically by this method —
   * use getInvalidItemsByCompoundTask() and removeItemFromCompoundTask() for those.
   * @returns Map of compound task name → labels of removed items.
   */
  public purgeUnrunnableItems(): Map<string, string[]> {
    const removedByTask = new Map<string, string[]>();
    const nowEmptyTasks: string[] = [];

    for (const [name, tasks] of this.compoundTasks) {
      const validItems: TaskItem[] = [];
      const removedLabels: string[] = [];

      for (const task of tasks) {
        if (this.isItemDefinitelyNotRunnable(task)) {
          const label = task.originalLabel || (task.label as string);
          this.logger.debug(`[CompoundTaskService] Removing definitely-unrunnable item '${label}' from compound task '${name}': taskType='${task.taskType || '(empty)'}' is not a recognized task type.`);
          removedLabels.push(label);
        } else {
          validItems.push(task);
        }
      }

      if (removedLabels.length > 0) {
        removedByTask.set(name, removedLabels);
        this.compoundTasks.set(name, validItems);
        if (validItems.length === 0) {
          nowEmptyTasks.push(name);
        }
      }
    }

    for (const name of nowEmptyTasks) {
      this.compoundTasks.delete(name);
      this.compoundTaskTypes.delete(name);
      this.logger.debug(`[CompoundTaskService] Compound task '${name}' became empty after purging unrunnable items and has been removed.`);
    }

    if (removedByTask.size > 0) {
      this.saveCompoundTasks();
      this.logger.debug(`[CompoundTaskService] Purged unrunnable items from ${removedByTask.size} compound task(s).`);
    }

    return removedByTask;
  }

  private deserializeTasks(serialized: SerializedTaskItem[]): TaskItem[] {
    const stateManager = TaskStateManager.getInstance();
    return serialized.map((sq) => {
      const uri = sq.resourceUri ? vscode.Uri.parse(sq.resourceUri) : undefined;
      const label = sq.originalLabel || sq.label; // Prefer original label
      const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, sq.taskType, uri);
      if (sq.id) {
        // Normalize the stored ID to handle old format
        item.id = stateManager.normalizeTaskId(sq.id);
      }
      item.originalLabel = label;
      item.startLine = sq.startLine;
      item.metadata = sq.metadata;
      // Restore context value
      item.contextValue = 'queuedTask';
      // Restore description (workspace folder name)
      if (uri) {
        const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
        item.description = wsFolder ? wsFolder.name : '';
      }

      // Restore Command (Open File)
      if (uri && item.startLine !== undefined) {
        item.command = {
          command: 'workspaceTasks.openFileAtLine',
          // TODO: use localized string
          title: 'Open File',
          arguments: [uri, item.startLine],
        };
      }

      return item;
    });
  }

  private saveCompoundTasks() {
    if (!this.context) {
      return;
    }

    const serializedCompoundTasks: Record<string, SerializedCompoundTask> = {};

    for (const [name, tasks] of this.compoundTasks) {
      if (tasks.length > 0) {
        serializedCompoundTasks[name] = {
          executionType: this.compoundTaskTypes.get(name) ?? 'sequential',
          items: tasks.map((q) => ({
            id: TaskStateManager.getInstance().getTaskId(q),
            label: q.label,
            originalLabel: q.originalLabel || q.label,
            taskType: q.taskType,
            resourceUri: (q.taskFileUri || q.resourceUri)?.toString(),
            startLine: q.startLine,
            metadata: q.metadata,
          })),
        };
      }
    }
    this.context.workspaceState.update(this.STORAGE_KEY, serializedCompoundTasks);
  }

  public getCompoundTask(name: string): TaskItem[] | undefined {
    return this.compoundTasks.get(name);
  }

  public getCompoundTaskNames(): string[] {
    return Array.from(this.compoundTasks.keys());
  }

  private getConfigDefaultExecutionType(): CompoundTaskExecutionType {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    return config.get<CompoundTaskExecutionType>('compoundTasks.defaultExecutionType', 'sequential');
  }

  public createCompoundTask(name: string, executionType?: CompoundTaskExecutionType) {
    if (!this.compoundTasks.has(name)) {
      this.compoundTasks.set(name, []);
      this.compoundTaskTypes.set(name, executionType ?? this.getConfigDefaultExecutionType());
      this.saveCompoundTasks();
    }
  }

  public getCompoundTaskExecutionType(name: string): CompoundTaskExecutionType {
    return this.compoundTaskTypes.get(name) ?? this.getConfigDefaultExecutionType();
  }

  public setCompoundTaskExecutionType(name: string, executionType: CompoundTaskExecutionType) {
    this.compoundTaskTypes.set(name, executionType);
    this.saveCompoundTasks();
  }

  public addToCompoundTask(item: TaskItem, compoundTaskName: string) {
    if (!this.compoundTasks.has(compoundTaskName)) {
      this.compoundTasks.set(compoundTaskName, []);
      this.compoundTaskTypes.set(compoundTaskName, this.getConfigDefaultExecutionType());
    }

    const compoundTask = this.compoundTasks.get(compoundTaskName)!;
    const taskStateManager = TaskStateManager.getInstance();

    // Avoid duplicates based on ID
    const id = taskStateManager.getTaskId(item);
    if (!compoundTask.some((t) => taskStateManager.getTaskId(t) === id)) {
      // FIX: If item is a grouped item, label is partial. Use originalLabel if available.
      const fullLabel = item.originalLabel || item.label;

      // Reconstruct the item to ensure we store a clean copy with the full label
      // Use taskFileUri only (the real file path). Do NOT fall back to resourceUri which
      // is a virtual workspace-tasks:// decoration URI and would be misinterpreted as an
      // out-of-workspace file path by purgeInvalidCompoundTasks / getInvalidItemsByCompoundTask.
      const compoundTaskItem = new TaskItem(
        fullLabel,
        vscode.TreeItemCollapsibleState.None,
        item.taskType,
        item.taskFileUri,
        item.command,
      );
      if (item.taskFileUri) {
        compoundTaskItem.taskFileUri = item.taskFileUri;
      }
      // Persist the original ID
      compoundTaskItem.id = id;
      compoundTaskItem.startLine = item.startLine;
      // Ensure originalLabel is set consistently
      compoundTaskItem.originalLabel = fullLabel;
      compoundTaskItem.metadata = item.metadata;
      // Preserve taskSource so isItemDefinitelyNotRunnable can detect workspace-resolvable tasks
      compoundTaskItem.taskSource = item.taskSource;

      // Set context value for compound task
      compoundTaskItem.contextValue = 'queuedTask';

      // Restore description
      if (item.resourceUri) {
        const wsFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
        compoundTaskItem.description = wsFolder ? wsFolder.name : '';
      }

      compoundTask.push(compoundTaskItem);
      this.saveCompoundTasks();
    }
  }

  public removeFromCompoundTask(item: TaskItem, compoundTaskName?: string) {
    const taskStateManager = TaskStateManager.getInstance();
    const id = taskStateManager.getTaskId(item);

    if (compoundTaskName && this.compoundTasks.has(compoundTaskName)) {
      const compoundTask = this.compoundTasks.get(compoundTaskName)!;
      const newCompoundTask = compoundTask.filter((t) => taskStateManager.getTaskId(t) !== id);
      this.compoundTasks.set(compoundTaskName, newCompoundTask);
      if (newCompoundTask.length === 0) {
        this.compoundTasks.delete(compoundTaskName);
      }
    } else {
      // Search all compound tasks to find and remove the item
      for (const [name, tasks] of this.compoundTasks) {
        const idx = tasks.findIndex((t) => taskStateManager.getTaskId(t) === id);
        if (idx > -1) {
          tasks.splice(idx, 1);
          if (tasks.length === 0) {
            this.compoundTasks.delete(name);
          } else {
            this.compoundTasks.set(name, tasks);
          }
        }
      }
    }

    this.saveCompoundTasks();
  }

  public clearCompoundTask(compoundTaskName: string) {
    this.compoundTasks.delete(compoundTaskName);
    this.compoundTaskTypes.delete(compoundTaskName);
    this.saveCompoundTasks();
  }

  public renameCompoundTask(oldName: string, newName: string) {
    if (this.compoundTasks.has(oldName)) {
      const tasks = this.compoundTasks.get(oldName)!;
      const executionType = this.compoundTaskTypes.get(oldName) ?? 'sequential';
      this.compoundTasks.delete(oldName);
      this.compoundTaskTypes.delete(oldName);
      this.compoundTasks.set(newName, tasks);
      this.compoundTaskTypes.set(newName, executionType);
      this.saveCompoundTasks();

      // Update favorites if the compound task group was favorited
      const oldId = `${constants.COMPOUND_TASK_ID_PREFIX}:${oldName}`;
      const newId = `${constants.COMPOUND_TASK_ID_PREFIX}:${newName}`;
      FavoritesService.getInstance().updateFavoriteId(oldId, newId);
    }
  }

  public moveCompoundTaskItem(sourceItem: TaskItem, targetItem: TaskItem) {
    const taskStateManager = TaskStateManager.getInstance();
    let targetCompoundTaskName: string | undefined;
    let sourceCompoundTaskName: string | undefined;

    for (const [name, tasks] of this.compoundTasks) {
      if (tasks.some((t) => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(sourceItem))) {
        sourceCompoundTaskName = name;
      }
      if (tasks.some((t) => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(targetItem))) {
        targetCompoundTaskName = name;
      }
    }

    if (sourceCompoundTaskName && targetCompoundTaskName && sourceCompoundTaskName === targetCompoundTaskName) {
      const compoundTask = this.compoundTasks.get(sourceCompoundTaskName)!;
      const sourceId = taskStateManager.getTaskId(sourceItem);
      const targetId = taskStateManager.getTaskId(targetItem);

      const sourceIndex = compoundTask.findIndex((t) => taskStateManager.getTaskId(t) === sourceId);
      const targetIndex = compoundTask.findIndex((t) => taskStateManager.getTaskId(t) === targetId);

      if (sourceIndex > -1 && targetIndex > -1 && sourceIndex !== targetIndex) {
        const [item] = compoundTask.splice(sourceIndex, 1);
        // We re-find target index because it might have shifted
        const newTargetIndex = compoundTask.findIndex((t) => taskStateManager.getTaskId(t) === targetId);
        compoundTask.splice(newTargetIndex, 0, item);
        this.saveCompoundTasks();
      }
    }
  }
}
