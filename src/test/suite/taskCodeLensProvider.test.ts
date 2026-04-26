import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskCodeLensProvider } from '../../taskCodeLensProvider';
import { TaskCacheService } from '../../services/taskCacheService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { FavoritesService } from '../../services/favoritesService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

let _onDidUpdateHandlers: Array<() => void> = [];
let _onDidFilterChangeHandlers: Array<() => void> = [];
let _onDidStateChangeHandlers: Array<(e: { id: string; status: string }) => void> = [];
let _onDidConfigChangeHandlers: Array<(e: vscode.ConfigurationChangeEvent) => void> = [];

/**
 * Creates a minimal TaskItem with the supplied properties.
 * `startLine` defaults to 0 (meaning it is "located"); pass undefined for unlocated.
 */
function makeTask(overrides: Partial<TaskItem> & { startLine?: number | undefined } = {}): TaskItem {
  const item = new TaskItem('task', vscode.TreeItemCollapsibleState.None, 'npm');
  item.id = 'task-id';
  item.originalLabel = 'task';
  item.taskFileUri = vscode.Uri.file('/workspace/package.json');
  item.startLine = 0;
  Object.assign(item, overrides);
  return item;
}

function makeDocument(uri: vscode.Uri): vscode.TextDocument {
  return { uri } as unknown as vscode.TextDocument;
}

function makeToken(cancelled = false): vscode.CancellationToken {
  return { isCancellationRequested: cancelled, onCancellationRequested: () => ({ dispose: () => {} }) } as unknown as vscode.CancellationToken;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskCodeLensProvider Test Suite', () => {
  let provider: TaskCodeLensProvider;
  let originalIsTrusted: boolean;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalOnDidChangeConfiguration: typeof vscode.workspace.onDidChangeConfiguration;
  let originalVisibleTextEditors: readonly vscode.TextEditor[];

  // Default stubs
  let stubHasTasksForFile = (_uri: vscode.Uri): boolean => true;
  let stubGetTasksForFile = (_uri: vscode.Uri): TaskItem[] => [];
  let stubGetTask = (_id: string): TaskItem | undefined => undefined;
  let stubIsFilteredOrHasFilteredParent = (_t: TaskItem): boolean => false;
  let stubIsShowHiddenMode = (): boolean => false;
  let stubGetStatus = (_id: string): string => 'idle';
  let stubIsFavorite = (_id: string | TaskItem): boolean => false;
  let configMap: Record<string, unknown> = { 'codeLens.enabled': true, 'task.actionBar': {} };

  setup(() => {
    // Reset singletons
    (TaskCacheService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    // Reset handler arrays
    _onDidUpdateHandlers = [];
    _onDidFilterChangeHandlers = [];
    _onDidStateChangeHandlers = [];
    _onDidConfigChangeHandlers = [];

    // Reset stub defaults
    stubHasTasksForFile = (_uri: vscode.Uri): boolean => true;
    stubGetTasksForFile = (_uri: vscode.Uri): TaskItem[] => [];
    stubGetTask = (_id: string): TaskItem | undefined => undefined;
    stubIsFilteredOrHasFilteredParent = (_t: TaskItem): boolean => false;
    stubIsShowHiddenMode = (): boolean => false;
    stubGetStatus = (_id: string): string => 'idle';
    stubIsFavorite = (_id: string | TaskItem): boolean => false;
    configMap = { 'codeLens.enabled': true, 'task.actionBar': {} };

    // Stub workspace trust
    originalIsTrusted = (vscode.workspace as any).isTrusted;
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });

    // Stub TaskCacheService
    (TaskCacheService as any).instance = {
      onDidUpdate: (handler: () => void) => {
        _onDidUpdateHandlers.push(handler);
        return { dispose: () => {} };
      },
      hasTasksForFile: (uri: vscode.Uri) => stubHasTasksForFile(uri),
      getTasksForFile: (uri: vscode.Uri) => stubGetTasksForFile(uri),
      getTask: (id: string) => stubGetTask(id),
    };

    // Stub FilteredTaskService
    (FilteredTaskService as any).instance = {
      onDidChange: (handler: () => void) => {
        _onDidFilterChangeHandlers.push(handler);
        return { dispose: () => {} };
      },
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: (t: TaskItem) => stubIsFilteredOrHasFilteredParent(t),
      isShowHiddenMode: () => stubIsShowHiddenMode(),
    };

    // Stub FavoritesService
    (FavoritesService as any).instance = {
      isFavorite: (id: string | TaskItem) => stubIsFavorite(id),
    };

    // Stub TaskStateManager
    (TaskStateManager as any).instance = {
      onDidStateChange: (handler: (e: { id: string; status: string }) => void) => {
        _onDidStateChangeHandlers.push(handler);
        return { dispose: () => {} };
      },
      getStatus: (id: string) => stubGetStatus(id),
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? String(item.label),
      normalizeTaskId: (id: string) => id,
    };

    // Stub vscode.workspace.getConfiguration
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, defaultVal?: T): T => {
            const val = configMap[key];
            return val !== undefined ? val as T : defaultVal as T;
          },
        };
      }
      return originalGetConfiguration(section as string);
    };

    // Stub vscode.workspace.onDidChangeConfiguration
    originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = (
      handler: (e: vscode.ConfigurationChangeEvent) => void,
    ) => {
      _onDidConfigChangeHandlers.push(handler);
      return { dispose: () => {} };
    };

    // Stub visibleTextEditors
    originalVisibleTextEditors = vscode.window.visibleTextEditors;
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      get: () => [],
      configurable: true,
    });

    provider = new TaskCodeLensProvider(makeContext());
  });

  teardown(() => {
    provider.dispose();
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = originalOnDidChangeConfiguration;
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      get: () => originalVisibleTextEditors,
      configurable: true,
    });
    (TaskCacheService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  });

  // ---------------------------------------------------------------------------
  // T01-T04: Guard conditions
  // ---------------------------------------------------------------------------

  test('T01 - returns [] when workspace is not trusted', () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  test('T02 - returns [] when codeLens.enabled is false', () => {
    configMap['codeLens.enabled'] = false;
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  test('T03 - returns [] when hasTasksForFile returns false', () => {
    stubHasTasksForFile = () => false;
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  test('T04 - returns [] when token is already cancelled', () => {
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken(true));
    assert.deepStrictEqual(lenses, []);
  });

  // ---------------------------------------------------------------------------
  // T05: No visible tasks and no hidden tasks → []
  // ---------------------------------------------------------------------------

  test('T05 - returns [] when no tasks pass filter', () => {
    stubGetTasksForFile = () => [makeTask()];
    stubIsFilteredOrHasFilteredParent = () => true;
    stubIsShowHiddenMode = () => false;
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  // ---------------------------------------------------------------------------
  // T06: Tasks without startLine are skipped
  // ---------------------------------------------------------------------------

  test('T06 - skips tasks without startLine', () => {
    const task = makeTask({ startLine: undefined });
    stubGetTasksForFile = () => [task];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  // ---------------------------------------------------------------------------
  // T07: Tasks that are not leaf tasks are skipped
  // ---------------------------------------------------------------------------

  test('T07 - skips non-leaf (parent) tasks', () => {
    const parent = makeTask();
    // Give it children to make it a parent (non-leaf)
    parent.children = [makeTask({ id: 'child' })];
    // Also set collapsibleState to Collapsed to ensure isLeafTask returns false
    (parent as any).collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    // Make task not have a vscode task so isLeafTask uses collapsibleState
    (parent as any).task = undefined;
    stubGetTasksForFile = () => [parent];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.deepStrictEqual(lenses, []);
  });

  // ---------------------------------------------------------------------------
  // T08: Default actionBar (all enabled) → run, runWithArgs, favorite, queue, hide
  // ---------------------------------------------------------------------------

  test('T08 - default actionBar emits run, runWithArgs, favorite, queue, hide lenses', () => {
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Run Task')), 'Expected Run Task lens');
    assert.ok(titles.some((t) => t.includes('Run with Args')), 'Expected Run with Args lens');
    assert.ok(titles.some((t) => t.includes('Favorites')), 'Expected Favorites lens');
    assert.ok(titles.some((t) => t.includes('Compound Task')), 'Expected Compound Task lens');
    assert.ok(titles.some((t) => t.includes('Hide Task')), 'Expected Hide Task lens');
  });

  // ---------------------------------------------------------------------------
  // T09: actionBar.run = false → no run lens
  // ---------------------------------------------------------------------------

  test('T09 - actionBar.run=false suppresses run lens', () => {
    configMap['task.actionBar'] = { run: false };
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Run Task')), 'Run lens should be absent');
    assert.ok(!titles.some((t) => t.includes('Stop Task')), 'Stop lens should be absent');
  });

  // ---------------------------------------------------------------------------
  // T10: actionBar.runWithArgs = false → no runWithArgs lens
  // ---------------------------------------------------------------------------

  test('T10 - actionBar.runWithArgs=false suppresses run-with-args lens', () => {
    configMap['task.actionBar'] = { runWithArgs: false };
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Run with Args')), 'Run with Args lens should be absent');
  });

  // ---------------------------------------------------------------------------
  // T11: actionBar.favorite = false → no favorite lens
  // ---------------------------------------------------------------------------

  test('T11 - actionBar.favorite=false suppresses favorite lens', () => {
    configMap['task.actionBar'] = { favorite: false };
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Favorites')), 'Favorites lens should be absent');
  });

  // ---------------------------------------------------------------------------
  // T12: actionBar.queue = false → no compound task lens
  // ---------------------------------------------------------------------------

  test('T12 - actionBar.queue=false suppresses compound task lens', () => {
    configMap['task.actionBar'] = { queue: false };
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Compound Task')), 'Compound Task lens should be absent');
  });

  // ---------------------------------------------------------------------------
  // T13: actionBar.hide = false → no hide lens
  // ---------------------------------------------------------------------------

  test('T13 - actionBar.hide=false suppresses hide lens', () => {
    configMap['task.actionBar'] = { hide: false };
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Hide Task')), 'Hide Task lens should be absent');
  });

  // ---------------------------------------------------------------------------
  // T14: Running task → Stop Task instead of Run Task, no Run with Args
  // ---------------------------------------------------------------------------

  test('T14 - running task shows Stop Task and omits Run with Args', () => {
    stubGetStatus = () => 'running';
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Stop Task')), 'Expected Stop Task lens');
    assert.ok(!titles.some((t) => t.includes('Run Task')), 'Run Task should be absent when running');
    assert.ok(!titles.some((t) => t.includes('Run with Args')), 'Run with Args should be absent when running');
  });

  // ---------------------------------------------------------------------------
  // T15: Favorited task → Remove from Favorites
  // ---------------------------------------------------------------------------

  test('T15 - favorited task shows Remove from Favorites', () => {
    stubIsFavorite = () => true;
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Remove from Favorites')), 'Expected Remove from Favorites');
    assert.ok(!titles.some((t) => t.includes('Add to Favorites')), 'Add to Favorites should be absent');
  });

  // ---------------------------------------------------------------------------
  // T16: Non-favorited task → Add to Favorites
  // ---------------------------------------------------------------------------

  test('T16 - non-favorited task shows Add to Favorites', () => {
    stubIsFavorite = () => false;
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Add to Favorites')), 'Expected Add to Favorites');
  });

  // ---------------------------------------------------------------------------
  // T17: Queued task → Remove from Compound Task
  // ---------------------------------------------------------------------------

  test('T17 - queued task shows Remove from Compound Task', () => {
    const task = makeTask({ contextValue: 'queuedTask' });
    stubGetTasksForFile = () => [task];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Remove from Compound Task')), 'Expected Remove from Compound Task');
  });

  // ---------------------------------------------------------------------------
  // T18: show-hidden mode → hidden tasks get Unhide lens
  // ---------------------------------------------------------------------------

  test('T18 - hidden task in show-hidden mode gets Unhide Task lens', () => {
    stubIsShowHiddenMode = () => true;
    stubIsFilteredOrHasFilteredParent = () => true; // all tasks are hidden
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Unhide Task')), 'Expected Unhide Task lens');
    assert.ok(!titles.some((t) => t.includes('Hide Task')), 'Hide should be absent for hidden tasks');
  });

  // ---------------------------------------------------------------------------
  // T19: actionBar.unhide = false → hidden task gets no lens
  // ---------------------------------------------------------------------------

  test('T19 - actionBar.unhide=false suppresses Unhide Task lens', () => {
    configMap['task.actionBar'] = { unhide: false };
    stubIsShowHiddenMode = () => true;
    stubIsFilteredOrHasFilteredParent = () => true;
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(!titles.some((t) => t.includes('Unhide Task')), 'Unhide should be absent');
  });

  // ---------------------------------------------------------------------------
  // T20: Multiple tasks → each gets its own row of lenses
  // ---------------------------------------------------------------------------

  test('T20 - multiple tasks each get their own lens row', () => {
    const t1 = makeTask({ id: 'task1', startLine: 0 });
    const t2 = makeTask({ id: 'task2', startLine: 5 });
    stubGetTasksForFile = () => [t1, t2];
    configMap['task.actionBar'] = { run: true, runWithArgs: false, favorite: false, queue: false, hide: false };
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.strictEqual(lenses.length, 2, 'Should be exactly one lens per task with only run enabled');
  });

  // ---------------------------------------------------------------------------
  // T21: Lens range matches task startLine
  // ---------------------------------------------------------------------------

  test('T21 - lens range is positioned at task startLine', () => {
    const task = makeTask({ startLine: 7 });
    stubGetTasksForFile = () => [task];
    configMap['task.actionBar'] = { run: true, runWithArgs: false, favorite: false, queue: false, hide: false };
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].range.start.line, 7);
  });

  // ---------------------------------------------------------------------------
  // T22: Lens arguments contain the task item
  // ---------------------------------------------------------------------------

  test('T22 - lens command arguments include the task item', () => {
    const task = makeTask();
    stubGetTasksForFile = () => [task];
    configMap['task.actionBar'] = { run: true, runWithArgs: false, favorite: false, queue: false, hide: false };
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    assert.strictEqual(lenses[0].command?.arguments?.[0], task);
  });

  // ---------------------------------------------------------------------------
  // T23: onDidChangeCodeLenses fires when TaskCacheService.onDidUpdate fires
  // ---------------------------------------------------------------------------

  test('T23 - fires onDidChangeCodeLenses on cache update', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidUpdateHandlers.forEach((h) => h());
    assert.ok(fired, 'Expected onDidChangeCodeLenses to fire');
  });

  // ---------------------------------------------------------------------------
  // T24: onDidChangeCodeLenses fires when workspaceTasks config changes
  // ---------------------------------------------------------------------------

  test('T24 - fires onDidChangeCodeLenses when workspaceTasks config changes', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    const fakeEvent: vscode.ConfigurationChangeEvent = {
      affectsConfiguration: (section: string) => section.startsWith('workspaceTasks'),
    };
    _onDidConfigChangeHandlers.forEach((h) => h(fakeEvent));
    assert.ok(fired, 'Expected onDidChangeCodeLenses to fire on config change');
  });

  // ---------------------------------------------------------------------------
  // T25: onDidChangeCodeLenses does NOT fire when unrelated config changes
  // ---------------------------------------------------------------------------

  test('T25 - does not fire onDidChangeCodeLenses for unrelated config changes', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    const fakeEvent: vscode.ConfigurationChangeEvent = {
      affectsConfiguration: (section: string) => section.startsWith('editor'),
    };
    _onDidConfigChangeHandlers.forEach((h) => h(fakeEvent));
    assert.ok(!fired, 'Should not fire for unrelated config changes');
  });

  // ---------------------------------------------------------------------------
  // T26: onDidChangeCodeLenses fires when FilteredTaskService changes
  // ---------------------------------------------------------------------------

  test('T26 - fires onDidChangeCodeLenses on filter service change', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidFilterChangeHandlers.forEach((h) => h());
    assert.ok(fired, 'Expected onDidChangeCodeLenses to fire on filter change');
  });

  // ---------------------------------------------------------------------------
  // T27: onDidStateChange fires invalidation when task file is open
  // ---------------------------------------------------------------------------

  test('T27 - fires onDidChangeCodeLenses on state change when task file is open', () => {
    const taskUri = vscode.Uri.file('/workspace/package.json');
    const task = makeTask({ taskFileUri: taskUri });
    stubGetTask = () => task;

    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      get: () => [{ document: { uri: taskUri } } as unknown as vscode.TextEditor],
      configurable: true,
    });

    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidStateChangeHandlers.forEach((h) => h({ id: task.id!, status: 'running' }));
    assert.ok(fired, 'Expected onDidChangeCodeLenses to fire when task file is open');
  });

  // ---------------------------------------------------------------------------
  // T28: onDidStateChange does NOT fire when task file is not open
  // ---------------------------------------------------------------------------

  test('T28 - does not fire onDidChangeCodeLenses when task file is not open', () => {
    const taskUri = vscode.Uri.file('/workspace/package.json');
    const task = makeTask({ taskFileUri: taskUri });
    stubGetTask = () => task;

    // visibleTextEditors already stubbed to []

    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidStateChangeHandlers.forEach((h) => h({ id: task.id!, status: 'running' }));
    assert.ok(!fired, 'Should not fire when task file is not open');
  });

  // ---------------------------------------------------------------------------
  // T29: onDidStateChange when task has no taskFileUri → no fire
  // ---------------------------------------------------------------------------

  test('T29 - does not fire when state-changed task has no taskFileUri', () => {
    const task = makeTask({ taskFileUri: undefined });
    stubGetTask = () => task;

    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidStateChangeHandlers.forEach((h) => h({ id: 'task-id', status: 'running' }));
    assert.ok(!fired, 'Should not fire when task has no file URI');
  });

  // ---------------------------------------------------------------------------
  // T30: onDidStateChange when getTask returns undefined → no fire
  // ---------------------------------------------------------------------------

  test('T30 - does not fire when state-changed task is not found in cache', () => {
    stubGetTask = () => undefined;

    let fired = false;
    provider.onDidChangeCodeLenses(() => { fired = true; });
    _onDidStateChangeHandlers.forEach((h) => h({ id: 'unknown-id', status: 'running' }));
    assert.ok(!fired, 'Should not fire when task is not in cache');
  });

  // ---------------------------------------------------------------------------
  // T31: dispose() cleans up — subsequent calls do not throw
  // ---------------------------------------------------------------------------

  test('T31 - dispose() does not throw and can be called multiple times', () => {
    assert.doesNotThrow(() => provider.dispose());
    assert.doesNotThrow(() => provider.dispose());
  });

  // ---------------------------------------------------------------------------
  // T32: dispose() prevents event handlers from firing
  // ---------------------------------------------------------------------------

  test('T32 - after dispose, onDidChangeCodeLenses is still a valid event but dead', () => {
    provider.dispose();
    // Firing cache update after dispose should not throw
    assert.doesNotThrow(() => _onDidUpdateHandlers.forEach((h) => h()));
  });

  // ---------------------------------------------------------------------------
  // T33: default actionBar config (undefined) is treated as all-enabled
  // ---------------------------------------------------------------------------

  test('T33 - undefined actionBar config falls back to all-enabled defaults', () => {
    configMap['task.actionBar'] = undefined;
    stubGetTasksForFile = () => [makeTask()];
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    // With all defaults (undefined = all enabled), at minimum run should be present
    assert.ok(titles.some((t) => t.includes('Run Task')), 'Expected Run Task with default config');
  });

  // ---------------------------------------------------------------------------
  // T34: Mixed visible + hidden tasks in show-hidden mode
  // ---------------------------------------------------------------------------

  test('T34 - mixed visible and hidden tasks in show-hidden mode both get lenses', () => {
    const visible = makeTask({ id: 'visible', startLine: 0 });
    const hidden = makeTask({ id: 'hidden', startLine: 5 });
    stubGetTasksForFile = () => [visible, hidden];
    stubIsShowHiddenMode = () => true;
    stubIsFilteredOrHasFilteredParent = (t: TaskItem) => t.id === 'hidden';
    configMap['task.actionBar'] = { run: true, runWithArgs: false, favorite: false, queue: false, hide: false, unhide: true };
    const doc = makeDocument(vscode.Uri.file('/workspace/package.json'));
    const lenses = provider.provideCodeLenses(doc, makeToken());
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(titles.some((t) => t.includes('Run Task')), 'Visible task should have Run Task');
    assert.ok(titles.some((t) => t.includes('Unhide Task')), 'Hidden task should have Unhide Task');
  });
});
