import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskHistoryTableViewProvider } from '../../taskHistoryTableViewProvider';
import { TaskHistoryService, ITaskExecutionRecord } from '../../services/taskHistoryService';
import { TaskMetricsService } from '../../services/taskMetricsService';
import { ITaskMetricsWithComputed } from '../../services/taskMetricsTypes';

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
    startTime: 1000000,
    endTime: 1001500,
    duration: 1500,
    exitCode: 0,
    status: 'Success',
    ...overrides,
  };
}

/**
 * Minimal fake WebviewView. Captures postMessage calls and fired event handlers.
 */
function makeFakeWebviewView(): {
  view: vscode.WebviewView;
  postedMessages: unknown[];
  fireVisibilityChange: () => void;
  fireDispose: () => void;
  fireMessage: (msg: unknown) => void;
  setVisible: (v: boolean) => void;
} {
  const postedMessages: unknown[] = [];
  let visibilityListeners: (() => void)[] = [];
  let disposeListeners: (() => void)[] = [];
  let messageListeners: ((msg: unknown) => void)[] = [];
  let visible = true;

  const webview = {
    options: {} as vscode.WebviewOptions,
    html: '',
    cspSource: 'vscode-resource:',
    postMessage: async (msg: unknown) => {
      postedMessages.push(msg);
      return true;
    },
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: (listener: (msg: unknown) => void) => {
      messageListeners.push(listener);
      return { dispose: () => { messageListeners = messageListeners.filter(l => l !== listener); } };
    },
  } as unknown as vscode.Webview;

  const view: vscode.WebviewView = {
    webview,
    get visible() { return visible; },
    viewType: 'workspaceTasksHistoryTableView',
    onDidChangeVisibility: (listener: () => void) => {
      visibilityListeners.push(listener);
      return { dispose: () => { visibilityListeners = visibilityListeners.filter(l => l !== listener); } };
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: () => {} };
    },
    title: '',
    show: () => {},
  } as unknown as vscode.WebviewView;

  return {
    view,
    postedMessages,
    fireVisibilityChange: () => visibilityListeners.forEach(l => l()),
    fireDispose: () => disposeListeners.forEach(l => l()),
    fireMessage: (msg) => messageListeners.forEach(l => l(msg)),
    setVisible: (v) => { visible = v; },
  };
}

/** Returns the extension's root URI (workspace root) */
function extensionUri(): vscode.Uri {
  return vscode.Uri.file(path.resolve(__dirname, '..', '..', '..'));
}

/**
 * Waits for the debounced setTimeout(0) in updateWebview to fire.
 */
function flushDebounce(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskHistoryTableViewProvider Test Suite', () => {
  let provider: TaskHistoryTableViewProvider;
  let historyService: TaskHistoryService;
  let metricsService: TaskMetricsService;

  // Event handler capture stubs
  let historyChangeListeners: (() => void)[];
  let metricsChangeListeners: (() => void)[];

  // getAllExecutions / hasFilter / getAllMetrics stubs
  let fakeExecutions: ITaskExecutionRecord[];
  let fakeMetrics: Record<string, ITaskMetricsWithComputed>;
  let clearMetricsCalls: string[];
  let clearAllCalled: boolean;

  const resetSingletons = () => {
    (TaskHistoryService as any).instance = undefined;
    (TaskMetricsService as any).instance = undefined;
  };

  const fireHistoryChange = () => historyChangeListeners.forEach(l => l());
  const fireMetricsChange = () => metricsChangeListeners.forEach(l => l());

  setup(() => {
    resetSingletons();
    historyChangeListeners = [];
    metricsChangeListeners = [];
    fakeExecutions = [];
    fakeMetrics = {};
    clearMetricsCalls = [];
    clearAllCalled = false;

    // Stub TaskHistoryService
    historyService = TaskHistoryService.getInstance();
    (historyService as any).onDidChange = (listener: () => void) => {
      historyChangeListeners.push(listener);
      return { dispose: () => { historyChangeListeners = historyChangeListeners.filter(l => l !== listener); } };
    };
    (historyService as any).getAllExecutions = () => [...fakeExecutions];
    (historyService as any).hasFilter = (_status: string) => true;

    // Stub TaskMetricsService
    metricsService = TaskMetricsService.getInstance();
    (metricsService as any).onDidChangeMetrics = (listener: () => void) => {
      metricsChangeListeners.push(listener);
      return { dispose: () => { metricsChangeListeners = metricsChangeListeners.filter(l => l !== listener); } };
    };
    (metricsService as any).getAllMetrics = () => ({ ...fakeMetrics });
    (metricsService as any).clearMetrics = (key: string) => { clearMetricsCalls.push(key); };
    (metricsService as any).clearAllMetrics = () => { clearAllCalled = true; };

    provider = new TaskHistoryTableViewProvider(extensionUri());
  });

  teardown(() => {
    resetSingletons();
  });

  // -------------------------------------------------------------------------
  // resolveWebviewView — basic wiring
  // -------------------------------------------------------------------------

  test('resolveWebviewView: sets webview html', () => {
    const { view } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    const webview = view.webview as unknown as { html: string };
    assert.ok(webview.html.includes('<!DOCTYPE html>'), 'html should be set');
  });

  test('resolveWebviewView: posts initial loadData message after debounce', async () => {
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    assert.strictEqual(postedMessages.length, 1);
    const msg = postedMessages[0] as any;
    assert.strictEqual(msg.command, 'loadData');
    assert.ok(Array.isArray(msg.data.history));
    assert.ok(typeof msg.data.metrics === 'object');
  });

  test('resolveWebviewView: does not post when view is not visible', async () => {
    const { view, postedMessages, setVisible } = makeFakeWebviewView();
    setVisible(false);
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    assert.strictEqual(postedMessages.length, 0);
  });

  // -------------------------------------------------------------------------
  // History change updates the view
  // -------------------------------------------------------------------------

  test('history onDidChange fires a new loadData with updated rows', async () => {
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    fakeExecutions = [makeRecord({ taskName: 'test', duration: 200 })];
    fireHistoryChange();
    await flushDebounce();

    assert.ok(postedMessages.length >= 2);
    const last = postedMessages[postedMessages.length - 1] as any;
    assert.strictEqual(last.command, 'loadData');
    assert.strictEqual(last.data.history.length, 1);
    assert.strictEqual(last.data.history[0].task, 'test');
  });

  test('metrics onDidChangeMetrics fires a new loadData', async () => {
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    fireMetricsChange();
    await flushDebounce();

    assert.ok(postedMessages.length >= 2);
    const last = postedMessages[postedMessages.length - 1] as any;
    assert.strictEqual(last.command, 'loadData');
  });

  test('rapid changes coalesce into one loadData (debounce)', async () => {
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    const before = postedMessages.length;

    // Fire both in the same tick — should coalesce
    fireHistoryChange();
    fireMetricsChange();
    await flushDebounce();

    assert.strictEqual(postedMessages.length, before + 1, 'expected exactly one coalesced update');
  });

  // -------------------------------------------------------------------------
  // Visibility change
  // -------------------------------------------------------------------------

  test('becoming visible triggers a loadData update', async () => {
    const { view, postedMessages, setVisible, fireVisibilityChange } = makeFakeWebviewView();
    setVisible(false);
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    assert.strictEqual(postedMessages.length, 0, 'invisible — no update yet');

    setVisible(true);
    fireVisibilityChange();
    await flushDebounce();
    assert.strictEqual(postedMessages.length, 1, 'should update when becoming visible');
  });

  // -------------------------------------------------------------------------
  // formatRecord output
  // -------------------------------------------------------------------------

  test('loadData history rows have expected shape', async () => {
    fakeExecutions = [
      makeRecord({
        taskName: 'build',
        taskSource: 'npm',
        scope: 'myProject',
        status: 'Success',
        exitCode: 0,
        duration: 1500,
        startTime: 1000000,
        definition: { type: 'npm', path: 'packages/core' },
      }),
    ];
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const msg = postedMessages[postedMessages.length - 1] as any;
    const row = msg.data.history[0];
    assert.strictEqual(row.status, 'Success');
    assert.strictEqual(row.type, 'npm');
    assert.strictEqual(row.task, 'build');
    assert.strictEqual(row.source, 'packages/core');
    assert.strictEqual(row.timestampRaw, 1000000);
    assert.strictEqual(row.exitCode, 0);
    assert.strictEqual(row.executionTime, '1.50s');
    assert.strictEqual(row.durationRaw, 1500);
    assert.strictEqual(row.metricsKey, 'npm:build:myProject');
  });

  test('formatRecord: uses cwd when path is absent', async () => {
    fakeExecutions = [
      makeRecord({ definition: { type: 'shell', cwd: '/home/user/project' } }),
    ];
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const row = (postedMessages[0] as any).data.history[0];
    assert.strictEqual(row.source, '/home/user/project');
  });

  test('formatRecord: source is empty when neither path nor cwd exists', async () => {
    fakeExecutions = [makeRecord({ definition: { type: 'npm' } })];
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const row = (postedMessages[0] as any).data.history[0];
    assert.strictEqual(row.source, '');
  });

  test('formatRecord: sub-second duration is formatted in ms', async () => {
    fakeExecutions = [makeRecord({ duration: 250 })];
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const row = (postedMessages[0] as any).data.history[0];
    assert.strictEqual(row.executionTime, '250ms');
  });

  test('formatRecord: undefined duration produces empty string', async () => {
    fakeExecutions = [makeRecord({ duration: undefined })];
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const row = (postedMessages[0] as any).data.history[0];
    assert.strictEqual(row.executionTime, '');
  });

  // -------------------------------------------------------------------------
  // Metrics stripping
  // -------------------------------------------------------------------------

  test('metrics sent to webview have recentDurations stripped', async () => {
    fakeMetrics = {
      'npm:build:workspace': {
        totalExecutions: 5,
        recentDurations: [100, 200, 300],
        hourlyRunCounts: new Array(24).fill(0),
      } as unknown as ITaskMetricsWithComputed,
    };
    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const metrics = (postedMessages[0] as any).data.metrics;
    const entry = metrics['npm:build:workspace'];
    assert.ok(entry !== undefined);
    assert.strictEqual(entry.totalExecutions, 5);
    assert.strictEqual(entry.recentDurations, undefined, 'recentDurations should be stripped');
    assert.strictEqual(entry.hourlyRunCounts, undefined, 'hourlyRunCounts should be stripped');
  });

  // -------------------------------------------------------------------------
  // Webview message handler — clearMetrics
  // -------------------------------------------------------------------------

  test('clearMetrics message with taskId calls clearMetrics on service', async () => {
    const { view, fireMessage } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    fireMessage({ command: 'clearMetrics', taskId: 'npm:build:workspace' });
    assert.deepStrictEqual(clearMetricsCalls, ['npm:build:workspace']);
    assert.strictEqual(clearAllCalled, false);
  });

  test('clearMetrics message without taskId does NOT call clearAllMetrics', async () => {
    const { view, fireMessage } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    fireMessage({ command: 'clearMetrics' });
    assert.strictEqual(clearAllCalled, false);
    assert.deepStrictEqual(clearMetricsCalls, []);
  });

  test('unrecognised message command is ignored', async () => {
    const { view, fireMessage } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    // Should not throw
    fireMessage({ command: 'unknownCommand', data: 'something' });
    assert.strictEqual(clearAllCalled, false);
    assert.deepStrictEqual(clearMetricsCalls, []);
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  test('after dispose, history changes do not post to the webview', async () => {
    const { view, postedMessages, fireDispose } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    const before = postedMessages.length;

    fireDispose();

    fireHistoryChange();
    await flushDebounce();
    assert.strictEqual(postedMessages.length, before, 'no new messages after dispose');
  });

  test('after dispose, metrics changes do not post to the webview', async () => {
    const { view, postedMessages, fireDispose } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();
    const before = postedMessages.length;

    fireDispose();

    fireMetricsChange();
    await flushDebounce();
    assert.strictEqual(postedMessages.length, before, 'no new messages after dispose');
  });

  // -------------------------------------------------------------------------
  // hasFilter integration
  // -------------------------------------------------------------------------

  test('rows excluded by hasFilter do not appear in history', async () => {
    fakeExecutions = [
      makeRecord({ taskName: 'build', status: 'Success' }),
      makeRecord({ taskName: 'test', status: 'Failed' }),
    ];
    // Only allow 'Success'
    (historyService as any).hasFilter = (status: string) => status === 'Success';

    const { view, postedMessages } = makeFakeWebviewView();
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    await flushDebounce();

    const rows = (postedMessages[0] as any).data.history;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].task, 'build');
  });
});
