import * as path from 'path';
import * as vscode from 'vscode';
import { TaskStateManager } from '../taskStateManager';
import { LoggerService } from './loggerService';
import { serialize, deserialize, parseNdjsonLine, ISerializedTaskExecutionRecord } from './taskHistorySerializer';

export interface ITaskExecutionRecord {
  id: string; // Unique ID for this execution (e.g. uuid or timestamp based)
  taskName: string;
  taskSource: string; // "npm", "workspace", etc.
  scope: string; // Workspace folder name, or TaskScope value as string (e.g. "1"), or "global"
  definition: vscode.TaskDefinition;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  status: 'Running' | 'Success' | 'Terminated' | 'Failed';
  duration?: number;
}

export interface ITaskHistoryGroup {
  key: string; // Unique key for the task (type + name + source + scope?)
  label: string; // "compile:vsix (project.json)"
  taskName: string;
  source: string;
  executions: ITaskExecutionRecord[];
}

const CONFIG_SECTION = 'workspaceTasks';
const WORKSPACE_STATE_KEY = 'workspaceTasks.taskHistory';

export class TaskHistoryService {
  private static instance: TaskHistoryService;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  private readonly _onDidRecordHistory = new vscode.EventEmitter<ITaskExecutionRecord>();
  /** Fires after a task execution record transitions to a terminal state (Success / Failed / Terminated). */
  public readonly onDidRecordHistory = this._onDidRecordHistory.event;

  private historyGroups: Map<string, ITaskHistoryGroup> = new Map();
  private activeExecutions: Map<vscode.TaskExecution, ITaskExecutionRecord> = new Map();
  private context: vscode.ExtensionContext | undefined;
  private filters: Set<string> = new Set(['Running', 'Success', 'Failed', 'Terminated']);

  private maxPersistedRecords: number = 200;
  private retentionDays: number = 0;
  private ndjsonPath: string | undefined;

  private readonly historyWriteQueue: { workspace: Promise<void>; ndjson: Promise<void> } = {
    workspace: Promise.resolve(),
    ndjson: Promise.resolve(),
  };

  private constructor() { }

  public static getInstance(): TaskHistoryService {
    if (!TaskHistoryService.instance) {
      TaskHistoryService.instance = new TaskHistoryService();
    }
    return TaskHistoryService.instance;
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.loadConfig();

    // Determine NDJSON path from first workspace folder
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.ndjsonPath = path.join(folders[0].uri.fsPath, '.vscode', 'task-history.ndjson');
    }

    // React to configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`${CONFIG_SECTION}.history.maxPersistedRecords`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.history.retentionDays`)
        ) {
          this.loadConfig();
        }
      }),
    );

    await this.loadPersistedHistory();
    this.registerListeners();
  }

  private loadConfig(): void {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    this.maxPersistedRecords = cfg.get<number>('history.maxPersistedRecords', 200);
    this.retentionDays = cfg.get<number>('history.retentionDays', 0);
  }

  private async loadPersistedHistory(): Promise<void> {
    if (!this.ndjsonPath) { return; }

    let records: ISerializedTaskExecutionRecord[] = [];
    const logger = LoggerService.getInstance();

    try {
      const fileUri = vscode.Uri.file(this.ndjsonPath);
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const text = new TextDecoder().decode(bytes);
      const lines = text.split('\n');
      for (const line of lines) {
        const parsed = parseNdjsonLine(line);
        if (parsed) {
          records.push(parsed);
        }
      }
    } catch (e: unknown) {
      // File not found is expected on first run; other errors are warnings
      if (!isFileNotFoundError(e)) {
        logger.warn(`[TaskHistoryService] Failed to read task history file: ${e}`);
      }
      // Fall back to workspaceState
      if (this.context) {
        const cached = this.context.workspaceState.get<ISerializedTaskExecutionRecord[]>(WORKSPACE_STATE_KEY, []);
        records = cached;
      }
    }

    // Apply retention pruning
    let pruned = false;
    if (this.retentionDays > 0) {
      const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const before = records.length;
      records = records.filter(r => r.startTime >= cutoffMs);
      if (records.length < before) {
        pruned = true;
      }
    }

    // Sort newest first
    records.sort((a, b) => b.startTime - a.startTime);

    // Seed in-memory history from deserialized records
    for (const raw of records) {
      const record = deserialize(raw);
      this.addRecordToGroup(record);
    }

    // Rewrite NDJSON if pruning removed records
    if (pruned && this.ndjsonPath) {
      this.enqueueNdjsonWrite(records);
    }

    // Seed workspaceState from most-recent maxPersistedRecords
    if (this.context) {
      const capped = records.slice(0, this.maxPersistedRecords);
      this.enqueueWorkspaceStateWrite(capped);
    }
  }

  private addRecordToGroup(record: ITaskExecutionRecord): void {
    const key = `${record.taskSource}:${record.taskName}:${record.scope}`;
    let group = this.historyGroups.get(key);
    if (!group) {
      group = {
        key,
        label: `${record.taskName} (${record.taskSource})`,
        taskName: record.taskName,
        source: record.taskSource,
        executions: [],
      };
      this.historyGroups.set(key, group);
    }
    // Records are loaded newest-first, so append to maintain newest-first order per group
    group.executions.push(record);
  }

  public toggleFilter(status: string) {
    if (this.filters.has(status)) {
      this.filters.delete(status);
    } else {
      this.filters.add(status);
    }
    this._onDidChange.fire();
  }

  public hasFilter(status: string): boolean {
    return this.filters.has(status);
  }

  private registerListeners() {
    if (!this.context) { return; }

    this.context.subscriptions.push(
      vscode.tasks.onDidStartTask((e) => this.handleTaskStart(e)),
      vscode.tasks.onDidEndTaskProcess((e) => this.handleTaskProcessEnd(e)),
      vscode.tasks.onDidEndTask((e) => this.handleTaskEnd(e))
    );

    // Persist records to storage on terminal state transitions (fire-and-forget)
    this.context.subscriptions.push(
      this.onDidRecordHistory((record) => {
        this.persistRecord(record);
      }),
    );
  }

  private getTaskKey(task: vscode.Task): string {
    const scope = typeof task.scope === 'object' ? (task.scope as vscode.WorkspaceFolder).name : (task.scope?.toString() || 'global');
    return `${task.source}:${task.name}:${scope}`;
  }

  private getTaskLabel(task: vscode.Task): string {
    // "task name (source)" or similar
    // User example: "compile:vsix (project.json)"
    // task.name is generic, we might want detail?
    // Let's stick to name and source
    return `${task.name} (${task.source})`;
  }

  private handleTaskStart(e: vscode.TaskStartEvent) {
    const task = e.execution.task;
    const key = this.getTaskKey(task);

    let group = this.historyGroups.get(key);
    if (!group) {
      group = {
        key,
        label: this.getTaskLabel(task),
        taskName: task.name,
        source: task.source,
        executions: []
      };
      this.historyGroups.set(key, group);
    }

    const record: ITaskExecutionRecord = {
      id: Date.now().toString() + Math.random().toString().substring(2, 5),
      taskName: task.name,
      taskSource: task.source,
      scope: typeof task.scope === 'object' ? (task.scope as vscode.WorkspaceFolder).name : (task.scope?.toString() || 'global'),
      definition: task.definition,
      startTime: Date.now(),
      status: 'Running'
    };

    // Prepend to executions (newest first)
    group.executions.unshift(record);
    this.activeExecutions.set(e.execution, record);

    this._onDidChange.fire();
  }

  private handleTaskProcessEnd(e: vscode.TaskProcessEndEvent) {
    const record = this.activeExecutions.get(e.execution);
    if (record) {
      record.endTime = Date.now();
      record.exitCode = e.exitCode;
      record.duration = record.endTime - record.startTime;

      const stateManager = TaskStateManager.getInstance();
      const taskId = stateManager.getIdByExecution(e.execution);
      const wasTerminated = taskId !== undefined && stateManager.isTerminated(taskId);

      if (e.exitCode === 0) {
        record.status = 'Success';
      } else if (wasTerminated) {
        record.status = 'Terminated'; // Task was explicitly stopped (e.g. via SIGINT)
      } else if (e.exitCode !== undefined) {
        record.status = 'Failed'; // Non-zero exit code
      } else {
        record.status = 'Terminated'; // No exit code — treat as terminated
      }

      this._onDidChange.fire();
      this._onDidRecordHistory.fire(record);
    }
  }

  private handleTaskEnd(e: vscode.TaskEndEvent) {
    // Cleanup active execution map
    // Also handle case where process end wasn't fired (some tasks types)
    const record = this.activeExecutions.get(e.execution);
    if (record) {
      if (record.status === 'Running') {
        // It ended without process event (e.g. shell execution failed to spawn or custom execution)
        record.endTime = Date.now();
        record.duration = record.endTime - record.startTime;
        // We don't have exit code here usually
        record.status = 'Terminated';
        this._onDidChange.fire();
        this._onDidRecordHistory.fire(record);
      }
      this.activeExecutions.delete(e.execution);
    }
  }

  /**
   * Appends a single record to both the NDJSON file and workspaceState cache.
   * Called fire-and-forget; errors are logged and do not propagate.
   */
  private persistRecord(record: ITaskExecutionRecord): void {
    const serialized = serialize(record);
    this.enqueueNdjsonAppend(serialized);
    this.enqueueWorkspaceStatePrepend(serialized);
  }

  /**
   * Enqueues a full rewrite of the NDJSON file with the given records array
   * (used during pruning at startup). Records are written newest-first.
   */
  private enqueueNdjsonWrite(records: ISerializedTaskExecutionRecord[]): void {
    if (!this.ndjsonPath) { return; }
    const filePath = this.ndjsonPath;
    this.historyWriteQueue.ndjson = this.historyWriteQueue.ndjson.then(async () => {
      try {
        await ensureVscodeDirectory(filePath);
        const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(filePath),
          new TextEncoder().encode(content),
        );
      } catch (e) {
        LoggerService.getInstance().warn(`[TaskHistoryService] Failed to write task history NDJSON: ${e}`);
      }
    }).catch(() => { /* queue must not break */ });
  }

  /**
   * Enqueues appending one serialized record to the NDJSON file.
   */
  private enqueueNdjsonAppend(serialized: ISerializedTaskExecutionRecord): void {
    if (!this.ndjsonPath) { return; }
    const filePath = this.ndjsonPath;
    this.historyWriteQueue.ndjson = this.historyWriteQueue.ndjson.then(async () => {
      try {
        await ensureVscodeDirectory(filePath);
        const fileUri = vscode.Uri.file(filePath);
        let existing = '';
        try {
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          existing = new TextDecoder().decode(bytes);
        } catch (e: unknown) {
          if (!isFileNotFoundError(e)) { throw e; }
          // File doesn't exist yet — start fresh
        }
        const newLine = JSON.stringify(serialized) + '\n';
        await vscode.workspace.fs.writeFile(
          fileUri,
          new TextEncoder().encode(existing + newLine),
        );
      } catch (e) {
        LoggerService.getInstance().warn(`[TaskHistoryService] Failed to append to task history NDJSON: ${e}`);
      }
    }).catch(() => { /* queue must not break */ });
  }

  /**
   * Enqueues writing a full replacement array to workspaceState (used during startup seeding).
   */
  private enqueueWorkspaceStateWrite(records: ISerializedTaskExecutionRecord[]): void {
    this.historyWriteQueue.workspace = this.historyWriteQueue.workspace.then(async () => {
      try {
        if (!this.context) { return; }
        await this.context.workspaceState.update(WORKSPACE_STATE_KEY, records);
      } catch (e) {
        LoggerService.getInstance().warn(`[TaskHistoryService] Failed to update workspaceState history: ${e}`);
      }
    }).catch(() => { /* queue must not break */ });
  }

  /**
   * Enqueues prepending one new serialized record to workspaceState, then
   * prunes to {@link maxPersistedRecords}.
   */
  private enqueueWorkspaceStatePrepend(serialized: ISerializedTaskExecutionRecord): void {
    this.historyWriteQueue.workspace = this.historyWriteQueue.workspace.then(async () => {
      try {
        if (!this.context) { return; }
        const current = this.context.workspaceState.get<ISerializedTaskExecutionRecord[]>(WORKSPACE_STATE_KEY, []);
        // Prepend newest record
        const updated = [serialized, ...current];
        // Prune to cap (oldest by startTime — they're at the tail since we prepend newest)
        const capped = updated.length > this.maxPersistedRecords
          ? updated.slice(0, this.maxPersistedRecords)
          : updated;
        await this.context.workspaceState.update(WORKSPACE_STATE_KEY, capped);
      } catch (e) {
        LoggerService.getInstance().warn(`[TaskHistoryService] Failed to prepend to workspaceState history: ${e}`);
      }
    }).catch(() => { /* queue must not break */ });
  }

  public getHistoryGroups(): ITaskHistoryGroup[] {
    return Array.from(this.historyGroups.values());
  }

  public getAllExecutions(): ITaskExecutionRecord[] {
    const all: ITaskExecutionRecord[] = [];
    for (const group of this.historyGroups.values()) {
      all.push(...group.executions);
    }
    return all.sort((a, b) => b.startTime - a.startTime);
  }

  public async clear(): Promise<void> {
    this.historyGroups.clear();
    this.activeExecutions.clear();

    // Clear workspaceState
    this.enqueueWorkspaceStateWrite([]);

    // Truncate NDJSON file
    if (this.ndjsonPath) {
      const filePath = this.ndjsonPath;
      this.historyWriteQueue.ndjson = this.historyWriteQueue.ndjson.then(async () => {
        try {
          const fileUri = vscode.Uri.file(filePath);
          // Only truncate if the file exists
          try {
            await vscode.workspace.fs.stat(fileUri);
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(''));
          } catch (e: unknown) {
            if (!isFileNotFoundError(e)) { throw e; }
            // File already absent — nothing to truncate
          }
        } catch (e) {
          LoggerService.getInstance().warn(`[TaskHistoryService] Failed to truncate task history NDJSON: ${e}`);
        }
      }).catch(() => { /* queue must not break */ });
    }

    await this.flush();
    this._onDidChange.fire();
  }

  /**
   * Resolves after all pending write operations for both storage targets
   * have completed. Primarily intended for extension deactivation and tests.
   */
  public flush(): Promise<void> {
    return Promise.all([
      this.historyWriteQueue.workspace,
      this.historyWriteQueue.ndjson,
    ]).then(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the error represents a "file not found" condition
 * across both Node.js and VS Code's `workspace.fs` APIs.
 */
function isFileNotFoundError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null) {
    const err = e as { code?: string | number };
    if (err.code === 'ENOENT') { return true; }
    // vscode.FileSystemError stringifies to include "EntryNotFound" or "FileNotFound"
    if (String(e).includes('EntryNotFound') || String(e).includes('FileNotFound')) { return true; }
  }
  return false;
}

/**
 * Ensures the `.vscode` directory that will contain `filePath` exists,
 * creating it if necessary. Uses `vscode.workspace.fs` so it works in all
 * VS Code environments.
 */
async function ensureVscodeDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const dirUri = vscode.Uri.file(dir);
  try {
    await vscode.workspace.fs.stat(dirUri);
  } catch (e: unknown) {
    if (isFileNotFoundError(e)) {
      await vscode.workspace.fs.createDirectory(dirUri);
    } else {
      throw e;
    }
  }
}
