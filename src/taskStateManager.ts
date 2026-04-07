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
  private terminals: Map<string, vscode.Terminal> = new Map();
  private stopTimers: Map<string, NodeJS.Timeout> = new Map();
  private terminatedTasks: Set<string> = new Set();
  private context: vscode.ExtensionContext | undefined;
  private idMigrationMap: Map<string, string> = new Map(); // Maps old IDs to new portable IDs

  private _onDidStateChange = new vscode.EventEmitter<{ id: string; status: TaskStatus }>();
  public readonly onDidStateChange = this._onDidStateChange.event;

  private constructor() { }

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

  /**
   * Generates a portable task ID that is workspace-aware and can be synced across machines.
   * For workspace tasks: Format: `workspace-name:relative-path:task-label`
   * For external tasks: Format: `external:absolute-path:task-label`
   * This allows tasks to be recognized across different machine setups where absolute paths differ.
   */
  public generatePortableTaskId(item: TaskItem): string {
    const label = item.originalLabel || item.label;
    const uri = item.taskFileUri || item.resourceUri;

    if (!uri) {
      // Fallback to label if no URI is available
      return label;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      // External task - use absolute path since it's not in any workspace
      const absolutePath = uri.fsPath;
      return `external:${absolutePath}:${label}`;
    }

    // Workspace task - use relative path
    const workspaceName = workspaceFolder.name;
    const relativePath = vscode.workspace.asRelativePath(uri, false);

    return `${workspaceName}:${relativePath}:${label}`;
  }

  /**
   * Converts old absolute path IDs to new portable IDs for migration.
   * Old format: `${wsPath}|${fileUriStr}|${label}`
   * New format: `${workspaceName}:${relativePath}:${label}`
   */
  private migrateOldIdToPortable(oldId: string): string | null {
    // Check if this looks like an old-format ID (contains |)
    if (!oldId.includes('|')) {
      return null; // Already in new format or not a path-based ID
    }

    const parts = oldId.split('|');
    // Old format requires at least: workspacePath|fileUri|label
    // IDs with a dedupe suffix (e.g. "...|1") must NOT be treated as old format.
    if (parts.length < 3) {
      return null;
    }

    const wsPath = parts[0];
    const fileUriStr = parts[1];
    const label = parts.slice(2).join('|'); // In case label contains |

    if (!wsPath || !fileUriStr) {
      return null;
    }

    // Guard against dedupe suffixes and other non-URI second segments.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(fileUriStr)) {
      return null;
    }

    try {
      const uri = vscode.Uri.parse(fileUriStr);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

      if (!workspaceFolder) {
        // External task - convert to new external format
        const absolutePath = uri.fsPath;
        return `external:${absolutePath}:${label}`;
      }

      // Workspace task - convert to new portable format
      const workspaceName = workspaceFolder.name;
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      return `${workspaceName}:${relativePath}:${label}`;
    } catch {
      return null;
    }
  }

  /**
   * Normalizes task IDs, handling both old and new formats.
   * Returns the appropriate ID format, supporting backwards compatibility.
   */
  public normalizeTaskId(id: string): string {
    // Strip prefixes added by view logic
    let normalized = id;

    while (normalized && normalized.startsWith('recent:')) {
      normalized = normalized.substring(7);
    }
    while (normalized && normalized.startsWith('fav:')) {
      normalized = normalized.substring(4);
    }

    // Handle queue prefix "queue:name:realId"
    if (normalized && normalized.startsWith('queue:')) {
      const firstColon = normalized.indexOf(':');
      const secondColon = normalized.indexOf(':', firstColon + 1);
      if (secondColon !== -1) {
        normalized = normalized.substring(secondColon + 1);
      }
    }

    // Check if we have a cached migration for this old ID
    if (this.idMigrationMap.has(normalized)) {
      return this.idMigrationMap.get(normalized)!;
    }

    // Try to migrate old format IDs to new format
    const migratedId = this.migrateOldIdToPortable(normalized);
    if (migratedId) {
      this.idMigrationMap.set(normalized, migratedId);
      return migratedId;
    }

    return normalized;
  }

  /**
   * Batch normalizes multiple task IDs. Useful for migrating stored collections.
   */
  public normalizeTaskIds(ids: string[]): string[] {
    return ids.map(id => this.normalizeTaskId(id));
  }

  public getTaskId(item: TaskItem): string {
    let id = item.id;

    // If ID is missing, generate a portable one
    if (!id) {
      id = this.generatePortableTaskId(item);
    } else {
      // Normalize the ID (strip prefixes and handle migrations)
      id = this.normalizeTaskId(id);
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

  public markTerminated(id: string) {
    this.terminatedTasks.add(id);
  }

  public isTerminated(id: string): boolean {
    return this.terminatedTasks.has(id);
  }

  public clearTerminated(id: string) {
    this.terminatedTasks.delete(id);
  }

  public clearExecution(id: string) {
    this.executions.delete(id);
  }

  public setTerminal(id: string, terminal: vscode.Terminal): void {
    this.terminals.set(id, terminal);
  }

  public getTerminal(id: string): vscode.Terminal | undefined {
    return this.terminals.get(id);
  }

  public clearTerminal(id: string): void {
    this.terminals.delete(id);
  }

  /**
   * Sets a pending stop timer (for the graceful-stop fallback to force-kill).
   * Any previous timer for the same task is cleared first.
   */
  public setStopTimer(id: string, timer: NodeJS.Timeout): void {
    this.clearStopTimer(id);
    this.stopTimers.set(id, timer);
  }

  public getStopTimer(id: string): NodeJS.Timeout | undefined {
    return this.stopTimers.get(id);
  }

  public clearStopTimer(id: string): void {
    const timer = this.stopTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.stopTimers.delete(id);
    }
  }

  public setStatus(id: string, status: TaskStatus) {
    this.states.set(id, status);
    this._onDidStateChange.fire({ id, status });
  }
}
