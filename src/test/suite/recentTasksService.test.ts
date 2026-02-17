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

    // Helper to reset singleton
    const resetSingleton = () => {
        (RecentTasksService as any).instance = undefined;
    };

    setup(() => {
        resetSingleton();
        mockWorkspaceState = new Map();
        onDidChangeConfiguration = new vscode.EventEmitter();
        onDidStartTask = new vscode.EventEmitter();

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

        // Mock vscode.workspace.onDidChangeConfiguration
        // We can't easily mock vscode.* directly if we are running in the extension host environment primarily.
        // However, RecentTasksService attaches listeners in initialize.
        // If we want to unit test logic without relying on VS Code firing events,
        // we might invoke the handlers directly via (service as any).handleTaskStart(...)
        // But for coverage, we want to exercise the paths.

        // We can stub external dependencies: TaskCacheService and TaskStateManager
    });

    teardown(() => {
        resetSingleton();
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

    test('invalid maxRecentTasks config defaults to 20', async () => {
        const config = vscode.workspace.getConfiguration('workspaceTasks');
        // Clear value to force default behavior (if package.json doesn't specify it, it's undefined)
        await config.update('recentTasks.maxItems', undefined, vscode.ConfigurationTarget.Global);

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
             // Add 25 tasks
             for(let i=0; i<25; i++) {
                  recentTasksService.addRecentTask(`task${i}`);
             }

             // Should be capped at 20
             assert.strictEqual(recentTasksService.getRecentTasks().length, 20);

             // Now update to something valid (10)
             await config.update('recentTasks.maxItems', 10, vscode.ConfigurationTarget.Global);
             await new Promise(resolve => setTimeout(resolve, 200));
             assert.strictEqual(recentTasksService.getRecentTasks().length, 10);

             // Now update to undefined (should revert to 20)
             // But valid tasks count is 10. We can add more to check limit.
             await config.update('recentTasks.maxItems', undefined, vscode.ConfigurationTarget.Global);
             await new Promise(resolve => setTimeout(resolve, 200));

             for(let i=100; i<125; i++) {
                  recentTasksService.addRecentTask(`task${i}`);
             }
             assert.strictEqual(recentTasksService.getRecentTasks().length, 20);

             // Test no change (same value)
             await config.update('recentTasks.maxItems', undefined, vscode.ConfigurationTarget.Global);
             await new Promise(resolve => setTimeout(resolve, 200));

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

    test('Configuration change updates maxRecentTasks', async () => {
        const config = vscode.workspace.getConfiguration('workspaceTasks');
        const originalMaxItems = config.get('recentTasks.maxItems');

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
            recentTasksService = RecentTasksService.getInstance();
            recentTasksService.initialize(mockContext);

            // Add 3 tasks
            recentTasksService.addRecentTask('task1');
            recentTasksService.addRecentTask('task2');
            recentTasksService.addRecentTask('task3');

            assert.strictEqual(recentTasksService.getRecentTasks().length, 3);

            // Update configuration to 2
            await config.update('recentTasks.maxItems', 2, vscode.ConfigurationTarget.Global);

            // Wait for event listener to process
            // We can wait a small amount of time or poll
            await new Promise(resolve => setTimeout(resolve, 500));

            // Should be trimmed to 2
            const tasks = recentTasksService.getRecentTasks();
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].id, 'task3');
            assert.strictEqual(tasks[1].id, 'task2'); // task1 should be removed (oldest)

        } finally {
            // Restore config
            await config.update('recentTasks.maxItems', originalMaxItems, vscode.ConfigurationTarget.Global);

            // Restore mocks
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
                    const item = new TaskItem(id, vscode.TreeItemCollapsibleState.None, 'test', vscode.Uri.file('/test'));
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
