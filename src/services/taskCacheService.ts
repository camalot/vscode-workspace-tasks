import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskProvider } from '../taskProvider';

export class TaskCacheService {
    private static instance: TaskCacheService;
    private fileTaskMap: Map<string, TaskItem[]> = new Map();
    private allTasks: TaskItem[] = [];
    private context?: vscode.ExtensionContext;

    private providers: TaskProvider[] = [];
    private providerTasks: Map<string, TaskItem[]> = new Map();

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

    public getProviders(): TaskProvider[] {
        return this.providers;
    }

    public async refreshProvider(type: string): Promise<void> {
        const provider = this.providers.find(p => (p as any).type === type);
        if (!provider) { return; }

        try {
            const tasks = await provider.getTasks();
            this.providerTasks.set(type, tasks);
        } catch (e) {
            console.error(`Error refreshing provider ${type}`, e);
            this.providerTasks.set(type, []);
        }
        this.rebuildCache();
    }

    private rebuildCache() {
        this.allTasks = [];
        this.fileTaskMap.clear();
        const seenIds = new Set<string>();

        // Ensure deterministic order of providers for stable IDs
        const sortedTypes = Array.from(this.providerTasks.keys()).sort();

        for (const type of sortedTypes) {
            const tasks = this.providerTasks.get(type) || [];
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
        }
    }

    public async refresh(): Promise<TaskItem[]> {
        this.providerTasks.clear();

        const promises = this.providers.map(async (provider) => {
            const type = (provider as any).type;
            if (type) {
                try {
                    const tasks = await provider.getTasks();
                    this.providerTasks.set(type, tasks);
                } catch (e) {
                    console.error(`Error refreshing provider ${type}`, e);
                    this.providerTasks.set(type, []);
                }
            }
        });

        await Promise.all(promises);
        this.rebuildCache();
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
