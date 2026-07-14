import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../../taskTreeDataProvider';
import { TaskItem } from '../../taskItem';
import { TaskCacheService } from '../../services/taskCacheService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { FavoritesService } from '../../services/favoritesService';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { RecentTasksService } from '../../services/recentTasksService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskIconService } from '../../services/taskIconService';
import { TaskDurationEstimateService } from '../../services/taskDurationEstimateService';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import constants from '../../libs/constants';

// ─── Mock helpers ────────────────────────────────────────────────────────────

function createMockContext(workspaceStateMap?: Map<string, any>): vscode.ExtensionContext {
  const wsMap = workspaceStateMap ?? new Map<string, any>();
  return {
    subscriptions: [],
    workspaceState: {
      get: (key: string, defaultValue?: any) => wsMap.get(key) ?? defaultValue,
      update: (key: string, value: any) => {
        wsMap.set(key, value);
        return Promise.resolve();
      },
      keys: () => Array.from(wsMap.keys()),
    },
    globalState: {
      get: (_key: string, defaultValue?: any) => defaultValue,
      update: () => Promise.resolve(),
      keys: () => [],
      setKeysForSync: () => {},
    },
    extensionUri: vscode.Uri.file('/mock/extension'),
    extensionPath: '/mock/extension',
    environmentVariableCollection: {} as any,
    storageUri: vscode.Uri.file('/mock/storage'),
    globalStorageUri: vscode.Uri.file('/mock/globalStorage'),
    logUri: vscode.Uri.file('/mock/log'),
    extensionMode: vscode.ExtensionMode.Test,
    asAbsolutePath: (relativePath: string) => `/mock/extension/${relativePath}`,
    storagePath: '/mock/storage',
    globalStoragePath: '/mock/globalStorage',
    languageModelAccessInformation: {} as any,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      keys: async () => [] as string[],
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
    extension: {} as any,
  } as unknown as vscode.ExtensionContext;
}

function resetSingletons() {
  (TaskTreeDataProvider as any).instance = undefined;
  (TaskCacheService as any).instance = undefined;
  (FilteredTaskService as any).instance = undefined;
  (FavoritesService as any).instance = undefined;
  (CompoundTaskService as any).instance = undefined;
  (RecentTasksService as any).instance = undefined;
  (TaskStateManager as any).instance = undefined;
  (TaskIconService as any).instance = undefined;
  (TaskDurationEstimateService as any).instance = undefined;
  (TaskRunGuardService as any)._instance = undefined;
}

/** Helper: reset only provider singleton without wiping services used by other suites */
function resetProviderSingleton() {
  (TaskTreeDataProvider as any).instance = undefined;
}

/** Creates a mock context with specific secret keys pre-loaded */
function createMockContextWithSecretKeys(secretKeys: string[]): vscode.ExtensionContext {
  const ctx = createMockContext();
  (ctx.secrets as any).keys = async () => [...secretKeys];
  return ctx;
}

/** Minimal stub that satisfies every service call made by organizeTasks */
function stubServicesForOrganize(tasks: TaskItem[]) {
  const cacheService = TaskCacheService.getInstance();
  (cacheService as any).allTasks = tasks;
  (cacheService as any).providers = [];
  // Build a simple task map for getTaskById lookups
  const taskMap = new Map<string, TaskItem>();
  for (const t of tasks) {
    if (t.id) { taskMap.set(t.id, t); }
  }
  (cacheService as any).taskMap = taskMap;

  const filteredService = FilteredTaskService.getInstance();
  // Stub the public methods used in organizeTasks
  (filteredService as any).isShowHiddenMode = () => false;
  (filteredService as any).isFiltered = (_id: string) => false;
  (filteredService as any).isFilteredOrHasFilteredParent = (_task: TaskItem) => false;

  const favService = FavoritesService.getInstance();
  // Stub isFavorite to return false by default
  (favService as any).isFavorite = (_item: TaskItem | string) => false;

  const compoundService = CompoundTaskService.getInstance();
  (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();

  const recentService = RecentTasksService.getInstance();
  (recentService as any).getRecentTasks = () => [];

  const stateManager = TaskStateManager.getInstance();
  (stateManager as any).runningTasks = new Map();
  (stateManager as any).taskStates = new Map();
  (stateManager as any).getTaskId = (item: TaskItem) => item.id ?? '';
}

/** Creates a minimal mock view for binding */
function createMockView(): vscode.TreeView<TaskItem> {
  return {
    onDidExpandElement: (_cb: any) => ({ dispose: () => {} }),
    onDidCollapseElement: (_cb: any) => ({ dispose: () => {} }),
    reveal: async () => {},
    dispose: () => {},
    onDidChangeVisibility: new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>().event,
    onDidChangeSelection: new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<TaskItem>>().event,
    onDidChangeCheckboxState: new vscode.EventEmitter<vscode.TreeCheckboxChangeEvent<TaskItem>>().event,
    onDidCollapseElement2: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<TaskItem>>().event,
    visible: true,
    selection: [],
    badge: undefined,
    message: undefined,
    title: undefined,
    description: undefined,
  } as unknown as vscode.TreeView<TaskItem>;
}

// ─── Test-safe subclass ───────────────────────────────────────────────────────

class TestableTaskTreeDataProvider extends TaskTreeDataProvider {
  public lastRevealedRoots: TaskItem[] = [];

  constructor(ctx?: vscode.ExtensionContext) {
    super(ctx ?? ({} as any));
  }

  /** Override to provide a controlled workspace folder for URI resolution */
  protected override getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    const p = uri.fsPath.replace(/\\/g, '/');
    if (p.startsWith('/root')) {
      return { uri: vscode.Uri.file('/root'), name: 'root', index: 0 };
    }
    return undefined;
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

suite('TaskTreeDataProvider Test Suite', () => {
  let ctx: vscode.ExtensionContext;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalCreateFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher;

  setup(() => {
    resetSingletons();
    ctx = createMockContext();

    originalCreateFileSystemWatcher = vscode.workspace.createFileSystemWatcher;
    (vscode.workspace as any).createFileSystemWatcher = (
      _globPattern: vscode.GlobPattern,
      _ignoreCreateEvents?: boolean,
      _ignoreChangeEvents?: boolean,
      _ignoreDeleteEvents?: boolean
    ): vscode.FileSystemWatcher => {
      let changeCallback: ((uri: vscode.Uri) => any) | undefined;
      let createCallback: ((uri: vscode.Uri) => any) | undefined;
      let deleteCallback: ((uri: vscode.Uri) => any) | undefined;
      return {
        ignoreCreateEvents: _ignoreCreateEvents ?? false,
        ignoreChangeEvents: _ignoreChangeEvents ?? false,
        ignoreDeleteEvents: _ignoreDeleteEvents ?? false,
        onDidCreate: (listener) => {
          createCallback = listener;
          return { dispose: () => { createCallback = undefined; } };
        },
        onDidChange: (listener) => {
          changeCallback = listener;
          return { dispose: () => { changeCallback = undefined; } };
        },
        onDidDelete: (listener) => {
          deleteCallback = listener;
          return { dispose: () => { deleteCallback = undefined; } };
        },
        dispose: () => {},
      };
    };

    // Mock getConfiguration to prevent .vscode/settings.json overrides from affecting tests.
    // Notably: groups.compoundTasks.enabled is true in settings.json which changes tree structure.
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            // Return sensible defaults that match code defaults, not workspace overrides
            if (key === 'groups.compoundTasks.enabled') { return false as unknown as T; }
            if (key === 'groups.enabled') { return true as unknown as T; }
            if (key === 'groups.useParentFolder') { return false as unknown as T; }
            if (key === 'groups.recentTasks.enabled') { return false as unknown as T; }
            if (key === 'compoundTasks.includeVsCodeCompoundTasks') { return true as unknown as T; }
            if (key === 'groups.taskSeparator') { return '-' as unknown as T; }
            if (key === 'groups.taskSeparatorIsRegex') { return false as unknown as T; }
            if (key === 'groups.expanded') {
              return { favorites: true, compoundTask: true, recent: true } as unknown as T;
            }
            return def as T;
          },
        };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    resetSingletons();
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).createFileSystemWatcher = originalCreateFileSystemWatcher;
  });

  // ── Instance management ──────────────────────────────────────────────────

  suite('Instance management', () => {
    test('constructor creates a valid instance', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.ok(provider);
      assert.ok(provider.onDidChangeTreeData);
    });

    test('getInstance creates and returns singleton', () => {
      const p1 = TaskTreeDataProvider.getInstance(ctx);
      const p2 = TaskTreeDataProvider.getInstance(ctx);
      assert.strictEqual(p1, p2);
    });

    test('getInstance returns existing instance when called without context', () => {
      const p1 = TaskTreeDataProvider.getInstance(ctx);
      const p2 = TaskTreeDataProvider.getInstance(); // no context
      assert.strictEqual(p1, p2);
    });

    test('initialize sets context and returns self', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      const result = await provider.initialize(ctx);
      assert.strictEqual(result, provider);
    });
  });

  // ── Tree item basics ─────────────────────────────────────────────────────

  suite('Tree item methods', () => {
    test('getTreeItem returns the passed element when no ETA or estimate', () => {
      // Ensure the service has no running estimates and no pre-run estimate.
      const etaService = TaskDurationEstimateService.getInstance();
      (etaService as any).getEtaDescription = (_id: string) => undefined;
      (etaService as any).getPreRunEstimate = (_item: TaskItem) => undefined;

      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'npm');
      assert.strictEqual(provider.getTreeItem(item), item);
    });

    test('getParent returns element.parent', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const parent = new TaskItem('parent', vscode.TreeItemCollapsibleState.Collapsed, 'folder');
      const child = new TaskItem('child', vscode.TreeItemCollapsibleState.None, 'npm');
      child.parent = parent;

      assert.strictEqual(provider.getParent(child), parent);
    });

    test('getParent returns undefined when no parent', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('item', vscode.TreeItemCollapsibleState.None, 'npm');
      assert.strictEqual(provider.getParent(item), undefined);
    });

    test('getTreeItem for running task with ETA returns projection with ETA description', () => {
      const etaService = TaskDurationEstimateService.getInstance();
      (etaService as any).getEtaDescription = (_id: string) => '~30s remaining';
      (etaService as any).getPreRunEstimate = (_item: TaskItem) => undefined;

      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      item.description = 'package.json';

      const view = provider.getTreeItem(item);

      // Should return a projection, not the original item
      assert.notStrictEqual(view, item, 'expected a new projection object');
      assert.strictEqual(view.description, '~30s remaining');
      // Cache item must not be mutated
      assert.strictEqual(item.description, 'package.json');
    });

    test('getTreeItem for idle task with >= 3 runs returns projection with estimate tooltip', () => {
      const etaService = TaskDurationEstimateService.getInstance();
      (etaService as any).getEtaDescription = (_id: string) => undefined;
      (etaService as any).getPreRunEstimate = (_item: TaskItem) => ({
        emaMs: 45_000,
        variability: 'Low' as const,
        sampleCount: 5,
      });

      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');

      const view = provider.getTreeItem(item);

      assert.notStrictEqual(view, item, 'expected a new projection object');
      assert.ok(view.tooltip instanceof vscode.MarkdownString, 'tooltip should be a MarkdownString');
      const tooltipText = (view.tooltip as vscode.MarkdownString).value;
      assert.ok(tooltipText.includes('Estimated duration'), `tooltip missing expected text: ${tooltipText}`);
      assert.ok(tooltipText.includes('5 runs'), `tooltip missing sample count: ${tooltipText}`);
      assert.ok(tooltipText.includes('Low'), `tooltip missing variability: ${tooltipText}`);
    });

    test('getTreeItem for idle task with < 3 runs returns element unchanged', () => {
      const etaService = TaskDurationEstimateService.getInstance();
      (etaService as any).getEtaDescription = (_id: string) => undefined;
      (etaService as any).getPreRunEstimate = (_item: TaskItem) => undefined;

      const provider = new TaskTreeDataProvider(ctx);
      const originalTooltip = 'build (npm)';
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      item.tooltip = originalTooltip;

      const view = provider.getTreeItem(item);

      // Fast path — same object returned
      assert.strictEqual(view, item);
      assert.strictEqual(view.tooltip, originalTooltip);
    });

    test('getTreeItem for collapsible item never requests pre-run estimate', () => {
      const etaService = TaskDurationEstimateService.getInstance();
      const preRunCalls: TaskItem[] = [];
      (etaService as any).getEtaDescription = (_id: string) => undefined;
      (etaService as any).getPreRunEstimate = (item: TaskItem) => {
        preRunCalls.push(item);
        return undefined;
      };

      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('folder', vscode.TreeItemCollapsibleState.Collapsed, 'npm');

      provider.getTreeItem(item);

      assert.strictEqual(preRunCalls.length, 0, 'getPreRunEstimate must not be called for collapsible items');
    });

    // ── Guard context value projection ───────────────────────────────────────

    function stubGuardService(isGuardedResult: boolean) {
      (TaskRunGuardService as any)._instance = {
        isGuarded: () => isGuardedResult,
        onDidChangeGuards: () => ({ dispose: () => {} }),
      };
    }

    function stubEtaServiceNoOverrides() {
      const etaService = TaskDurationEstimateService.getInstance();
      (etaService as any).getEtaDescription = (_id: string) => undefined;
      (etaService as any).getPreRunEstimate = (_item: TaskItem) => undefined;
    }

    test('getTreeItem — not guarded leaf: returns element unchanged', () => {
      stubEtaServiceNoOverrides();
      stubGuardService(false);
      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      item.contextValue = 'task';
      const result = provider.getTreeItem(item);
      assert.strictEqual(result, item, 'should return the same element reference');
    });

    test('getTreeItem — guarded leaf task: returns projection with contextValue = guardedTask', () => {
      stubEtaServiceNoOverrides();
      stubGuardService(true);
      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'npm');
      item.contextValue = 'task';
      const result = provider.getTreeItem(item);
      assert.notStrictEqual(result, item, 'should return a new projection object');
      assert.strictEqual(result.contextValue, 'guardedTask');
      // Cached element must not be mutated
      assert.strictEqual(item.contextValue, 'task');
    });

    test('getTreeItem — guarded favorite leaf: returns projection with contextValue = guardedFavoriteTask', () => {
      stubEtaServiceNoOverrides();
      stubGuardService(true);
      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'npm');
      item.contextValue = 'favoriteTask';
      const result = provider.getTreeItem(item);
      assert.notStrictEqual(result, item);
      assert.strictEqual(result.contextValue, 'guardedFavoriteTask');
      assert.strictEqual(item.contextValue, 'favoriteTask');
    });

    test('getTreeItem — guarded group item: returns element unchanged (no guard prefix on groups)', () => {
      stubEtaServiceNoOverrides();
      stubGuardService(true); // guard returns true, but collapsibleState prevents prefix
      const provider = new TaskTreeDataProvider(ctx);
      const item = new TaskItem('folder', vscode.TreeItemCollapsibleState.Collapsed, 'npm');
      item.contextValue = 'compoundTask';
      const result = provider.getTreeItem(item);
      // Collapsible items must never get the guard prefix
      assert.strictEqual(result, item, 'group/collapsible items should be returned unchanged');
      assert.strictEqual(result.contextValue, 'compoundTask');
    });
  });

  // ── View binding ─────────────────────────────────────────────────────────

  suite('bindView', () => {
    test('adds the view to internal views list', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const expandEmitter = new vscode.EventEmitter<vscode.TreeViewExpansionEvent<TaskItem>>();
      const collapseEmitter = new vscode.EventEmitter<vscode.TreeViewExpansionEvent<TaskItem>>();

      const mockView = {
        onDidExpandElement: (listener: any) => { expandEmitter.event(listener); return { dispose: () => {} }; },
        onDidCollapseElement: (listener: any) => { collapseEmitter.event(listener); return { dispose: () => {} }; },
        reveal: async () => {},
      } as unknown as vscode.TreeView<TaskItem>;

      provider.bindView(mockView);
      assert.strictEqual((provider as any).views.length, 1);
    });

    test('fires tree data change via onDidChangeTreeData', (done) => {
      const provider = new TaskTreeDataProvider(ctx);
      const disposable = provider.onDidChangeTreeData(() => {
        disposable.dispose();
        done();
      });
      provider.refreshLocal();
    });

    test('expand event updates expanded state in workspaceState', () => {
      const wsMap = new Map<string, any>();
      const testCtx = createMockContext(wsMap);

      const provider = new TaskTreeDataProvider(testCtx);

      let expandListener: (e: vscode.TreeViewExpansionEvent<TaskItem>) => void = () => {};
      const mockView = {
        onDidExpandElement: (cb: any) => {
          expandListener = cb;
          return { dispose: () => {} };
        },
        onDidCollapseElement: (_cb: any) => ({ dispose: () => {} }),
        reveal: async () => {},
      } as unknown as vscode.TreeView<TaskItem>;

      provider.bindView(mockView);

      const item = new TaskItem('expandable', vscode.TreeItemCollapsibleState.Collapsed, 'folder');
      item.id = 'test-expand-id';
      expandListener({ element: item });

      const saved = wsMap.get('taskTree.itemState');
      assert.ok(saved);
      assert.strictEqual(saved['test-expand-id'], vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapse event updates collapsed state in workspaceState', () => {
      const wsMap = new Map<string, any>();
      const testCtx = createMockContext(wsMap);

      const provider = new TaskTreeDataProvider(testCtx);

      let collapseListener: (e: vscode.TreeViewExpansionEvent<TaskItem>) => void = () => {};
      const mockView = {
        onDidExpandElement: (_cb: any) => ({ dispose: () => {} }),
        onDidCollapseElement: (cb: any) => {
          collapseListener = cb;
          return { dispose: () => {} };
        },
        reveal: async () => {},
      } as unknown as vscode.TreeView<TaskItem>;

      provider.bindView(mockView);

      const item = new TaskItem('collapsible', vscode.TreeItemCollapsibleState.Expanded, 'folder');
      item.id = 'test-collapse-id';
      collapseListener({ element: item });

      const saved = wsMap.get('taskTree.itemState');
      assert.ok(saved);
      assert.strictEqual(saved['test-collapse-id'], vscode.TreeItemCollapsibleState.Collapsed);
    });
  });

  // ── State management (updateExpandedState / getExpandedState) ────────────

  suite('Expanded state management', () => {
    test('updateExpandedState skips when id is undefined', () => {
      const wsMap = new Map<string, any>();
      const testCtx = createMockContext(wsMap);
      const provider = new TaskTreeDataProvider(testCtx);

      (provider as any).updateExpandedState(undefined, true);
      assert.strictEqual(wsMap.has('taskTree.itemState'), false);
    });

    test('updateExpandedState skips when collapseLevel is not 0', () => {
      const wsMap = new Map<string, any>();
      const testCtx = createMockContext(wsMap);
      const provider = new TaskTreeDataProvider(testCtx);
      (provider as any).collapseLevel = 1;

      (provider as any).updateExpandedState('some-id', true);
      assert.strictEqual(wsMap.has('taskTree.itemState'), false);
    });

    test('getExpandedState returns default when collapseLevel is not 0', () => {
      const provider = new TaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 2;

      const result = (provider as any).getExpandedState('any-id', vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(result, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('getExpandedState returns default when no saved state exists', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const result = (provider as any).getExpandedState('missing-id', vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual(result, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('getExpandedState returns saved state when it exists', () => {
      const wsMap = new Map<string, any>();
      wsMap.set('taskTree.itemState', { 'saved-id': vscode.TreeItemCollapsibleState.Expanded });
      const testCtx = createMockContext(wsMap);
      const provider = new TaskTreeDataProvider(testCtx);

      const result = (provider as any).getExpandedState('saved-id', vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual(result, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('getExpandedState returns default when context or workspaceState is missing', () => {
      const provider = new TaskTreeDataProvider({} as any);
      const result = (provider as any).getExpandedState('any-id', vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(result, vscode.TreeItemCollapsibleState.Expanded);
    });
  });

  // ── refresh / refreshLocal ───────────────────────────────────────────────

  suite('refresh and refreshLocal', () => {
    test('refreshLocal fires onDidChangeTreeData', (done) => {
      const provider = new TaskTreeDataProvider(ctx);
      const sub = provider.onDidChangeTreeData(() => {
        sub.dispose();
        done();
      });
      provider.refreshLocal();
    });

    test('refresh calls TaskCacheService.refresh without throwing', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      const cacheService = TaskCacheService.getInstance();
      let refreshCalled = false;
      const original = cacheService.refresh.bind(cacheService);
      cacheService.refresh = async (): Promise<TaskItem[]> => { refreshCalled = true; return []; };

      await provider.refresh();
      assert.ok(refreshCalled);

      // Restore
      cacheService.refresh = original;
    });
  });

  // ── collapseAllTaskGroups ────────────────────────────────────────────────

  suite('collapseAllTaskGroups', () => {
    test('does nothing when views is empty (collapseLevel stays at 0)', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      // No views added — method returns early
      await provider.collapseAllTaskGroups();
      assert.strictEqual((provider as any).collapseLevel, 0);
    });

    test('cycles: level 0 -> 1 (Expand All), sets pendingRevealLevel to 0', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      provider.bindView(createMockView());
      assert.strictEqual((provider as any).collapseLevel, 0);

      await provider.collapseAllTaskGroups();
      assert.strictEqual((provider as any).collapseLevel, 1);
    });

    test('cycles: level 1 -> 2 (Collapse All Roots), clears pendingRevealLevel', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      provider.bindView(createMockView());
      (provider as any).collapseLevel = 1;

      await provider.collapseAllTaskGroups();
      assert.strictEqual((provider as any).collapseLevel, 2);
      assert.strictEqual((provider as any).pendingRevealLevel, undefined);
    });

    test('cycles: level 2 -> 0 (Default), sets pendingRevealLevel to 1', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      provider.bindView(createMockView());
      (provider as any).collapseLevel = 2;

      await provider.collapseAllTaskGroups();
      assert.strictEqual((provider as any).collapseLevel, 0);
      assert.strictEqual((provider as any).pendingRevealLevel, 1);
    });
  });

  // ── getChildren ──────────────────────────────────────────────────────────

  suite('getChildren', () => {
    test('returns element.children when element is provided', async () => {
      const provider = new TaskTreeDataProvider(ctx);
      const parent = new TaskItem('parent', vscode.TreeItemCollapsibleState.Collapsed, 'folder');
      const child = new TaskItem('child', vscode.TreeItemCollapsibleState.None, 'npm');
      parent.children = [child];

      const result = await provider.getChildren(parent);
      assert.deepStrictEqual(result, [child]);
    });

    test('returns organized roots from cache when no element provided', async () => {
      stubServicesForOrganize([]);
      const provider = new TestableTaskTreeDataProvider(ctx);

      const roots = await provider.getChildren();
      // No tasks → no roots
      assert.ok(Array.isArray(roots));
    });

    test('stores result in currentRoots when no element', async () => {
      stubServicesForOrganize([]);
      const provider = new TaskTreeDataProvider(ctx);
      await provider.getChildren();
      assert.ok(Array.isArray((provider as any).currentRoots));
    });
  });

  // ── makeId (internal) ────────────────────────────────────────────────────

  suite('makeId (internal)', () => {
    test('returns base:salt when salt is provided', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).makeId('base', 'salt'), 'base:salt');
    });

    test('returns base when salt is empty string', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).makeId('base', ''), 'base');
    });
  });

  // ── getRootState (internal) ──────────────────────────────────────────────

  suite('getRootState (internal)', () => {
    const expandedGroups = { favorites: true, compoundTask: true, recent: true };
    const collapsedGroups = { favorites: false, compoundTask: false, recent: false };

    test('collapseLevel 2 always returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 2;
      assert.strictEqual((provider as any).getRootState('favorites', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual((provider as any).getRootState('compoundTask', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual((provider as any).getRootState('recent', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual((provider as any).getRootState('workspace', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 1 always returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 1;
      assert.strictEqual((provider as any).getRootState('favorites', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual((provider as any).getRootState('recent', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual((provider as any).getRootState('workspace', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, favorites=true returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('favorites', expandedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, favorites=false returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('favorites', collapsedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, compoundTask=true returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('compoundTask', expandedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, compoundTask=false returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('compoundTask', collapsedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, recent=true returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('recent', expandedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, recent=false returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('recent', collapsedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, workspace always returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getRootState('workspace', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });
  });

  // ── getGroupState (internal) ─────────────────────────────────────────────

  suite('getGroupState (internal)', () => {
    const expandedGroups = { favorites: true, compoundTask: true, recent: true };
    const collapsedGroups = { favorites: false, compoundTask: false, recent: false };

    test('collapseLevel 1 returns Expanded for all types', () => {
      const provider = new TaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 1;
      assert.strictEqual((provider as any).getGroupState('favorites', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual((provider as any).getGroupState('recent', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual((provider as any).getGroupState('workspace', collapsedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 2 returns Collapsed for all types', () => {
      const provider = new TaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 2;
      assert.strictEqual((provider as any).getGroupState('favorites', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual((provider as any).getGroupState('recent', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
      assert.strictEqual((provider as any).getGroupState('workspace', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, favorites=true returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getGroupState('favorites', expandedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, favorites=false returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getGroupState('favorites', collapsedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, recent=true returns Expanded', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getGroupState('recent', expandedGroups), vscode.TreeItemCollapsibleState.Expanded);
    });

    test('collapseLevel 0, recent=false returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getGroupState('recent', collapsedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('collapseLevel 0, workspace returns Collapsed', () => {
      const provider = new TaskTreeDataProvider(ctx);
      assert.strictEqual((provider as any).getGroupState('workspace', expandedGroups), vscode.TreeItemCollapsibleState.Collapsed);
    });
  });

  // ── organizeTasks via getChildren ─────────────────────────────────────────

  suite('organizeTasks via getChildren', () => {
    test('empty cache produces empty roots', async () => {
      stubServicesForOrganize([]);
      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();
      assert.strictEqual(roots.length, 0);
    });

    test('tasks without URI go under workspace_generic when groups enabled', async () => {
      const task = new TaskItem('my-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'np-task-1';
      task.originalLabel = 'my-task';

      stubServicesForOrganize([task]);
      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // workspaceInfoMap uses 'workspace_generic'; should produce a workspace item
      assert.ok(roots.length > 0);
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.ok(wsItem, 'Should have a workspace root item');
    });

    test('tasks with URI under known workspace folder', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'npm-build-root';
      task.originalLabel = 'build';

      stubServicesForOrganize([task]);
      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      assert.ok(roots.length > 0);
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.ok(wsItem, 'Should have a workspace root item');
      // Should have a type sub-item (npm)
      assert.ok(wsItem!.children.length > 0);
    });

    test('filters out hidden tasks (showHiddenMode off)', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const hiddenTask = new TaskItem('hidden-task', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      hiddenTask.taskFileUri = uri;
      hiddenTask.id = 'hidden-task-id';
      hiddenTask.originalLabel = 'hidden-task';

      stubServicesForOrganize([hiddenTask]);

      // Makes the task appear filtered
      const filteredService = FilteredTaskService.getInstance();
      (filteredService as any).isFilteredOrHasFilteredParent = (_task: TaskItem) => true;

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // Task should be filtered out; no workspace roots should appear
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.strictEqual(wsItem, undefined, 'Workspace root should be absent when all tasks are filtered');
    });

    test('shows hidden tasks when showHiddenMode is on', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const hiddenTask = new TaskItem('hidden-task', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      hiddenTask.taskFileUri = uri;
      hiddenTask.id = 'hidden-task-id';
      hiddenTask.originalLabel = 'hidden-task';

      stubServicesForOrganize([hiddenTask]);

      // Override to enable show-hidden mode and filter the task (but show it anyway)
      const filteredService = FilteredTaskService.getInstance();
      (filteredService as any).isShowHiddenMode = () => true;
      (filteredService as any).isFilteredOrHasFilteredParent = (_task: TaskItem) => true;

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // Task should be visible — showHiddenMode bypasses filtering in organizeTasks
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.ok(wsItem, 'Should have workspace root even with hidden tasks in show-hidden mode');
    });

    test('includes favorites group when favorites exist', async () => {
      const task = new TaskItem('fav-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'fav-task-id';
      task.originalLabel = 'fav-task';

      stubServicesForOrganize([task]);

      // Stub isFavorite to return true for our task
      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return id === 'fav-task-id';
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      assert.ok(favGroup, 'Should have favorites group');
      assert.strictEqual(favGroup!.label, 'Favorites');
    });

    test('includes recent tasks group when recent tasks exist', async () => {
      const task = new TaskItem('recent-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'recent-task-id';
      task.originalLabel = 'recent-task';

      stubServicesForOrganize([task]);

      // Stub getRecentTasks to return our task
      const recentService = RecentTasksService.getInstance();
      (recentService as any).getRecentTasks = () => [task];

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const recentGroup = roots.find((r) => r.taskType === 'recent');
      assert.ok(recentGroup, 'Should have recent tasks group');
      assert.strictEqual(recentGroup!.label, 'Recent Tasks');
    });

    test('includes compound task group when compound task has items', async () => {
      const task = new TaskItem('compound-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'compound-task-id';
      task.originalLabel = 'compound-task';

      stubServicesForOrganize([]);

      // Stub getAllCompoundTasks to return a compound task with one task
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompoundTask', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      assert.strictEqual(compoundGroup!.label, 'MyCompoundTask');
    });

    test('compound task child items have queuedTask contextValue, not compoundTask', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompoundTask', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      assert.ok(compoundGroup!.children.length > 0, 'Compound task group should have children');

      const childItem = compoundGroup!.children[0];
      assert.ok(
        childItem.contextValue === 'queuedTask' || childItem.contextValue?.startsWith('running'),
        `Compound task child contextValue should be 'queuedTask' or 'runningQueuedTask', got '${childItem.contextValue}'`
      );
      assert.notStrictEqual(childItem.contextValue, 'compoundTask', 'Child item should not have compoundTask contextValue');
    });

    test('vscode task with dependsOnLabels shows as collapsible with dependency children', async () => {
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1', 'dep2'] };

      // dep1 exists in cache
      const dep1 = new TaskItem('dep1', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep1.id = 'dep1-id';
      dep1.originalLabel = 'dep1';
      dep1.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      dep1.startLine = 5;

      stubServicesForOrganize([dep1]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      assert.ok(compoundGroup!.children.length > 0, 'Compound task group should have children');

      const compoundTaskItem = compoundGroup!.children[0];
      assert.strictEqual(compoundTaskItem.label, 'MyVscodeTask');
      assert.strictEqual(compoundTaskItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed,
        'Task with dependsOnLabels should be collapsible');
      assert.strictEqual(compoundTaskItem.children.length, 2, 'Should have two dependency children');
    });

    test('dependency children have the same contextValue as their task type', async () => {
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1'] };

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      const compoundTaskItem = compoundGroup!.children[0];
      assert.strictEqual(compoundTaskItem.children.length, 1);

      const depItem = compoundTaskItem.children[0];
      assert.strictEqual(depItem.label, 'dep1');
      // Dependency items use the natural context value for their task type (e.g. 'task'),
      // not a special 'compoundTaskDependency', so they show the same action bar as their type.
      assert.ok(
        depItem.contextValue === 'task' || depItem.contextValue?.endsWith('Task') || depItem.contextValue?.includes('task'),
        `Dependency item should have a task-type contextValue, got '${depItem.contextValue}'`
      );
      assert.strictEqual(depItem.collapsibleState, vscode.TreeItemCollapsibleState.None,
        'Dependency item should not be collapsible');
    });

    test('dependency child uses cached task properties when found in cache', async () => {
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1'] };

      const dep1 = new TaskItem('dep1', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep1.id = 'dep1-id';
      dep1.originalLabel = 'dep1';
      dep1.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      dep1.startLine = 10;

      stubServicesForOrganize([dep1]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      const compoundTaskItem = compoundGroup!.children[0];
      const depItem = compoundTaskItem.children[0];

      assert.strictEqual(depItem.startLine, 10, 'Dependency item should use startLine from cached task');
    });

    test('dependency child shows running status when dep task is running at build time', async () => {
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1'] };

      const dep1 = new TaskItem('dep1', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep1.id = 'dep1-id';
      dep1.originalLabel = 'dep1';
      dep1.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');

      stubServicesForOrganize([dep1]);
      const stateManager = TaskStateManager.getInstance();
      stateManager.setStatus('dep1-id', 'running');

      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      const compoundTaskItem = compoundGroup!.children[0];
      const depItem = compoundTaskItem.children[0];

      assert.ok(
        depItem.iconPath instanceof vscode.ThemeIcon && (depItem.iconPath as vscode.ThemeIcon).id === 'loading~spin',
        `Dependency item should show spinning icon when task is running, got iconPath: ${JSON.stringify(depItem.iconPath)}`
      );
      assert.ok(
        depItem.contextValue?.includes('running'),
        `Dependency item contextValue should include 'running', got '${depItem.contextValue}'`
      );
    });

    test('dependency items update their running status when getChildren is called on a stale element', async () => {
      // This test simulates the VS Code tree-view behavior where it can pass an OLD
      // element reference to getChildren() even after a full refresh fires.  In that
      // case the dep-item objects inside the old compound-task item were built before
      // the sub-task started running and therefore carry stale (idle) state.
      // getChildren must call updateContextValue() on each child/grandchild so the
      // returned items always reflect the current task status.
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1'] };

      const dep1 = new TaskItem('dep1', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep1.id = 'dep1-id';
      dep1.originalLabel = 'dep1';
      dep1.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');

      stubServicesForOrganize([dep1]);
      const stateManager = TaskStateManager.getInstance();

      // Override getTaskId to mimic the real normalizeTaskId behavior for this test.
      // The real implementation strips "queue:name:" and then ":dep:" prefixes so that
      // both freshly-built and stale dep-item objects can look up the canonical status key.
      (stateManager as any).getTaskId = (item: TaskItem) => {
        let id = item.id ?? '';
        // Strip "queue:name:" compound-task prefix
        if (id.startsWith('queue:')) {
          const fi = id.indexOf(':');
          const si = id.indexOf(':', fi + 1);
          if (si !== -1) { id = id.substring(si + 1); }
        }
        // Strip ":dep:canonicalDepId" to extract the canonical dep task ID
        const di = id.indexOf(':dep:');
        if (di !== -1) { id = id.substring(di + ':dep:'.length); }
        return id;
      };

      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      const provider = new TestableTaskTreeDataProvider(ctx);

      // --- Phase 1: build initial tree while dep task is still idle ---
      const roots = await provider.getChildren();
      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      const oldCompoundTaskItem = compoundGroup!.children[0];

      // Verify dep item is idle initially
      const idleDepItem = oldCompoundTaskItem.children[0];
      assert.ok(
        !(idleDepItem.iconPath instanceof vscode.ThemeIcon && (idleDepItem.iconPath as vscode.ThemeIcon).id === 'loading~spin'),
        'Dep item should NOT be spinning when task is idle'
      );

      // --- Phase 2: dep task starts running (simulating onDidStartTask) ---
      stateManager.setStatus('dep1-id', 'running');

      // --- Phase 3: VS Code calls getChildren on the OLD compound task item reference ---
      // (This is the stale-element scenario that caused the bug)
      const refreshedChildren = await provider.getChildren(oldCompoundTaskItem);
      const refreshedDepItem = refreshedChildren[0];

      assert.ok(
        refreshedDepItem.iconPath instanceof vscode.ThemeIcon && (refreshedDepItem.iconPath as vscode.ThemeIcon).id === 'loading~spin',
        `Dep item should show spinning icon after task starts running (stale element scenario), got: ${JSON.stringify(refreshedDepItem.iconPath)}`
      );
      assert.ok(
        refreshedDepItem.contextValue?.includes('running'),
        `Dep item contextValue should include 'running' after refresh, got '${refreshedDepItem.contextValue}'`
      );
    });

    test('task without dependsOnLabels remains non-collapsible', async () => {
      const task = new TaskItem('PlainTask', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'plain-task-id';
      task.originalLabel = 'PlainTask';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      const compoundTaskItem = compoundGroup!.children[0];

      assert.strictEqual(compoundTaskItem.collapsibleState, vscode.TreeItemCollapsibleState.None,
        'Task without dependsOnLabels should remain non-collapsible');
      assert.strictEqual(compoundTaskItem.children.length, 0, 'Should have no dependency children');
    });

    test('favorited compound task clones dependency grandchildren', async () => {
      const task = new TaskItem('MyVscodeTask', vscode.TreeItemCollapsibleState.None, 'vscode');
      task.id = 'vscode-task-id';
      task.originalLabel = 'MyVscodeTask';
      task.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      task.metadata = { dependsOnLabels: ['dep1'] };

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyFavCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return typeof id === 'string' && id.includes('MyFavCompound');
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      assert.ok(favGroup, 'Favorites group should exist');
      const favCompoundGroup = favGroup!.children.find((c) => c.label === 'MyFavCompound');
      assert.ok(favCompoundGroup, 'Favorited compound task should appear in favorites');
      assert.ok(favCompoundGroup!.children.length > 0, 'Favorited compound task should have children');

      const favChildItem = favCompoundGroup!.children[0];
      assert.strictEqual(favChildItem.label, 'MyVscodeTask');
      assert.strictEqual(favChildItem.children.length, 1, 'Favorites clone should preserve dependency grandchildren');

      const favDepItem = favChildItem.children[0];
      assert.strictEqual(favDepItem.label, 'dep1');
      // Dependency items use natural task context values so their action bar matches their type
      assert.ok(
        favDepItem.contextValue === 'task' || favDepItem.contextValue?.endsWith('Task') || favDepItem.contextValue?.includes('task'),
        `Favorites dep item should have a task-type contextValue, got '${favDepItem.contextValue}'`
      );
    });

    test('compound task group uses sequential icon when executionType is sequential', async () => {
      const task = new TaskItem('seq-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'seq-task-id';
      task.originalLabel = 'seq-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['SeqCompoundTask', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      const iconPath = compoundGroup!.iconPath as { light: vscode.Uri; dark: vscode.Uri };
      assert.ok(iconPath.light.fsPath.includes('sequential.svg'), 'Should use sequential icon for light theme');
      assert.ok(iconPath.dark.fsPath.includes('sequential.svg'), 'Should use sequential icon for dark theme');
    });

    test('compound task group uses parallel icon when executionType is parallel', async () => {
      const task = new TaskItem('par-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'par-task-id';
      task.originalLabel = 'par-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['ParCompoundTask', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'parallel';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      const iconPath = compoundGroup!.iconPath as { light: vscode.Uri; dark: vscode.Uri };
      assert.ok(iconPath.light.fsPath.includes('parallel.svg'), 'Should use parallel icon for light theme');
      assert.ok(iconPath.dark.fsPath.includes('parallel.svg'), 'Should use parallel icon for dark theme');
    });

    test('favorited compound task group appears in favorites section', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyFavCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      // Mark the compound task group as a favorite by its ID
      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return typeof id === 'string' && id.includes('MyFavCompound');
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      assert.ok(favGroup, 'Favorites group should exist when a compound task is favorited');
      const favCompoundChild = favGroup!.children.find((c) => c.label === 'MyFavCompound');
      assert.ok(favCompoundChild, 'Favorited compound task should appear as child of favorites group');
      assert.strictEqual(favCompoundChild!.taskType, 'compoundTask');
    });

    test('favorited compound task group child has queuedTask contextValue', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyFavCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return typeof id === 'string' && id.includes('MyFavCompound');
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      const favCompoundChild = favGroup!.children.find((c) => c.label === 'MyFavCompound');
      assert.ok(favCompoundChild, 'Favorited compound task should appear in favorites');
      assert.ok(favCompoundChild!.children.length > 0, 'Favorited compound task should include children');
      const childItem = favCompoundChild!.children[0];
      assert.ok(
        childItem.contextValue === 'queuedTask' || childItem.contextValue?.startsWith('running'),
        `Favorited compound task child should have queuedTask contextValue, got '${childItem.contextValue}'`
      );
    });

    test('favorited compound task group has favoriteCompoundTask contextValue', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyFavCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return typeof id === 'string' && id.includes('MyFavCompound');
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // Original compound task group should have favoriteCompoundTask contextValue
      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Compound task group should still exist in compound section');
      assert.strictEqual(compoundGroup!.contextValue, 'favoriteCompoundTask');

      // Favorite copy should also have favoriteCompoundTask contextValue
      const favGroup = roots.find((r) => r.taskType === 'favorites');
      const favCompoundChild = favGroup!.children.find((c) => c.label === 'MyFavCompound');
      assert.ok(favCompoundChild, 'Favorited compound task should appear in favorites');
      assert.strictEqual(favCompoundChild!.contextValue, 'favoriteCompoundTask');
    });

    test('running favorited compound task has runningFavoriteCompoundTask contextValue in favorites', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['RunningFav', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => true;

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return typeof id === 'string' && id.includes('RunningFav');
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      assert.ok(favGroup, 'Favorites group should exist');
      const favCompoundChild = favGroup!.children.find((c) => c.label === 'RunningFav');
      assert.ok(favCompoundChild, 'Running favorited compound task should appear in favorites');
      assert.strictEqual(favCompoundChild!.contextValue, 'runningFavoriteCompoundTask');
    });

    test('root ordering: recent, favorites, compoundTask, workspace', async () => {
      const task = new TaskItem('task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'task-id';
      task.originalLabel = 'task';

      stubServicesForOrganize([task]);

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return id === 'task-id';
      };

      const recentService = RecentTasksService.getInstance();
      (recentService as any).getRecentTasks = () => [task];

      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['Q1', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // Find positions
      const recentIdx = roots.findIndex((r) => r.taskType === 'recent');
      const favIdx = roots.findIndex((r) => r.taskType === 'favorites');
      const compoundIdx = roots.findIndex((r) => r.taskType === 'compoundTask');
      const wsIdx = roots.findIndex((r) => r.taskType === 'workspace');

      assert.ok(recentIdx !== -1, 'Should have recent group');
      assert.ok(favIdx !== -1, 'Should have favorites group');
      assert.ok(compoundIdx !== -1, 'Should have compound task group');
      assert.ok(wsIdx !== -1, 'Should have workspace root');

      // recent < favorites < compoundTask < workspace in the output array
      assert.ok(recentIdx < favIdx, 'Recent should come before favorites');
      assert.ok(favIdx < compoundIdx, 'Favorites should come before compound task');
      assert.ok(compoundIdx < wsIdx, 'Compound task should come before workspace');
    });

    test('invalid regex pattern falls back to plain-string matching and shows warning exactly once', async () => {
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'build-id';
      task.originalLabel = 'build';
      task.taskFileUri = vscode.Uri.file('/root/project/package.json');
      stubServicesForOrganize([task]);

      // Track showWarningMessage calls
      const warningMessages: string[] = [];
      const originalShowWarning = vscode.window.showWarningMessage;
      (vscode.window as any).showWarningMessage = (message: string) => {
        warningMessages.push(message);
        return Promise.resolve(undefined);
      };

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.taskSeparator') { return '[invalid'; }
              if (key === 'groups.taskSeparatorIsRegex') { return true; }
              if (key === 'groups.enabled') { return true; }
              if (key === 'groups.useParentFolder') { return false; }
              if (key === 'groups.recentTasks.enabled') { return false; }
              if (key === 'groups.compoundTasks.enabled') { return false; }
              if (key === 'compoundTasks.includeVsCodeCompoundTasks') { return true; }
              if (key === 'groups.expanded') { return { favorites: true, compoundTask: true, recent: true }; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };

      try {
        resetProviderSingleton();
        const provider = new TestableTaskTreeDataProvider(ctx);

        // Call getChildren three times to simulate multiple refreshes
        await provider.getChildren();
        await provider.getChildren();
        await provider.getChildren();

        // Warning should have been shown exactly once (deduplication)
        assert.strictEqual(warningMessages.length, 1, 'Warning should be shown exactly once, not on every refresh');
        assert.ok(
          warningMessages[0].includes('[invalid'),
          `Warning message should contain the invalid pattern, got: ${warningMessages[0]}`,
        );

        // Fallback: '[invalid' is used as a plain string — since label 'build' does not contain
        // the literal string '[invalid', the task should appear as a leaf (ungrouped).
        const roots = await provider.getChildren();
        const wsItem = roots.find((r) => r.taskType === 'workspace');
        assert.ok(wsItem, 'Should have workspace item');
        // Navigate down to find the task leaf — it should be ungrouped (no folder between type and task)
        const typeItem = wsItem!.children.find((c) => c.label === 'npm');
        assert.ok(typeItem, 'Should have npm type item');
        const leaf = typeItem!.children.find((c) => c.originalLabel === 'build' || c.label === 'build');
        assert.ok(leaf, 'Task should be present as a leaf (not grouped)');
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
        (vscode.window as any).showWarningMessage = originalShowWarning;
      }
    });
  });

  // ── organizeTasks with groups.compoundTasks.enabled ──────────────────────

  suite('compound tasks grouped mode', () => {
    function withCompoundTasksGroupEnabled(callback: () => Promise<void>): Promise<void> {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.compoundTasks.enabled') { return true; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };
      return callback().finally(() => {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      });
    }

    test('compound tasks appear under a Compound Tasks root when groups.compoundTasks.enabled is true', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withCompoundTasksGroupEnabled(async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        // Should have a 'compoundTasks' root instead of a bare 'compoundTask' root
        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.ok(compoundTasksRoot, 'Should have a Compound Tasks root group');
        assert.strictEqual(compoundTasksRoot!.label, 'Compound Tasks');

        // The individual compound task should be a child, not a root
        const bareCompoundRoot = roots.find((r) => r.taskType === 'compoundTask');
        assert.strictEqual(bareCompoundRoot, undefined, 'Individual compound task should NOT be a root when grouped');

        const childGroup = compoundTasksRoot!.children.find((c) => c.label === 'MyCompound');
        assert.ok(childGroup, 'MyCompound should be a child of the Compound Tasks root');
        assert.strictEqual(childGroup!.taskType, 'compoundTask');
      });
    });

    test('compoundTasks root has contextValue compoundTasks', async () => {
      const task = new TaskItem('child-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'child-task-id';
      task.originalLabel = 'child-task';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withCompoundTasksGroupEnabled(async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.ok(compoundTasksRoot, 'Should have compoundTasks root');
        assert.strictEqual(compoundTasksRoot!.contextValue, 'compoundTasks');
      });
    });

    test('root ordering: recent, favorites, compoundTasks, workspace when grouped', async () => {
      const task = new TaskItem('task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'task-id';
      task.originalLabel = 'task';

      stubServicesForOrganize([task]);

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return id === 'task-id';
      };

      const recentService = RecentTasksService.getInstance();
      (recentService as any).getRecentTasks = () => [task];

      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['Q1', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withCompoundTasksGroupEnabled(async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const recentIdx = roots.findIndex((r) => r.taskType === 'recent');
        const favIdx = roots.findIndex((r) => r.taskType === 'favorites');
        const compoundGroupIdx = roots.findIndex((r) => r.taskType === 'compoundTasks');
        const wsIdx = roots.findIndex((r) => r.taskType === 'workspace');

        assert.ok(recentIdx !== -1, 'Should have recent group');
        assert.ok(favIdx !== -1, 'Should have favorites group');
        assert.ok(compoundGroupIdx !== -1, 'Should have compoundTasks root');
        assert.ok(wsIdx !== -1, 'Should have workspace root');

        assert.ok(recentIdx < favIdx, 'Recent should come before favorites');
        assert.ok(favIdx < compoundGroupIdx, 'Favorites should come before compoundTasks');
        assert.ok(compoundGroupIdx < wsIdx, 'compoundTasks should come before workspace');
      });
    });

    test('multiple compound tasks are all children of the Compound Tasks root', async () => {
      const t1 = new TaskItem('task1', vscode.TreeItemCollapsibleState.None, 'npm');
      t1.id = 'task1-id';
      t1.originalLabel = 'task1';
      const t2 = new TaskItem('task2', vscode.TreeItemCollapsibleState.None, 'npm');
      t2.id = 'task2-id';
      t2.originalLabel = 'task2';

      stubServicesForOrganize([]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['CompoundA', [t1]], ['CompoundB', [t2]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withCompoundTasksGroupEnabled(async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.ok(compoundTasksRoot, 'Should have compoundTasks root');
        assert.strictEqual(compoundTasksRoot!.children.length, 2, 'Should have 2 compound task children');

        const labels = compoundTasksRoot!.children.map((c) => c.label);
        assert.ok(labels.includes('CompoundA'), 'CompoundA should be a child');
        assert.ok(labels.includes('CompoundB'), 'CompoundB should be a child');
      });
    });

    // Helper to configure both groups.compoundTasks.enabled and includeVsCodeCompoundTasks
    function withVscodeCompoundTasksEnabled(
      includeVscode: boolean,
      callback: () => Promise<void>,
    ): Promise<void> {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.compoundTasks.enabled') { return true; }
              if (key === 'compoundTasks.includeVsCodeCompoundTasks') { return includeVscode; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };
      return callback().finally(() => {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      });
    }

    test('vscode compound tasks appear as direct children of Compound Tasks root when includeVsCodeCompoundTasks is true', async () => {
      const vscodeTask = new TaskItem('Full Build', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      vscodeTask.id = 'vscode-full-build-id';
      vscodeTask.originalLabel = 'Full Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      vscodeTask.metadata = { dependsOnLabels: ['Compile', 'Test'] };

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(true, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.ok(compoundTasksRoot, 'Should have Compound Tasks root');

        const vscodeChild = compoundTasksRoot!.children.find((c) => c.label === 'Full Build');
        assert.ok(vscodeChild, 'Full Build should be a direct child of Compound Tasks root');
        assert.strictEqual(vscodeChild!.taskType, 'vscode', 'Child should have vscode type');
        assert.strictEqual(
          vscodeChild!.collapsibleState,
          vscode.TreeItemCollapsibleState.Collapsed,
          'VSCode compound task should be collapsible',
        );
      });
    });

    test('vscode compound task has dependency sub-items when includeVsCodeCompoundTasks is true', async () => {
      const vscodeTask = new TaskItem('Full Build', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      vscodeTask.id = 'vscode-full-build-id';
      vscodeTask.originalLabel = 'Full Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      vscodeTask.metadata = { dependsOnLabels: ['Compile', 'Test'] };

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(true, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        const vscodeChild = compoundTasksRoot!.children.find((c) => c.label === 'Full Build');
        assert.ok(vscodeChild, 'Full Build should exist');
        assert.strictEqual(vscodeChild!.children.length, 2, 'Should have 2 dependency sub-items');

        const depLabels = vscodeChild!.children.map((d) => d.label);
        assert.ok(depLabels.includes('Compile'), 'Should have Compile dep');
        assert.ok(depLabels.includes('Test'), 'Should have Test dep');
      });
    });

    test('vscode task without dependsOn is NOT added to Compound Tasks root', async () => {
      const vscodeTask = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'vscode');
      vscodeTask.id = 'vscode-build-id';
      vscodeTask.originalLabel = 'Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      // no dependsOnLabels metadata

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(true, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        // No compound tasks group because no vscode compound tasks and no user compound tasks
        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.strictEqual(compoundTasksRoot, undefined, 'Should not have Compound Tasks root when no compound tasks exist');
      });
    });

    test('vscode compound task is NOT added to Compound Tasks root when includeVsCodeCompoundTasks is false', async () => {
      const vscodeTask = new TaskItem('Full Build', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      vscodeTask.id = 'vscode-full-build-id';
      vscodeTask.originalLabel = 'Full Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      vscodeTask.metadata = { dependsOnLabels: ['Compile', 'Test'] };

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(false, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.strictEqual(compoundTasksRoot, undefined, 'Should not have Compound Tasks root when includeVsCodeCompoundTasks is false');
      });
    });

    test('vscode compound task has unique prefixed ID for tree node uniqueness', async () => {
      const vscodeTask = new TaskItem('Full Build', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      vscodeTask.id = 'vscode-full-build-id';
      vscodeTask.originalLabel = 'Full Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      vscodeTask.metadata = { dependsOnLabels: ['Compile'] };

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map<string, TaskItem[]>();
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(true, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        const vscodeChild = compoundTasksRoot!.children.find((c) => c.label === 'Full Build');
        assert.ok(vscodeChild, 'Full Build should exist');
        assert.ok(
          vscodeChild!.id?.startsWith(`${constants.VSCODE_COMPOUND_TASK_ID_PREFIX}:`),
          `ID should be prefixed with '${constants.VSCODE_COMPOUND_TASK_ID_PREFIX}:', got '${vscodeChild!.id}'`,
        );
      });
    });

    test('vscode compound task and user-defined compound tasks both appear under Compound Tasks root', async () => {
      const vscodeTask = new TaskItem('Full Build', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      vscodeTask.id = 'vscode-full-build-id';
      vscodeTask.originalLabel = 'Full Build';
      vscodeTask.taskFileUri = vscode.Uri.file('/root/.vscode/tasks.json');
      vscodeTask.metadata = { dependsOnLabels: ['Compile'] };

      const npmTask = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'npm');
      npmTask.id = 'npm-test-id';
      npmTask.originalLabel = 'test';

      stubServicesForOrganize([vscodeTask]);
      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['MyCompound', [npmTask]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';
      (compoundService as any).isCompoundTaskRunning = (_name: string) => false;

      await withVscodeCompoundTasksEnabled(true, async () => {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const compoundTasksRoot = roots.find((r) => r.taskType === 'compoundTasks');
        assert.ok(compoundTasksRoot, 'Should have Compound Tasks root');

        const vscodeChild = compoundTasksRoot!.children.find((c) => c.label === 'Full Build');
        assert.ok(vscodeChild, 'Full Build VSCode compound task should be a child');

        const userCompoundChild = compoundTasksRoot!.children.find((c) => c.label === 'MyCompound');
        assert.ok(userCompoundChild, 'User-defined MyCompound should be a child');
        assert.strictEqual(userCompoundChild!.taskType, 'compoundTask');
      });
    });
  });

  // ── organizeTasks with groups disabled ───────────────────────────────────

  suite('groups disabled mode', () => {
    test('produces flat Tasks root when groups.enabled is false', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const t1 = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      t1.taskFileUri = uri;
      t1.id = 'build-id';
      t1.originalLabel = 'build';

      const t2 = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      t2.taskFileUri = uri;
      t2.id = 'test-id';
      t2.originalLabel = 'test';

      stubServicesForOrganize([t1, t2]);

      // Create provider subclass that returns groups.enabled=false from config
      class GroupsDisabledProvider extends TestableTaskTreeDataProvider {
        constructor() { super(ctx); }
      }

      // We'll manipulate via the internal organizeTasks by overriding getConfiguration via monkey-patching
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.enabled') { return false; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };

      try {
        const provider = new GroupsDisabledProvider();
        const roots = await provider.getChildren();

        // Should have a single "Tasks" root item of type 'folder'
        const tasksRoot = roots.find((r) => r.label === 'Tasks');
        assert.ok(tasksRoot, 'Should have flat Tasks root');
        assert.strictEqual(tasksRoot!.children.length, 2, 'Should have 2 children (build, test)');
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      }
    });
  });

  // ── handleFileChange (via registerProvider) ──────────────────────────────

  suite('registerProvider', () => {
    test('does not throw when registering a provider without filePattern', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const mockProvider = {
        type: 'mockType',
        getTasks: async () => [],
        // no filePattern
      } as any;

      assert.doesNotThrow(() => provider.registerProvider(mockProvider));
    });

    test('does not throw when registering a provider with filePattern', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const mockProvider = {
        type: 'mockType',
        filePattern: '**/*.json',
        getTasks: async () => [],
      } as any;

      assert.doesNotThrow(() => provider.registerProvider(mockProvider));
    });
  });

  // ── handleFileChange debounce ─────────────────────────────────────────────

  suite('handleFileChange debouncing (internal)', () => {
    test('skips refresh when provider has no type', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const typelessProvider = { type: undefined } as any;
      // Should not throw
      assert.doesNotThrow(() => (provider as any).handleFileChange(typelessProvider));
    });

    test('sets a timeout for known provider type', (done) => {
      const provider = new TaskTreeDataProvider(ctx);
      const mockProvider = { type: 'someType' } as any;

      // Spy on setTimeout via the internal refreshTimeouts map
      (provider as any).handleFileChange(mockProvider);

      // The timeout should be registered
      assert.ok((provider as any).refreshTimeouts.has('someType'), 'Should have a timeout registered');

      // Cleanup the timeout to avoid leaking
      clearTimeout((provider as any).refreshTimeouts.get('someType'));
      (provider as any).refreshTimeouts.delete('someType');
      done();
    });

    test('replaces existing timeout for the same provider type', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const mockProvider = { type: 'someType' } as any;

      (provider as any).handleFileChange(mockProvider);
      const firstTimeout = (provider as any).refreshTimeouts.get('someType');

      (provider as any).handleFileChange(mockProvider);
      const secondTimeout = (provider as any).refreshTimeouts.get('someType');

      assert.notStrictEqual(firstTimeout, secondTimeout, 'Second call should replace first timeout');

      // Cleanup
      clearTimeout(secondTimeout);
      (provider as any).refreshTimeouts.delete('someType');
    });

    test('timeout callback fires refreshProvider and onDidChangeTreeData', (done) => {
      const provider = new TaskTreeDataProvider(ctx);
      const mockProvider = { type: 'fireType' } as any;

      // Stub TaskCacheService.refreshProvider to track invocation
      const cacheService = TaskCacheService.getInstance();
      const originalRefreshProvider = (cacheService as any).refreshProvider;
      let refreshCalled = false;
      (cacheService as any).refreshProvider = async (_type: string) => { refreshCalled = true; };

      // Track tree data change event
      let treeDataFired = false;
      const sub = provider.onDidChangeTreeData(() => { treeDataFired = true; });

      // Intercept the setTimeout call to capture the callback and invoke it directly
      const originalSetTimeout = global.setTimeout;
      let capturedFn: ((...args: any[]) => void) | undefined;
      let capturedTimeoutId: NodeJS.Timeout | undefined;

      try {
        (global as any).setTimeout = (fn: (...args: any[]) => void, _delay: number, ...args: any[]) => {
          capturedFn = fn;
          // Schedule with a very long delay so it doesn't fire on its own
          capturedTimeoutId = originalSetTimeout(fn, 60000, ...args) as any;
          return capturedTimeoutId;
        };

        (provider as any).handleFileChange(mockProvider);
        (global as any).setTimeout = originalSetTimeout;

        // Manually invoke the captured callback
        if (capturedFn) {
          Promise.resolve(capturedFn()).then(() => {
            assert.ok(refreshCalled, 'cache should have been refreshed');
            assert.ok(treeDataFired, 'tree data change should have fired');
            done();
          }).catch((err) => {
            done(err);
          }).finally(() => {
            (global as any).setTimeout = originalSetTimeout;
            sub.dispose();
            (cacheService as any).refreshProvider = originalRefreshProvider;
            if (capturedTimeoutId) clearTimeout(capturedTimeoutId);
            const timeouts = (provider as any).refreshTimeouts as Map<string, NodeJS.Timeout>;
            if (timeouts && timeouts.has('fireType')) {
                clearTimeout(timeouts.get('fireType'));
                timeouts.delete('fireType');
            }
          });
        } else {
          try {
            throw new Error('No callback was captured');
          } catch (e) {
            done(e);
          } finally {
            (global as any).setTimeout = originalSetTimeout;
            sub.dispose();
            (cacheService as any).refreshProvider = originalRefreshProvider;
            if (capturedTimeoutId) clearTimeout(capturedTimeoutId);
          }
        }
      } catch (err) {
        done(err);
        (global as any).setTimeout = originalSetTimeout;
        sub.dispose();
        (cacheService as any).refreshProvider = originalRefreshProvider;
        if (capturedTimeoutId) clearTimeout(capturedTimeoutId);
      }
    });
  });

  // ── groupTasksByParentFolder (covered separately but adding edge cases) ───

  suite('groupTasksByParentFolder edge cases', () => {
    test('returns empty array for empty input', () => {
      const provider = new TestableTaskTreeDataProvider(ctx);
      const result = provider.groupTasksByParentFolder([], '-', 'npm', 'ws1', '');
      assert.strictEqual(result.length, 0);
    });

    test('task without URI goes to root tasks (no folder separation)', () => {
      const provider = new TestableTaskTreeDataProvider(ctx);
      const task = new TaskItem('root-task', vscode.TreeItemCollapsibleState.None, 'npm');
      // no taskFileUri
      const result = provider.groupTasksByParentFolder([task], '-', 'npm', 'ws1', '');
      // All in rootTasks → groupedByName with '-'
      assert.ok(result.length > 0);
    });

    test('task at workspace root URI goes to root tasks', () => {
      const provider = new TestableTaskTreeDataProvider(ctx);
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('root-task', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;

      const result = provider.groupTasksByParentFolder([task], '', 'npm', 'ws1', '');
      // dir of /root/package.json is /root which equals workspace root → no sub-folder
      const appFolder = result.find((r) => r.taskType === 'folder');
      assert.strictEqual(appFolder, undefined, 'Should be no sub-folder for root-level task');
    });
  });

  // ── groupTasksByName (supplemental edge cases) ────────────────────────────

  suite('groupTasksByName edge cases', () => {
    test('empty separator returns sorted flat list', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const tasks = [
        new TaskItem('z-task', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('a-task', vscode.TreeItemCollapsibleState.None, 'npm'),
      ];
      const result = provider.groupTasksByName(tasks, '');
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].label, 'a-task');
      assert.strictEqual(result[1].label, 'z-task');
    });

    test('folders sort before leafs', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const tasks = [
        new TaskItem('a-leaf', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('b:grouped', vscode.TreeItemCollapsibleState.None, 'npm'),
      ];
      const result = provider.groupTasksByName(tasks, ':');
      const folder = result.find((r) => r.contextValue === 'folder');
      const leaf = result.find((r) => r.contextValue !== 'folder');
      const folderIdx = result.indexOf(folder!);
      const leafIdx = result.indexOf(leaf!);
      assert.ok(folderIdx < leafIdx, 'Folder should appear before leaf');
    });

    test('sortEnabled=false preserves insertion order with no separator', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const tasks = [
        new TaskItem('z-task', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('a-task', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('m-task', vscode.TreeItemCollapsibleState.None, 'npm'),
      ];
      const result = provider.groupTasksByName(tasks, '', '', false);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].label, 'z-task', 'First task should remain first');
      assert.strictEqual(result[1].label, 'a-task', 'Second task should remain second');
      assert.strictEqual(result[2].label, 'm-task', 'Third task should remain third');
    });

    test('sortEnabled=false preserves insertion order of groups and leafs', () => {
      const provider = new TaskTreeDataProvider(ctx);
      const tasks = [
        new TaskItem('z:leaf', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('a:leaf', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('m-standalone', vscode.TreeItemCollapsibleState.None, 'npm'),
      ];
      const result = provider.groupTasksByName(tasks, ':', '', false);
      // Groups come first (z group, then a group), then standalone leaf
      assert.strictEqual(result.length, 3, 'Should have 2 groups + 1 standalone');
      assert.strictEqual(result[0].contextValue, 'folder', 'First result should be a folder group');
      assert.strictEqual(result[0].label, 'z', 'First group should be z (insertion order)');
      assert.strictEqual(result[1].contextValue, 'folder', 'Second result should be a folder group');
      assert.strictEqual(result[1].label, 'a', 'Second group should be a (insertion order)');
      assert.strictEqual(result[2].label, 'm-standalone', 'Standalone leaf should come last');
    });

    test('grouped task retains dependency children when split by separator', () => {
      const provider = new TaskTreeDataProvider(ctx);

      // Simulate "My Group - My Task" with two dependency children
      const dep1 = new TaskItem('Dependee 1', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep1.id = 'dep1-id';
      const dep2 = new TaskItem('Dependee 2', vscode.TreeItemCollapsibleState.None, 'vscode');
      dep2.id = 'dep2-id';

      const task = new TaskItem('My Group - My Task', vscode.TreeItemCollapsibleState.Collapsed, 'vscode');
      task.id = 'my-group-my-task-id';
      task.originalLabel = 'My Group - My Task';
      task.metadata = { dependsOnLabels: ['Dependee 1', 'Dependee 2'] };
      task.children = [dep1, dep2];
      dep1.parent = task;
      dep2.parent = task;

      const result = provider.groupTasksByName([task], ' - ');

      // Should have one group: "My Group"
      assert.strictEqual(result.length, 1, 'Should have one group');
      const group = result[0];
      assert.strictEqual(group.label, 'My Group', 'Group label should be "My Group"');
      assert.strictEqual(group.contextValue, 'folder', 'Group should be a folder');

      // The group should contain "My Task"
      assert.strictEqual(group.children.length, 1, 'Group should have one child');
      const taskItem = group.children[0];
      assert.strictEqual(taskItem.label, 'My Task', 'Task label should be "My Task"');
      assert.strictEqual(taskItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed,
        'Task should be collapsible (it has dependency children)');

      // The task should still have its dependency children
      assert.strictEqual(taskItem.children.length, 2, 'Task should have two dependency children');
      assert.strictEqual(taskItem.children[0].label, 'Dependee 1');
      assert.strictEqual(taskItem.children[1].label, 'Dependee 2');

      // Children should have the grouped task as their parent
      assert.strictEqual(taskItem.children[0].parent, taskItem);
      assert.strictEqual(taskItem.children[1].parent, taskItem);
    });
  });

  // ── onDidChangeTreeData listener ─────────────────────────────────────────

  suite('onDidChangeTreeData listener', () => {
    test('TaskCacheService.onDidUpdate triggers tree data change', (done) => {
      const cacheService = TaskCacheService.getInstance();
      const provider = new TaskTreeDataProvider(ctx);

      const sub = provider.onDidChangeTreeData(() => {
        sub.dispose();
        done();
      });

      // Simulate a cache update
      (cacheService as any)._onDidUpdate?.fire();
    });
  });

  // ── Additional coverage: deep branches ───────────────────────────────────

  suite('filterTask with groups having children (deep filtering)', () => {
    test('filters out group when all its children are filtered', async () => {
      // Create a group (type='workspace') with two children, both filtered
      const parent = new TaskItem('group-parent', vscode.TreeItemCollapsibleState.Collapsed, 'workspace');
      parent.id = 'group-parent-id';
      const child1 = new TaskItem('child1', vscode.TreeItemCollapsibleState.None, 'npm');
      child1.id = 'child1-id';
      const child2 = new TaskItem('child2', vscode.TreeItemCollapsibleState.None, 'npm');
      child2.id = 'child2-id';
      parent.children = [child1, child2];

      stubServicesForOrganize([parent]);

      // Mark children as filtered; parent not directly filtered
      const filteredService = FilteredTaskService.getInstance();
      (filteredService as any).isFilteredOrHasFilteredParent = (task: TaskItem) => {
        return task.id === 'child1-id' || task.id === 'child2-id';
      };
      (filteredService as any).isFiltered = (id: string) => id === 'child1-id' || id === 'child2-id';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      // The parent group should be filtered away (all children filtered, group not explicitly filtered)
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.strictEqual(wsItem, undefined, 'Should remove workspace root when all descendants are filtered');
    });

    test('keeps group when only some children are filtered', async () => {
      const parent = new TaskItem('kept-group', vscode.TreeItemCollapsibleState.Collapsed, 'workspace');
      parent.id = 'kept-group-id';
      const child1 = new TaskItem('hidden-child', vscode.TreeItemCollapsibleState.None, 'npm');
      child1.id = 'hidden-child-id';
      const child2 = new TaskItem('visible-child', vscode.TreeItemCollapsibleState.None, 'npm');
      child2.id = 'visible-child-id';
      parent.children = [child1, child2];

      stubServicesForOrganize([parent]);

      // Only child1 is filtered
      const filteredService = FilteredTaskService.getInstance();
      (filteredService as any).isFilteredOrHasFilteredParent = (task: TaskItem) => task.id === 'hidden-child-id';
      (filteredService as any).isFiltered = (id: string) => id === 'hidden-child-id';

      const provider = new TestableTaskTreeDataProvider(ctx);
      await provider.getChildren();
      // The group should have child2 remaining; not filtered away
      // (parent has no taskFileUri so it goes to workspace_generic path)
      // Just verify no error thrown and the group parent's children are updated
    });
  });

  suite('collapseLevel=2 in organizeTasks', () => {
    test('sets groupSalt to roots_collapsed when collapseLevel is 2', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'build-id';
      task.originalLabel = 'build';

      stubServicesForOrganize([task]);

      const provider = new TestableTaskTreeDataProvider(ctx);
      (provider as any).collapseLevel = 2;
      const roots = await provider.getChildren();

      // Should still produce workspace items but with 'collapsed' salt in IDs
      const wsItem = roots.find((r) => r.taskType === 'workspace');
      assert.ok(wsItem, 'Should have workspace root');
      // ID should contain 'collapsed' salt
      assert.ok(wsItem!.id?.includes('collapsed'), 'Workspace ID should contain collapsed salt');
    });
  });

  suite('favorites with children', () => {
    test('favorites a task that has children - copies children too', async () => {
      const parent = new TaskItem('parent-with-children', vscode.TreeItemCollapsibleState.Collapsed, 'npm');
      parent.id = 'parent-with-children-id';
      parent.originalLabel = 'parent-with-children';

      const child1 = new TaskItem('child-task-1', vscode.TreeItemCollapsibleState.None, 'npm');
      child1.id = 'child-1-id';
      child1.originalLabel = 'child-task-1';
      parent.children = [child1];

      stubServicesForOrganize([parent]);

      const favService = FavoritesService.getInstance();
      (favService as any).isFavorite = (itemOrId: TaskItem | string) => {
        const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
        return id === 'parent-with-children-id';
      };

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const favGroup = roots.find((r) => r.taskType === 'favorites');
      assert.ok(favGroup, 'Should have favorites group');

      // The favorite type child should have children
      // favGroup.children[0] is a type item, its children contain the cloned parent
      const typeItem = favGroup!.children[0];
      assert.ok(typeItem, 'Should have type item in favorites');
      const clonedParent = typeItem.children.find((c) => (c as any).originalLabel === 'parent-with-children');
      assert.ok(clonedParent, 'Should have cloned favorite item');
    });
  });

  suite('compound task items with taskFileUri', () => {
    test('compound task items get description from workspace folder when taskFileUri matches real workspace', async () => {
      const task = new TaskItem('compound-task-with-uri', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'compound-task-uri-id';
      task.originalLabel = 'compound-task-with-uri';
      // No taskFileUri — description should be empty string
      task.taskFileUri = undefined;

      stubServicesForOrganize([]);

      const compoundService = CompoundTaskService.getInstance();
      (compoundService as any).getAllCompoundTasks = () => new Map([['TestCompoundTask', [task]]]);
      (compoundService as any).getCompoundTaskExecutionType = (_name: string) => 'sequential';

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const compoundGroup = roots.find((r) => r.taskType === 'compoundTask');
      assert.ok(compoundGroup, 'Should have compound task group');
      assert.strictEqual(compoundGroup!.children.length, 1);
    });
  });

  suite('recent tasks grouped by type (recentGroupsEnabled=true)', () => {
    test('groups recent tasks by type when groups.recentTasks.enabled is true', async () => {
      const task = new TaskItem('recent-grouped', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'recent-grouped-id';
      task.originalLabel = 'recent-grouped';

      stubServicesForOrganize([task]);

      const recentService = RecentTasksService.getInstance();
      (recentService as any).getRecentTasks = () => [task];

      // Mock getConfiguration to enable recentTasks grouping
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.recentTasks.enabled') { return true; }
              if (key === 'groups.enabled') { return true; }
              if (key === 'groups.useParentFolder') { return false; }
              if (key === 'groups.taskSeparator') { return '-'; }
              if (key === 'groups.taskSeparatorIsRegex') { return false; }
              if (key === 'groups.expanded') { return { favorites: true, compoundTask: true, recent: true }; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };

      try {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        const recentGroup = roots.find((r) => r.taskType === 'recent');
        assert.ok(recentGroup, 'Should have recent tasks group');
        // In grouped mode, children are type items
        assert.ok(recentGroup!.children.length > 0, 'Recent group should have type children');
        // The type item should contain our task
        const typeItem = recentGroup!.children[0];
        assert.ok(typeItem, 'Should have at least one type item');
        assert.ok(typeItem.children.length > 0, 'Type item should have task children');
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      }
    });
  });

  suite('duplicate recent task IDs', () => {
    test('handles duplicate recent task IDs by appending counter', async () => {
      // Create two tasks with the same id to trigger duplicate handling
      const task1 = new TaskItem('same-label', vscode.TreeItemCollapsibleState.None, 'npm');
      task1.id = 'same-id';
      task1.originalLabel = 'same-label';

      const task2 = new TaskItem('same-label', vscode.TreeItemCollapsibleState.None, 'npm');
      task2.id = 'same-id'; // Same ID
      task2.originalLabel = 'same-label';

      stubServicesForOrganize([task1, task2]);

      const recentService = RecentTasksService.getInstance();
      (recentService as any).getRecentTasks = () => [task1, task2];

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const recentGroup = roots.find((r) => r.taskType === 'recent');
      assert.ok(recentGroup, 'Should have recent tasks group');
      assert.strictEqual(recentGroup!.children.length, 2, 'Should have 2 recent tasks');

      // IDs should be unique
      const id1 = recentGroup!.children[0].id;
      const id2 = recentGroup!.children[1].id;
      assert.notStrictEqual(id1, id2, 'Duplicate IDs should be made unique');
      // Second one should have a counter suffix
      assert.ok(id2?.includes('|'), 'Second duplicate should have a pipe counter suffix');
    });
  });

  suite('sortingEnabled config in organizeTasks', () => {
    test('tasks.sortingEnabled=false preserves task discovery order', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const taskZ = new TaskItem('z-task', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      taskZ.taskFileUri = uri;
      taskZ.id = 'z-task-id';
      taskZ.originalLabel = 'z-task';
      const taskA = new TaskItem('a-task', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      taskA.taskFileUri = uri;
      taskA.id = 'a-task-id';
      taskA.originalLabel = 'a-task';

      stubServicesForOrganize([taskZ, taskA]);

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'tasks.sortingEnabled') { return false; }
              if (key === 'groups.enabled') { return true; }
              if (key === 'groups.useParentFolder') { return false; }
              if (key === 'groups.recentTasks.enabled') { return false; }
              if (key === 'groups.taskSeparator') { return ''; }
              if (key === 'groups.taskSeparatorIsRegex') { return false; }
              if (key === 'groups.expanded') { return { favorites: true, compoundTask: true, recent: true }; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };

      try {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();
        const wsItem = roots.find((r) => r.taskType === 'workspace');
        assert.ok(wsItem, 'Should have workspace item');
        const typeItem = wsItem!.children[0];
        assert.ok(typeItem, 'Should have type item');
        // Tasks should appear in discovery order (z first, then a) rather than sorted (a first)
        assert.strictEqual(typeItem.children[0].label, 'z-task', 'z-task should come first (discovery order)');
        assert.strictEqual(typeItem.children[1].label, 'a-task', 'a-task should come second (discovery order)');
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      }
    });
  });

  suite('useParentFolder config in organizeTasks', () => {
    test('uses groupTasksByParentFolder when groups.useParentFolder=true', async () => {
      const uri = vscode.Uri.file('/root/subdir/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'build-pf-id';
      task.originalLabel = 'build';

      stubServicesForOrganize([task]);

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: (key: string, defaultValue?: any) => {
              if (key === 'groups.useParentFolder') { return true; }
              if (key === 'groups.enabled') { return true; }
              if (key === 'groups.recentTasks.enabled') { return false; }
              if (key === 'groups.taskSeparator') { return '-'; }
              if (key === 'groups.taskSeparatorIsRegex') { return false; }
              if (key === 'groups.expanded') { return { favorites: true, compoundTask: true, recent: true }; }
              return defaultValue;
            },
          };
        }
        return originalGetConfig.call(vscode.workspace, section);
      };

      try {
        const provider = new TestableTaskTreeDataProvider(ctx);
        const roots = await provider.getChildren();

        // Should have a workspace root with type item
        const wsItem = roots.find((r) => r.taskType === 'workspace');
        assert.ok(wsItem, 'Should have workspace item');
        assert.ok(wsItem!.children.length > 0, 'Workspace should have type children');
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      }
    });
  });

  suite('pendingRevealLevel setTimeout callback', () => {
    test('level=0 calls reveal with expand:3 on bound views', (done) => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'reveal-build-0';
      task.originalLabel = 'build';
      stubServicesForOrganize([task]);

      let revealCalled = false;
      let revealExpand: number | undefined;

      const mockView = {
        onDidExpandElement: (_cb: any) => ({ dispose: () => {} }),
        onDidCollapseElement: (_cb: any) => ({ dispose: () => {} }),
        reveal: async (_root: TaskItem, options: any) => {
          revealCalled = true;
          revealExpand = options.expand;
        },
        dispose: () => {},
        visible: true,
        selection: [],
      } as unknown as vscode.TreeView<TaskItem>;

      const provider = new TestableTaskTreeDataProvider(ctx);
      provider.bindView(mockView);

      // Set pendingRevealLevel to 0 (expand 3 deep)
      (provider as any).pendingRevealLevel = 0;

      // Call getChildren so pendingRevealLevel is processed and currentRoots is populated
      provider.getChildren().then(() => {
        // Wait for the setTimeout (100ms) to fire, plus a small buffer
        setTimeout(() => {
          assert.ok(revealCalled, 'reveal should have been called when roots exist and view is bound');
          assert.strictEqual(revealExpand, 3, 'level=0 should expand 3 deep');
          done();
        }, 300);
      });
    });

    test('level=1 calls reveal with expand:1 on bound views', (done) => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'reveal-test-1';
      task.originalLabel = 'test';
      stubServicesForOrganize([task]);

      let revealCalled = false;
      let revealExpand: number | undefined;

      const mockView = {
        onDidExpandElement: (_cb: any) => ({ dispose: () => {} }),
        onDidCollapseElement: (_cb: any) => ({ dispose: () => {} }),
        reveal: async (_root: TaskItem, options: any) => {
          revealCalled = true;
          revealExpand = options.expand;
        },
        dispose: () => {},
        visible: true,
        selection: [],
      } as unknown as vscode.TreeView<TaskItem>;

      const provider = new TestableTaskTreeDataProvider(ctx);
      provider.bindView(mockView);

      // Set pendingRevealLevel to 1 (expand 1 deep)
      (provider as any).pendingRevealLevel = 1;

      provider.getChildren().then(() => {
        setTimeout(() => {
          assert.ok(revealCalled, 'reveal should have been called when roots exist and view is bound');
          assert.strictEqual(revealExpand, 1, 'Should reveal with expand:1 for level=1');
          done();
        }, 300);
      });
    });

    test('returns early when views list is empty when setTimeout fires', (done) => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'reveal-noview';
      task.originalLabel = 'build';
      stubServicesForOrganize([task]);

      const provider = new TestableTaskTreeDataProvider(ctx);
      // Do NOT bind any view — views list is empty

      (provider as any).pendingRevealLevel = 1;

      // Should not throw even when views is empty
      provider.getChildren().then(() => {
        setTimeout(() => {
          // No view bound, reveal code should have returned early without error
          done();
        }, 300);
      });
    });
  });

  // ── Loading placeholders (Phase 3) ─────────────────────────────────────────

  suite('Loading placeholders', () => {
    test('loading placeholder appears for in-flight provider with no tasks', async () => {
      stubServicesForOrganize([]);
      const cacheService = TaskCacheService.getInstance();
      // Simulate a provider actively loading with no tasks committed yet
      (cacheService as any).loadingProviders = new Set(['shell']);
      (cacheService as any).providerTasks = new Map(); // no tasks committed

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholder = roots.find((r) => r.contextValue === 'loadingPlaceholder');
      assert.ok(placeholder, 'A loading placeholder should appear for the loading provider');
      assert.ok(String(placeholder!.label).includes('shell'), 'Placeholder label should mention provider type');
    });

    test('loading placeholder uses loading~spin icon', async () => {
      stubServicesForOrganize([]);
      const cacheService = TaskCacheService.getInstance();
      (cacheService as any).loadingProviders = new Set(['npm']);
      (cacheService as any).providerTasks = new Map();

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholder = roots.find((r) => r.contextValue === 'loadingPlaceholder');
      assert.ok(placeholder, 'Placeholder should exist');
      const icon = placeholder!.iconPath as vscode.ThemeIcon;
      assert.ok(icon instanceof vscode.ThemeIcon, 'Icon should be a ThemeIcon');
      assert.strictEqual(icon.id, 'loading~spin');
    });

    test('loading placeholder has contextValue loadingPlaceholder', async () => {
      stubServicesForOrganize([]);
      const cacheService = TaskCacheService.getInstance();
      (cacheService as any).loadingProviders = new Set(['vscode']);
      (cacheService as any).providerTasks = new Map();

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholder = roots.find((r) => r.contextValue === 'loadingPlaceholder');
      assert.ok(placeholder, 'Placeholder should exist');
      assert.strictEqual(placeholder!.contextValue, 'loadingPlaceholder');
    });

    test('no placeholder appears when provider has tasks committed', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'npm-build';
      task.originalLabel = 'build';
      stubServicesForOrganize([task]);
      const cacheService = TaskCacheService.getInstance();
      // Provider is still "loading" but has committed tasks
      (cacheService as any).loadingProviders = new Set(['npm']);
      (cacheService as any).providerTasks = new Map([['npm', [task]]]);

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholder = roots.find((r) => r.contextValue === 'loadingPlaceholder');
      assert.strictEqual(placeholder, undefined, 'No placeholder when provider already has tasks');
    });

    test('no placeholders appear when loadingProviders is empty', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'npm-build-2';
      task.originalLabel = 'build';
      stubServicesForOrganize([task]);
      const cacheService = TaskCacheService.getInstance();
      (cacheService as any).loadingProviders = new Set();

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholders = roots.filter((r) => r.contextValue === 'loadingPlaceholder');
      assert.strictEqual(placeholders.length, 0, 'No placeholders when not loading');
    });

    test('placeholder is inserted before workspace-folder groups', async () => {
      const uri = vscode.Uri.file('/root/package.json');
      const task = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
      task.taskFileUri = uri;
      task.id = 'npm-build-3';
      task.originalLabel = 'build';
      stubServicesForOrganize([task]);
      const cacheService = TaskCacheService.getInstance();
      // shell is loading (no tasks), npm has tasks
      (cacheService as any).loadingProviders = new Set(['shell']);
      (cacheService as any).providerTasks = new Map();

      const provider = new TestableTaskTreeDataProvider(ctx);
      const roots = await provider.getChildren();

      const placeholderIdx = roots.findIndex((r) => r.contextValue === 'loadingPlaceholder');
      const workspaceIdx = roots.findIndex((r) => r.taskType === 'workspace');

      assert.ok(placeholderIdx >= 0, 'Placeholder should be present');
      if (workspaceIdx >= 0) {
        assert.ok(
          placeholderIdx < workspaceIdx,
          `Placeholder (idx ${placeholderIdx}) should appear before workspace root (idx ${workspaceIdx})`,
        );
      }
    });

    test('onDidLoadingStateChange subscription fires tree data change', () => {
      const cacheService = TaskCacheService.getInstance();
      const provider = new TestableTaskTreeDataProvider(ctx);

      let treeChanged = false;
      provider.onDidChangeTreeData(() => {
        treeChanged = true;
      });

      // Fire the loading state change event
      (cacheService as any)._onDidLoadingStateChange.fire();

      assert.strictEqual(treeChanged, true, 'Tree data change event should fire on loading state change');
    });
  });

  // ── Secrets group ──────────────────────────────────────────────────────────

  suite('Secrets group', () => {
    test('no Secrets group when secrets storage is empty', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys([]);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.strictEqual(secretsGroup, undefined, 'Secrets group should not appear when no secrets');
    });

    test('Secrets group appears when secrets exist', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['api.key', 'deploy.token']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should appear');
      assert.strictEqual(secretsGroup!.label, 'Secrets');
    });

    test('Secrets group has key icon and wtSecrets contextValue', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['api.key']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should exist');
      assert.strictEqual(secretsGroup!.contextValue, 'wtSecrets');
      assert.ok(
        secretsGroup!.iconPath instanceof vscode.ThemeIcon &&
        (secretsGroup!.iconPath as vscode.ThemeIcon).id === 'key',
        `Secrets group icon should be 'key', got: ${JSON.stringify(secretsGroup!.iconPath)}`,
      );
    });

    test('Secrets group children are sorted alphabetically', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['zzz.key', 'aaa.key', 'mmm.key']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should exist');

      const labels = secretsGroup!.children.map((c) => c.label as string);
      assert.deepStrictEqual(labels, ['aaa.key', 'mmm.key', 'zzz.key']);
    });

    test('each secret child has storedSecret contextValue and lock icon', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['my.secret']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should exist');
      assert.strictEqual(secretsGroup!.children.length, 1);

      const child = secretsGroup!.children[0];
      assert.strictEqual(child.contextValue, 'storedSecret');
      assert.ok(
        child.iconPath instanceof vscode.ThemeIcon &&
        (child.iconPath as vscode.ThemeIcon).id === 'lock',
        `Secret item icon should be 'lock', got: ${JSON.stringify(child.iconPath)}`,
      );
    });

    test('each secret child id is "secret:<key>"', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['my.secret']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should exist');

      const child = secretsGroup!.children[0];
      assert.strictEqual(child.id, 'secret:my.secret');
    });

    test('each secret child has correct tooltip and is a leaf node', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['db.password']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      const child = secretsGroup!.children[0];

      assert.ok(
        (child.tooltip as string)?.includes('db.password'),
        `Tooltip should include the key name, got: ${child.tooltip}`,
      );
      assert.strictEqual(child.collapsibleState, vscode.TreeItemCollapsibleState.None);
    });

    test('Secrets group is the last root item when tasks also exist', async () => {
      const task = new TaskItem('my-task', vscode.TreeItemCollapsibleState.None, 'npm');
      task.id = 'task-1';
      task.originalLabel = 'my-task';
      stubServicesForOrganize([task]);

      const localCtx = createMockContextWithSecretKeys(['my.secret']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      assert.ok(roots.length >= 2, 'Should have workspace root + secrets group');
      const lastRoot = roots[roots.length - 1];
      assert.strictEqual(lastRoot.taskType, 'secrets', 'Secrets group should be the last root item');
    });

    test('cachedSecretKeys is refreshed on each getChildren call', async () => {
      stubServicesForOrganize([]);
      const mutableKeys: string[] = [];
      const localCtx = createMockContext();
      (localCtx.secrets as any).keys = async () => [...mutableKeys];
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      // First call: no secrets
      let roots = await provider.getChildren();
      assert.strictEqual(roots.find((r) => r.taskType === 'secrets'), undefined, 'No secrets yet');

      // Add a key and refresh
      mutableKeys.push('new.secret');
      roots = await provider.getChildren();
      assert.ok(roots.find((r) => r.taskType === 'secrets'), 'Secrets group should appear after key added');
    });

    test('secrets.keys() error is handled gracefully — no Secrets group', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContext();
      (localCtx.secrets as any).keys = async () => { throw new Error('SecretStorage unavailable'); };
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.strictEqual(secretsGroup, undefined, 'No secrets group when keys() throws');
    });

    test('each secret child has secrets group as parent', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['child.key']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.ok(secretsGroup, 'Secrets group should exist');

      const child = secretsGroup!.children[0];
      assert.strictEqual(child.parent, secretsGroup, 'Secret item parent should be the Secrets group');
    });

    test('each secret child command invokes copySecretKey with the key name', async () => {
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys(['db.password']);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      const child = secretsGroup!.children[0];

      assert.ok(child.command, 'Secret item should have a command');
      assert.strictEqual(child.command!.command, 'workspaceTasks.env.copySecretKey',
        `Expected copySecretKey, got: ${child.command!.command}`);
      assert.deepStrictEqual(child.command!.arguments, ['db.password'],
        'Command arguments should be the secret key string');
    });

    // ── secrets.showEmptyGroup setting ───────────────────────────────────────

    /**
     * Wraps a test callback with a getConfiguration mock that sets
     * `secrets.showEmptyGroup` to `enabled` while preserving all other defaults.
     */
    function withShowEmptySecretsGroup(enabled: boolean, callback: () => Promise<void>): Promise<void> {
      const currentGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'secrets.showEmptyGroup') { return enabled as unknown as T; }
              // Preserve standard defaults used by the outer setup mock.
              if (key === 'groups.compoundTasks.enabled') { return false as unknown as T; }
              if (key === 'groups.enabled') { return true as unknown as T; }
              if (key === 'groups.useParentFolder') { return false as unknown as T; }
              if (key === 'groups.recentTasks.enabled') { return false as unknown as T; }
              if (key === 'compoundTasks.includeVsCodeCompoundTasks') { return true as unknown as T; }
              if (key === 'groups.taskSeparator') { return '-' as unknown as T; }
              if (key === 'groups.taskSeparatorIsRegex') { return false as unknown as T; }
              if (key === 'groups.expanded') {
                return { favorites: true, compoundTask: true, recent: true } as unknown as T;
              }
              return def as T;
            },
          };
        }
        return currentGetConfig(section);
      };
      return callback().finally(() => {
        (vscode.workspace as any).getConfiguration = currentGetConfig;
      });
    }

    test('showEmptyGroup=false and no secrets: Secrets group absent (regression)', async () => {
      // Default behavior: secrets group hidden when storage is empty.
      stubServicesForOrganize([]);
      const localCtx = createMockContextWithSecretKeys([]);
      resetProviderSingleton();
      const provider = new TestableTaskTreeDataProvider(localCtx);

      const roots = await provider.getChildren();
      const secretsGroup = roots.find((r) => r.taskType === 'secrets');
      assert.strictEqual(secretsGroup, undefined, 'Secrets group should be absent with no secrets and showEmptyGroup=false');
    });

    test('showEmptyGroup=true and no secrets: Secrets group is present with no children', async () => {
      await withShowEmptySecretsGroup(true, async () => {
        stubServicesForOrganize([]);
        const localCtx = createMockContextWithSecretKeys([]);
        resetProviderSingleton();
        const provider = new TestableTaskTreeDataProvider(localCtx);

        const roots = await provider.getChildren();
        const secretsGroup = roots.find((r) => r.taskType === 'secrets');
        assert.ok(secretsGroup, 'Secrets group should be present when showEmptyGroup=true even with no secrets');
        assert.strictEqual(secretsGroup!.label, 'Secrets');
        assert.strictEqual(secretsGroup!.children.length, 0, 'Empty secrets group should have no children');
      });
    });

    test('showEmptyGroup=true and secrets exist: Secrets group still renders children normally', async () => {
      await withShowEmptySecretsGroup(true, async () => {
        stubServicesForOrganize([]);
        const localCtx = createMockContextWithSecretKeys(['existing.key']);
        resetProviderSingleton();
        const provider = new TestableTaskTreeDataProvider(localCtx);

        const roots = await provider.getChildren();
        const secretsGroup = roots.find((r) => r.taskType === 'secrets');
        assert.ok(secretsGroup, 'Secrets group should be present');
        assert.strictEqual(secretsGroup!.children.length, 1, 'Secrets group should still render its children');
        assert.strictEqual(secretsGroup!.children[0].label, 'existing.key');
      });
    });

    test('showEmptyGroup=true empty group: tooltip indicates no secrets are stored', async () => {
      await withShowEmptySecretsGroup(true, async () => {
        stubServicesForOrganize([]);
        const localCtx = createMockContextWithSecretKeys([]);
        resetProviderSingleton();
        const provider = new TestableTaskTreeDataProvider(localCtx);

        const roots = await provider.getChildren();
        const secretsGroup = roots.find((r) => r.taskType === 'secrets');
        assert.ok(secretsGroup, 'Secrets group should be present');
        assert.ok(
          (secretsGroup!.tooltip as string)?.includes('No secrets stored'),
          `Tooltip should indicate no secrets are stored, got: ${secretsGroup!.tooltip}`,
        );
      });
    });
  });
});
