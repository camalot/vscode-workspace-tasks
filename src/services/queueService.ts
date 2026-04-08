import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

export type QueueExecutionType = 'sequential' | 'parallel';

interface SerializedTaskItem {
  id: string;
  label: string;
  taskType: string;
  resourceUri?: string;
  startLine?: number;
  originalLabel?: string;
  metadata?: any;
}

interface SerializedQueue {
  executionType: QueueExecutionType;
  items: SerializedTaskItem[];
}

export interface QueueCancellationToken {
  cancelled: boolean;
}

export class QueueService {
  private static instance: QueueService;
  private queues: Map<string, TaskItem[]> = new Map();
  private queueTypes: Map<string, QueueExecutionType> = new Map();
  private runningQueues: Map<string, QueueCancellationToken> = new Map();
  private context: vscode.ExtensionContext | undefined;
  private readonly STORAGE_KEY = 'savedQueues';

  private _onQueueStateChanged = new vscode.EventEmitter<{ name: string; running: boolean }>();
  public readonly onQueueStateChanged = this._onQueueStateChanged.event;

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    // Restore Queues
    // Check for new persistence format first
    // Switch to workspaceState
    const savedQueues = context.workspaceState.get<Record<string, SerializedQueue | SerializedTaskItem[]>>(this.STORAGE_KEY);

    let queuesToLoad = savedQueues;
    let sourceIsGlobal = false;

    if (!queuesToLoad) {
        const globalQueues = context.globalState.get<Record<string, SerializedQueue | SerializedTaskItem[]>>(this.STORAGE_KEY);
        if (globalQueues) {
            queuesToLoad = globalQueues;
            sourceIsGlobal = true;
        }
    }

    let hasMigration = sourceIsGlobal; // Valid reason to save back to workspaceState

    if (queuesToLoad) {
      Object.entries(queuesToLoad).forEach(([queueName, value]) => {
        // Migrate from old format (array) to new format (SerializedQueue object)
        let serializedQueue: SerializedQueue;
        if (Array.isArray(value)) {
          serializedQueue = { executionType: 'sequential', items: value as SerializedTaskItem[] };
          hasMigration = true;
        } else {
          serializedQueue = value as SerializedQueue;
        }

        this.queueTypes.set(queueName, serializedQueue.executionType ?? 'sequential');

        // Track if any IDs were migrated during deserialization
        const originalIds = serializedQueue.items.map(q => q.id);
        const deserializedTasks = this.deserializeTasks(serializedQueue.items);
        const newIds = deserializedTasks.map(t => TaskStateManager.getInstance().getTaskId(t));

        if (JSON.stringify(originalIds) !== JSON.stringify(newIds)) {
          hasMigration = true;
        }

        this.queues.set(queueName, deserializedTasks);
      });
    } else {
      // Legacy Migration: Check for old 'queueItems'
      // Legacy was definitely global?
      const legacyQueue = context.globalState.get<SerializedTaskItem[]>('queueItems', []);
      if (legacyQueue.length > 0) {
        const legacyName = context.globalState.get<string>('queueName', 'Queue');
        this.queues.set(legacyName, this.deserializeTasks(legacyQueue));
        this.queueTypes.set(legacyName, 'sequential');
        hasMigration = true;
      }
    }

    // If any IDs were migrated, save the normalized data back to storage (workspaceState)
    if (hasMigration) {
      this.saveQueues();
    }
  }

  /**
   * Marks a queue as running and returns a cancellation token.
   * The token's `cancelled` property can be set to true to stop the queue loop.
   */
  public markQueueRunning(name: string): QueueCancellationToken {
    const token: QueueCancellationToken = { cancelled: false };
    this.runningQueues.set(name, token);
    this._onQueueStateChanged.fire({ name, running: true });
    return token;
  }

  /**
   * Marks a queue as stopped (completed normally).
   */
  public markQueueStopped(name: string): void {
    if (this.runningQueues.has(name)) {
      this.runningQueues.delete(name);
      this._onQueueStateChanged.fire({ name, running: false });
    }
  }

  /**
   * Returns true if the named queue is currently running.
   */
  public isQueueRunning(name: string): boolean {
    return this.runningQueues.has(name);
  }

  /**
   * Cancels a running queue (signals the loop to stop and no new tasks will start).
   */
  public cancelQueue(name: string): void {
    const token = this.runningQueues.get(name);
    if (token) {
      token.cancelled = true;
      this.runningQueues.delete(name);
      this._onQueueStateChanged.fire({ name, running: false });
    }
  }

  public getAllQueues(): Map<string, TaskItem[]> {
    // Filter tasks to only include those in the current workspace or with accessible files
    const filteredQueues = new Map<string, TaskItem[]>();
    for (const [name, tasks] of this.queues) {
      const validTasks = tasks.filter((task) => {
        const uri = task.taskFileUri || task.resourceUri;
        if (!uri) { return true; } // Keep tasks without URI (e.g. some virtual tasks)
        // Check if file exists and is in workspace
        const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
        return !!wsFolder;
      });
      if (validTasks.length > 0) {
        filteredQueues.set(name, validTasks);
      }
    }
    return filteredQueues;
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

  private saveQueues() {
    if (!this.context) {
      return;
    }

    const serializedQueues: Record<string, SerializedQueue> = {};

    for (const [name, tasks] of this.queues) {
      if (tasks.length > 0) {
        serializedQueues[name] = {
          executionType: this.queueTypes.get(name) ?? 'sequential',
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
    this.context.workspaceState.update(this.STORAGE_KEY, serializedQueues);
  }

  public getQueue(name: string): TaskItem[] | undefined {
    return this.queues.get(name);
  }

  public getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  public createQueue(name: string, executionType: QueueExecutionType = 'sequential') {
    if (!this.queues.has(name)) {
      this.queues.set(name, []);
      this.queueTypes.set(name, executionType);
      this.saveQueues();
    }
  }

  public getQueueExecutionType(name: string): QueueExecutionType {
    return this.queueTypes.get(name) ?? 'sequential';
  }

  public setQueueExecutionType(name: string, executionType: QueueExecutionType) {
    this.queueTypes.set(name, executionType);
    this.saveQueues();
  }

  public addToQueue(item: TaskItem, queueName: string) {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }

    const queue = this.queues.get(queueName)!;
    const taskStateManager = TaskStateManager.getInstance();

    // Avoid duplicates based on ID
    const id = taskStateManager.getTaskId(item);
    if (!queue.some((t) => taskStateManager.getTaskId(t) === id)) {
      // FIX: If item is a grouped item, label is partial. Use originalLabel if available.
      const fullLabel = item.originalLabel || item.label;

      // Reconstruct the item to ensure we store a clean copy with the full label
      // Use taskFileUri if available to ensure we store the real file path, not the decoration URI
      const queueItem = new TaskItem(
        fullLabel,
        vscode.TreeItemCollapsibleState.None,
        item.taskType,
        item.taskFileUri || item.resourceUri,
        item.command,
      );
      if (item.taskFileUri) {
        queueItem.taskFileUri = item.taskFileUri;
      }
      // Persist the original ID
      queueItem.id = id;
      queueItem.startLine = item.startLine;
      // Ensure originalLabel is set consistently
      queueItem.originalLabel = fullLabel;
      queueItem.metadata = item.metadata;

      // Set context value for queue
      queueItem.contextValue = 'queuedTask';

      // Restore description
      if (item.resourceUri) {
        const wsFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
        queueItem.description = wsFolder ? wsFolder.name : '';
      }

      queue.push(queueItem);
      this.saveQueues();
    }
  }

  public removeFromQueue(item: TaskItem, queueName?: string) {
    const taskStateManager = TaskStateManager.getInstance();
    const id = taskStateManager.getTaskId(item);

    if (queueName && this.queues.has(queueName)) {
      const queue = this.queues.get(queueName)!;
      const newQueue = queue.filter((t) => taskStateManager.getTaskId(t) !== id);
      this.queues.set(queueName, newQueue);
      if (newQueue.length === 0) {
        this.queues.delete(queueName);
      }
    } else {
      // Search all queues
      for (const [name, tasks] of this.queues) {
        const idx = tasks.findIndex((t) => taskStateManager.getTaskId(t) === id);
        if (idx > -1) {
          tasks.splice(idx, 1);
          if (tasks.length === 0) {
            this.queues.delete(name);
          } else {
            this.queues.set(name, tasks);
          }
        }
      }
    }

    this.saveQueues();
  }

  public clearQueue(queueName: string) {
    this.queues.delete(queueName);
    this.queueTypes.delete(queueName);
    this.saveQueues();
  }

  public renameQueue(oldName: string, newName: string) {
    if (this.queues.has(oldName)) {
      const tasks = this.queues.get(oldName)!;
      const executionType = this.queueTypes.get(oldName) ?? 'sequential';
      this.queues.delete(oldName);
      this.queueTypes.delete(oldName);
      this.queues.set(newName, tasks);
      this.queueTypes.set(newName, executionType);
      this.saveQueues();
    }
  }

  public moveQueueItem(sourceItem: TaskItem, targetItem: TaskItem) {
    const taskStateManager = TaskStateManager.getInstance();
    let targetQueueName: string | undefined;
    let sourceQueueName: string | undefined;

    for (const [name, tasks] of this.queues) {
      if (tasks.some((t) => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(sourceItem))) {
        sourceQueueName = name;
      }
      if (tasks.some((t) => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(targetItem))) {
        targetQueueName = name;
      }
    }

    if (sourceQueueName && targetQueueName && sourceQueueName === targetQueueName) {
      const queue = this.queues.get(sourceQueueName)!;
      const sourceId = taskStateManager.getTaskId(sourceItem);
      const targetId = taskStateManager.getTaskId(targetItem);

      const sourceIndex = queue.findIndex((t) => taskStateManager.getTaskId(t) === sourceId);
      const targetIndex = queue.findIndex((t) => taskStateManager.getTaskId(t) === targetId);

      if (sourceIndex > -1 && targetIndex > -1 && sourceIndex !== targetIndex) {
        const [item] = queue.splice(sourceIndex, 1);
        // We re-find target index because it might have shifted
        const newTargetIndex = queue.findIndex((t) => taskStateManager.getTaskId(t) === targetId);
        queue.splice(newTargetIndex, 0, item);
        this.saveQueues();
      }
    }
  }
}
