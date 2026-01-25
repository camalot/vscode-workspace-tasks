import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskCacheService } from './taskCacheService';

export interface RecentTaskEntry {
  taskId: string;
  timestamp: number;
}

export class RecentTasksService {
  private static instance: RecentTasksService;
  private context?: vscode.ExtensionContext;
  private recentTasks: RecentTaskEntry[] = [];
  private readonly STORAGE_KEY = 'workspaceTasks.recentTasks';
  private maxRecentTasks: number = 20;

  private constructor() { }

  public static getInstance(): RecentTasksService {
    if (!RecentTasksService.instance) {
      RecentTasksService.instance = new RecentTasksService();
    }
    return RecentTasksService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    // Load from storage
    this.recentTasks = this.context.workspaceState.get<RecentTaskEntry[]>(this.STORAGE_KEY, []);

    // Load max from configuration
    const cfgMax = vscode.workspace.getConfiguration('workspaceTasks').get<number>('groups.recentTasks.maxItems');
    this.maxRecentTasks = (typeof cfgMax === 'number') ? cfgMax : 20;

    // Listen for configuration changes and update max accordingly
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('workspaceTasks.groups.recentTasks.maxItems')) {
        const newVal = vscode.workspace.getConfiguration('workspaceTasks').get<number>('groups.recentTasks.maxItems');
        const parsed = (typeof newVal === 'number') ? newVal : 20;
        if (parsed !== this.maxRecentTasks) {
          this.maxRecentTasks = parsed;
          // Trim stored list if needed
          if (this.recentTasks.length > this.maxRecentTasks) {
            this.recentTasks = this.recentTasks.slice(0, this.maxRecentTasks);
            this.save();
            vscode.commands.executeCommand('workspaceTasks.refreshTree');
          }
        }
      }
    }));

    // Listen for task execution
    context.subscriptions.push(vscode.tasks.onDidStartTask(e => this.handleTaskStart(e)));
  }

  private handleTaskStart(e: vscode.TaskStartEvent) {
    const task = e.execution.task;

    // if maxRecentTasks is 0, do not track recent tasks
    if (this.maxRecentTasks === 0) {
      return;
    }

    // Find matching TaskItem
    const taskItem = this.findMatchingTaskItem(task);

    if (taskItem && taskItem.id) {
      this.addRecentTask(taskItem.id);
    }
  }

  private findMatchingTaskItem(task: vscode.Task): TaskItem | undefined {
        const allTasks = TaskCacheService.getInstance().getAllTasks();

        // Extract definition name (task, script, or target) depending on type
        const def = task.definition as any;
        const defName = def.task || def.script || def.target;
        const defPath = def.path; // path added for github-actions to be specific

        // Helper to collect matching candidates recursively
        const candidates: TaskItem[] = [];
        const visit = (items: TaskItem[]) => {
            for (const item of items) {
                const labelMatch = item.label === task.name || (item.originalLabel && item.originalLabel === task.name);
                // Also match against definition name if available (more reliable than UI name)
                const defMatch = defName && (item.label === defName || (item.originalLabel && item.originalLabel === defName));

                // If definition has path, ensure it matches item resourceUri
                let pathMatch = true;
                if (defPath && item.resourceUri) {
                    // Normalize paths for comparison (handle windows/unix separators and casing)
                    const p1 = vscode.Uri.file(defPath).fsPath.toLowerCase();
                    const p2 = item.resourceUri.fsPath.toLowerCase();
                    if (p1 !== p2) pathMatch = false;
                }

                if ((labelMatch || defMatch) && pathMatch) {
                    candidates.push(item);
                }
                if (item.children && item.children.length > 0) {
                    visit(item.children);
                }
            }
        };
        visit(allTasks);

        if (candidates.length === 0) { return undefined; }

        const defType = (task.definition && (task.definition as any).type) ? (task.definition as any).type as string : undefined;
        const taskSource = (task as any).source as string | undefined;
        const taskScopeFolder = (task.scope && typeof task.scope !== 'number' && (task.scope as vscode.WorkspaceFolder).uri) ? (task.scope as vscode.WorkspaceFolder).uri.toString() : undefined;

        // 1) Exact type match (preferred)
        // Check exact match on taskType
        if (defType) {
            const exact = candidates.find(item => item.taskType === defType);
            if (exact) { return exact; }
        }

        // 2) Workspace-declared tasks: if the runtime type is 'workspace-task', prefer items that came from workspace providers (taskSource set)
        if (defType === 'workspace-task') {
            const ws = candidates.find(item => !!item.taskSource);
            if (ws) { return ws; }
        }

        // 3) VS Code declared tasks (source 'Workspace') -> prefer task type 'vscode'
        if (taskSource === 'Workspace') {
            const vs = candidates.find(item => item.taskType === 'vscode');
            if (vs) { return vs; }
        }

        // 4) Match by workspace folder if available
        if (taskScopeFolder) {
            const byFolder = candidates.find(item => {
                if (!item.resourceUri) { return false; }
                const itemFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
                return itemFolder?.uri.toString() === taskScopeFolder;
            });
            if (byFolder) { return byFolder; }
        }

        // 5) Fallback to first candidate
        return candidates[0];
    }

    public remove(item: TaskItem) {
        if (!item || !item.id) {
            return;
        }

        let canonicalId = item.id;
        // Strip prefixes if present
        if (canonicalId.startsWith('recent:')) {
            canonicalId = canonicalId.substring(7);
        }

        this.recentTasks = this.recentTasks.filter(t => t.taskId !== canonicalId);
        this.save();
    }

    public addRecentTask(taskId: string) {
        // IMPORTANT: Ensure we are using the canonical ID for deduplication
        // The ID passed in comes from a found TaskItem, which likely has a "pure" ID.
        // But if there's any prefix contamination (e.g. from UI interactions), strip it.
        if (taskId.includes('recent:') || taskId.includes('fav:')) {
             // This is a naive strip, ideally we use TaskStateManager.getTaskId logic but without circular dep.
             // However, findMatchingTaskItem returns items from cache which are pure.
             // So taskId here *should* be pure.
        }

        // Remove existing entry for this task if present
        this.recentTasks = this.recentTasks.filter(t => t.taskId !== taskId);

        if (this.maxRecentTasks === 0) {
            return;
        }

        // Add to top
        this.recentTasks.unshift({
            taskId: taskId,
            timestamp: Date.now()
        });

        // Trim
        if (this.recentTasks.length > this.maxRecentTasks) {
            this.recentTasks = this.recentTasks.slice(0, this.maxRecentTasks);
        }

        this.save();

        // Refresh tree
        vscode.commands.executeCommand('workspaceTasks.refreshTree');
    }

    private save() {
        this.context?.workspaceState.update(this.STORAGE_KEY, this.recentTasks);
    }

    public clear(): void {
        this.recentTasks = [];
        this.save();
        vscode.commands.executeCommand('workspaceTasks.refreshTree');
    }

    public getRecentTasks(): TaskItem[] {
        if (this.maxRecentTasks === 0) {
            return [];
        }

        const validRecentTasks: TaskItem[] = [];

        for (const entry of this.recentTasks) {
            const item = TaskCacheService.getInstance().getTaskById(entry.taskId);
            if (item) {
                validRecentTasks.push(item);
            }
        }

        return validRecentTasks;
    }
}
