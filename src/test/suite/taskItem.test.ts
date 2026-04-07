import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { TaskStateManager, TaskStatus } from '../../taskStateManager';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';

// ---------------------------------------------------------------------------
// Minimal fake helpers
// ---------------------------------------------------------------------------

function buildFakeStateManager(statusMap: Map<string, TaskStatus> = new Map()): TaskStateManager {
  return {
    getTaskId: (item: TaskItem) => (item.id ?? item.originalLabel ?? item.label),
    getStatus: (id: string) => statusMap.get(id) ?? 'idle',
    getIdByExecution: () => undefined,
  } as unknown as TaskStateManager;
}

function buildFakeFavoritesService(favoriteIds: Set<string> = new Set()): FavoritesService {
  return {
    isFavorite: (itemOrId: TaskItem | string) => {
      const id = typeof itemOrId === 'string' ? itemOrId : (itemOrId.id ?? '');
      return favoriteIds.has(id);
    },
  } as unknown as FavoritesService;
}

function buildFakeFilteredTaskService(filteredIds: Set<string> = new Set()): FilteredTaskService {
  return {
    isFiltered: (id: string) => filteredIds.has(id),
    isFilteredOrHasFilteredParent: (item: TaskItem) => {
      const id = item.id;
      const canonicalId = id ? id.replace(/\|\d+$/, '') : id;
      if ((id && filteredIds.has(id)) || (canonicalId && filteredIds.has(canonicalId))) {
        return true;
      }
      let current = item.parent;
      while (current) {
        if (current.id && filteredIds.has(current.id)) {
          return true;
        }
        current = current.parent;
      }
      return false;
    },
  } as unknown as FilteredTaskService;
}

function makeTaskItem(label: string, id: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'vscode');
  item.originalLabel = label;
  (item as any).id = id;
  return item;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskItem.updateContextValue Test Suite', () => {
  let originalStateManager: TaskStateManager;
  let originalFavoritesService: FavoritesService;
  let originalFilteredTaskService: FilteredTaskService;

  setup(() => {
    originalStateManager = (TaskStateManager as any).instance;
    originalFavoritesService = (FavoritesService as any).instance;
    originalFilteredTaskService = (FilteredTaskService as any).instance;
  });

  teardown(() => {
    (TaskStateManager as any).instance = originalStateManager;
    (FavoritesService as any).instance = originalFavoritesService;
    (FilteredTaskService as any).instance = originalFilteredTaskService;
  });

  // -------------------------------------------------------------------------
  // Dedup-suffix state propagation
  // -------------------------------------------------------------------------

  test('compound task child with "|N" id shows running icon when original task is running', () => {
    const statusMap = new Map<TaskStatus, TaskStatus>();
    (statusMap as unknown as Map<string, TaskStatus>).set('ws:path:compile', 'running');

    (TaskStateManager as any).instance = buildFakeStateManager(statusMap as unknown as Map<string, TaskStatus>);
    (FavoritesService as any).instance = buildFakeFavoritesService();
    (FilteredTaskService as any).instance = buildFakeFilteredTaskService();

    // Child in compound task gets "|1" dedup suffix
    const child = makeTaskItem('compile', 'ws:path:compile|1');
    child.updateContextValue();

    assert.ok(
      (child.iconPath as vscode.ThemeIcon).id === 'loading~spin',
      'Child icon should be loading~spin when original task is running',
    );
    assert.ok(
      (child.contextValue ?? '').startsWith('running'),
      `contextValue should start with "running", got: ${child.contextValue}`,
    );
  });

  test('compound task child with "|N" id shows success icon when original task succeeded', () => {
    const statusMap = new Map<string, TaskStatus>();
    statusMap.set('ws:path:compile', 'success');

    (TaskStateManager as any).instance = buildFakeStateManager(statusMap);
    (FavoritesService as any).instance = buildFakeFavoritesService();
    (FilteredTaskService as any).instance = buildFakeFilteredTaskService();

    const child = makeTaskItem('compile', 'ws:path:compile|1');
    child.updateContextValue();

    assert.ok(
      (child.iconPath as vscode.ThemeIcon).id === 'check',
      'Child icon should be check when original task succeeded',
    );
  });

  test('compound task child with "|N" id shows failure icon when original task failed', () => {
    const statusMap = new Map<string, TaskStatus>();
    statusMap.set('ws:path:compile', 'failure');

    (TaskStateManager as any).instance = buildFakeStateManager(statusMap);
    (FavoritesService as any).instance = buildFakeFavoritesService();
    (FilteredTaskService as any).instance = buildFakeFilteredTaskService();

    const child = makeTaskItem('compile', 'ws:path:compile|1');
    child.updateContextValue();

    assert.ok(
      (child.iconPath as vscode.ThemeIcon).id === 'error',
      'Child icon should be error when original task failed',
    );
  });

  test('compound task child with "|N" id reflects favourite state of the original', () => {
    (TaskStateManager as any).instance = buildFakeStateManager();
    (FavoritesService as any).instance = buildFakeFavoritesService(new Set(['ws:path:compile']));
    (FilteredTaskService as any).instance = buildFakeFilteredTaskService();

    const child = makeTaskItem('compile', 'ws:path:compile|1');
    child.updateContextValue();

    assert.ok(
      child.contextValue?.includes('favoriteTask'),
      `contextValue should include favoriteTask, got: ${child.contextValue}`,
    );
  });

  test('original task (no dedup suffix) state is unaffected by the fix', () => {
    const statusMap = new Map<string, TaskStatus>();
    statusMap.set('ws:path:compile', 'running');

    (TaskStateManager as any).instance = buildFakeStateManager(statusMap);
    (FavoritesService as any).instance = buildFakeFavoritesService();
    (FilteredTaskService as any).instance = buildFakeFilteredTaskService();

    const original = makeTaskItem('compile', 'ws:path:compile');
    original.updateContextValue();

    assert.ok(
      (original.iconPath as vscode.ThemeIcon).id === 'loading~spin',
      'Original task should still show running icon',
    );
  });
});
