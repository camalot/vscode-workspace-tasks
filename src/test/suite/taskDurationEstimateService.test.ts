import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskDurationEstimateService } from '../../services/taskDurationEstimateService';
import { TaskMetricsService } from '../../services/taskMetricsService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskItem } from '../../taskItem';
import { ITaskMetricsWithComputed } from '../../services/taskMetricsTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskItem(opts: {
  label?: string;
  originalLabel?: string;
  taskType?: string;
  id?: string;
  taskFileUri?: vscode.Uri;
  resourceUri?: vscode.Uri;
  collapsibleState?: vscode.TreeItemCollapsibleState;
} = {}): TaskItem {
  return {
    label: opts.label ?? 'build',
    originalLabel: opts.originalLabel ?? opts.label ?? 'build',
    taskType: opts.taskType ?? 'npm',
    id: opts.id ?? 'test-task-id',
    taskFileUri: opts.taskFileUri,
    resourceUri: opts.resourceUri,
    collapsibleState: opts.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
  } as unknown as TaskItem;
}

function makeVscodeTask(opts: { source?: string; name?: string; scope?: unknown } = {}): vscode.Task {
  return {
    source: opts.source ?? 'npm',
    name: opts.name ?? 'build',
    scope: opts.scope,
  } as unknown as vscode.Task;
}

function makeMetrics(durations: number[]): ITaskMetricsWithComputed {
  return {
    recentDurations: durations,
    totalExecutions: durations.length,
    successfulExecutions: durations.length,
    failedExecutions: 0,
    terminatedExecutions: 0,
    totalDurationMs: durations.reduce((s, d) => s + d, 0),
    minDurationMs: durations.length ? Math.min(...durations) : undefined,
    maxDurationMs: durations.length ? Math.max(...durations) : undefined,
    firstRunAt: undefined,
    lastRunAt: undefined,
    lastSuccessAt: undefined,
    lastFailureAt: undefined,
    lastTerminatedAt: undefined,
    lastExitCode: undefined,
    exitCodeCounts: {},
    consecutiveFailures: 0,
    consecutiveSuccesses: durations.length,
    hourlyRunCounts: Array(24).fill(0),
    avgDurationMs: undefined,
    medianDurationMs: undefined,
    p95DurationMs: undefined,
    successRate: 100,
    isFlaky: false,
    mostCommonExitCode: undefined,
    peakHour: undefined,
    runFrequency: undefined,
    durationTrend: undefined,
    typicalDurationMs: undefined,
    durationVariability: undefined,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskDurationEstimateService', () => {
  let service: TaskDurationEstimateService;
  let metricsService: TaskMetricsService;
  let stateManager: TaskStateManager;

  const resetSingletons = () => {
    (TaskDurationEstimateService as any).instance = undefined;
    (TaskMetricsService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  };

  setup(() => {
    resetSingletons();
    service = TaskDurationEstimateService.getInstance();

    metricsService = TaskMetricsService.getInstance();
    // Default stub: no metrics for any key
    (metricsService as any).getMetrics = (_key: string): ITaskMetricsWithComputed | undefined => undefined;

    stateManager = TaskStateManager.getInstance();
    // Default stub: getTaskId returns item.id
    (stateManager as any).getTaskId = (item: TaskItem) => (item as any).id ?? 'unknown';
  });

  teardown(() => {
    // Clean up any live interval before discarding the instance
    const runningMap = (service as any).running as Map<string, unknown>;
    runningMap.clear();
    if ((service as any)._interval) {
      clearInterval((service as any)._interval);
      (service as any)._interval = undefined;
    }
    resetSingletons();
  });

  // -------------------------------------------------------------------------
  // startTracking — fewer than 3 samples
  // -------------------------------------------------------------------------

  test('startTracking with < 3 recentDurations does not add to running map', () => {
    (metricsService as any).getMetrics = () => makeMetrics([1000, 2000]);
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());

    assert.strictEqual((service as any).running.size, 0);
    assert.strictEqual(service.getEtaDescription('task-a'), undefined);
  });

  test('startTracking with missing metrics does not add to running map', () => {
    (metricsService as any).getMetrics = () => undefined;
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());

    assert.strictEqual((service as any).running.size, 0);
  });

  // -------------------------------------------------------------------------
  // startTracking — 3 or more samples
  // -------------------------------------------------------------------------

  test('startTracking with >= 3 samples adds to running map', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());

    assert.strictEqual((service as any).running.size, 1);
    assert.ok(service.getEtaDescription('task-a') !== undefined);
  });

  test('startTracking starts the shared interval', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());

    assert.ok((service as any)._interval !== undefined);
  });

  // -------------------------------------------------------------------------
  // getEtaDescription
  // -------------------------------------------------------------------------

  test('getEtaDescription returns undefined for untracked task', () => {
    assert.strictEqual(service.getEtaDescription('non-existent'), undefined);
  });

  test('getEtaDescription returns ~Xs remaining while within estimate', () => {
    const item = makeTaskItem({ id: 'task-a' });
    (service as any).running.set('task-a', {
      item,
      startTime: Date.now(),
      estimatedMs: 30_000,
    });

    const desc = service.getEtaDescription('task-a');
    assert.ok(desc !== undefined);
    assert.ok(desc.startsWith('~'), `expected "~" prefix, got "${desc}"`);
    assert.ok(desc.includes('remaining'), `expected "remaining", got "${desc}"`);
  });

  test('getEtaDescription returns Longer than expected when elapsed > estimatedMs', () => {
    const item = makeTaskItem({ id: 'task-a' });
    (service as any).running.set('task-a', {
      item,
      startTime: Date.now() - 120_000, // 2 minutes elapsed
      estimatedMs: 60_000,             // 1 minute estimated
    });

    const desc = service.getEtaDescription('task-a');
    assert.ok(desc !== undefined);
    assert.ok(
      desc.startsWith('Longer than expected'),
      `expected "Longer than expected" prefix, got "${desc}"`,
    );
    assert.ok(desc.includes('est.'), `expected "est." in "${desc}"`);
  });

  // -------------------------------------------------------------------------
  // stopTracking
  // -------------------------------------------------------------------------

  test('stopTracking removes task from running map', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());
    assert.strictEqual((service as any).running.size, 1);

    service.stopTracking('task-a');

    assert.strictEqual((service as any).running.size, 0);
    assert.strictEqual(service.getEtaDescription('task-a'), undefined);
  });

  test('stopTracking clears the interval when no tasks remain', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const item = makeTaskItem({ id: 'task-a' });

    service.startTracking(item, makeVscodeTask());
    assert.ok((service as any)._interval !== undefined, 'interval should exist after startTracking');

    service.stopTracking('task-a');

    assert.strictEqual((service as any)._interval, undefined);
  });

  test('stopTracking fires onDidUpdateEta for the stopped task ID', () => {
    const item = makeTaskItem({ id: 'task-a' });
    (service as any).running.set('task-a', { item, startTime: Date.now(), estimatedMs: 30_000 });

    const firedIds: string[] = [];
    service.onDidUpdateEta(id => firedIds.push(id));

    service.stopTracking('task-a');

    assert.ok(firedIds.includes('task-a'), `expected 'task-a' in ${JSON.stringify(firedIds)}`);
  });

  test('stopTracking is a no-op for an untracked task ID', () => {
    assert.doesNotThrow(() => service.stopTracking('non-existent'));
  });

  // -------------------------------------------------------------------------
  // Multiple concurrent tasks
  // -------------------------------------------------------------------------

  test('multiple tasks are tracked independently and share one interval', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const itemA = makeTaskItem({ id: 'task-a', label: 'build' });
    const itemB = makeTaskItem({ id: 'task-b', label: 'test' });

    service.startTracking(itemA, makeVscodeTask({ name: 'build' }));
    service.startTracking(itemB, makeVscodeTask({ name: 'test' }));

    assert.strictEqual((service as any).running.size, 2);
    assert.ok((service as any)._interval !== undefined, 'single shared interval');
    assert.ok(service.getEtaDescription('task-a') !== undefined);
    assert.ok(service.getEtaDescription('task-b') !== undefined);
  });

  test('interval persists while any task is still running', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000]);
    const itemA = makeTaskItem({ id: 'task-a' });
    const itemB = makeTaskItem({ id: 'task-b', label: 'test' });

    service.startTracking(itemA, makeVscodeTask({ name: 'build' }));
    service.startTracking(itemB, makeVscodeTask({ name: 'test' }));

    service.stopTracking('task-a');
    assert.ok((service as any)._interval !== undefined, 'interval persists while task-b is running');

    service.stopTracking('task-b');
    assert.strictEqual((service as any)._interval, undefined, 'interval cleared when all tasks stop');
  });

  // -------------------------------------------------------------------------
  // getPreRunEstimate
  // -------------------------------------------------------------------------

  test('getPreRunEstimate returns undefined when metrics are absent', () => {
    (metricsService as any).getMetrics = () => undefined;
    const item = makeTaskItem();

    assert.strictEqual(service.getPreRunEstimate(item), undefined);
  });

  test('getPreRunEstimate returns undefined when fewer than 3 samples', () => {
    (metricsService as any).getMetrics = () => makeMetrics([1000, 2000]);
    const item = makeTaskItem();

    assert.strictEqual(service.getPreRunEstimate(item), undefined);
  });

  test('getPreRunEstimate returns { emaMs, variability, sampleCount } with >= 3 samples', () => {
    (metricsService as any).getMetrics = () => makeMetrics([5000, 5000, 5000, 5000]);
    const item = makeTaskItem({ taskType: 'npm', label: 'build' });

    const result = service.getPreRunEstimate(item);

    assert.ok(result !== undefined);
    assert.ok(typeof result.emaMs === 'number' && result.emaMs > 0, `expected positive emaMs, got ${result.emaMs}`);
    assert.ok(
      ['Low', 'Moderate', 'High', undefined].includes(result.variability),
      `unexpected variability: ${result.variability}`,
    );
    assert.strictEqual(result.sampleCount, 4);
  });

  test('getPreRunEstimate uses originalLabel when set', () => {
    const capturedKeys: string[] = [];
    (metricsService as any).getMetrics = (key: string) => {
      capturedKeys.push(key);
      return undefined;
    };
    const item = makeTaskItem({ taskType: 'npm', label: 'build', originalLabel: 'my-original' });

    service.getPreRunEstimate(item);

    assert.ok(
      capturedKeys.some(k => k.includes('my-original')),
      `expected key with 'my-original', got: ${JSON.stringify(capturedKeys)}`,
    );
  });

  test('getPreRunEstimate falls back to label when originalLabel equals label', () => {
    const capturedKeys: string[] = [];
    (metricsService as any).getMetrics = (key: string) => {
      capturedKeys.push(key);
      return undefined;
    };
    const item = makeTaskItem({ taskType: 'npm', label: 'build', originalLabel: 'build' });

    service.getPreRunEstimate(item);

    assert.ok(
      capturedKeys.some(k => k.includes('build')),
      `expected key with 'build', got: ${JSON.stringify(capturedKeys)}`,
    );
  });

  test('getPreRunEstimate uses global scope when item has no URI', () => {
    const capturedKeys: string[] = [];
    (metricsService as any).getMetrics = (key: string) => {
      capturedKeys.push(key);
      return undefined;
    };
    const item = makeTaskItem({ taskType: 'npm', label: 'build' }); // no taskFileUri / resourceUri

    service.getPreRunEstimate(item);

    assert.ok(
      capturedKeys.some(k => k.endsWith(':global')),
      `expected key ending with ':global', got: ${JSON.stringify(capturedKeys)}`,
    );
  });
});
