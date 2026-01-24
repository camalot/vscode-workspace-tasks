import * as vscode from 'vscode';

import { TaskItem } from './taskItem';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failure';

interface SerializedTaskItem {
    label: string;
    taskType: string;
    resourceUri?: string;
    startLine?: number;
    originalLabel?: string;
    metadata?: any;
}

export class TaskStateManager {
    private static instance: TaskStateManager;
    private states: Map<string, TaskStatus> = new Map();
    private executions: Map<string, vscode.TaskExecution> = new Map();
    private favorites: Set<string> = new Set();
    // private queue: TaskItem[] = []; // Removed: Single queue support
    private queues: Map<string, TaskItem[]> = new Map(); // Added: Multiple queues support
    private context: vscode.ExtensionContext | undefined;
    // private queueName: string = 'Queue'; // Removed: No longer single queue name property

    private constructor() {}

    public static getInstance(): TaskStateManager {
        if (!TaskStateManager.instance) {
            TaskStateManager.instance = new TaskStateManager();
        }
        return TaskStateManager.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.context = context;
        const savedFavorites = context.globalState.get<string[]>('favorites', []);
        this.favorites = new Set(savedFavorites);

        // Restore Queues
        // Check for new persistence format first
        const savedQueues = context.globalState.get<Record<string, SerializedTaskItem[]>>('savedQueues');

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
                 // Optionally clear old state, but keeping it for safety/rollback is fine
            }
        }
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
        if (!this.context) return;

        const serializedQueues: Record<string, SerializedTaskItem[]> = {};

        for (const [name, tasks] of this.queues) {
            if (tasks.length > 0) {
                serializedQueues[name] = tasks.map(q => ({
                    label: q.label,
                    originalLabel: q.originalLabel || q.label,
                    taskType: q.taskType,
                    resourceUri: q.resourceUri ? q.resourceUri.toString() : undefined,
                    startLine: q.startLine,
                    metadata: q.metadata
                }));
            }
        }
        this.context.globalState.update('savedQueues', serializedQueues);
    }

    public getQueue(name: string): TaskItem[] | undefined {
        return this.queues.get(name);
    }

    public getQueueNames(): string[] {
        return Array.from(this.queues.keys());
    }

    public getAllQueues(): Map<string, TaskItem[]> {
        return this.queues;
    }

    public getContext(): vscode.ExtensionContext | undefined {
        return this.context;
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

        // Avoid duplicates based on ID
        const id = this.getTaskId(item);
        if (!queue.some(t => this.getTaskId(t) === id)) {
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
        const id = this.getTaskId(item);

        if (queueName && this.queues.has(queueName)) {
             const queue = this.queues.get(queueName)!;
             const newQueue = queue.filter(t => this.getTaskId(t) !== id);
             this.queues.set(queueName, newQueue);
             if (newQueue.length === 0) {
                 this.queues.delete(queueName);
             }
        } else {
            // Search all queues
            for (const [name, tasks] of this.queues) {
                const idx = tasks.findIndex(t => this.getTaskId(t) === id);
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
        let targetQueueName: string | undefined;
        let sourceQueueName: string | undefined;

        for (const [name, tasks] of this.queues) {
            if (tasks.some(t => this.getTaskId(t) === this.getTaskId(sourceItem))) sourceQueueName = name;
            if (tasks.some(t => this.getTaskId(t) === this.getTaskId(targetItem))) targetQueueName = name;
        }

        if (sourceQueueName && targetQueueName && sourceQueueName === targetQueueName) {
            const queue = this.queues.get(sourceQueueName)!;
            const sourceId = this.getTaskId(sourceItem);
            const targetId = this.getTaskId(targetItem);

            const sourceIndex = queue.findIndex(t => this.getTaskId(t) === sourceId);
            const targetIndex = queue.findIndex(t => this.getTaskId(t) === targetId);

            if (sourceIndex > -1 && targetIndex > -1 && sourceIndex !== targetIndex) {
                 const [item] = queue.splice(sourceIndex, 1);
                 // We re-find target index because it might have shifted
                 const newTargetIndex = queue.findIndex(t => this.getTaskId(t) === targetId);
                 queue.splice(newTargetIndex, 0, item);
                 this.saveQueues();
            }
        }
    }

    public isFavorite(id: string): boolean {
        return this.favorites.has(id);
    }

    public addToFavorites(item: TaskItem) {
        const id = this.getTaskId(item);
        this.favorites.add(id);
        this.context?.globalState.update('favorites', Array.from(this.favorites));
    }

    public removeFromFavorites(item: TaskItem) {
        const id = this.getTaskId(item);
        if (this.favorites.has(id)) {
            this.favorites.delete(id);
            this.context?.globalState.update('favorites', Array.from(this.favorites));
        }
    }

    public getTaskId(item: { label: string, resourceUri?: vscode.Uri, taskType: string, originalLabel?: string }): string {
        const label = item.originalLabel || item.label;
        if (item.resourceUri) {
            return `${item.resourceUri.toString()}|${item.taskType}|${label}`;
        }
        return `${item.taskType}|${label}`;
    }

    public setStatus(id: string, status: TaskStatus) {
        this.states.set(id, status);
    }

    public getStatus(id: string): TaskStatus {
        return this.states.get(id) || 'idle';
    }

    public setExecution(id: string, execution: vscode.TaskExecution) {
        this.executions.set(id, execution);
    }

    public getExecution(id: string): vscode.TaskExecution | undefined {
        return this.executions.get(id);
    }

    public getIdByExecution(execution: vscode.TaskExecution): string | undefined {
        for (const [id, exec] of this.executions) {
            // Task objects might be different instances, but compare internal ref if possible
            if (exec === execution) {
                return id;
            }
        }
        return undefined;
    }

    public clearExecution(id: string) {
        this.executions.delete(id);
    }
}
