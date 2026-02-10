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

    setup(async () => {
        service = TaskCacheService.getInstance();
        // Clear existing providers to have a clean state
        (service as any).providers = [];
        mockTasks = [];
        mockProvider = new MockTaskProvider(mockTasks, 'mockType');
        service.registerProvider(mockProvider);
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

        // Task name mimics what VS Code might present ("script - folder")
        const task = createVsCodeTask('build - project', { type: 'npm', script: 'build' });

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should find match by systemTaskName');
        assert.strictEqual(match?.label, 'build');
    });

    test('findMatchingTask - Filters out mismatching paths', async () => {
        const uri1 = vscode.Uri.file('/path/A/package.json');
        const uri2 = vscode.Uri.file('/path/B/package.json');

        const item1 = createTaskItem('test', 'npm', uri1);
        const item2 = createTaskItem('test', 'npm', uri2);

        mockTasks.push(item1, item2);
        await service.refreshProvider('mockType');

        // Task definition points to path B
        const task = createVsCodeTask('test', { type: 'npm', script: 'test', path: '/path/B/package.json' });

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should find a match');
        // Should match item2 because paths match
        assert.strictEqual(match?.resourceUri?.fsPath, uri2.fsPath);
    });

    test('findMatchingTask - Handles relative paths with scope', async () => {
        const rootPath = path.join(path.sep, 'root', 'project');
        const scopeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(rootPath),
            name: 'project',
            index: 0
        };

        const fileUri = vscode.Uri.file(path.join(rootPath, 'sub', 'task.json'));
        const item = createTaskItem('deploy', 'custom', fileUri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        // Definition has relative path "sub/task.json"
        const task = createVsCodeTask('deploy', { type: 'custom', path: 'sub/task.json' }, scopeFolder);

        const match = service.findMatchingTask(task);
        assert.ok(match, 'Should match relative path resolved against scope');
        assert.strictEqual(match?.resourceUri?.fsPath, fileUri.fsPath);
    });

    test('findMatchingTask - Skips path check for vscode tasks', async () => {
        const uri = vscode.Uri.file('/path/to/.vscode/tasks.json');
        // Simulate a vscode task (e.g. from tasks.json).
        // Note: The caching service usually stores these with taskType='vscode'
        const item = createTaskItem('Shell Build', 'vscode', uri);
        mockTasks.push(item);
        await service.refreshProvider('mockType');

        // Definition might have a path property that refers to a CWD or script location,
        // which definitely WON'T match tasks.json path.
        const task = createVsCodeTask('Shell Build', { type: 'shell', path: '/some/other/location' });
        // We need to ensure the item.taskType is 'vscode' for the skip logic to trigger.
        // And the candidate needs to be selected.

        // Wait, findMatchingTask candidates logic:
        // item.label === task.name ("Shell Build" === "Shell Build") -> Match
        // Path check: if (defPath && item.taskType !== 'vscode') -> skipped if item.taskType IS 'vscode'
        // So it should remain a candidate.

        // Then priority logic:
        // 3) Visual Studio Code declared tasks: if (taskSource === 'Workspace') -> return vs item.
        // We set task source to 'testSource' in helper. Let's make it 'Workspace'
        const workspaceTask = new vscode.Task(
            { type: 'shell', path: '/others' },
            vscode.TaskScope.Workspace,
            'Shell Build',
            'Workspace', // Source
            undefined
        );

        const match = service.findMatchingTask(workspaceTask);
        assert.ok(match, 'Should match vscode task ignoring path mismatch');
        assert.strictEqual(match?.taskType, 'vscode');
    });

    test('findMatchingTask - Prioritizes exact type match', async () => {
        const uri = vscode.Uri.file('/path/common');
        const item1 = createTaskItem('mytask', 'typeA', uri);
        const item2 = createTaskItem('mytask', 'typeB', uri);
        mockTasks.push(item1, item2);
        await service.refreshProvider('mockType');

        // Task name matches both, but definition type is 'typeB'
        const task = createVsCodeTask('mytask', { type: 'typeB' });

        const match = service.findMatchingTask(task);
        assert.strictEqual(match?.taskType, 'typeB');
    });
});
