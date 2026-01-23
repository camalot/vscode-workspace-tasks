import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskProvider } from '../taskProvider';

export class TaskCacheService {
    private static instance: TaskCacheService;
    private fileTaskMap: Map<string, TaskItem[]> = new Map();
    private allTasks: TaskItem[] = [];
    private context?: vscode.ExtensionContext;

    private providers: TaskProvider[] = [];

    private constructor() {}

    public initialize(context: vscode.ExtensionContext): TaskCacheService {
        this.context = context;
        return this;
    }

    public static getInstance(): TaskCacheService {
        if (!TaskCacheService.instance) {
            TaskCacheService.instance = new TaskCacheService();
        }
        return TaskCacheService.instance;
    }

    public registerProvider(provider: TaskProvider) {
        this.providers.push(provider);
    }

    public async refresh(): Promise<TaskItem[]> {
        this.allTasks = [];
        this.fileTaskMap.clear();
        const seenIds = new Set<string>();

        for (const provider of this.providers) {
            try {
                const tasks = await provider.getTasks();

                for (const task of tasks) {

                    // Ensure task has the requested ID format
                    if (task.label) {
                        let wsPath = '';
                        let fileUriStr = '';
                        const uri = task.taskFileUri || task.resourceUri;
                        if (uri) {
                            fileUriStr = uri.toString();
                            const ws = vscode.workspace.getWorkspaceFolder(uri);
                            if (ws) {
                                wsPath = ws.uri.fsPath;
                            }
                        }
                        task.id = `${wsPath}|${fileUriStr}|${task.label}`;
                    }

                    if (task.id) {
                        let uniqueId = task.id;
                        let counter = 1;
                        while (seenIds.has(uniqueId)) {
                            uniqueId = `${task.id}|${counter++}`;
                        }
                        task.id = uniqueId;
                        seenIds.add(uniqueId);
                    }

                    this.allTasks.push(task);

                    if (task.resourceUri) {
                        const key = task.resourceUri.toString();
                        if (!this.fileTaskMap.has(key)) {
                            this.fileTaskMap.set(key, []);
                        }
                        this.fileTaskMap.get(key)?.push(task);
                    }
                }
            } catch (e) {
                console.error('Error refreshing provider tasks', e);
            }
        }
        return this.allTasks;
    }

    public getTasksForFile(uri: vscode.Uri): TaskItem[] {
        // Try exact match
        let tasks = this.fileTaskMap.get(uri.toString());
        if (tasks) return tasks;

        // Try finding by fsPath (ignoring scheme/encoding differences) if needed,
        // or iterate keys if we suspect casing issues on Windows.
        // A simple normalization approach:
        const targetPath = uri.fsPath.toLowerCase();
        for (const [key, items] of this.fileTaskMap) {
             const keyUri = vscode.Uri.parse(key);
             if (keyUri.fsPath.toLowerCase() === targetPath) {
                 return items;
             }
        }

        return [];
    }

    public getAllTasks(): TaskItem[] {
        return this.allTasks;
    }
}
