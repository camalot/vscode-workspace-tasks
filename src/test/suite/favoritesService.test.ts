import * as assert from 'assert';
import * as vscode from 'vscode';
import { FavoritesService } from '../../services/favoritesService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskItem } from '../../taskItem';

suite('FavoritesService Test Suite', () => {
  let ctx: vscode.ExtensionContext;
  let updates: Array<{ key: string; value: any }>;

  setup(() => {
    // reset singletons
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    updates = [];
    // simple fake globalState and workspaceState
    const fakeState = {
      get: (_key: string, defaultValue?: any) => defaultValue,
      update: async (key: string, value: any) => {
        updates.push({ key, value });
        return Promise.resolve();
      },
    };

    ctx = {
      globalState: fakeState,
      workspaceState: fakeState,
    } as unknown as vscode.ExtensionContext;
  });

  teardown(() => {
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  });

  test('initialize with empty storage results in no favorites', () => {
    // fake TaskStateManager that simply echoes ids
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (item: TaskItem) => item.label,
      getTaskId: (item: TaskItem) => item.label,
    } as unknown as TaskStateManager;

    (TaskStateManager as any).instance = fakeState;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    assert.strictEqual(svc.isFavorite('anything'), false);
  });

  test('initialize migrates old ids and persists migrated list', async () => {
    const saved = ['old:format:id'];
    const fakeStateValue = {
      get: (_k: string, _d?: any) => saved,
      update: async (key: string, value: any) => {
        updates.push({ key, value });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const fakeState = {
      normalizeTaskIds: (_ids: string[]) => ['migrated-id'],
      normalizeTaskId: (id: string) => (id === 'raw' ? 'migrated-id' : id),
      generatePortableTaskId: (item: TaskItem) => item.label,
      getTaskId: (item: TaskItem) => item.label,
    } as unknown as TaskStateManager;

    (TaskStateManager as any).instance = fakeState;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    // should have persisted migrated list because it's different from saved
    assert.strictEqual(updates.length, 1, 'should call globalState.update for migration');
    assert.deepStrictEqual(updates[0].value, ['migrated-id']);

    // and isFavorite should reflect migrated id
    assert.strictEqual(svc.isFavorite('migrated-id'), true);
  });

  test('isFavorite works for TaskItem and string (uses TaskStateManager)', () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id.replace(/^pref:/, ''),
      generatePortableTaskId: (item: TaskItem) => `p:${item.label}`,
      getTaskId: (item: TaskItem) => `p:${item.label}`,
    } as unknown as TaskStateManager;

    (TaskStateManager as any).instance = fakeState;

    // pre-populate storage via initialize
    const fakeStateValue = {
      get: (_k: string, _d?: any) => ['p:MyTask'],
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    const item = new TaskItem('MyTask', vscode.TreeItemCollapsibleState.None, 'type');

    assert.strictEqual(svc.isFavorite(item), true, 'TaskItem should be recognized as favorite');
    assert.strictEqual(svc.isFavorite('pref:p:MyTask'), true, 'String id should be normalized and found');
  });

  test('addToFavorites saves generated id to storage', async () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (item: TaskItem) => `fav:${item.label}`,
      getTaskId: (item: TaskItem) => `fav:${item.label}`,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeState;

    // start with empty stored favorites
    const fakeStateValue = {
      get: (_k: string, d?: any) => d,
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    const item = new TaskItem('DoThing', vscode.TreeItemCollapsibleState.None, 'type');
    svc.addToFavorites(item);

    // expect save called once with the new favorite
    assert.strictEqual(updates.length, 1);
    assert.deepStrictEqual(updates[0].value, ['fav:DoThing']);
    assert.strictEqual(svc.isFavorite(item), true);
  });

  test('removeFromFavorites removes id and persists', async () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (item: TaskItem) => `r:${item.label}`,
      getTaskId: (item: TaskItem) => `r:${item.label}`,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeState;

    // start with one favorite stored
    const fakeStateValue = {
      get: (_k: string, _d?: any) => ['r:RemoveMe'],
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    const item = new TaskItem('RemoveMe', vscode.TreeItemCollapsibleState.None, 'type');
    svc.removeFromFavorites(item);

    assert.strictEqual(updates.length, 1);
    assert.deepStrictEqual(updates[0].value, []);
    assert.strictEqual(svc.isFavorite(item), false);
  });

  test('addToFavorites does nothing when generatePortableTaskId returns falsy', () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (_item: TaskItem) => '' as any,
      getTaskId: (_item: TaskItem) => '' as any,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeState;

    const fakeStateValue = {
      get: (_k: string, d?: any) => d,
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      workspaceState: fakeStateValue,
      globalState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    const item = new TaskItem('NoId', vscode.TreeItemCollapsibleState.None, 'type');
    svc.addToFavorites(item);

    assert.strictEqual(updates.length, 0, 'should not persist when no portable id');
    assert.strictEqual(svc.isFavorite(item), false);
  });

  test('updateFavoriteId renames the stored favorite id', async () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (item: TaskItem) => item.label,
      getTaskId: (item: TaskItem) => item.label,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeState;

    const fakeStateValue = {
      get: (_k: string, _d?: any) => ['undefined:OldName'],
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    assert.strictEqual(svc.isFavorite('undefined:OldName'), true, 'old id should be present before rename');

    svc.updateFavoriteId('undefined:OldName', 'undefined:NewName');

    assert.strictEqual(svc.isFavorite('undefined:OldName'), false, 'old id should be removed after rename');
    assert.strictEqual(svc.isFavorite('undefined:NewName'), true, 'new id should be present after rename');
    assert.strictEqual(updates.length, 1, 'should persist after update');
    assert.deepStrictEqual(updates[0].value, ['undefined:NewName']);
  });

  test('updateFavoriteId is a no-op when old id is not in favorites', () => {
    const fakeState = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (item: TaskItem) => item.label,
      getTaskId: (item: TaskItem) => item.label,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeState;

    const fakeStateValue = {
      get: (_k: string, d?: any) => d,
      update: async (k: string, v: any) => {
        updates.push({ key: k, value: v });
        return Promise.resolve();
      },
    };
    ctx = {
      globalState: fakeStateValue,
      workspaceState: fakeStateValue,
    } as unknown as vscode.ExtensionContext;

    const svc = FavoritesService.getInstance();
    svc.initialize(ctx);

    svc.updateFavoriteId('undefined:NonExistent', 'undefined:NewName');

    assert.strictEqual(svc.isFavorite('undefined:NewName'), false, 'new id should not be added');
    assert.strictEqual(updates.length, 0, 'should not persist when old id was not in favorites');
  });
});
