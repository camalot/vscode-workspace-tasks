import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

interface SerializedTaskItem {
    id: string;
    label: string;
    taskType: string;
    resourceUri?: string;
    startLine?: number;
    originalLabel?: string;
    metadata?: any;
}

export class QueueService {
    private static instance: QueueService;
    private queues: Map<string, TaskItem[]> = new Map();
    private context: vscode.ExtensionContext | undefined;
    private readonly STORAGE_KEY = 'savedQueues';

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
        const savedQueues = context.globalState.get<Record<string, SerializedTaskItem[]>>(this.STORAGE_KEY);

        if (savedQueues) {
            Object.entries(savedQueues).forEach(([queueName, items]) => {
                this.queues.set(queueName, this.deserializeTasks(items));
            });
        } else {
            // Legacy Migration: Check for old 'queueItems'
            const legacyQueue = context.globalState.get<SerializedTaskItem[]>('queueItems', []);
            if (legacyQueue.length > 0) {
                 const legacyName = context.globalState.get<string>('queueName', 'Queue');
                 this.queues.set(legacyName, this.deserializeTasks(legacyQueue));
            }
        }
    }

    public getAllQueues(): Map<string, TaskItem[]> {
        return this.queues;
    }

    private deserializeTasks(serialized: SerializedTaskItem[]): TaskItem[] {
      return serialized.map(sq => {
          const uri = sq.resourceUri ? vscode.Uri.parse(sq.resourceUri) : undefined;
          const label = sq.originalLabel || sq.label; // Prefer original label
          const item = new TaskItem(
              label,
              vscode.TreeItemCollapsibleState.None,
              sq.taskType,
              uri
          );
          if (sq.id) {
            item.id = sq.id;
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
          if (uri && (item.startLine !== undefined)) {
               item.command = {
                   command: 'workspaceTasks.openFileAtLine',
                   title: '%command.openFileAtLine%',
                   arguments: [uri, item.startLine]
               };
          }

          return item;
      });
  }

  private saveQueues() {
    if (!this.context) {
        return;
    }

    const serializedQueues: Record<string, SerializedTaskItem[]> = {};

    for (const [name, tasks] of this.queues) {
        if (tasks.length > 0) {
            serializedQueues[name] = tasks.map(q => ({
                id: TaskStateManager.getInstance().getTaskId(q),
                label: q.label,
                originalLabel: q.originalLabel || q.label,
                taskType: q.taskType,
                resourceUri: q.resourceUri ? q.resourceUri.toString() : undefined,
                startLine: q.startLine,
                metadata: q.metadata
            }));
        }
    }
    this.context.globalState.update(this.STORAGE_KEY, serializedQueues);
  }

  public getQueue(name: string): TaskItem[] | undefined {
    return this.queues.get(name);
  }

  public getQueueNames(): string[] {
      return Array.from(this.queues.keys());
  }

  public createQueue(name: string) {
    if (!this.queues.has(name)) {
        this.queues.set(name, []);
        this.saveQueues();
    }
  }

  public addToQueue(item: TaskItem, queueName: string) {
    if (!this.queues.has(queueName)) {
        this.queues.set(queueName, []);
    }

    const queue = this.queues.get(queueName)!;
    const taskStateManager = TaskStateManager.getInstance();

    // Avoid duplicates based on ID
    const id = taskStateManager.getTaskId(item);
    if (!queue.some(t => taskStateManager.getTaskId(t) === id)) {
        // FIX: If item is a grouped item, label is partial. Use originalLabel if available.
        const fullLabel = item.originalLabel || item.label;

        // Reconstruct the item to ensure we store a clean copy with the full label
        const queueItem = new TaskItem(
            fullLabel,
            vscode.TreeItemCollapsibleState.None,
            item.taskType,
            item.resourceUri,
            item.command
        );
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
         const newQueue = queue.filter(t => taskStateManager.getTaskId(t) !== id);
         this.queues.set(queueName, newQueue);
         if (newQueue.length === 0) {
             this.queues.delete(queueName);
         }
    } else {
        // Search all queues
        for (const [name, tasks] of this.queues) {
            const idx = tasks.findIndex(t => taskStateManager.getTaskId(t) === id);
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
    this.saveQueues();
}

public renameQueue(oldName: string, newName: string) {
    if (this.queues.has(oldName)) {
        const tasks = this.queues.get(oldName)!;
        this.queues.delete(oldName);
        this.queues.set(newName, tasks);
        this.saveQueues();
    }
}

public moveQueueItem(sourceItem: TaskItem, targetItem: TaskItem) {
    const taskStateManager = TaskStateManager.getInstance();
    let targetQueueName: string | undefined;
    let sourceQueueName: string | undefined;

    for (const [name, tasks] of this.queues) {
        if (tasks.some(t => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(sourceItem))) {
            sourceQueueName = name;
        }
        if (tasks.some(t => taskStateManager.getTaskId(t) === taskStateManager.getTaskId(targetItem))) {
            targetQueueName = name;
        }
    }

    if (sourceQueueName && targetQueueName && sourceQueueName === targetQueueName) {
        const queue = this.queues.get(sourceQueueName)!;
        const sourceId = taskStateManager.getTaskId(sourceItem);
        const targetId = taskStateManager.getTaskId(targetItem);

        const sourceIndex = queue.findIndex(t => taskStateManager.getTaskId(t) === sourceId);
        const targetIndex = queue.findIndex(t => taskStateManager.getTaskId(t) === targetId);

        if (sourceIndex > -1 && targetIndex > -1 && sourceIndex !== targetIndex) {
             const [item] = queue.splice(sourceIndex, 1);
             // We re-find target index because it might have shifted
             const newTargetIndex = queue.findIndex(t => taskStateManager.getTaskId(t) === targetId);
             queue.splice(newTargetIndex, 0, item);
             this.saveQueues();
        }
    }
}

}
