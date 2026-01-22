import * as vscode from 'vscode';

import { TaskItem } from './taskItem';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failure';

interface SerializedTaskItem {
    label: string;
    taskType: string;
    resourceUri?: string;
    startLine?: number;
}

export class TaskStateManager {
    private static instance: TaskStateManager;
    private states: Map<string, TaskStatus> = new Map();
    private executions: Map<string, vscode.TaskExecution> = new Map();
    private favorites: Set<string> = new Set();
    private queue: TaskItem[] = [];
    private context: vscode.ExtensionContext | undefined;
    private queueName: string = 'Queue'; // TODO: support localization from package.nls.json (%tree.queue%)

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
        this.queueName = context.globalState.get<string>('queueName', 'Queue'); // TODO: support localization from package.nls.json (%tree.queue%)

        // Restore Queue
        const savedQueue = context.globalState.get<SerializedTaskItem[]>('queueItems', []);
        this.queue = savedQueue.map(sq => {
            const uri = sq.resourceUri ? vscode.Uri.parse(sq.resourceUri) : undefined;
            const item = new TaskItem(
                sq.label,
                vscode.TreeItemCollapsibleState.None,
                sq.taskType,
                uri
            );
            item.startLine = sq.startLine;
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

    private saveQueue() {
        if (!this.context) return;
        const serialized: SerializedTaskItem[] = this.queue.map(q => ({
            label: q.label,
            taskType: q.taskType,
            resourceUri: q.resourceUri ? q.resourceUri.toString() : undefined,
            startLine: q.startLine
        }));
        this.context.globalState.update('queueItems', serialized);
    }

    public getQueueName(): string {
        return this.queueName;
    }

    public setQueueName(name: string) {
        this.queueName = name;
        this.context?.globalState.update('queueName', name);
    }

    public getQueue(): TaskItem[] {
        return this.queue;
    }

    public addToQueue(item: TaskItem) {
        // Avoid duplicates based on ID
        const id = this.getTaskId(item);
        if (!this.queue.some(t => this.getTaskId(t) === id)) {
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

            // Set context value for queue
            queueItem.contextValue = 'queuedTask';

            // Restore description
            if (item.resourceUri) {
                const wsFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
                queueItem.description = wsFolder ? wsFolder.name : '';
            }

            this.queue.push(queueItem);
            this.saveQueue();
        }
    }

    public removeFromQueue(item: TaskItem) {
        const id = this.getTaskId(item);
        this.queue = this.queue.filter(t => this.getTaskId(t) !== id);
        this.saveQueue();
    }

    public clearQueue() {
        this.queue = [];
        this.saveQueue();
    }

    public moveQueueItem(sourceItem: TaskItem, targetItem: TaskItem) {
        const sourceId = this.getTaskId(sourceItem);
        const targetId = this.getTaskId(targetItem);

        const sourceIndex = this.queue.findIndex(t => this.getTaskId(t) === sourceId);
        const targetIndex = this.queue.findIndex(t => this.getTaskId(t) === targetId);

        if (sourceIndex > -1 && targetIndex > -1 && sourceIndex !== targetIndex) {
            const [item] = this.queue.splice(sourceIndex, 1);
            // If we are moving down, the removal shifted indices, but targetIndex refers to original.
            // But targetIndex is computed BEFORE removal.
            // If source < target, removing source shifts target down by 1.

            // Re-calculate or just logic it out.
            // Simple approach: remove then insert.

            // If I want to place BEFORE the target:
            // If source was before target, removing source decreases target index.
            // If source was after target, removing source doesn't affect target index.

            // Let's rely on indices calculated before modification?
            // No, array is modified.
            // Better:
            const newTargetIndex = this.queue.findIndex(t => this.getTaskId(t) === targetId);
            // Insert *after* or *before*?
            // Standard drag behavior is insert before if dropping on top section, or after?
            // VS Code list DND usually implies "insert at this position".

            this.queue.splice(newTargetIndex, 0, item);
            this.saveQueue();
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
