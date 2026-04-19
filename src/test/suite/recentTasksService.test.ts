import * as assert from 'assert';
import * as vscode from 'vscode';
import { RecentTasksService, RecentTaskEntry } from '../../services/recentTasksService';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskItem } from '../../taskItem';

suite('RecentTasksService Test Suite', () => {
    let recentTasksService: RecentTasksService;
    let mockContext: vscode.ExtensionContext;
    let mockWorkspaceState: Map<string, any>;
    let onDidChangeConfiguration: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;
    let onDidStartTask: vscode.EventEmitter<vscode.TaskStartEvent>;
    let executeCommandStub: any;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let originalOnDidChangeConfiguration: typeof vscode.workspace.onDidChangeConfiguration;
    let mockConfigValues: Record<string, unknown>;
    let capturedConfigChangeHandlers: Array<(e: vscode.ConfigurationChangeEvent) => void>;

    // Helper to reset singleton
    const resetSingleton = () => {
        (RecentTasksService as any).instance = undefined;
    };

    // Fire a fake onDidChangeConfiguration event for the given fully-qualified section key
    const fireConfigChange = (section: string) => {
        const event: vscode.ConfigurationChangeEvent = {
            affectsConfiguration: (cfg: string) => cfg === section || section.startsWith(cfg + '.'),
        };
        capturedConfigChangeHandlers.forEach((h) => h(event));
    };

    setup(() => {
        resetSingleton();
        mockWorkspaceState = new Map();
        onDidChangeConfiguration = new vscode.EventEmitter();
        onDidStartTask = new vscode.EventEmitter();
        mockConfigValues = {};
        capturedConfigChangeHandlers = [];

        mockContext = {
            subscriptions: [],
            workspaceState: {
                get: (key: string, defaultValue?: any) => mockWorkspaceState.get(key) ?? defaultValue,
                update: (key: string, value: any) => {
                    mockWorkspaceState.set(key, value);
                    return Promise.resolve();
                },
                keys: () => [],
            },
        } as unknown as vscode.ExtensionContext;

        // Mock vscode.workspace.getConfiguration so tests return known values
        // without writing to real VS Code settings.
        originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceTasks') {
                return {
                    get: <T>(key: string, defaultValue?: T): T =>
                        (Object.prototype.hasOwnProperty.call(mockConfigValues, key)
                            ? mockConfigValues[key]
                            : defaultValue) as T,
                };
            }
            return originalGetConfiguration(section);
        };

        // Mock vscode.workspace.onDidChangeConfiguration to capture handlers so
        // tests can fire config-change events synchronously without touching real settings.
        originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
        (vscode.workspace as any).onDidChangeConfiguration = (
            listener: (e: vscode.ConfigurationChangeEvent) => void,
        ) => {
            capturedConfigChangeHandlers.push(listener);
            return { dispose: () => {} };
        };
    });

    teardown(() => {
        resetSingleton();
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
        (vscode.workspace as any).onDidChangeConfiguration = originalOnDidChangeConfiguration;
        mockContext.subscriptions.forEach(sub => sub.dispose());
        onDidChangeConfiguration.dispose();
        onDidStartTask.dispose();
    });

    test('initialize loads recent tasks from storage', () => {
        const storedTasks: RecentTaskEntry[] = [
            { taskId: 'task1', timestamp: 1000 },
            { taskId: 'task2', timestamp: 2000 }
        ];
        mockWorkspaceState.set('workspaceTasks.recentTasks', storedTasks);

        // Mock TaskStateManager.getInstance().normalizeTaskId to return same ID
        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        const stateManagerMock = stateManager as any;
        stateManagerMock.normalizeTaskId = (id: string) => id;

        try {
            recentTasksService = RecentTasksService.getInstance();
            recentTasksService.initialize(mockContext);

            // We can't access private recentTasks directly easily, but we can verify via public methods
            // if we stub TaskCacheService to return valid items for these IDs.

            // Stub TaskCacheService
            const cacheService = TaskCacheService.getInstance();
            const originalGetTaskById = cacheService.getTaskById;

            (cacheService as any).getTaskById = (id: string) => {
                const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
                item.id = id;
                return item;
            };

            const tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].label, 'task1');
            assert.strictEqual(tasks[1].label, 'task2');

            // Restore
            (cacheService as any).getTaskById = originalGetTaskById;
        } finally {
            stateManagerMock.normalizeTaskId = originalNormalize;
        }
    });

    test('addRecentTask adds a new task', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
             const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
             item.id = id;
             return item;
        };

        try {
            recentTasksService.addRecentTask('task1');
            let tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].id, 'task1');

            recentTasksService.addRecentTask('task2');
            tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].id, 'task2'); // Most recent first, based on implementation unshift
            assert.strictEqual(tasks[1].id, 'task1');
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('addRecentTask deduplicates IDs with numeric suffixes', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
             const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
             item.id = id;
             return item;
        };

        try {
            recentTasksService.addRecentTask('taskA|1');
            recentTasksService.addRecentTask('taskA|2');

            const tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].id, 'taskA');
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('addRecentTask respects maxRecentTasks limit', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        // Manually set max items via private property or ensure config is default
        (recentTasksService as any).maxRecentTasks = 2;

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
            const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = id;
             return item;
        };

        try {
            recentTasksService.addRecentTask('task1');
            recentTasksService.addRecentTask('task2');
            recentTasksService.addRecentTask('task3');

            const tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].id, 'task3');
            assert.strictEqual(tasks[1].id, 'task2');
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('remove removes a task', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
            const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = id;
             return item;
        };

        try {
             recentTasksService.addRecentTask('task1');
             recentTasksService.addRecentTask('task2');

             let tasks = recentTasksService.getRecentTasks();
             assert.strictEqual(tasks.length, 2);

             const taskToRemove = new TaskItem('task1', vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
             taskToRemove.id = 'task1';
             recentTasksService.remove(taskToRemove);

             tasks = recentTasksService.getRecentTasks();
             assert.strictEqual(tasks.length, 1);
             assert.strictEqual(tasks[0].id, 'task2');
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('remove with invalid item does nothing', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        // Ensure no error is thrown
        recentTasksService.remove(undefined as any);
        recentTasksService.remove({} as any);
    });

    test('invalid maxRecentTasks config defaults to 20', () => {
        // Default: no maxItems configured — service should cap at 20
        delete mockConfigValues['recentTasks.maxItems'];

        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        // Mock dependencies
        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
             const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
             item.id = id;
             return item;
        };

        try {
             // Add 25 tasks — should be capped at default 20
             for(let i=0; i<25; i++) {
                  recentTasksService.addRecentTask(`task${i}`);
             }
             assert.strictEqual(recentTasksService.getRecentTasks().length, 20);

             // Simulate config update to 10 by setting mock value and firing the event
             mockConfigValues['recentTasks.maxItems'] = 10;
             fireConfigChange('workspaceTasks.recentTasks.maxItems');
             assert.strictEqual(recentTasksService.getRecentTasks().length, 10);

             // Simulate removing config (revert to default 20)
             delete mockConfigValues['recentTasks.maxItems'];
             fireConfigChange('workspaceTasks.recentTasks.maxItems');

             for(let i=100; i<125; i++) {
                  recentTasksService.addRecentTask(`task${i}`);
             }
             assert.strictEqual(recentTasksService.getRecentTasks().length, 20);

             // No-op: fire event when value hasn't changed
             fireConfigChange('workspaceTasks.recentTasks.maxItems');

        } finally {
             (stateManager as any).normalizeTaskId = originalNormalize;
             (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('clear removes all tasks', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
            const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = id;
             return item;
        };

        try {
            recentTasksService.addRecentTask('task1');
            assert.strictEqual(recentTasksService.getRecentTasks().length, 1);

            recentTasksService.clear();
            assert.strictEqual(recentTasksService.getRecentTasks().length, 0);
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('Migration logic in initialize', () => {
        // Prepare stored tasks with old IDs (simulate by mocking normalizeTaskId to change them)
        const storedTasks: RecentTaskEntry[] = [
            { taskId: 'oldId', timestamp: 1000 }
        ];
        mockWorkspaceState.set('workspaceTasks.recentTasks', storedTasks);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        // Mock normalize to change the ID
        (stateManager as any).normalizeTaskId = (id: string) => id === 'oldId' ? 'newId' : id;

        try {
            recentTasksService = RecentTasksService.getInstance();
            recentTasksService.initialize(mockContext);

            // Verify that the stored task now has 'newId'
            const savedTasks = mockWorkspaceState.get('workspaceTasks.recentTasks') as RecentTaskEntry[];
            assert.strictEqual(savedTasks[0].taskId, 'newId');
        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
        }
    });

    test('Configuration change updates maxRecentTasks', () => {
        // Start with no configured maxItems — defaults to 20
        delete mockConfigValues['recentTasks.maxItems'];

        // Mock dependencies
        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
                const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test');
                item.id = id;
                return item;
        };

        try {
            recentTasksService = RecentTasksService.getInstance();
            recentTasksService.initialize(mockContext);

            // Add 3 tasks
            recentTasksService.addRecentTask('task1');
            recentTasksService.addRecentTask('task2');
            recentTasksService.addRecentTask('task3');

            assert.strictEqual(recentTasksService.getRecentTasks().length, 3);

            // Simulate config change to maxItems = 2 and fire the event synchronously
            mockConfigValues['recentTasks.maxItems'] = 2;
            fireConfigChange('workspaceTasks.recentTasks.maxItems');

            // Should be trimmed to 2 immediately (no async wait required)
            const tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].id, 'task3');
            assert.strictEqual(tasks[1].id, 'task2'); // task1 should be removed (oldest)

        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('handleTaskStart adds task', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        const stateManager = TaskStateManager.getInstance();
        const originalNormalize = stateManager.normalizeTaskId;
        (stateManager as any).normalizeTaskId = (id: string) => id;

        const cacheService = TaskCacheService.getInstance();
        const originalFindMatchingTask = (cacheService as any).findMatchingTask;
        (cacheService as any).findMatchingTask = (_task: vscode.Task) => {
            const item = new TaskItem('task1', vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = 'task1';
            return item;
        };

        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
            if (id === 'task1') {
                    const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test');
                    item.id = id;
                    return item;
            }
            return undefined;
        };

        try {
            // Invoke private handleTaskStart
            const mockTask = { name: 'task1', source: 'test' } as vscode.Task;
            const mockExecution = { task: mockTask } as vscode.TaskExecution;

            (recentTasksService as any).handleTaskStart({ execution: mockExecution });

            const tasks = recentTasksService.getRecentTasks();

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].id, 'task1');

        } finally {
            (stateManager as any).normalizeTaskId = originalNormalize;
            (cacheService as any).findMatchingTask = originalFindMatchingTask;
            (cacheService as any).getTaskById = originalGetTaskById;
        }
    });

    test('maxRecentTasks = 0 disables tracking', () => {
        recentTasksService = RecentTasksService.getInstance();
        recentTasksService.initialize(mockContext);

        (recentTasksService as any).maxRecentTasks = 0;

        const cacheService = TaskCacheService.getInstance();
        const originalFindMatchingTask = (cacheService as any).findMatchingTask;
        (cacheService as any).findMatchingTask = (_task: vscode.Task) => {
            const item = new TaskItem('task1', vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = 'task1';
            return item;
        };

        const originalGetTaskById = cacheService.getTaskById;
        (cacheService as any).getTaskById = (id: string) => {
            const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
            item.id = id;
            return item;
        };

         try {
             // Try via addRecentTask
             recentTasksService.addRecentTask('task1');
             assert.strictEqual(recentTasksService.getRecentTasks().length, 0);

             // Try via handleTaskStart
             const mockTask = { name: 'task1', source: 'test' } as vscode.Task;
             const mockExecution = { task: mockTask } as vscode.TaskExecution;
            (recentTasksService as any).handleTaskStart({ execution: mockExecution });
             assert.strictEqual(recentTasksService.getRecentTasks().length, 0);

         } finally {
             (cacheService as any).findMatchingTask = originalFindMatchingTask;
             (cacheService as any).getTaskById = originalGetTaskById;
         }
    });
});
