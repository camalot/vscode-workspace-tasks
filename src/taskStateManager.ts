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
  private context: vscode.ExtensionContext | undefined;

  private _onDidStateChange = new vscode.EventEmitter<{ id: string; status: TaskStatus }>();
  public readonly onDidStateChange = this._onDidStateChange.event;

  private constructor() {}

  public static getInstance(): TaskStateManager {
    if (!TaskStateManager.instance) {
      TaskStateManager.instance = new TaskStateManager();
    }
    return TaskStateManager.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public getContext(): vscode.ExtensionContext | undefined {
    return this.context;
  }

  public getTaskId(item: TaskItem): string {
    let id = item.id;

    // If ID is missing, fall back to calculating one.
    // NOTE: This fallback logic MUST match how TaskCacheService generates IDs to ensure consistency.
    // TaskCacheService uses: `${wsPath}|${fileUriStr}|${task.label}` + optional suffix
    if (!id) {
      const label = item.originalLabel || item.label;
      let wsPath = '';
      let fileUriStr = '';
      const uri = item.taskFileUri || item.resourceUri;
      if (uri) {
        fileUriStr = uri.toString();
        const ws = vscode.workspace.getWorkspaceFolder(uri);
        if (ws) {
          wsPath = ws.uri.fsPath;
        }
      }
      id = `${wsPath}|${fileUriStr}|${label}`;
    }

    // Canonicalize ID: Strip prefixes added by view logic
    // Prefixes to strip: "recent:", "fav:", "queue:<name>:"

    while (id && id.startsWith('recent:')) {
      id = id.substring(7);
    }
    while (id && id.startsWith('fav:')) {
      id = id.substring(4);
    }

    // Handle queue prefix "queue:name:realId"
    if (id && id.startsWith('queue:')) {
      // Find the second colon
      const firstColon = id.indexOf(':'); // char 5
      const secondColon = id.indexOf(':', firstColon + 1);
      if (secondColon !== -1) {
        id = id.substring(secondColon + 1);
      }
    }

    return id;
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

  public setStatus(id: string, status: TaskStatus) {
    this.states.set(id, status);
    this._onDidStateChange.fire({ id, status });
  }
}
