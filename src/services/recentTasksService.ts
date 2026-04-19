import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskCacheService } from './taskCacheService';
import { TaskStateManager } from '../taskStateManager';

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

  private canonicalizeTaskId(taskId: string): string {
    const normalized = TaskStateManager.getInstance().normalizeTaskId(taskId);
    return normalized.replace(/\|\d+$/, '');
  }

  private constructor() {}

  public static getInstance(): RecentTasksService {
    if (!RecentTasksService.instance) {
      RecentTasksService.instance = new RecentTasksService();
    }
    return RecentTasksService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    // Load from storage
    const savedRecentTasks = this.context.workspaceState.get<RecentTaskEntry[]>(this.STORAGE_KEY, []);

    // Migrate old task IDs to new portable format
    const stateManager = TaskStateManager.getInstance();
    const migratedRecentTasks = savedRecentTasks.map(entry => ({
      ...entry,
      taskId: this.canonicalizeTaskId(entry.taskId),
    }));

    // If any IDs were migrated (format changed), save the migrated data back
    if (JSON.stringify(savedRecentTasks) !== JSON.stringify(migratedRecentTasks)) {
      this.recentTasks = migratedRecentTasks;
      this.save();
    } else {
      this.recentTasks = migratedRecentTasks;
    }

    // Load max from configuration
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const cfgMax = config.get<number>('recentTasks.maxItems');
    // If not found or explicitly null/undefined, use default 20. But allow 0.
    this.maxRecentTasks = (cfgMax !== undefined && cfgMax !== null) ? cfgMax : 20;

    // Listen for configuration changes and update max accordingly
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workspaceTasks.recentTasks.maxItems')) {
          const config = vscode.workspace.getConfiguration('workspaceTasks');
          const newVal = config.get<number>('recentTasks.maxItems');
          const parsed = (newVal !== undefined && newVal !== null) ? newVal : 20;
          if (parsed !== this.maxRecentTasks) {
            this.maxRecentTasks = parsed;
            // Trim stored list if needed
            if (this.recentTasks.length > this.maxRecentTasks) {
              this.recentTasks = this.recentTasks.slice(0, this.maxRecentTasks);
              this.save();
              vscode.commands.executeCommand('workspaceTasks.refreshTree').then(undefined, () => {});
            }
          }
        }
      }),
    );

    // Listen for task execution
    context.subscriptions.push(vscode.tasks.onDidStartTask((e) => this.handleTaskStart(e)));
  }

  private handleTaskStart(e: vscode.TaskStartEvent) {
    const task = e.execution.task;

    // if maxRecentTasks is 0, do not track recent tasks
    if (this.maxRecentTasks === 0) {
      return;
    }

    // Find matching TaskItem
    const taskItem = TaskCacheService.getInstance().findMatchingTask(task);

    if (taskItem && taskItem.id) {
      this.addRecentTask(taskItem.id);
    }
  }

  public remove(item: TaskItem) {
    if (!item || !item.id) {
      return;
    }

    let canonicalId = item.id;
    // Normalize the ID to handle old format and prefixes
    canonicalId = this.canonicalizeTaskId(canonicalId);

    this.recentTasks = this.recentTasks.filter((t) => t.taskId !== canonicalId);
    this.save();
  }

  public addRecentTask(taskId: string) {
    // Normalize the task ID to ensure consistency with stored format
    const normalizedId = this.canonicalizeTaskId(taskId);

    // Remove existing entry for this task if present
    this.recentTasks = this.recentTasks.filter((t) => t.taskId !== normalizedId);

    if (this.maxRecentTasks === 0) {
      return;
    }

    // Add to top with normalized ID
    this.recentTasks.unshift({
      taskId: normalizedId,
      timestamp: Date.now(),
    });

    // Trim
    if (this.recentTasks.length > this.maxRecentTasks) {
      this.recentTasks = this.recentTasks.slice(0, this.maxRecentTasks);
    }

    this.save();

    // Refresh tree
    vscode.commands.executeCommand('workspaceTasks.refreshTree').then(undefined, () => {});
  }

  private save() {
    this.context?.workspaceState.update(this.STORAGE_KEY, this.recentTasks);
  }

  public clear(): void {
    this.recentTasks = [];
    this.save();
    vscode.commands.executeCommand('workspaceTasks.refreshTree').then(undefined, () => {});
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
