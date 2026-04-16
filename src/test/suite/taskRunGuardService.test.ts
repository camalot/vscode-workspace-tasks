import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(label: string, id?: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'npm');
  item.id = id ?? label;
  item.originalLabel = label;
  return item;
}

function makeContext(stored: string[] = []): vscode.ExtensionContext {
  const wsMap = new Map<string, any>([['workspaceTasks.guardedTasks', stored]]);
  return {
    workspaceState: {
      get: (key: string, def?: any) => wsMap.get(key) ?? def,
      update: (key: string, value: any) => { wsMap.set(key, value); return Promise.resolve(); },
      keys: () => Array.from(wsMap.keys()),
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

function stubPatterns(patterns: string[]) {
  (vscode.workspace as any).getConfiguration = (section?: string) => {
    if (section === 'workspaceTasks') {
      return { get: (key: string, def?: any) => key === 'task.confirmPatterns' ? patterns : def };
    }
    return originalGetConfiguration(section);
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskRunGuardService Test Suite', () => {
  let service: TaskRunGuardService;

  setup(() => {
    (TaskRunGuardService as any)._instance = undefined;
    service = TaskRunGuardService.getInstance();
    originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    stubPatterns([]);
  });

  teardown(() => {
    (TaskRunGuardService as any)._instance = undefined;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  // ── getInstance ────────────────────────────────────────────────────────────

  test('getInstance returns singleton', () => {
    const a = TaskRunGuardService.getInstance();
    const b = TaskRunGuardService.getInstance();
    assert.strictEqual(a, b);
  });

  // ── isGuarded — no guards ──────────────────────────────────────────────────

  test('isGuarded — no guards set returns false', () => {
    service.initialize(makeContext());
    const item = makeItem('build');
    assert.strictEqual(service.isGuarded(item), false);
  });

  // ── isGuarded — Solution C (manual) ───────────────────────────────────────

  test('isGuarded — manual guard (Solution C) returns true for guarded ID', () => {
    service.initialize(makeContext(['build']));
    const item = makeItem('build', 'build');
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('isGuarded — manual guard does not match different ID', () => {
    service.initialize(makeContext(['other']));
    const item = makeItem('build', 'build');
    assert.strictEqual(service.isGuarded(item), false);
  });

  // ── isGuarded — Solution B (definition flag) ──────────────────────────────

  test('isGuarded — definition flag (Solution B) returns true when guardedByDefinition === true', () => {
    service.initialize(makeContext());
    const item = makeItem('deploy');
    item.guardedByDefinition = true;
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('isGuarded — guardedByDefinition false is not guarded', () => {
    service.initialize(makeContext());
    const item = makeItem('deploy');
    item.guardedByDefinition = false;
    assert.strictEqual(service.isGuarded(item), false);
  });

  // ── isGuarded — Solution A (pattern) ──────────────────────────────────────

  test('isGuarded — pattern match (Solution A) returns true when label matches', () => {
    stubPatterns(['deploy.*']);
    service.initialize(makeContext());
    const item = makeItem('deploy-prod');
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('isGuarded — pattern miss returns false when label does not match', () => {
    stubPatterns(['deploy.*']);
    service.initialize(makeContext());
    const item = makeItem('build');
    assert.strictEqual(service.isGuarded(item), false);
  });

  test('isGuarded — pattern matching is case-insensitive', () => {
    stubPatterns(['deploy']);
    service.initialize(makeContext());
    const item = makeItem('Deploy');
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('isGuarded — originalLabel used for pattern match, not post-grouping label', () => {
    stubPatterns(['deploy']);
    service.initialize(makeContext());
    const item = makeItem('Deploy');
    // Simulate a grouped label override while originalLabel stays stable
    (item as any).label = 'prod / deploy';
    item.originalLabel = 'deploy';
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('isGuarded — invalid regex in patterns does not throw; skips invalid entry', () => {
    stubPatterns(['[invalid(', 'build']);
    service.initialize(makeContext());
    const item = makeItem('build');
    // Should not throw, and the valid pattern 'build' still matches
    assert.doesNotThrow(() => assert.strictEqual(service.isGuarded(item), true));
  });

  // ── addGuard / removeGuard / isManuallyGuarded ─────────────────────────────

  test('addGuard + isManuallyGuarded: ID added to workspaceState', async () => {
    service.initialize(makeContext());
    const item = makeItem('build', 'build');
    await service.addGuard(item);
    assert.strictEqual(service.isManuallyGuarded('build'), true);
    assert.strictEqual(service.isGuarded(item), true);
  });

  test('removeGuard: ID removed; isGuarded returns false', async () => {
    service.initialize(makeContext(['build']));
    const item = makeItem('build', 'build');
    assert.strictEqual(service.isGuarded(item), true);
    await service.removeGuard(item);
    assert.strictEqual(service.isGuarded(item), false);
    assert.strictEqual(service.isManuallyGuarded('build'), false);
  });

  test('addGuard — duplicate: no duplicate stored; guard count stays 1', async () => {
    service.initialize(makeContext());
    const item = makeItem('build', 'build');
    await service.addGuard(item);
    await service.addGuard(item); // second call is a no-op
    assert.strictEqual(service.isManuallyGuarded('build'), true);
    // Verify internal set size is exactly 1
    assert.strictEqual((service as any)._manualGuardIds.size, 1);
  });

  test('addGuard — item with no id does nothing', async () => {
    service.initialize(makeContext());
    const item = makeItem('build');
    item.id = undefined;
    await service.addGuard(item);
    assert.strictEqual((service as any)._manualGuardIds.size, 0);
  });

  test('removeGuard — item not in guards is a no-op', async () => {
    service.initialize(makeContext());
    const item = makeItem('build', 'build');
    await service.removeGuard(item); // nothing to remove
    assert.strictEqual(service.isManuallyGuarded('build'), false);
  });

  // ── onDidChangeGuards event ────────────────────────────────────────────────

  test('addGuard fires onDidChangeGuards', async () => {
    service.initialize(makeContext());
    let fired = false;
    service.onDidChangeGuards(() => { fired = true; });
    await service.addGuard(makeItem('build', 'build'));
    assert.strictEqual(fired, true);
  });

  test('removeGuard fires onDidChangeGuards', async () => {
    service.initialize(makeContext(['build']));
    let fired = false;
    service.onDidChangeGuards(() => { fired = true; });
    await service.removeGuard(makeItem('build', 'build'));
    assert.strictEqual(fired, true);
  });

  // ── confirmIfNeeded ────────────────────────────────────────────────────────

  test('confirmIfNeeded — not guarded returns true without showing dialog', async () => {
    service.initialize(makeContext());
    let dialogCalled = false;
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = () => { dialogCalled = true; return Promise.resolve(undefined); };
    try {
      const result = await service.confirmIfNeeded(makeItem('build'));
      assert.strictEqual(result, true);
      assert.strictEqual(dialogCalled, false);
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('confirmIfNeeded — guarded, user confirms returns true', async () => {
    service.initialize(makeContext(['build']));
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = () => Promise.resolve('Run Task');
    try {
      const result = await service.confirmIfNeeded(makeItem('build', 'build'));
      assert.strictEqual(result, true);
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('confirmIfNeeded — guarded, user cancels returns false', async () => {
    service.initialize(makeContext(['build']));
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = () => Promise.resolve(undefined);
    try {
      const result = await service.confirmIfNeeded(makeItem('build', 'build'));
      assert.strictEqual(result, false);
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('confirmIfNeeded — uses originalLabel in dialog prompt', async () => {
    service.initialize(makeContext(['id-1']));
    let capturedMsg = '';
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => { capturedMsg = msg; return Promise.resolve(undefined); };
    try {
      const item = makeItem('Deploy Production', 'id-1');
      await service.confirmIfNeeded(item);
      assert.ok(capturedMsg.includes('Deploy Production'), `Expected dialog to mention task label, got: ${capturedMsg}`);
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  // ── isGuardedById ─────────────────────────────────────────────────────────

  test('isGuardedById — matches manual guard', () => {
    service.initialize(makeContext(['canonical-id']));
    assert.strictEqual(service.isGuardedById('canonical-id'), true);
  });

  test('isGuardedById — strips fav: prefix before lookup', () => {
    service.initialize(makeContext(['canonical-id']));
    assert.strictEqual(service.isGuardedById('fav:canonical-id'), true);
  });

  test('isGuardedById — strips queue: compound-task prefix before lookup', () => {
    // The actual prefix constant is COMPOUND_TASK_ID_PREFIX = 'queue', not 'compound-task'.
    service.initialize(makeContext(['canonical-id']));
    assert.strictEqual(service.isGuardedById('queue:myGroup:canonical-id'), true);
  });

  test('isGuardedById — returns false when not manually guarded', () => {
    service.initialize(makeContext());
    assert.strictEqual(service.isGuardedById('unknown'), false);
  });

  // ── fav:/recent: prefix normalization ───────────────────────────────────────

  test('isGuarded — fav:-prefixed ID matches guard stored under canonical ID', () => {
    // Guard stored with canonical (non-prefixed) ID; item in Favorites has fav: prefix.
    service.initialize(makeContext(['canonical-id']));
    const favItem = makeItem('build', 'fav:canonical-id');
    assert.strictEqual(service.isGuarded(favItem), true,
      'Favorites item should be treated as guarded when the canonical ID is in the guard set');
  });

  test('isGuarded — recent:-prefixed ID matches guard stored under canonical ID', () => {
    service.initialize(makeContext(['canonical-id']));
    const recentItem = makeItem('build', 'recent:canonical-id');
    assert.strictEqual(service.isGuarded(recentItem), true,
      'Recents item should be treated as guarded when the canonical ID is in the guard set');
  });

  test('addGuard — fav:-prefixed ID stores canonical ID (not the prefixed form)', async () => {
    service.initialize(makeContext());
    const favItem = makeItem('build', 'fav:canonical-id');
    await service.addGuard(favItem);
    // The canonical ID should be in the set.
    assert.strictEqual(service.isManuallyGuarded('canonical-id'), true, 'canonical ID should be stored');
    // isManuallyGuarded normalizes IDs, so the fav:-prefixed query also resolves to the same entry.
    assert.strictEqual(service.isManuallyGuarded('fav:canonical-id'), true, 'fav:-prefixed lookup normalizes and finds the canonical entry');
    // Only one entry should be stored — not both the raw fav: form and the canonical form.
    assert.strictEqual((service as any)._manualGuardIds.size, 1, 'Only one entry should be stored');
  });

  test('addGuard — adding from fav view and standalone view results in one entry', async () => {
    service.initialize(makeContext());
    const standaloneItem = makeItem('build', 'canonical-id');
    const favItem = makeItem('build', 'fav:canonical-id');
    await service.addGuard(standaloneItem);
    await service.addGuard(favItem); // second add with fav: prefix is a no-op
    assert.strictEqual((service as any)._manualGuardIds.size, 1, 'Only one entry should be stored');
  });

  test('removeGuard — fav:-prefixed ID removes canonical guard', async () => {
    service.initialize(makeContext(['canonical-id']));
    const favItem = makeItem('build', 'fav:canonical-id');
    await service.removeGuard(favItem);
    assert.strictEqual(service.isManuallyGuarded('canonical-id'), false,
      'canonical ID should be removed when removeGuard is called with fav:-prefixed item');
  });

  // ── onDidUpdate from TaskCacheService fires onDidChangeGuards ────────────────

  test('initialize subscribes to TaskCacheService.onDidUpdate and fires onDidChangeGuards', () => {
    const cacheUpdateEmitter = new vscode.EventEmitter<void>();
    const originalCacheInstance = (TaskCacheService as any).instance;
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getAllTasks: () => [],
    };

    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    service.initialize(ctx);

    let guardChangesFired = 0;
    service.onDidChangeGuards(() => { guardChangesFired++; });

    // Simulate cache update (e.g. .workspace-tasks.json saved with confirm: changed)
    cacheUpdateEmitter.fire();

    assert.strictEqual(guardChangesFired, 1,
      'onDidChangeGuards should fire when TaskCacheService.onDidUpdate fires (covers definition-level guard changes)');

    // Clean up
    (TaskCacheService as any).instance = originalCacheInstance;
    cacheUpdateEmitter.dispose();
  });

  test('initialize: multiple cache updates each fire onDidChangeGuards', () => {
    const cacheUpdateEmitter = new vscode.EventEmitter<void>();
    const originalCacheInstance = (TaskCacheService as any).instance;
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getAllTasks: () => [],
    };

    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    service.initialize(ctx);

    let guardChangesFired = 0;
    service.onDidChangeGuards(() => { guardChangesFired++; });

    cacheUpdateEmitter.fire();
    cacheUpdateEmitter.fire();
    cacheUpdateEmitter.fire();

    assert.strictEqual(guardChangesFired, 3, 'each cache update should independently fire onDidChangeGuards');

    (TaskCacheService as any).instance = originalCacheInstance;
    cacheUpdateEmitter.dispose();
  });

  test('cache update populates _definitionGuardIds from items with guardedByDefinition=true', () => {
    const cacheUpdateEmitter = new vscode.EventEmitter<void>();
    const originalCacheInstance = (TaskCacheService as any).instance;
    const guardedItem = makeItem('Great Southern Trendkill', 'pantera:task-id');
    guardedItem.guardedByDefinition = true;
    const ungurdedItem = makeItem('Walk', 'pantera:walk-id');
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getAllTasks: () => [guardedItem, ungurdedItem],
    };

    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    service.initialize(ctx);

    // Before cache update: set is empty
    assert.strictEqual((service as any)._definitionGuardIds.size, 0);

    cacheUpdateEmitter.fire();

    // After cache update: only the guarded item's canonical ID is in the set
    assert.strictEqual((service as any)._definitionGuardIds.has('pantera:task-id'), true,
      'canonical ID of guarded item should be in _definitionGuardIds');
    assert.strictEqual((service as any)._definitionGuardIds.has('pantera:walk-id'), false,
      'unguarded item ID should not be in _definitionGuardIds');
    assert.strictEqual((service as any)._definitionGuardIds.size, 1);

    (TaskCacheService as any).instance = originalCacheInstance;
    cacheUpdateEmitter.dispose();
  });

  test('isGuarded returns true via _definitionGuardIds even when item.guardedByDefinition is not set (stale item ref)', () => {
    // This tests the core bug fix: VS Code may pass a stale item reference to getTreeItem()
    // that was created before the cache rebuild and does not have guardedByDefinition set.
    // isGuarded must still return true because _definitionGuardIds contains the item's ID.
    const cacheUpdateEmitter = new vscode.EventEmitter<void>();
    const originalCacheInstance = (TaskCacheService as any).instance;
    const cachedItem = makeItem('Great Southern Trendkill', 'confirm-task-id');
    cachedItem.guardedByDefinition = true;
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getAllTasks: () => [cachedItem],
    };

    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    service.initialize(ctx);
    cacheUpdateEmitter.fire(); // triggers _rebuildDefinitionGuards

    // Simulate a stale item reference: same ID, but guardedByDefinition is NOT set
    const staleItem = makeItem('Great Southern Trendkill', 'confirm-task-id');
    // staleItem.guardedByDefinition is undefined — as if it was created before the file save

    assert.strictEqual(service.isGuarded(staleItem), true,
      'isGuarded should return true via _definitionGuardIds even when item.guardedByDefinition is not set');

    (TaskCacheService as any).instance = originalCacheInstance;
    cacheUpdateEmitter.dispose();
  });

  test('_definitionGuardIds is cleared when cache updates and no items are guarded by definition', () => {
    const cacheUpdateEmitter = new vscode.EventEmitter<void>();
    const originalCacheInstance = (TaskCacheService as any).instance;
    const guardedItem = makeItem('confirm-task', 'confirm-task-id');
    guardedItem.guardedByDefinition = true;
    let cachedItems: any[] = [guardedItem];
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getAllTasks: () => cachedItems,
    };

    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    service.initialize(ctx);

    // First update: item is guarded
    cacheUpdateEmitter.fire();
    assert.strictEqual((service as any)._definitionGuardIds.has('confirm-task-id'), true);

    // Second update: confirm removed from file, item no longer guarded
    const unguardedItem = makeItem('confirm-task', 'confirm-task-id'); // no guardedByDefinition
    cachedItems = [unguardedItem];
    cacheUpdateEmitter.fire();
    assert.strictEqual((service as any)._definitionGuardIds.has('confirm-task-id'), false,
      '_definitionGuardIds should be cleared when item no longer has guardedByDefinition');
    assert.strictEqual(service.isGuarded(unguardedItem), false,
      'isGuarded should return false after confirm is removed from the task definition');

    (TaskCacheService as any).instance = originalCacheInstance;
    cacheUpdateEmitter.dispose();
  });

  // ── patterns reloaded on config change ────────────────────────────────────

  test('patterns are reloaded when settings change and event fires', async () => {
    const onDidChangeConfigEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
    const ctx = makeContext();
    (ctx.subscriptions as any) = [];
    const origOnDidChange = vscode.workspace.onDidChangeConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = (listener: any) => {
      onDidChangeConfigEmitter.event(listener);
      return { dispose: () => {} };
    };

    try {
      service.initialize(ctx);
      const item = makeItem('deploy');
      assert.strictEqual(service.isGuarded(item), false);

      // Now update the stub to return a pattern and fire the change event
      stubPatterns(['deploy']);
      let guardChangesFired = 0;
      service.onDidChangeGuards(() => { guardChangesFired++; });

      onDidChangeConfigEmitter.fire({
        affectsConfiguration: (section: string) => section === 'workspaceTasks.task.confirmPatterns',
      });

      assert.strictEqual(service.isGuarded(item), true, 'pattern should now match after config reload');
      assert.strictEqual(guardChangesFired, 1, 'onDidChangeGuards should fire once on pattern change');
    } finally {
      (vscode.workspace as any).onDidChangeConfiguration = origOnDidChange;
      onDidChangeConfigEmitter.dispose();
    }
  });
});
