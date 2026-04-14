import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskMetricsService, MetricsScope } from '../../services/taskMetricsService';
import { TaskHistoryService, ITaskExecutionRecord } from '../../services/taskHistoryService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ITaskExecutionRecord> = {}): ITaskExecutionRecord {
  return {
    id: 'test-id',
    taskName: 'build',
    taskSource: 'npm',
    scope: 'workspace',
    definition: { type: 'npm' },
    startTime: Date.now(),
    endTime: Date.now() + 1000,
    duration: 1000,
    exitCode: 0,
    status: 'Success',
    ...overrides,
  };
}

function createMockContext(
  workspaceData: Map<string, unknown> = new Map(),
  globalData: Map<string, unknown> = new Map(),
): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {
      get: (key: string, defaultValue?: unknown) =>
        workspaceData.has(key) ? workspaceData.get(key) : defaultValue,
      update: async (key: string, value: unknown) => {
        workspaceData.set(key, value);
      },
      keys: () => [],
    },
    globalState: {
      get: (key: string, defaultValue?: unknown) =>
        globalData.has(key) ? globalData.get(key) : defaultValue,
      update: async (key: string, value: unknown) => {
        globalData.set(key, value);
      },
      keys: () => [],
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskMetricsService Test Suite', () => {
  let service: TaskMetricsService;
  let workspaceData: Map<string, unknown>;
  let globalData: Map<string, unknown>;
  let mockContext: vscode.ExtensionContext;
  let configValues: Record<string, unknown>;
  let capturedConfigHandlers: Array<(e: vscode.ConfigurationChangeEvent) => void>;
  let capturedHistoryHandlers: Array<(r: ITaskExecutionRecord) => void>;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalOnDidChangeConfiguration: typeof vscode.workspace.onDidChangeConfiguration;

  const resetSingleton = () => {
    (TaskMetricsService as any).instance = undefined;
  };

  const fireConfigChange = (section: string) => {
    const event: vscode.ConfigurationChangeEvent = {
      affectsConfiguration: (cfg: string) => cfg === section || section.startsWith(cfg + '.'),
    };
    capturedConfigHandlers.forEach((h) => h(event));
  };

  /** Simulate a task record being recorded by TaskHistoryService */
  const fireHistoryRecord = (record: ITaskExecutionRecord) => {
    capturedHistoryHandlers.forEach((h) => h(record));
  };

  setup(() => {
    resetSingleton();

    workspaceData = new Map();
    globalData = new Map();
    mockContext = createMockContext(workspaceData, globalData);
    configValues = {};
    capturedConfigHandlers = [];
    capturedHistoryHandlers = [];

    // Reset TaskHistoryService singleton and patch onDidRecordHistory
    (TaskHistoryService as any).instance = undefined;
    const historyService = TaskHistoryService.getInstance();
    (historyService as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, defaultValue?: T): T =>
            (Object.prototype.hasOwnProperty.call(configValues, key)
              ? configValues[key]
              : defaultValue) as T,
        };
      }
      return originalGetConfiguration(section);
    };

    originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = (
      listener: (e: vscode.ConfigurationChangeEvent) => void,
    ) => {
      capturedConfigHandlers.push(listener);
      return { dispose: () => {} };
    };

    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);
  });

  teardown(() => {
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = originalOnDidChangeConfiguration;
  });

  // -------------------------------------------------------------------------
  // Scope: workspace (default)
  // -------------------------------------------------------------------------

  test('scope=workspace: records saved to workspaceState', async () => {
    fireHistoryRecord(makeRecord({ status: 'Success', exitCode: 0, duration: 500 }));
    await service.flush();
    assert.ok(workspaceData.has('workspaceTasks.taskMetrics'));
    assert.strictEqual(globalData.has('workspaceTasks.taskMetrics'), false);
  });

  test('scope=workspace: getMetrics returns data', async () => {
    const rec = makeRecord({ status: 'Success', exitCode: 0, duration: 500 });
    fireHistoryRecord(rec);
    await service.flush();
    const key = `${rec.taskSource}:${rec.taskName}:${rec.scope}`;
    const metrics = service.getMetrics(key);
    assert.ok(metrics !== undefined);
    assert.strictEqual(metrics!.totalExecutions, 1);
    assert.strictEqual(metrics!.successRate, 100);
  });

  test('scope=workspace: getAllMetrics returns all tasks', async () => {
    fireHistoryRecord(makeRecord({ taskName: 'build', status: 'Success', exitCode: 0, duration: 100 }));
    fireHistoryRecord(makeRecord({ taskName: 'test', status: 'Failed', exitCode: 1, duration: 200 }));
    await service.flush();
    const all = service.getAllMetrics();
    const keys = Object.keys(all);
    assert.strictEqual(keys.length, 2);
  });

  // -------------------------------------------------------------------------
  // Scope: global
  // -------------------------------------------------------------------------

  test('scope=global: records saved to globalState', async () => {
    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    configValues['metrics.scope'] = 'global';
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);

    fireHistoryRecord(makeRecord({ status: 'Success', exitCode: 0, duration: 300 }));
    await service.flush();
    assert.ok(globalData.has('workspaceTasks.taskMetrics'));
    assert.strictEqual(workspaceData.has('workspaceTasks.taskMetrics'), false);
  });

  // -------------------------------------------------------------------------
  // Scope: both
  // -------------------------------------------------------------------------

  test('scope=both: records saved to both stores', async () => {
    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    configValues['metrics.scope'] = 'both';
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);

    fireHistoryRecord(makeRecord({ status: 'Success', exitCode: 0, duration: 200 }));
    await service.flush();
    assert.ok(workspaceData.has('workspaceTasks.taskMetrics'));
    assert.ok(globalData.has('workspaceTasks.taskMetrics'));
  });

  // -------------------------------------------------------------------------
  // Scope: disabled
  // -------------------------------------------------------------------------

  test('scope=disabled: nothing stored, getMetrics returns undefined', () => {
    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    configValues['metrics.scope'] = 'disabled';
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);

    fireHistoryRecord(makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    assert.strictEqual(workspaceData.has('workspaceTasks.taskMetrics'), false);
    assert.strictEqual(globalData.has('workspaceTasks.taskMetrics'), false);
    assert.strictEqual(service.getMetrics('npm:build:workspace'), undefined);
  });

  // -------------------------------------------------------------------------
  // getMetrics / getAllMetrics for unknown key
  // -------------------------------------------------------------------------

  test('getMetrics returns undefined for unknown key', () => {
    assert.strictEqual(service.getMetrics('not:a:key'), undefined);
  });

  test('getAllMetrics returns empty object when no records', () => {
    const all = service.getAllMetrics();
    assert.deepStrictEqual(all, {});
  });

  // -------------------------------------------------------------------------
  // clearMetrics
  // -------------------------------------------------------------------------

  test('clearMetrics removes single task', async () => {
    const rec = makeRecord({ status: 'Success', exitCode: 0, duration: 100 });
    fireHistoryRecord(rec);
    await service.flush();
    const key = `${rec.taskSource}:${rec.taskName}:${rec.scope}`;
    assert.ok(service.getMetrics(key) !== undefined);
    service.clearMetrics(key);
    await service.flush();
    assert.strictEqual(service.getMetrics(key), undefined);
  });

  test('clearMetrics fires onDidChangeMetrics', () => {
    let fired = false;
    service.onDidChangeMetrics(() => { fired = true; });
    const rec = makeRecord({ status: 'Success', exitCode: 0, duration: 100 });
    fireHistoryRecord(rec);
    fired = false; // reset after initial fire
    const key = `${rec.taskSource}:${rec.taskName}:${rec.scope}`;
    service.clearMetrics(key);
    assert.strictEqual(fired, true);
  });

  // -------------------------------------------------------------------------
  // clearAllMetrics
  // -------------------------------------------------------------------------

  test('clearAllMetrics removes all tasks', async () => {
    fireHistoryRecord(makeRecord({ taskName: 'build', status: 'Success', exitCode: 0, duration: 100 }));
    fireHistoryRecord(makeRecord({ taskName: 'test', status: 'Success', exitCode: 0, duration: 200 }));
    await service.flush();
    assert.strictEqual(Object.keys(service.getAllMetrics()).length, 2);
    service.clearAllMetrics();
    await service.flush();
    assert.deepStrictEqual(service.getAllMetrics(), {});
  });

  test('clearAllMetrics fires onDidChangeMetrics', () => {
    let fired = false;
    service.onDidChangeMetrics(() => { fired = true; });
    fired = false;
    service.clearAllMetrics();
    assert.strictEqual(fired, true);
  });

  // -------------------------------------------------------------------------
  // clearCurrentWorkspaceMetrics
  // -------------------------------------------------------------------------

  /** Recreate the service instance with a specific scope. */
  function reinitServiceWithScope(scope: MetricsScope): void {
    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };
    configValues['metrics.scope'] = scope;
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);
  }

  const METRICS_STORAGE_KEY = 'workspaceTasks.taskMetrics';

  test('clearCurrentWorkspaceMetrics: scope=workspace wipes workspace store entirely', async () => {
    fireHistoryRecord(makeRecord({ taskName: 'build', scope: 'myProject', status: 'Success', exitCode: 0, duration: 100 }));
    fireHistoryRecord(makeRecord({ taskName: 'test', scope: 'myProject', status: 'Success', exitCode: 0, duration: 200 }));
    await service.flush();
    assert.strictEqual(Object.keys(service.getAllMetrics()).length, 2);
    service.clearCurrentWorkspaceMetrics(['myProject']);
    await service.flush();
    assert.deepStrictEqual(service.getAllMetrics(), {});
  });

  test('clearCurrentWorkspaceMetrics: scope=workspace does not touch global store', () => {
    globalData.set(METRICS_STORAGE_KEY, { 'npm:build:otherProject': { totalExecutions: 5 } });
    fireHistoryRecord(makeRecord({ taskName: 'build', scope: 'myProject', status: 'Success', exitCode: 0, duration: 100 }));
    service.clearCurrentWorkspaceMetrics(['myProject']);
    const globalStore = globalData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.ok('npm:build:otherProject' in globalStore, 'global store should be untouched');
  });

  test('clearCurrentWorkspaceMetrics: scope=global removes matching folder keys only', async () => {
    reinitServiceWithScope('global');
    globalData.set(METRICS_STORAGE_KEY, {
      'npm:build:myProject': { totalExecutions: 3 },
      'npm:test:otherProject': { totalExecutions: 7 },
    });
    service.clearCurrentWorkspaceMetrics(['myProject']);
    await service.flush();
    const remaining = globalData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.strictEqual('npm:build:myProject' in remaining, false, 'matching key should be removed');
    assert.ok('npm:test:otherProject' in remaining, 'non-matching key should be preserved');
  });

  test('clearCurrentWorkspaceMetrics: scope=global preserves "1" and "global" scoped keys', async () => {
    reinitServiceWithScope('global');
    globalData.set(METRICS_STORAGE_KEY, {
      'npm:build:1': { totalExecutions: 1 },
      'npm:build:global': { totalExecutions: 2 },
      'npm:build:myProject': { totalExecutions: 3 },
    });
    service.clearCurrentWorkspaceMetrics(['myProject']);
    await service.flush();
    const remaining = globalData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.ok('npm:build:1' in remaining, '"1"-scoped key should be preserved');
    assert.ok('npm:build:global' in remaining, '"global"-scoped key should be preserved');
    assert.strictEqual('npm:build:myProject' in remaining, false, 'folder-scoped key should be removed');
  });

  test('clearCurrentWorkspaceMetrics: scope=both wipes workspace store and removes matching global keys', async () => {
    reinitServiceWithScope('both');
    workspaceData.set(METRICS_STORAGE_KEY, { 'npm:build:1': { totalExecutions: 2 } });
    globalData.set(METRICS_STORAGE_KEY, {
      'npm:build:myProject': { totalExecutions: 5 },
      'npm:test:otherProject': { totalExecutions: 7 },
    });
    service.clearCurrentWorkspaceMetrics(['myProject']);
    await service.flush();
    const wsStore = workspaceData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.deepStrictEqual(wsStore, {}, 'workspace store should be wiped');
    const gStore = globalData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.strictEqual('npm:build:myProject' in gStore, false, 'matching global key should be removed');
    assert.ok('npm:test:otherProject' in gStore, 'non-matching global key should be preserved');
  });

  test('clearCurrentWorkspaceMetrics: scope=disabled is a no-op', () => {
    reinitServiceWithScope('disabled');
    workspaceData.set(METRICS_STORAGE_KEY, { 'npm:build:myProject': { totalExecutions: 1 } });
    globalData.set(METRICS_STORAGE_KEY, { 'npm:build:myProject': { totalExecutions: 1 } });
    service.clearCurrentWorkspaceMetrics(['myProject']);
    const wsStore = workspaceData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    const gStore = globalData.get(METRICS_STORAGE_KEY) as Record<string, unknown>;
    assert.ok('npm:build:myProject' in wsStore, 'workspace store should be unchanged');
    assert.ok('npm:build:myProject' in gStore, 'global store should be unchanged');
  });

  test('clearCurrentWorkspaceMetrics: fires onDidChangeMetrics', () => {
    let fired = false;
    service.onDidChangeMetrics(() => { fired = true; });
    fired = false;
    service.clearCurrentWorkspaceMetrics(['any']);
    assert.strictEqual(fired, true);
  });

  // -------------------------------------------------------------------------
  // onDidChangeMetrics event
  // -------------------------------------------------------------------------

  test('onDidChangeMetrics fires when a record is received', () => {
    let count = 0;
    service.onDidChangeMetrics(() => { count++; });
    fireHistoryRecord(makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    assert.strictEqual(count, 1);
  });

  // -------------------------------------------------------------------------
  // Config change handling
  // -------------------------------------------------------------------------

  test('onDidChangeConfiguration for scope fires onDidChangeMetrics', () => {
    let count = 0;
    service.onDidChangeMetrics(() => { count++; });
    configValues['metrics.scope'] = 'global';
    fireConfigChange('workspaceTasks.metrics.scope');
    assert.strictEqual(count, 1);
  });

  // -------------------------------------------------------------------------
  // Retention pruning
  // -------------------------------------------------------------------------

  test('retentionDays=0 does not prune any records', () => {
    // Pre-populate with an old record
    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const stored = {
      'npm:build:workspace': {
        totalExecutions: 5,
        successfulExecutions: 5,
        failedExecutions: 0,
        terminatedExecutions: 0,
        totalDurationMs: 500,
        minDurationMs: 100,
        maxDurationMs: 100,
        recentDurations: [100, 100, 100, 100, 100],
        firstRunAt: oldTime,
        lastRunAt: oldTime,
        lastSuccessAt: oldTime,
        lastFailureAt: undefined,
        lastTerminatedAt: undefined,
        lastExitCode: 0,
        exitCodeCounts: { '0': 5 },
        consecutiveFailures: 0,
        consecutiveSuccesses: 5,
        hourlyRunCounts: Array(24).fill(0),
      },
    };
    workspaceData.set('workspaceTasks.taskMetrics', stored);

    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    // Default retentionDays = 0 (no limit)
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);

    assert.ok(service.getMetrics('npm:build:workspace') !== undefined);
  });

  test('retentionDays>0 prunes stale records on initialize', async () => {
    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const stored = {
      'npm:build:workspace': {
        totalExecutions: 1,
        successfulExecutions: 1,
        failedExecutions: 0,
        terminatedExecutions: 0,
        totalDurationMs: 100,
        minDurationMs: 100,
        maxDurationMs: 100,
        recentDurations: [100],
        firstRunAt: oldTime,
        lastRunAt: oldTime,
        lastSuccessAt: oldTime,
        lastFailureAt: undefined,
        lastTerminatedAt: undefined,
        lastExitCode: 0,
        exitCodeCounts: { '0': 1 },
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
        hourlyRunCounts: Array(24).fill(0),
      },
    };
    workspaceData.set('workspaceTasks.taskMetrics', stored);

    capturedHistoryHandlers = [];
    resetSingleton();
    (TaskHistoryService as any).instance = undefined;
    const hs = TaskHistoryService.getInstance();
    (hs as any).onDidRecordHistory = (listener: (r: ITaskExecutionRecord) => void) => {
      capturedHistoryHandlers.push(listener);
      return { dispose: () => {} };
    };

    configValues['metrics.retentionDays'] = 5; // 5-day retention, record is 10 days old
    service = TaskMetricsService.getInstance();
    service.initialize(mockContext);
    await service.flush();

    assert.strictEqual(service.getMetrics('npm:build:workspace'), undefined);
  });
});
