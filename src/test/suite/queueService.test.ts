import * as assert from 'assert';
import * as vscode from 'vscode';
import { QueueService } from '../../services/queueService';
import { TaskItem } from '../../taskItem';

suite('QueueService Test Suite', () => {
  let queueService: QueueService;
  let mockContext: vscode.ExtensionContext;
  let mockGlobalState: Map<string, any>;

  setup(() => {
    // Reset singleton instance to ensure fresh state for each test
    (QueueService as any).instance = undefined;
    queueService = QueueService.getInstance();

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
    const instance1 = QueueService.getInstance();
    const instance2 = QueueService.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  test('initialize restores queues from storage (legacy array format migrates to sequential)', () => {
    const savedQueues = {
      'TestQueue': [{
        id: 'external:/path/to/script.sh:Label',
        label: 'Label',
        taskType: 'shell',
        resourceUri: 'file:///path/to/script.sh',
        startLine: 10,
        originalLabel: 'Label'
      }]
    };
    mockGlobalState.set('savedQueues', savedQueues);

    queueService.initialize(mockContext);

    const tasks = queueService.getQueue('TestQueue');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'Label');
    // Legacy format should default to sequential
    assert.strictEqual(queueService.getQueueExecutionType('TestQueue'), 'sequential');
  });

  test('initialize restores queues from new SerializedQueue format', () => {
    const savedQueues = {
      'ParallelQueue': {
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
    mockGlobalState.set('savedQueues', savedQueues);

    queueService.initialize(mockContext);

    const tasks = queueService.getQueue('ParallelQueue');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(queueService.getQueueExecutionType('ParallelQueue'), 'parallel');
  });

  test('initialize migrates legacy queue', () => {
    const legacyQueue = [{
      id: 'oldId',
      label: 'LegacyTask',
      taskType: 'shell'
    }];
    mockGlobalState.set('queueItems', legacyQueue);
    mockGlobalState.set('queueName', 'LegacyQueue');

    queueService.initialize(mockContext);

    const tasks = queueService.getQueue('LegacyQueue');
    assert.ok(tasks);
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'LegacyTask');
    // Legacy migration should default to sequential
    assert.strictEqual(queueService.getQueueExecutionType('LegacyQueue'), 'sequential');

    // Verify it saved effectively to new storage
    const saved = mockGlobalState.get('savedQueues');
    assert.ok(saved);
    assert.ok(saved['LegacyQueue']);
  });

  test('createQueue adds a new queue with default sequential type', () => {
    queueService.initialize(mockContext);
    queueService.createQueue('NewQueue');

    const queue = queueService.getQueue('NewQueue');
    assert.ok(queue);
    assert.strictEqual(queue?.length, 0);
    assert.strictEqual(queueService.getQueueExecutionType('NewQueue'), 'sequential');
  });

  test('createQueue adds a new queue with parallel type', () => {
    queueService.initialize(mockContext);
    queueService.createQueue('ParQueue', 'parallel');
    assert.strictEqual(queueService.getQueueExecutionType('ParQueue'), 'parallel');
  });

  test('createQueue does not overwrite existing queue', () => {
     queueService.initialize(mockContext);
     queueService.createQueue('Existing');
     const item = new TaskItem('Task', vscode.TreeItemCollapsibleState.None, 'type');
     queueService.addToQueue(item, 'Existing');

     queueService.createQueue('Existing');
     assert.strictEqual(queueService.getQueue('Existing')?.length, 1);
  });

  test('addToQueue adds item to queue', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    // We need to ensure getTaskId returns something consistent.
    // TaskStateManager logic depends on uri. If no uri, it uses label.
    // If we want to test with duplicate prevention, we rely on TaskStateManager.

    queueService.addToQueue(item, 'MyQueue');

    const queue = queueService.getQueue('MyQueue');
    assert.ok(queue);
    assert.strictEqual(queue!.length, 1);
    assert.strictEqual(queue![0].label, 'Task1');
  });

  test('addToQueue avoids duplicates', () => {
    queueService.initialize(mockContext);
    const item1 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item1, 'MyQueue');

    // Create another item that should result in same ID
    const item2 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item2, 'MyQueue');

    const queue = queueService.getQueue('MyQueue');
    assert.strictEqual(queue!.length, 1);
  });

  test('removeFromQueue removes item from specific queue', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'MyQueue');

    queueService.removeFromQueue(item, 'MyQueue');
    const queue = queueService.getQueue('MyQueue');
    // If empty, queue is deleted
    assert.strictEqual(queue, undefined);
  });

  test('removeFromQueue removes item from all queues if queueName not provided', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'Q1');
    queueService.addToQueue(item, 'Q2');

    queueService.removeFromQueue(item);

    assert.strictEqual(queueService.getQueue('Q1'), undefined);
    assert.strictEqual(queueService.getQueue('Q2'), undefined);
  });

  test('clearQueue removes the queue', () => {
    queueService.initialize(mockContext);
    queueService.createQueue('Q1');
    queueService.clearQueue('Q1');
    assert.strictEqual(queueService.getQueue('Q1'), undefined);
  });

  test('renameQueue renames the queue', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'OldName');

    queueService.renameQueue('OldName', 'NewName');
    assert.strictEqual(queueService.getQueue('OldName'), undefined);
    const newQueue = queueService.getQueue('NewName');
    assert.ok(newQueue);
    assert.strictEqual(newQueue!.length, 1);
  });

  test('renameQueue preserves execution type', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'OldName');
    queueService.setQueueExecutionType('OldName', 'parallel');

    queueService.renameQueue('OldName', 'NewName');
    assert.strictEqual(queueService.getQueueExecutionType('NewName'), 'parallel');
    assert.strictEqual(queueService.getQueueExecutionType('OldName'), 'sequential'); // default fallback
  });

  test('getQueueExecutionType returns sequential by default', () => {
    queueService.initialize(mockContext);
    queueService.createQueue('Q');
    assert.strictEqual(queueService.getQueueExecutionType('Q'), 'sequential');
  });

  test('getQueueExecutionType returns sequential for unknown queue', () => {
    queueService.initialize(mockContext);
    assert.strictEqual(queueService.getQueueExecutionType('NonExistent'), 'sequential');
  });

  test('setQueueExecutionType changes type and persists', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'Q');
    queueService.setQueueExecutionType('Q', 'parallel');

    assert.strictEqual(queueService.getQueueExecutionType('Q'), 'parallel');

    const saved = mockGlobalState.get('savedQueues');
    assert.ok(saved);
    assert.strictEqual(saved['Q'].executionType, 'parallel');
  });

  test('setQueueExecutionType can toggle back to sequential', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'Q');
    queueService.setQueueExecutionType('Q', 'parallel');
    queueService.setQueueExecutionType('Q', 'sequential');

    assert.strictEqual(queueService.getQueueExecutionType('Q'), 'sequential');
  });

  test('clearQueue removes execution type', () => {
    queueService.initialize(mockContext);
    const item = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    queueService.addToQueue(item, 'Q');
    queueService.setQueueExecutionType('Q', 'parallel');
    queueService.clearQueue('Q');

    // After clear, execution type falls back to default
    assert.strictEqual(queueService.getQueueExecutionType('Q'), 'sequential');
  });

  test('moveQueueItem reorders items', () => {
    queueService.initialize(mockContext);
    const item1 = new TaskItem('Task1', vscode.TreeItemCollapsibleState.None, 'type');
    const item2 = new TaskItem('Task2', vscode.TreeItemCollapsibleState.None, 'type');
    const item3 = new TaskItem('Task3', vscode.TreeItemCollapsibleState.None, 'type');

    queueService.addToQueue(item1, 'Q');
    queueService.addToQueue(item2, 'Q');
    queueService.addToQueue(item3, 'Q');

    // Current order: 1, 2, 3
    // Move 2 to be before 1 -> [2, 1, 3]

    // Simulating items coming from the tree view which might be different instances but same ID
    // We need to pass items that resolve to the same IDs.

    queueService.moveQueueItem(item2, item1);

    const queue = queueService.getQueue('Q')!;
    assert.strictEqual(queue[0].label, 'Task2');
    assert.strictEqual(queue[1].label, 'Task1');
    assert.strictEqual(queue[2].label, 'Task3');

    // Move 3 to top (target 2) -> [3, 2, 1]

    const item1ref = queue[1]; // Task1
    const item2ref = queue[0]; // Task2
    const item3ref = queue[2]; // Task3

    queueService.moveQueueItem(item3, item2ref);
     const queue2 = queueService.getQueue('Q')!;
     assert.strictEqual(queue2[0].label, 'Task3');
     assert.strictEqual(queue2[1].label, 'Task2');
     assert.strictEqual(queue2[2].label, 'Task1');
  });

  test('getQueueNames returns keys', () => {
     queueService.initialize(mockContext);
     queueService.createQueue('A');
     queueService.createQueue('B');
     const names = queueService.getQueueNames();
     assert.ok(names.includes('A'));
     assert.ok(names.includes('B'));
  });

  test('initialize handles ID migration in stored data', () => {
    // This tests the logic: if (JSON.stringify(originalIds) !== JSON.stringify(newIds)) { hasMigration = true; }
    // We need an ID that produces a different ID when normalized.
    // TaskStateManager.getInstance().normalizeTaskId() might change "queue:..." or handle old format.
    // Let's create an item with an ID that will likely change explicitly or implicity.
    // Or we can mock TaskStateManager if we want to be sure, but we can't easily.
    // However, if we store a legacy ID, it should be migrated.

    const oldFormatId = 'workspace|file:///test|Label';
    // TaskStateManager logic: if it contains |, it tries to migrate.

    const savedQueues = {
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
    mockGlobalState.set('savedQueues', savedQueues);

    queueService.initialize(mockContext);

    const tasks = queueService.getQueue('MigrateQ');
    assert.ok(tasks);
    // The ID should have changed from oldFormatId
    assert.notStrictEqual(tasks![0].id, oldFormatId);

    // And it should have triggered a save
    const saved = mockGlobalState.get('savedQueues');
    assert.strictEqual(saved['MigrateQ'].items[0].id, tasks![0].id);
  });

  // -------------------------------------------------------------------------
  // Running queue state: markQueueRunning / markQueueStopped / isQueueRunning / cancelQueue
  // -------------------------------------------------------------------------

  test('isQueueRunning returns false for unknown queue', () => {
    queueService.initialize(mockContext);
    assert.strictEqual(queueService.isQueueRunning('NoSuchQueue'), false);
  });

  test('markQueueRunning marks queue as running and returns a token', () => {
    queueService.initialize(mockContext);
    const token = queueService.markQueueRunning('Q1');
    assert.ok(token, 'token should be defined');
    assert.strictEqual(token.cancelled, false);
    assert.strictEqual(queueService.isQueueRunning('Q1'), true);
  });

  test('markQueueStopped marks queue as not running', () => {
    queueService.initialize(mockContext);
    queueService.markQueueRunning('Q1');
    queueService.markQueueStopped('Q1');
    assert.strictEqual(queueService.isQueueRunning('Q1'), false);
  });

  test('markQueueStopped is a no-op for non-running queue', () => {
    queueService.initialize(mockContext);
    // Should not throw
    queueService.markQueueStopped('NotRunning');
    assert.strictEqual(queueService.isQueueRunning('NotRunning'), false);
  });

  test('cancelQueue sets token.cancelled to true', () => {
    queueService.initialize(mockContext);
    const token = queueService.markQueueRunning('Q1');
    queueService.cancelQueue('Q1');
    assert.strictEqual(token.cancelled, true);
    assert.strictEqual(queueService.isQueueRunning('Q1'), false);
  });

  test('cancelQueue is a no-op when queue is not running', () => {
    queueService.initialize(mockContext);
    // Should not throw
    queueService.cancelQueue('NotRunning');
    assert.strictEqual(queueService.isQueueRunning('NotRunning'), false);
  });

  test('onQueueStateChanged fires when queue starts running', () => {
    queueService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    queueService.onQueueStateChanged((e) => events.push(e));

    queueService.markQueueRunning('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, true);
  });

  test('onQueueStateChanged fires when queue stops normally', () => {
    queueService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    queueService.markQueueRunning('Q1');
    queueService.onQueueStateChanged((e) => events.push(e));

    queueService.markQueueStopped('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, false);
  });

  test('onQueueStateChanged fires when queue is cancelled', () => {
    queueService.initialize(mockContext);
    const events: { name: string; running: boolean }[] = [];
    queueService.markQueueRunning('Q1');
    queueService.onQueueStateChanged((e) => events.push(e));

    queueService.cancelQueue('Q1');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, 'Q1');
    assert.strictEqual(events[0].running, false);
  });
});
