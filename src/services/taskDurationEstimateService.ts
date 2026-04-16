import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskMetricsService } from './taskMetricsService';
import { TaskStateManager } from '../taskStateManager';
import { computeEma, computeVariability } from './taskMetricsAggregator';
import { formatSeconds } from '../common/formatSeconds';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface IRunningEstimate {
  item: TaskItem;
  /** `Date.now()` at the moment tracking started. */
  startTime: number;
  /**
   * EMA (ms) computed once when tracking started — frozen for the run's lifetime.
   * Subsequent metric updates do not affect the live ETA for the current run.
   */
  estimatedMs: number;
}

/** Shape returned by `getPreRunEstimate`. */
export interface IPreRunEstimate {
  emaMs: number;
  variability: 'Low' | 'Moderate' | 'High' | undefined;
  sampleCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Tracks running tasks and provides ETA descriptions for the tree view.
 *
 * Design constraints:
 * - Never mutates cached `TaskItem` objects. All overrides are applied as
 *   projections inside `TaskTreeDataProvider.getTreeItem()`.
 * - A single 1-second interval is shared across all tracked tasks; it is
 *   created lazily on first `startTracking` and cleared when the last task
 *   stops.
 */
export class TaskDurationEstimateService {
  private static instance: TaskDurationEstimateService;

  private readonly _onDidUpdateEta = new vscode.EventEmitter<string>();
  /**
   * Fires the task ID every ~1 s while a task with a known ETA is running,
   * and once more when the task stops (so the tree reverts to normal display).
   */
  public readonly onDidUpdateEta = this._onDidUpdateEta.event;

  private readonly running: Map<string, IRunningEstimate> = new Map();
  private _interval: ReturnType<typeof setInterval> | undefined;

  private constructor() {}

  public static getInstance(): TaskDurationEstimateService {
    if (!TaskDurationEstimateService.instance) {
      TaskDurationEstimateService.instance = new TaskDurationEstimateService();
    }
    return TaskDurationEstimateService.instance;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Subscribes to `TaskStateManager.onDidStateChange` for terminal states
   * (`'success'` and `'failure'` only — never `'running'`; `startTracking` is
   * called exclusively from `TaskRunner`).
   *
   * Registers a `Disposable` that stops all tracking (and clears the interval)
   * when the extension deactivates.
   *
   * Must be called once in `extension.activate()`.
   */
  public initialize(context: vscode.ExtensionContext): void {
    const stateSubscription = TaskStateManager.getInstance().onDidStateChange(({ id, status }) => {
      if (status === 'success' || status === 'failure') {
        this.stopTracking(id);
      }
    });

    context.subscriptions.push(
      stateSubscription,
      { dispose: () => this.stopAllTracking() },
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Begins ETA tracking for a task that is about to start.
   *
   * Called by `TaskRunner.runTask()` immediately before `vscode.tasks.executeTask()`.
   * Exits early (no-op) when fewer than 3 historical duration samples are available.
   * Never modifies `item.description` or any other cached `TaskItem` property.
   */
  public startTracking(item: TaskItem, task: vscode.Task): void {
    const scope = typeof task.scope === 'object'
      ? (task.scope as vscode.WorkspaceFolder).name
      : (task.scope?.toString() ?? 'global');

    const metricsKey = `${task.source}:${task.name}:${scope}`;
    const metrics = TaskMetricsService.getInstance().getMetrics(metricsKey);
    const ema = metrics ? computeEma(metrics.recentDurations) : undefined;
    if (ema === undefined) { return; } // < 3 samples — no ETA

    const id = TaskStateManager.getInstance().getTaskId(item);
    this.running.set(id, {
      item,
      startTime: Date.now(),
      estimatedMs: ema,
    });
    this.ensureInterval();
  }

  /**
   * Stops ETA tracking for a task that has completed.
   *
   * Fires `onDidUpdateEta` once so the tree can revert to the normal description.
   * Clears the shared interval when no tasks remain running.
   * The cached `TaskItem` is never modified — `TaskTreeDataProvider.getTreeItem()`
   * naturally takes the fast path (returns `element` unchanged) on the next render.
   */
  public stopTracking(taskId: string): void {
    if (!this.running.has(taskId)) { return; }
    this.running.delete(taskId);
    this._onDidUpdateEta.fire(taskId);
    if (this.running.size === 0) {
      this.clearSharedInterval();
    }
  }

  /**
   * Returns the ETA description for a currently-running task, or `undefined`
   * when the task is not tracked (< 3 historical samples, or not yet started).
   *
   * Possible return values:
   * - `"~Xs remaining"` — task is on track
   * - `"Longer than expected (~Xs est.)"` — elapsed time has exceeded the estimate
   */
  public getEtaDescription(taskId: string): string | undefined {
    const est = this.running.get(taskId);
    if (!est) { return undefined; }

    const elapsed = Date.now() - est.startTime;
    const remaining = est.estimatedMs - elapsed;
    if (remaining > 0) {
      return `~${formatSeconds(remaining)} remaining`;
    }
    return `Longer than expected (~${formatSeconds(est.estimatedMs)} est.)`;
  }

  /**
   * Returns pre-run duration metadata for an idle task, or `undefined` when
   * fewer than 3 runs are available.
   *
   * Used by `TaskTreeDataProvider.getTreeItem()` to enrich the hover tooltip
   * before the task is launched.
   *
   * Key construction is best-effort (`${item.taskType}:${label}:${scope}`).
   * Silently returns `undefined` on any key-miss.
   */
  public getPreRunEstimate(item: TaskItem): IPreRunEstimate | undefined {
    const label = item.originalLabel || item.label;
    const uri = item.taskFileUri || item.resourceUri;
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    const scope = folder?.name ?? 'global';
    const key = `${item.taskType}:${label}:${scope}`;

    const metrics = TaskMetricsService.getInstance().getMetrics(key);
    if (!metrics || metrics.recentDurations.length < 3) { return undefined; }

    const emaMs = computeEma(metrics.recentDurations);
    if (emaMs === undefined) { return undefined; }

    const variability = computeVariability(metrics.recentDurations);
    return { emaMs, variability, sampleCount: metrics.recentDurations.length };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureInterval(): void {
    if (this._interval) { return; } // guard: only one interval at a time
    this._interval = setInterval(() => {
      for (const [id] of this.running) {
        this._onDidUpdateEta.fire(id);
      }
    }, 1000);
  }

  private clearSharedInterval(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = undefined;
    }
  }

  /** Called by the context disposable registered in `initialize()`. */
  private stopAllTracking(): void {
    this.running.clear();
    this.clearSharedInterval();
  }
}
