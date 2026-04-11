import * as vscode from 'vscode';
import { ITaskExecutionRecord } from './taskHistoryService';
import { TaskHistoryService } from './taskHistoryService';
import { ITaskMetrics, ITaskMetricsWithComputed, createDefaultMetrics } from './taskMetricsTypes';
import { updateMetricsFromRecord, computeMetricsWithStats } from './taskMetricsAggregator';

/** Supported storage scope values */
export type MetricsScope = 'workspace' | 'global' | 'both' | 'disabled';

const STORAGE_KEY = 'workspaceTasks.taskMetrics';
const CONFIG_SECTION = 'workspaceTasks';

/** Map from taskKey → ITaskMetrics, as persisted in state */
type MetricsStore = Record<string, ITaskMetrics>;

export class TaskMetricsService {
  private static instance: TaskMetricsService;

  private readonly _onDidChangeMetrics = new vscode.EventEmitter<void>();
  /** Fires whenever any task's metrics are updated or cleared. */
  public readonly onDidChangeMetrics = this._onDidChangeMetrics.event;

  private context: vscode.ExtensionContext | undefined;
  private scope: MetricsScope = 'workspace';
  private maxRecentSamples: number = 100;
  private retentionDays: number = 0;

  private constructor() {}

  public static getInstance(): TaskMetricsService {
    if (!TaskMetricsService.instance) {
      TaskMetricsService.instance = new TaskMetricsService();
    }
    return TaskMetricsService.instance;
  }

  /** Must be called once in extension activate() before any metrics are recorded. */
  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    this.loadConfig();
    this.pruneStaleRecords();

    // React to configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`${CONFIG_SECTION}.metrics.scope`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.metrics.maxDurationSamples`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.metrics.retentionDays`)
        ) {
          this.loadConfig();
          this._onDidChangeMetrics.fire();
        }
      }),
    );

    // Subscribe to new history records from TaskHistoryService
    const historyService = TaskHistoryService.getInstance();
    context.subscriptions.push(
      historyService.onDidRecordHistory((record) => this.handleRecord(record)),
    );
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  private loadConfig(): void {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    this.scope = cfg.get<MetricsScope>('metrics.scope', 'workspace');
    this.maxRecentSamples = cfg.get<number>('metrics.maxDurationSamples', 100);
    this.retentionDays = cfg.get<number>('metrics.retentionDays', 0);
  }

  // ---------------------------------------------------------------------------
  // Record handling
  // ---------------------------------------------------------------------------

  private handleRecord(record: ITaskExecutionRecord): void {
    if (this.scope === 'disabled') { return; }

    const taskKey = this.getTaskKey(record);

    if (this.scope === 'workspace' || this.scope === 'both') {
      const store = this.readStore('workspace');
      store[taskKey] = updateMetricsFromRecord(store[taskKey], record, this.maxRecentSamples);
      this.writeStore('workspace', store);
    }

    if (this.scope === 'global' || this.scope === 'both') {
      const store = this.readStore('global');
      store[taskKey] = updateMetricsFromRecord(store[taskKey], record, this.maxRecentSamples);
      this.writeStore('global', store);
    }

    this._onDidChangeMetrics.fire();
  }

  /** Derives a stable key from an execution record matching TaskHistoryService convention. */
  private getTaskKey(record: ITaskExecutionRecord): string {
    const scope =
      record.definition?.scope !== undefined
        ? String(record.definition.scope)
        : 'global';
    return `${record.taskSource}:${record.taskName}:${scope}`;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns metrics (with computed fields) for a single task, or undefined if none exist. */
  public getMetrics(taskKey: string): ITaskMetricsWithComputed | undefined {
    const stored = this.readMergedStore()[taskKey];
    if (!stored) { return undefined; }
    return computeMetricsWithStats(stored);
  }

  /** Returns metrics (with computed fields) for all tracked tasks. */
  public getAllMetrics(): Record<string, ITaskMetricsWithComputed> {
    const store = this.readMergedStore();
    const result: Record<string, ITaskMetricsWithComputed> = {};
    for (const [key, metrics] of Object.entries(store)) {
      result[key] = computeMetricsWithStats(metrics);
    }
    return result;
  }

  /** Clears metrics for a single task from all active stores. */
  public clearMetrics(taskKey: string): void {
    if (this.scope === 'disabled') { return; }

    if (this.scope === 'workspace' || this.scope === 'both') {
      const store = this.readStore('workspace');
      delete store[taskKey];
      this.writeStore('workspace', store);
    }

    if (this.scope === 'global' || this.scope === 'both') {
      const store = this.readStore('global');
      delete store[taskKey];
      this.writeStore('global', store);
    }

    this._onDidChangeMetrics.fire();
  }

  /** Clears all metrics from all active stores. */
  public clearAllMetrics(): void {
    if (this.scope === 'disabled') { return; }

    if (this.scope === 'workspace' || this.scope === 'both') {
      this.writeStore('workspace', {});
    }

    if (this.scope === 'global' || this.scope === 'both') {
      this.writeStore('global', {});
    }

    this._onDidChangeMetrics.fire();
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  private readStore(target: 'workspace' | 'global'): MetricsStore {
    if (!this.context) { return {}; }
    const state = target === 'workspace' ? this.context.workspaceState : this.context.globalState;
    return state.get<MetricsStore>(STORAGE_KEY, {});
  }

  private writeStore(target: 'workspace' | 'global', store: MetricsStore): void {
    if (!this.context) { return; }
    const state = target === 'workspace' ? this.context.workspaceState : this.context.globalState;
    state.update(STORAGE_KEY, store);
  }

  /**
   * Returns the effective store to read from.
   * For scope=both, merges workspace (primary) and global (secondary),
   * with workspace entries taking precedence.
   */
  private readMergedStore(): MetricsStore {
    if (this.scope === 'disabled') { return {}; }
    if (this.scope === 'workspace') { return this.readStore('workspace'); }
    if (this.scope === 'global') { return this.readStore('global'); }

    // scope === 'both': merge; workspace takes precedence
    const global = this.readStore('global');
    const workspace = this.readStore('workspace');
    return { ...global, ...workspace };
  }

  // ---------------------------------------------------------------------------
  // Retention pruning
  // ---------------------------------------------------------------------------

  private pruneStaleRecords(): void {
    if (this.retentionDays <= 0 || this.scope === 'disabled') { return; }

    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    const prune = (target: 'workspace' | 'global') => {
      const store = this.readStore(target);
      let changed = false;
      for (const key of Object.keys(store)) {
        const m = store[key];
        if (m.lastRunAt !== undefined && m.lastRunAt < cutoffMs) {
          delete store[key];
          changed = true;
        }
      }
      if (changed) { this.writeStore(target, store); }
    };

    if (this.scope === 'workspace' || this.scope === 'both') { prune('workspace'); }
    if (this.scope === 'global' || this.scope === 'both') { prune('global'); }
  }
}
