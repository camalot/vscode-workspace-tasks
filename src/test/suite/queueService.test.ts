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

    // Mock ExtensionContext and globalState
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve(),
        keys: () => []
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

  test('initialize restores queues from storage', () => {
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

    const queues = queueService.getAllQueues();
    assert.ok(queues.has('TestQueue'));
    const tasks = queues.get('TestQueue');
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'Label');
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

    const queues = queueService.getAllQueues();
    assert.ok(queues.has('LegacyQueue'));
    const tasks = queues.get('LegacyQueue');
    assert.strictEqual(tasks?.length, 1);
    assert.strictEqual(tasks![0].label, 'LegacyTask');

    // Verify it saved effectively to new storage
    const saved = mockGlobalState.get('savedQueues');
    assert.ok(saved);
    assert.ok(saved['LegacyQueue']);
  });

  test('createQueue adds a new queue', () => {
    queueService.initialize(mockContext);
    queueService.createQueue('NewQueue');

    const queues = queueService.getAllQueues();
    assert.ok(queues.has('NewQueue'));
    assert.strictEqual(queues.get('NewQueue')?.length, 0);
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
      'MigrateQ': [{
         id: oldFormatId,
         label: 'Label',
         taskType: 'type',
         resourceUri: 'file:///test',
         originalLabel: 'Label'
      }]
    };
    mockGlobalState.set('savedQueues', savedQueues);

    queueService.initialize(mockContext);

    const queues = queueService.getAllQueues();
    const tasks = queues.get('MigrateQ');
    assert.ok(tasks);
    // The ID should have changed from oldFormatId
    assert.notStrictEqual(tasks![0].id, oldFormatId);

    // And it should have triggered a save
     const saved = mockGlobalState.get('savedQueues');
     assert.strictEqual(saved['MigrateQ'][0].id, tasks![0].id);
  });
});
