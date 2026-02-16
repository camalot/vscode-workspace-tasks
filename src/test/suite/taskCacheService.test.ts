import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskItem } from '../../taskItem';
import { TaskProvider } from '../../taskProvider';

class MockTaskProvider implements TaskProvider {
    constructor(private tasks: TaskItem[], public type: string) { }
    async getTasks(): Promise<TaskItem[]> {
        return this.tasks;
    }
}

suite('TaskCacheService Test Suite', () => {
    let service: TaskCacheService;
    let mockProvider: MockTaskProvider;
    let mockTasks: TaskItem[] = [];
    let originalGetWorkspaceFolder: any;

    setup(async () => {
        service = TaskCacheService.getInstance();
        // Clear existing providers to have a clean state
        (service as any).providers = [];
        (service as any).fileTaskMap = new Map();
        (service as any).taskMap = new Map();
        (service as any).allTasks = [];
        (service as any).providerTasks = new Map();

        mockTasks = [];
        mockProvider = new MockTaskProvider(mockTasks, 'mockType');
        service.registerProvider(mockProvider);

        originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    });

    teardown(() => {
        vscode.workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
    });

    /**
     * Helper to create a task item with optional properties
     */
    function createTaskItem(label: string, type: string, uri?: vscode.Uri, metadata?: any): TaskItem {
        const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, type, uri);
        if (metadata) {
            item.metadata = metadata;
        }
        return item;
    }

    /**
     * Helper to create a vscode.Task
     */
    function createVsCodeTask(name: string, definition: vscode.TaskDefinition, scope: vscode.WorkspaceFolder | vscode.TaskScope = vscode.TaskScope.Workspace): vscode.Task {
        return new vscode.Task(
            definition,
            scope,
            name,
            'testSource',
            undefined
        );
    }

    test('getTask - Retrieves task by ID', async () => {
        mockTasks.length = 0;
        const item = createTaskItem('T1', 'mockType');
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const tasks = service.getAllTasks();
        assert.ok(tasks.length > 0);
        const id = tasks[0].id!;

        const retrieved = service.getTask(id);
        assert.strictEqual(retrieved, item);

        const retrievedById = service.getTaskById(id);
        assert.strictEqual(retrievedById, item);
    });

    test('refreshProvider - Ignores unknown provider type', async () => {
        // Should not throw and not result in cached tasks
        await service.refreshProvider('unknownType');
        assert.strictEqual(service.getAllTasks().length, 0);
    });

    test('refreshProvider - Handles provider failure by clearing its tasks', async () => {
        const item = createTaskItem('T1', 'mockType');
        mockTasks.push(item);
        await service.refreshProvider('mockType');
        assert.strictEqual(service.getAllTasks().length, 1);

        const failProvider = new MockTaskProvider([], 'mockType');
        failProvider.getTasks = async () => { throw new Error("Unfortunate error"); };

        // This simulates overriding the provider logic or we have to register a new one with same type?
        // Service.providers is array. Logic finds FIRST provider with type.
        // Let's replace the provider in the service.
        (service as any).providers = [failProvider];

        await service.refreshProvider('mockType');
        assert.strictEqual(service.getAllTasks().length, 0, 'Tasks should be cleared on error');
    });

    test('rebuildCache - Sorts by uri if labels match', async () => {
        mockTasks.length = 0;
        const u1 = vscode.Uri.file('/a');
        const u2 = vscode.Uri.file('/b');
        const i1 = createTaskItem('same', 't', u1);
        const i2 = createTaskItem('same', 't', u2);

        // Intentionally push in reverse order
        mockTasks.push(i2, i1);

        await service.refreshProvider('mockType');
        const tasks = service.getAllTasks();

        // Should be sorted by URI since labels are same
        assert.strictEqual(tasks[0].resourceUri?.fsPath, u1.fsPath);
        assert.strictEqual(tasks[1].resourceUri?.fsPath, u2.fsPath);
    });

    test('rebuildCache - Includes workspace name in ID if available', async () => {
        mockTasks.length = 0;
        const wsUri = vscode.Uri.file('/my/workspace');
        const fileUri = vscode.Uri.file('/my/workspace/file.txt');

        vscode.workspace.getWorkspaceFolder = (u: vscode.Uri) => {
            if (u.toString() === fileUri.toString()) {
                return { uri: wsUri, name: 'ws-name', index: 0 };
            }
            return undefined;
        };

        const item = createTaskItem('Test', 't', fileUri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const tasks = service.getAllTasks();
        const id = tasks[0].id!;
        // ID format: ${workspaceName}:${relativePath}:${task.label}
        assert.ok(id.includes('ws-name'), 'ID should contain workspace name');
    });

    test('findMatchingTask - Matches by label', async () => {
        const uri = vscode.Uri.file('/path/to/project/file.ext');
        const item = createTaskItem('Build Project', 'customType', uri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const task = createVsCodeTask('Build Project', { type: 'customType' });

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should find match by label');
        assert.strictEqual(match?.label, 'Build Project');
    });

    test('findMatchingTask - Matches by metadata.systemTaskName', async () => {
        const uri = vscode.Uri.file('/path/to/project/package.json');
        const item = createTaskItem('build', 'npm', uri, { systemTaskName: 'build - project' });
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const task = createVsCodeTask('build - project', { type: 'npm', script: 'build' });

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should find match by systemTaskName');
        assert.strictEqual(match?.label, 'build');
    });

    test('findMatchingTask - Matches by originalLabel (defMatch)', async () => {
        const item = createTaskItem('DisplayName', 't');
        item.originalLabel = 'OriginalName';
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const task = createVsCodeTask('DisplayName', { type: 't', task: 'OriginalName' });
        const match = service.findMatchingTask(task);
        assert.strictEqual(match, item);
    });

    test('findMatchingTask - Filters out mismatching paths', async () => {
        const uri1 = vscode.Uri.file('/path/A/package.json');
        const uri2 = vscode.Uri.file('/path/B/package.json');

        const item1 = createTaskItem('test', 'npm', uri1);
        const item2 = createTaskItem('test', 'npm', uri2);

        mockTasks.push(item1, item2);
        await service.refreshProvider('mockType');

        const task = createVsCodeTask('test', { type: 'npm', script: 'test', path: '/path/B/package.json' });

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should find a match');
        assert.strictEqual(match?.resourceUri?.fsPath, uri2.fsPath);
    });

    test('findMatchingTask - Handles relative paths with scope', async () => {
        // Construct paths
        const rootPath = process.platform === 'win32' ? 'C:\\root\\project' : '/root/project';
        const subFile = path.join(rootPath, 'sub', 'task.json');
        const rootUri = vscode.Uri.file(rootPath);
        const fileUri = vscode.Uri.file(subFile);

        const scopeFolder: vscode.WorkspaceFolder = {
            uri: rootUri,
            name: 'project',
            index: 0
        };

        const item = createTaskItem('deploy', 'custom', fileUri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        // Definition has relative path "sub/task.json"
        const task = createVsCodeTask('deploy', { type: 'custom', path: path.join('sub', 'task.json') }, scopeFolder);

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should match relative path resolved against scope');
        assert.strictEqual(match, item);
    });

    test('findMatchingTask - Skips path check for vscode tasks', async () => {
        const uri = vscode.Uri.file('/path/to/.vscode/tasks.json');
        const item = createTaskItem('Shell Build', 'vscode', uri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const workspaceTask = new vscode.Task(
            { type: 'shell', path: '/others' },
            vscode.TaskScope.Workspace,
            'Shell Build',
            'Workspace',
            undefined
        );

        const match = service.findMatchingTask(workspaceTask);
        assert.ok(match, 'Should match vscode task ignoring path mismatch');
        assert.strictEqual(match?.taskType, 'vscode');
    });

    test('findMatchingTask - Prioritizes workspace-task def type', async () => {
        const item1 = createTaskItem('t', 'other');
        const item2 = createTaskItem('t', 'workspace-task');
        item2.taskSource = 'workspace';
        mockTasks.push(item1, item2);
        await service.refreshProvider('mockType');

        const task = createVsCodeTask('t', { type: 'workspace-task' });
        const match = service.findMatchingTask(task);

        assert.strictEqual(match, item2);
    });

    test('findMatchingTask - Matches by scope folder', async () => {
        const scopeFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/scope'), name: 's', index: 0 };
        const otherFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/other'), name: 'o', index: 1 };

        const itemScoped = createTaskItem('t', 'type', scopeFolder.uri); // item resource is the folder itself usually? or file in it
        const itemOther = createTaskItem('t', 'type', otherFolder.uri);

        mockTasks.push(itemScoped, itemOther);
        await service.refreshProvider('mockType');

        // Task has scope folder /scope
        const task = createVsCodeTask('t', { type: 'type' }, scopeFolder);

        // Since resource matching logic in `findMatchingTask` uses checking if itemUri matches scope?
        // Wait, logic 4): if (taskScopeFolder) ... candidates.find(item => ... itemScope === taskScopeFolder)
        // We need to make sure item uri matches.

        // Mock getWorkspaceFolder to return the scope folder for itemScoped
        vscode.workspace.getWorkspaceFolder = (u: vscode.Uri) => {
            if (u.toString() === scopeFolder.uri.toString()) return scopeFolder;
            if (u.toString() === otherFolder.uri.toString()) return otherFolder;
            return undefined;
        };

        const match = service.findMatchingTask(task);
        assert.strictEqual(match, itemScoped);
    });

    test('refresh - Handles multiple providers and errors gracefully', async () => {
        mockTasks.length = 0;
        const item1 = createTaskItem('Task 1', 'type1');
        mockTasks.push(item1);

        const failingProvider = new MockTaskProvider([], 'type2');
        failingProvider.getTasks = async () => { throw new Error('Refresh error'); };
        service.registerProvider(failingProvider);

        let updateEventFired = false;
        const subscription = service.onDidUpdate(() => { updateEventFired = true; });

        await service.refresh();

        assert.ok(updateEventFired, 'onDidUpdate should have fired');
        const tasks = service.getAllTasks();
        assert.strictEqual(tasks.length, 1, 'Should have tasks from successful provider');
        assert.strictEqual(tasks[0].label, 'Task 1');

        subscription.dispose();
    });

    test('rebuildCache - Generates unique IDs for duplicates', async () => {
        mockTasks.length = 0;
        const uri = vscode.Uri.file('/path/to/project');
        const item1 = createTaskItem('Task', 'type', uri);
        const item2 = createTaskItem('Task', 'type', uri);
        mockTasks.push(item1, item2);

        await service.refreshProvider('mockType');

        const tasks = service.getAllTasks();
        assert.strictEqual(tasks.length, 2);
        assert.notStrictEqual(tasks[0].id, tasks[1].id, 'IDs should be unique');
    });

    test('rebuildCache - Processes children recursively', async () => {
        mockTasks.length = 0;
        const parent = createTaskItem('Parent', 'type');
        const child = createTaskItem('Child', 'type', vscode.Uri.file('/path/child'));
        parent.children = [child];
        mockTasks.push(parent);

        await service.refreshProvider('mockType');

        const roots = service.getAllTasks();
        assert.strictEqual(roots.length, 1);
        assert.strictEqual(roots[0].label, 'Parent');

        assert.ok(child.id, 'Child should have an ID assigned');
        const retrievedChild = service.getTask(child.id!);
        assert.strictEqual(retrievedChild, child);
    });

    test('getTasksForFile - Case insensitive search on Windows logic', async () => {
        const originalPath = process.platform === 'win32' ? 'c:\\Path\\To\\File.txt' : '/Path/To/File.txt';
        const searchPath = process.platform === 'win32' ? 'c:\\path\\to\\file.txt' : '/path/to/file.txt';

        mockTasks.length = 0;
        const item = createTaskItem('Task', 'type', vscode.Uri.file(originalPath));
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        const tasks = service.getTasksForFile(vscode.Uri.file(searchPath));
        assert.strictEqual(tasks.length, 1);
        assert.strictEqual(tasks[0], item);
    });

    test('getTasksForFile - Returns empty if not found', () => {
        const tasks = service.getTasksForFile(vscode.Uri.file('/non/existent'));
        assert.strictEqual(tasks.length, 0);
    });

    test('getProviders - Returns registered providers', () => {
        const providers = service.getProviders();
        assert.ok(providers.length >= 1);
        assert.ok(providers.includes(mockProvider));
    });

    test('initialize - Sets context', () => {
        const context = { subscriptions: [] } as any;
        const result = service.initialize(context);
        assert.strictEqual(result, service);
    });

});
