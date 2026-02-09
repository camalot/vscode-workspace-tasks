import * as vscode from 'vscode';
import * as path from 'path';
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
    this.recentTasks = this.context.workspaceState.get<RecentTaskEntry[]>(this.STORAGE_KEY, []);

    // Load max from configuration
    const cfgMax = vscode.workspace.getConfiguration('workspaceTasks').get<number>('recentTasks.maxItems');
    this.maxRecentTasks = typeof cfgMax === 'number' ? cfgMax : 20;

    // Listen for configuration changes and update max accordingly
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workspaceTasks.recentTasks.maxItems')) {
          const newVal = vscode.workspace.getConfiguration('workspaceTasks').get<number>('recentTasks.maxItems');
          const parsed = typeof newVal === 'number' ? newVal : 20;
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
    // Strip prefixes if present
    if (canonicalId.startsWith('recent:')) {
      canonicalId = canonicalId.substring(7);
    }

    this.recentTasks = this.recentTasks.filter((t) => t.taskId !== canonicalId);
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
    this.recentTasks = this.recentTasks.filter((t) => t.taskId !== taskId);

    if (this.maxRecentTasks === 0) {
      return;
    }

    // Add to top
    this.recentTasks.unshift({
      taskId: taskId,
      timestamp: Date.now(),
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
