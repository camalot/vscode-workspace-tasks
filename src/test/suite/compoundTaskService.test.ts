import * as assert from 'assert';
import * as vscode from 'vscode';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { FavoritesService } from '../../services/favoritesService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskItem } from '../../taskItem';

suite('CompoundTaskService Test Suite', () => {
  let compoundTaskService: CompoundTaskService;
  let mockContext: vscode.ExtensionContext;
  let mockGlobalState: Map<string, any>;

  setup(() => {
    // Reset singleton instance to ensure fresh state for each test
    (CompoundTaskService as any).instance = undefined;
    compoundTaskService = CompoundTaskService.getInstance();

    mockGlobalState = new Map();

    // Mock ExtensionContext and workspaceState
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: (key: string, defaultValue?: any) => mockGlobalState.get(key) ?? defaultValue,
        update: (key: string, value: any) => {
          if (value === undefined) {
            mockGlobalState.delete(key);
          } else {
            mockGlobalState.set(key, value);
          }
          return Promise.resolve();
        },
        keys: () => Array.from(mockGlobalState.keys())
      },
      globalState: {
        get: (key: string, defaultValue?: any) => mockGlobalState.get(key) ?? defaultValue,
        update: (key: string, value: any) => {
          if (value === undefined) {
            mockGlobalState.delete(key);
          } else {
            mockGlobalState.set(key, value);
          }
          return Promise.resolve();
        },
        keys: () => Array.from(mockGlobalState.keys()),
        setKeysForSync: () => { }
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
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
      }
    } as unknown as vscode.ExtensionContext;
  });

  test('getInstance returns singleton', () => {
    const instance1 = CompoundTaskService.getInstance();
    const instance2 = CompoundTaskService.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  test('initialize restores compound tasks from storage (legacy array format migrates to sequential)', () => {
    const savedCompoundTasks = {
      'TestCompoundTask': [{
        id: 'external:/path/to/script.sh:Label',
        label: 'Label',
        taskType: 'shell',
        resourceUri: 'file:///path/to/script.sh',
        startLine: 10,
        originalLabel: 'Label'
      }]
    };
    mockGlobalState.set('savedQueues', savedCompoundTasks);

    compoundTaskService.initialize(mockContext);

    const tasks = compoundTaskService.getCompoundTask('TestCompoundTask');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'Label');
    // Legacy format should default to sequential
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('TestCompoundTask'), 'sequential');
  });

  test('initialize restores compound tasks from new SerializedCompoundTask format', () => {
    const savedCompoundTasks = {
      'ParallelCompoundTask': {
        executionType: 'parallel',
        items: [{
          id: 'external:/path/to/script.sh:Label',
          label: 'Label',
          taskType: 'shell',
          resourceUri: 'file:///path/to/script.sh',
          startLine: 10,
          originalLabel: 'Label'
        }]
      }
    };
    mockGlobalState.set('savedQueues', savedCompoundTasks);

    compoundTaskService.initialize(mockContext);

    const tasks = compoundTaskService.getCompoundTask('ParallelCompoundTask');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('ParallelCompoundTask'), 'parallel');
  });

  test('initialize migrates legacy compound task', () => {
    const legacyCompoundTask = [{
      id: 'oldId',
      label: 'LegacyTask',
      taskType: 'shell'
    }];
    mockGlobalState.set('queueItems', legacyCompoundTask);
    mockGlobalState.set('queueName', 'LegacyCompoundTask');

    compoundTaskService.initialize(mockContext);

    const tasks = compoundTaskService.getCompoundTask('LegacyCompoundTask');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'LegacyTask');
    // Legacy migration should default to sequential
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('LegacyCompoundTask'), 'sequential');

    // Verify it saved effectively to new storage
    const saved = mockGlobalState.get('savedQueues');
    assert.ok(saved);
    assert.ok(saved['LegacyCompoundTask']);
  });

  test('createQueue adds a new queue with default sequential type', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('NewCompoundTask');

    const compoundTask = compoundTaskService.getCompoundTask('NewCompoundTask');
    assert.ok(compoundTask);
    assert.strictEqual(compoundTask?.length, 0);
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('NewCompoundTask'), 'sequential');
  });

  test('createCompoundTask adds a new compound task with parallel type', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('ParCompoundTask', 'parallel');
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('ParCompoundTask'), 'parallel');
  });

  test('createCompoundTask does not overwrite existing compound task', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('Existing');
    const item = new TaskItem('Task', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'Existing');

    compoundTaskService.createCompoundTask('Existing');
    assert.strictEqual(compoundTaskService.getCompoundTask('Existing')?.length, 1);
  });

  test('createCompoundTask uses configured defaultExecutionType when no type provided', () => {
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = () => ({
      get: <T>(key: string, defaultValue?: T) =>
        key === 'compoundTasks.defaultExecutionType' ? ('parallel' as unknown as T) : defaultValue as T,
    });
    try {
      compoundTaskService.initialize(mockContext);
      compoundTaskService.createCompoundTask('ConfiguredCompoundTask');
      assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('ConfiguredCompoundTask'), 'parallel');
    } finally {
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    }
  });

  test('addToCompoundTask uses configured defaultExecutionType when creating a new compound task', () => {
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = () => ({
      get: <T>(key: string, defaultValue?: T) =>
        key === 'compoundTasks.defaultExecutionType' ? ('parallel' as unknown as T) : defaultValue as T,
    });
    try {
      compoundTaskService.initialize(mockContext);
      const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
      compoundTaskService.addToCompoundTask(item, 'NewViaAdd');
      assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('NewViaAdd'), 'parallel');
    } finally {
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    }
  });

  test('addToCompoundTask adds item to compound task', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    // We need to ensure getTaskId returns something consistent.
    // TaskStateManager logic depends on uri. If no uri, it uses label.
    // If we want to test with duplicate prevention, we rely on TaskStateManager.

    compoundTaskService.addToCompoundTask(item, 'MyCompoundTask');

    const compoundTask = compoundTaskService.getCompoundTask('MyCompoundTask');
    assert.ok(compoundTask);
    assert.strictEqual(compoundTask!.length, 1);
    assert.strictEqual(compoundTask![0].label, 'Task1');
  });

  test('addToCompoundTask avoids duplicates', () => {
    compoundTaskService.initialize(mockContext);
    const item1 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item1, 'MyCompoundTask');

    // Create another item that should result in same ID
    const item2 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item2, 'MyCompoundTask');

    const compoundTask = compoundTaskService.getCompoundTask('MyCompoundTask');
    assert.strictEqual(compoundTask!.length, 1);
  });

  test('removeFromCompoundTask removes item from specific compound task', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'MyCompoundTask');

    compoundTaskService.removeFromCompoundTask(item, 'MyCompoundTask');
    const compoundTask = compoundTaskService.getCompoundTask('MyCompoundTask');
    // If empty, compound task is deleted
    assert.strictEqual(compoundTask, undefined);
  });

  test('removeFromCompoundTask removes item from all compound tasks if compoundTaskName not provided', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'Q1');
    compoundTaskService.addToCompoundTask(item, 'Q2');

    compoundTaskService.removeFromCompoundTask(item);

    assert.strictEqual(compoundTaskService.getCompoundTask('Q1'), undefined);
    assert.strictEqual(compoundTaskService.getCompoundTask('Q2'), undefined);
  });

  test('clearCompoundTask removes the compound task', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('Q1');
    compoundTaskService.clearCompoundTask('Q1');
    assert.strictEqual(compoundTaskService.getCompoundTask('Q1'), undefined);
  });

  test('renameCompoundTask renames the compound task', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'OldName');

    compoundTaskService.renameCompoundTask('OldName', 'NewName');
    assert.strictEqual(compoundTaskService.getCompoundTask('OldName'), undefined);
    const newCompoundTask = compoundTaskService.getCompoundTask('NewName');
    assert.ok(newCompoundTask);
    assert.strictEqual(newCompoundTask!.length, 1);
  });

  test('renameCompoundTask updates favorites when the compound task was favorited', () => {
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    const fakeTaskStateManager = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (taskItem: TaskItem) => taskItem.label,
      getTaskId: (taskItem: TaskItem) => taskItem.id || taskItem.label,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeTaskStateManager;

    const favService = FavoritesService.getInstance();
    favService.initialize(mockContext);

    // Simulate the compound task group being favorited with its tree ID
    const oldId = `${(require('../../libs/constants').default as any).COMPOUND_TASK_ID_PREFIX}:OldName`;
    const newId = `${(require('../../libs/constants').default as any).COMPOUND_TASK_ID_PREFIX}:NewName`;
    favService.updateFavoriteId('placeholder', oldId); // seed old id directly
    (favService as any).favorites.add(oldId);
    (favService as any).favorites.delete('placeholder');

    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'OldName');

    compoundTaskService.renameCompoundTask('OldName', 'NewName');

    assert.strictEqual(favService.isFavorite(oldId), false, 'old favorite id should be removed');
    assert.strictEqual(favService.isFavorite(newId), true, 'new favorite id should be present');

    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  });

  test('renameCompoundTask does not affect favorites when compound task was not favorited', () => {
    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    const fakeTaskStateManager = {
      normalizeTaskIds: (ids: string[]) => ids || [],
      normalizeTaskId: (id: string) => id,
      generatePortableTaskId: (taskItem: TaskItem) => taskItem.label,
      getTaskId: (taskItem: TaskItem) => taskItem.id || taskItem.label,
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeTaskStateManager;

    const favService = FavoritesService.getInstance();
    favService.initialize(mockContext);

    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'OldName');

    // No favorites set — rename should succeed without error
    compoundTaskService.renameCompoundTask('OldName', 'NewName');

    const newId = `${(require('../../libs/constants').default as any).COMPOUND_TASK_ID_PREFIX}:NewName`;
    assert.strictEqual(favService.isFavorite(newId), false, 'new id should not appear in favorites');

    (FavoritesService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  });

  test('renameCompoundTask preserves execution type', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'OldName');
    compoundTaskService.setCompoundTaskExecutionType('OldName', 'parallel');

    compoundTaskService.renameCompoundTask('OldName', 'NewName');
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('NewName'), 'parallel');
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('OldName'), 'sequential'); // default fallback
  });

  test('getCompoundTaskExecutionType returns sequential by default', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('Q');
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('Q'), 'sequential');
  });

  test('getCompoundTaskExecutionType returns sequential for unknown compound task', () => {
    compoundTaskService.initialize(mockContext);
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('NonExistent'), 'sequential');
  });

  test('setCompoundTaskExecutionType changes type and persists', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'Q');
    compoundTaskService.setCompoundTaskExecutionType('Q', 'parallel');

    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('Q'), 'parallel');

    const saved = mockGlobalState.get('savedQueues');
    assert.ok(saved);
    assert.strictEqual(saved['Q'].executionType, 'parallel');
  });

  test('setCompoundTaskExecutionType can toggle back to sequential', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'Q');
    compoundTaskService.setCompoundTaskExecutionType('Q', 'parallel');
    compoundTaskService.setCompoundTaskExecutionType('Q', 'sequential');

    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('Q'), 'sequential');
  });

  test('clearCompoundTask removes execution type', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    compoundTaskService.addToCompoundTask(item, 'Q');
    compoundTaskService.setCompoundTaskExecutionType('Q', 'parallel');
    compoundTaskService.clearCompoundTask('Q');

    // After clear, execution type falls back to default
    assert.strictEqual(compoundTaskService.getCompoundTaskExecutionType('Q'), 'sequential');
  });

  test('moveQueueItem reorders items', () => {
    compoundTaskService.initialize(mockContext);
    const item1 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    const item2 = new TaskItem('Task2', vscode.TreeItemCollapsibleState.None, 'type');
    const item3 = new TaskItem('Task3', vscode.TreeItemCollapsibleState.None, 'type');

    compoundTaskService.addToCompoundTask(item1, 'Q');
    compoundTaskService.addToCompoundTask(item2, 'Q');
    compoundTaskService.addToCompoundTask(item3, 'Q');

    // Current order: 1, 2, 3
    // Move 2 to be before 1 -> [2, 1, 3]

    // Simulating items coming from the tree view which might be different instances but same ID
    // We need to pass items that resolve to the same IDs.

    compoundTaskService.moveCompoundTaskItem(item2, item1);

    const compoundTask = compoundTaskService.getCompoundTask('Q')!;
    assert.strictEqual(compoundTask[0].label, 'Task2');
    assert.strictEqual(compoundTask[1].label, 'Task1');
    assert.strictEqual(compoundTask[2].label, 'Task3');

    // Move 3 to top (target 2) -> [3, 2, 1]

    const item1ref = compoundTask[1]; // Task1
    const item2ref = compoundTask[0]; // Task2
    const item3ref = compoundTask[2]; // Task3

    compoundTaskService.moveCompoundTaskItem(item3, item2ref);
    const compoundTask2 = compoundTaskService.getCompoundTask('Q')!;
    assert.strictEqual(compoundTask2[0].label, 'Task3');
    assert.strictEqual(compoundTask2[1].label, 'Task2');
    assert.strictEqual(compoundTask2[2].label, 'Task1');
  });

  test('getCompoundTaskNames returns keys', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.createCompoundTask('A');
    compoundTaskService.createCompoundTask('B');
    const names = compoundTaskService.getCompoundTaskNames();
    assert.ok(names.includes('A'));
    assert.ok(names.includes('B'));
  });

  test('initialize handles ID migration in stored data', () => {
    // This tests the logic: if (JSON.stringify(originalIds) !== JSON.stringify(newIds)) { hasMigration = true; }
    // We need an ID that produces a different ID when normalized.
    // TaskStateManager.getInstance().normalizeTaskId() might change "queue:..." or handle old format.
    // Let's create an item with an ID that will likely change explicitly or implicitly.
    // Or we can mock TaskStateManager if we want to be sure, but we can't easily.
    // However, if we store a legacy ID, it should be migrated.

    const oldFormatId = 'workspace|file:///test|Label';
    // TaskStateManager logic: if it contains |, it tries to migrate.

    const savedCompoundTasks = {
      'MigrateQ': {
        executionType: 'sequential',
        items: [{
          id: oldFormatId,
          label: 'Label',
          taskType: 'type',
          resourceUri: 'file:///test',
          originalLabel: 'Label'
        }]
      }
    };
    mockGlobalState.set('savedQueues', savedCompoundTasks);

    compoundTaskService.initialize(mockContext);

    const tasks = compoundTaskService.getCompoundTask('MigrateQ');
    assert.ok(tasks);
    // The ID should have changed from oldFormatId
    assert.notStrictEqual(tasks![0].id, oldFormatId);

    // And it should have triggered a save
    const saved = mockGlobalState.get('savedQueues');
    assert.strictEqual(saved['MigrateQ'].items[0].id, tasks![0].id);
  });

  // -------------------------------------------------------------------------
  // Running compound task state: markCompoundTaskRunning / markCompoundTaskStopped / isCompoundTaskRunning / cancelCompoundTask
  // -------------------------------------------------------------------------

  test('isCompoundTaskRunning returns false for unknown compound task', () => {
    compoundTaskService.initialize(mockContext);
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('NoSuchCompoundTask'), false);
  });

  test('markCompoundTaskRunning marks compound task as running and returns a token', () => {
    compoundTaskService.initialize(mockContext);
    const token = compoundTaskService.markCompoundTaskRunning('Q1');
    assert.ok(token, 'token should be defined');
    assert.strictEqual(token.cancelled, false);
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('Q1'), true);
  });

  test('markCompoundTaskStopped marks compound task as not running', () => {
    compoundTaskService.initialize(mockContext);
    compoundTaskService.markCompoundTaskRunning('Q1');
    compoundTaskService.markCompoundTaskStopped('Q1');
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('Q1'), false);
  });

  test('markCompoundTaskStopped is a no-op for non-running compound task', () => {
    compoundTaskService.initialize(mockContext);
    // Should not throw
    compoundTaskService.markCompoundTaskStopped('NotRunning');
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('NotRunning'), false);
  });

  test('cancelCompoundTask sets token.cancelled to true', () => {
    compoundTaskService.initialize(mockContext);
    const token = compoundTaskService.markCompoundTaskRunning('Q1');
    compoundTaskService.cancelCompoundTask('Q1');
    assert.strictEqual(token.cancelled, true);
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('Q1'), false);
  });

  test('cancelCompoundTask is a no-op when compound task is not running', () => {
    compoundTaskService.initialize(mockContext);
    // Should not throw
    compoundTaskService.cancelCompoundTask('NotRunning');
    assert.strictEqual(compoundTaskService.isCompoundTaskRunning('NotRunning'), false);
  });

  test('onCompoundTaskStateChanged fires when compound task starts running', () => {
    compoundTaskService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    compoundTaskService.onCompoundTaskStateChanged((e) => events.push(e));

    compoundTaskService.markCompoundTaskRunning('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, true);
  });

  test('onCompoundTaskStateChanged fires when compound task stops normally', () => {
    compoundTaskService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    compoundTaskService.markCompoundTaskRunning('Q1');
    compoundTaskService.onCompoundTaskStateChanged((e) => events.push(e));

    compoundTaskService.markCompoundTaskStopped('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, false);
  });

  test('onCompoundTaskStateChanged fires when compound task is cancelled', () => {
    compoundTaskService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    compoundTaskService.markCompoundTaskRunning('Q1');
    compoundTaskService.onCompoundTaskStateChanged((e) => events.push(e));

    compoundTaskService.cancelCompoundTask('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, false);
  });

  // -------------------------------------------------------------------------
  // getAllCompoundTasksRaw
  // -------------------------------------------------------------------------

  test('getAllCompoundTasksRaw returns all compound tasks without workspace filtering', () => {
    compoundTaskService.initialize(mockContext);

    // Add a task with a URI that is NOT in any workspace folder (so getAllCompoundTasks would filter it out)
    const item = new TaskItem('GhostTask', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/workspace/file.sh'));
    compoundTaskService.addToCompoundTask(item, 'GhostCompound');

    const raw = compoundTaskService.getAllCompoundTasksRaw();
    assert.ok(raw.has('GhostCompound'), 'raw map should include ghost compound task');
    assert.strictEqual(raw.get('GhostCompound')?.length, 1);
  });

  test('getAllCompoundTasksRaw returns a copy of the internal map', () => {
    compoundTaskService.initialize(mockContext);

    const raw1 = compoundTaskService.getAllCompoundTasksRaw();
    const raw2 = compoundTaskService.getAllCompoundTasksRaw();

    // Should be different Map instances (copies)
    assert.notStrictEqual(raw1, raw2);
  });

  // -------------------------------------------------------------------------
  // purgeInvalidCompoundTasks
  // -------------------------------------------------------------------------

  test('purgeInvalidCompoundTasks returns empty array when all compound tasks are valid', () => {
    compoundTaskService.initialize(mockContext);

    // A task without a URI is always considered valid
    const item = new TaskItem('ValidTask', vscode.TreeItemCollapsibleState.None, 'shell');
    compoundTaskService.addToCompoundTask(item, 'ValidCompound');

    const purged = compoundTaskService.purgeInvalidCompoundTasks();
    assert.deepStrictEqual(purged, []);
    assert.ok(compoundTaskService.getCompoundTask('ValidCompound'), 'valid compound task should remain');
  });

  test('purgeInvalidCompoundTasks removes compound tasks with no valid workspace items', () => {
    compoundTaskService.initialize(mockContext);

    // Items with URIs outside any workspace folder will not be valid
    const item = new TaskItem('GhostTask', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/workspace/file.sh'));
    compoundTaskService.addToCompoundTask(item, 'GhostCompound');

    const purged = compoundTaskService.purgeInvalidCompoundTasks();
    assert.ok(purged.includes('GhostCompound'), 'ghost compound task should be purged');
    assert.strictEqual(compoundTaskService.getCompoundTask('GhostCompound'), undefined, 'should be removed from internal map');
  });

  test('purgeInvalidCompoundTasks preserves compound tasks that have at least one valid item', () => {
    compoundTaskService.initialize(mockContext);

    // Item without URI is always valid
    const validItem = new TaskItem('ValidTask', vscode.TreeItemCollapsibleState.None, 'shell');
    // Item with external URI (invalid)
    const invalidItem = new TaskItem('ExternalTask', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/workspace/external.sh'));
    compoundTaskService.addToCompoundTask(validItem, 'MixedCompound');
    compoundTaskService.addToCompoundTask(invalidItem, 'MixedCompound');

    const purged = compoundTaskService.purgeInvalidCompoundTasks();
    assert.ok(!purged.includes('MixedCompound'), 'compound task with at least one valid item should be kept');
    assert.ok(compoundTaskService.getCompoundTask('MixedCompound'), 'mixed compound task should remain');
  });

  test('purgeInvalidCompoundTasks persists the removal to storage', () => {
    compoundTaskService.initialize(mockContext);

    const item = new TaskItem('GhostTask', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/workspace/file.sh'));
    compoundTaskService.addToCompoundTask(item, 'GhostCompound');

    compoundTaskService.purgeInvalidCompoundTasks();

    const saved = mockGlobalState.get('savedQueues');
    assert.ok(!saved || !saved['GhostCompound'], 'ghost compound task should be removed from persistent storage');
  });

  test('purgeInvalidCompoundTasks returns names of purged compound tasks', () => {
    compoundTaskService.initialize(mockContext);

    const itemA = new TaskItem('GhostA', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/a.sh'));
    const itemB = new TaskItem('GhostB', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/b.sh'));
    compoundTaskService.addToCompoundTask(itemA, 'GhostCompoundA');
    compoundTaskService.addToCompoundTask(itemB, 'GhostCompoundB');

    const purged = compoundTaskService.purgeInvalidCompoundTasks();
    assert.ok(purged.includes('GhostCompoundA'));
    assert.ok(purged.includes('GhostCompoundB'));
    assert.strictEqual(purged.length, 2);
  });

  // -------------------------------------------------------------------------
  // isItemDefinitelyNotRunnable
  // -------------------------------------------------------------------------

  test('isItemDefinitelyNotRunnable returns false for items with a known taskType', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'npm');
    assert.strictEqual(compoundTaskService.isItemDefinitelyNotRunnable(item), false);
  });

  test('isItemDefinitelyNotRunnable returns false for shell taskType', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Run', vscode.TreeItemCollapsibleState.None, 'shell');
    assert.strictEqual(compoundTaskService.isItemDefinitelyNotRunnable(item), false);
  });

  test('isItemDefinitelyNotRunnable returns true for items with an unrecognized taskType', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Queue', vscode.TreeItemCollapsibleState.None, 'queue');
    assert.strictEqual(compoundTaskService.isItemDefinitelyNotRunnable(item), true);
  });

  test('isItemDefinitelyNotRunnable returns true for items with an empty taskType and no taskSource', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Legacy', vscode.TreeItemCollapsibleState.None, '');
    assert.strictEqual(compoundTaskService.isItemDefinitelyNotRunnable(item), true);
  });

  test('isItemDefinitelyNotRunnable returns false when taskSource is set (workspace task resolver)', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('WorkspaceTask', vscode.TreeItemCollapsibleState.None, 'unknown-type');
    (item as any).taskSource = 'Workspace';
    assert.strictEqual(compoundTaskService.isItemDefinitelyNotRunnable(item), false);
  });

  // -------------------------------------------------------------------------
  // getInvalidItemsByCompoundTask
  // -------------------------------------------------------------------------

  test('getInvalidItemsByCompoundTask returns empty map when all items are in workspace or have no URI', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('ValidTask', vscode.TreeItemCollapsibleState.None, 'npm');
    compoundTaskService.addToCompoundTask(item, 'ValidCompound');

    const result = compoundTaskService.getInvalidItemsByCompoundTask();
    assert.strictEqual(result.size, 0);
  });

  test('getInvalidItemsByCompoundTask returns items with URIs outside the workspace', () => {
    compoundTaskService.initialize(mockContext);
    const externalItem = new TaskItem('ExternalTask', vscode.TreeItemCollapsibleState.None, 'shell', vscode.Uri.file('/outside/workspace/file.sh'));
    compoundTaskService.addToCompoundTask(externalItem, 'MyCompound');

    const result = compoundTaskService.getInvalidItemsByCompoundTask();
    assert.ok(result.has('MyCompound'));
    assert.strictEqual(result.get('MyCompound')?.length, 1);
    assert.strictEqual(result.get('MyCompound')?.[0].label, 'ExternalTask');
  });

  test('getInvalidItemsByCompoundTask does not include items without a URI', () => {
    compoundTaskService.initialize(mockContext);
    // No-URI item is always valid (workspace-independent)
    const noUriItem = new TaskItem('GlobalTask', vscode.TreeItemCollapsibleState.None, 'shell');
    compoundTaskService.addToCompoundTask(noUriItem, 'MyCompound');

    const result = compoundTaskService.getInvalidItemsByCompoundTask();
    assert.strictEqual(result.size, 0);
  });

  // -------------------------------------------------------------------------
  // purgeUnrunnableItems
  // -------------------------------------------------------------------------

  test('purgeUnrunnableItems returns empty map when all items have known taskTypes', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'npm');
    compoundTaskService.addToCompoundTask(item, 'MyCompound');

    const result = compoundTaskService.purgeUnrunnableItems();
    assert.strictEqual(result.size, 0);
    assert.strictEqual(compoundTaskService.getCompoundTask('MyCompound')?.length, 1, 'valid item should remain');
  });

  test('purgeUnrunnableItems removes items with unrecognized taskType', () => {
    compoundTaskService.initialize(mockContext);
    const badItem = new TaskItem('Queue', vscode.TreeItemCollapsibleState.None, 'queue');
    const goodItem = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'npm');
    compoundTaskService.addToCompoundTask(badItem, 'MyCompound');
    compoundTaskService.addToCompoundTask(goodItem, 'MyCompound');

    const result = compoundTaskService.purgeUnrunnableItems();
    assert.ok(result.has('MyCompound'), 'compound task should appear in result');
    assert.ok(result.get('MyCompound')?.includes('Queue'), 'Queue item label should be in removed list');
    assert.strictEqual(compoundTaskService.getCompoundTask('MyCompound')?.length, 1, 'only the good item should remain');
    assert.strictEqual(compoundTaskService.getCompoundTask('MyCompound')?.[0].label, 'Build');
  });

  test('purgeUnrunnableItems deletes compound task when all its items are unrunnable', () => {
    compoundTaskService.initialize(mockContext);
    const badItem = new TaskItem('Queue', vscode.TreeItemCollapsibleState.None, 'queue');
    compoundTaskService.addToCompoundTask(badItem, 'GhostCompound');

    const result = compoundTaskService.purgeUnrunnableItems();
    assert.ok(result.has('GhostCompound'));
    assert.strictEqual(compoundTaskService.getCompoundTask('GhostCompound'), undefined, 'compound task should be deleted after all items removed');
  });

  test('purgeUnrunnableItems persists removal to storage', () => {
    compoundTaskService.initialize(mockContext);
    const badItem = new TaskItem('LegacyTask', vscode.TreeItemCollapsibleState.None, 'old-type');
    compoundTaskService.addToCompoundTask(badItem, 'LegacyCompound');

    compoundTaskService.purgeUnrunnableItems();

    const saved = mockGlobalState.get('savedQueues');
    assert.ok(!saved || !saved['LegacyCompound'], 'empty compound task should be removed from persistent storage');
  });

  test('purgeUnrunnableItems does not remove items that have a taskSource even with unknown taskType', () => {
    compoundTaskService.initialize(mockContext);
    const item = new TaskItem('WorkspaceResolvable', vscode.TreeItemCollapsibleState.None, 'custom-type');
    (item as any).taskSource = 'Workspace';
    compoundTaskService.addToCompoundTask(item, 'MyCompound');

    const result = compoundTaskService.purgeUnrunnableItems();
    assert.strictEqual(result.size, 0, 'item with taskSource should not be removed');
    assert.strictEqual(compoundTaskService.getCompoundTask('MyCompound')?.length, 1, 'item should remain');
  });
});
