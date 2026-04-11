import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { MetricsClearAllCommand, MetricsClearTaskCommand } from '../../commands/clearTaskMetricsCommand';
import { TaskMetricsService } from '../../services/taskMetricsService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: {
      get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

function makeMinimalStateManagerStub(): TaskStateManager {
  return {
    getTaskId: (item: TaskItem) => `${item.taskType}:${item.label}`,
    normalizeTaskId: (id: string) => id,
    normalizeTaskIds: (ids: string[]) => ids,
    getStatus: (_id: string) => 'idle',
    generatePortableTaskId: () => 'test-id',
  } as unknown as TaskStateManager;
}

function makeMinimalFilteredTaskServiceStub(): FilteredTaskService {
  return {
    isFiltered: () => false,
    isFilteredOrHasFilteredParent: () => false,
    hasFilteredTasks: () => false,
    isShowHiddenMode: () => false,
  } as unknown as FilteredTaskService;
}

function makeMinimalFavoritesServiceStub(): FavoritesService {
  return {
    isFavorite: () => false,
  } as unknown as FavoritesService;
}

/**
 * Creates a TaskItem with the given source, name, and optional scope,
 * setting item.task to a minimal vscode.Task stub.
 */
function makeTaskItem(
  label: string,
  taskSource: string,
  scope: vscode.TaskScope | vscode.WorkspaceFolder | undefined,
): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'npm');
  item.taskSource = taskSource;
  // Minimal vscode.Task stub with name and scope
  item.task = { name: label, source: taskSource, scope } as unknown as vscode.Task;
  return item;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('clearTaskMetricsCommand Test Suite', () => {
  let fakeContext: vscode.ExtensionContext;
  let clearMetricsCalls: string[];
  let clearAllCalled: boolean;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let showWarningMessageResult: string | undefined;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let clearTaskCmd: MetricsClearTaskCommand;
  let clearAllCmd: MetricsClearAllCommand;

  setup(() => {
    // Reset singletons
    (TaskMetricsService as any).instance = undefined;
    (TaskStateManager as any).instance = makeMinimalStateManagerStub();
    (FilteredTaskService as any).instance = makeMinimalFilteredTaskServiceStub();
    (FavoritesService as any).instance = makeMinimalFavoritesServiceStub();

    clearMetricsCalls = [];
    clearAllCalled = false;

    fakeContext = makeFakeContext();

    // Patch TaskMetricsService with a minimal stub
    const fakeMetricsService = {
      clearMetrics: (key: string) => { clearMetricsCalls.push(key); },
      clearAllMetrics: () => { clearAllCalled = true; },
    };
    (TaskMetricsService as any).instance = fakeMetricsService;

    // Patch configuration (required by BaseCommand / LoggerService etc.)
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (_section?: string) => ({
      get: (_key: string, defaultValue?: any) => defaultValue,
    });

    // Patch showWarningMessage
    originalShowWarningMessage = vscode.window.showWarningMessage;
    showWarningMessageResult = 'Clear All';
    (vscode.window as any).showWarningMessage = async () => showWarningMessageResult;

    // Create command instances once per test (fresh fakeContext each time)
    clearTaskCmd = new MetricsClearTaskCommand(fakeContext);
    clearAllCmd = new MetricsClearAllCommand(fakeContext);
  });

  teardown(() => {
    // Dispose registered command disposables to allow re-registration in next test
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (TaskMetricsService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  // -------------------------------------------------------------------------
  // MetricsClearTaskCommand
  // -------------------------------------------------------------------------

  test('clearTask: no item arg is a no-op', async () => {
    await clearTaskCmd.run(undefined);
    assert.strictEqual(clearMetricsCalls.length, 0);
  });

  test('clearTask: calls clearMetrics with derived key (workspace-scoped task)', async () => {
    const item = makeTaskItem('build', 'npm', vscode.TaskScope.Workspace);
    await clearTaskCmd.run(item);
    assert.strictEqual(clearMetricsCalls.length, 1);
    assert.strictEqual(clearMetricsCalls[0], `npm:build:${vscode.TaskScope.Workspace.toString()}`);
  });

  test('clearTask: calls clearMetrics with derived key (workspace folder scope)', async () => {
    const folder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/test/project'),
      name: 'my-project',
      index: 0,
    };
    const item = makeTaskItem('test', 'npm', folder);
    await clearTaskCmd.run(item);
    assert.strictEqual(clearMetricsCalls.length, 1);
    assert.strictEqual(clearMetricsCalls[0], 'npm:test:my-project');
  });

  test('clearTask: defaults scope to global when task is undefined', async () => {
    const item = makeTaskItem('lint', 'shell', undefined);
    item.task = undefined; // no underlying task
    await clearTaskCmd.run(item);
    assert.strictEqual(clearMetricsCalls.length, 1);
    assert.strictEqual(clearMetricsCalls[0], 'shell:lint:global');
  });

  test('clearTask: uses task.name over item.label for key', async () => {
    const item = makeTaskItem('display-label', 'npm', vscode.TaskScope.Workspace);
    // Simulate task.name being different from display label
    item.task!.name = 'actual-task-name';
    await clearTaskCmd.run(item);
    assert.strictEqual(clearMetricsCalls[0], `npm:actual-task-name:${vscode.TaskScope.Workspace.toString()}`);
  });

  // -------------------------------------------------------------------------
  // MetricsClearAllCommand
  // -------------------------------------------------------------------------

  test('clearAll: calls clearAllMetrics when confirmed', async () => {
    showWarningMessageResult = 'Clear All';
    await clearAllCmd.run();
    assert.strictEqual(clearAllCalled, true);
  });

  test('clearAll: does NOT call clearAllMetrics when cancelled', async () => {
    showWarningMessageResult = undefined; // user dismissed or pressed Cancel
    await clearAllCmd.run();
    assert.strictEqual(clearAllCalled, false);
  });
});
