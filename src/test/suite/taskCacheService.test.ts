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
    getFilePatterns(): string[] {
        return [];
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
        const originalAsRelativePath = vscode.workspace.asRelativePath;
        try {
            vscode.workspace.asRelativePath = () => {
                return 'file.txt';
            };

            const item = createTaskItem('Test', 't', fileUri);
            mockTasks.push(item);
            await service.refreshProvider('mockType');

            const tasks = service.getAllTasks();

            const id = tasks[0].id!;
            // ID format: ${workspaceName}:${relativePath}:${task.label}
            assert.ok(id.includes('ws-name'), 'ID should contain workspace name');
        } finally {
            vscode.workspace.asRelativePath = originalAsRelativePath;
        }
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

    test('findMatchingTask - Disambiguates by definition.path absence for root-level task', async () => {
        // Reproduce the scenario: two npm tasks with the same label in different package.json
        // files relative to the same workspace folder (e.g. /ws/package.json and
        // /ws/nodejs/package.json). VS Code's npm provider omits `path` for the root-level
        // task and includes it for subdirectory tasks.  When the root task fires
        // onDidStartTask (no `path` in definition), findMatchingTask must return the ROOT
        // item and NOT mark the nodejs item as running.
        const wsFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };
        const rootPkgUri    = vscode.Uri.file('/ws/package.json');
        const nodejsPkgUri  = vscode.Uri.file('/ws/nodejs/package.json');

        const rootNpmItem = createTaskItem('long-running', 'npm', rootPkgUri);
        rootNpmItem.taskFileUri = rootPkgUri;

        const nodejsNpmItem = createTaskItem('long-running', 'npm', nodejsPkgUri);
        nodejsNpmItem.taskFileUri = nodejsPkgUri;

        // nodejs/package.json sorts alphabetically before package.json — push in that order
        // to confirm step 1.5 does NOT simply pick the first entry.
        mockTasks.push(nodejsNpmItem, rootNpmItem);
        await service.refreshProvider('mockType');

        vscode.workspace.getWorkspaceFolder = (u: vscode.Uri) => {
            if (u.fsPath.startsWith(wsFolder.uri.fsPath)) { return wsFolder; }
            return undefined;
        };

        // Native npm task for root package.json: no `path` in definition (VS Code behavior).
        const rootNpmTask = createVsCodeTask('long-running', { type: 'npm', script: 'long-running' }, wsFolder);

        const match = service.findMatchingTask(rootNpmTask);
        assert.ok(match, 'Should find a match');
        assert.strictEqual(match, rootNpmItem,
            'Should return root package.json item (no definition.path → task is at workspace root)');
    });

    test('findMatchingTask - Disambiguates by definition.path presence for subdirectory task', async () => {
        // Counterpart: the SUBDIRECTORY task fires onDidStartTask with `path: 'nodejs/'`.
        // findMatchingTask must return the nodejs item.
        const wsFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };
        const rootPkgUri    = vscode.Uri.file('/ws/package.json');
        const nodejsPkgUri  = vscode.Uri.file('/ws/nodejs/package.json');

        const rootNpmItem = createTaskItem('long-running', 'npm', rootPkgUri);
        rootNpmItem.taskFileUri = rootPkgUri;

        const nodejsNpmItem = createTaskItem('long-running', 'npm', nodejsPkgUri);
        nodejsNpmItem.taskFileUri = nodejsPkgUri;

        mockTasks.push(nodejsNpmItem, rootNpmItem);
        await service.refreshProvider('mockType');

        vscode.workspace.getWorkspaceFolder = (u: vscode.Uri) => {
            if (u.fsPath.startsWith(wsFolder.uri.fsPath)) { return wsFolder; }
            return undefined;
        };

        // Native npm task for nodejs/package.json includes `path: 'nodejs'`.
        const nodejsNpmTask = createVsCodeTask('long-running', { type: 'npm', script: 'long-running', path: 'nodejs' }, wsFolder);

        const match = service.findMatchingTask(nodejsNpmTask);
        assert.ok(match, 'Should find a match');
        assert.strictEqual(match, nodejsNpmItem,
            'Should return nodejs item (definition.path = nodejs/ identifies subdirectory)');
    });

    test('findMatchingTask - Disambiguates by type when same-named tasks share folder', async () => {
        // Reproduce the npm vs grunt "long-running" scenario: two tasks with the same label
        // in the same workspace folder but different types (npm / grunt).
        // When VS Code fires onDidStartTask for the npm execution, findMatchingTask must
        // return the npm item — not the grunt item that sorts alphabetically first.
        const wsFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };

        const gruntUri = vscode.Uri.file('/ws/grunt/Gruntfile.js');
        const npmUri   = vscode.Uri.file('/ws/package.json');

        const gruntItem = createTaskItem('long-running', 'grunt', gruntUri);
        gruntItem.taskFileUri = gruntUri;

        const npmItem = createTaskItem('long-running', 'npm', npmUri);
        npmItem.taskFileUri = npmUri;

        // Push grunt first (replicates the alphabetical ordering in allTasks).
        mockTasks.push(gruntItem, npmItem);
        await service.refreshProvider('mockType');

        // Mock workspace folder resolution so both items resolve to the same folder.
        vscode.workspace.getWorkspaceFolder = (u: vscode.Uri) => {
            if (u.fsPath.startsWith(wsFolder.uri.fsPath)) { return wsFolder; }
            return undefined;
        };

        // Simulate the native npm task fired by VS Code (no `path` property — matches both by label).
        const npmTask = createVsCodeTask('long-running', { type: 'npm', script: 'long-running' }, wsFolder);

        const match = service.findMatchingTask(npmTask);
        assert.ok(match, 'Should find a match');
        assert.strictEqual(match, npmItem, 'Should return the npm item, not the grunt item');
    });

    test('findMatchingTask - Prefers top-level item over dependsOn child clone', async () => {
        // Simulate a tasks.json with Task A (dependsOn Task B) and Task B.
        // vscodeTaskProvider builds a child clone of Task B under Task A.
        // When onDidStartTask fires for Task B (as a dependency), findMatchingTask
        // must return the top-level Task B, not the child clone, so that setStatus
        // targets the item whose ID the tree view uses for status display.
        const uri = vscode.Uri.file('/workspace/.vscode/tasks.json');

        const topLevelTaskB = createTaskItem('Task B', 'vscode', uri);

        // Create a clone of Task B as a child of Task A (simulating buildChildren)
        const taskA = createTaskItem('Task A', 'vscode', uri);
        const childTaskBClone = createTaskItem('Task B', 'vscode', uri);
        // Set the parent so this clone is recognized as a child item
        childTaskBClone.parent = taskA;
        taskA.children = [childTaskBClone];

        // Push both parent (Task A) and top-level Task B (alphabetical: A before B)
        mockTasks.push(taskA, topLevelTaskB);
        await service.refreshProvider('mockType');

        const vsTask = createVsCodeTask('Task B', { type: 'shell' });

        const match = service.findMatchingTask(vsTask);
        assert.ok(match, 'Should find a matching task');
        assert.strictEqual(match, topLevelTaskB, 'Should prefer the top-level item over the dependsOn child clone');
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
        const context = { subscriptions: [] as vscode.Disposable[] } as any;
        const result = service.initialize(context);
        assert.strictEqual(result, service);
        // Dispose subscriptions to prevent leaking the onDidInitialScanComplete listener
        // into subsequent tests (which would trigger spurious invalidateCache() calls).
        for (const d of context.subscriptions) {
            d.dispose();
        }
    });

    // ── Loading state (Phase 3) ───────────────────────────────────────────────

    test('isLoading() returns false when no providers are refreshing', () => {
        assert.strictEqual(service.isLoading(), false);
    });

    test('isLoading() returns true while a refreshProvider call is in-flight', async () => {
        let resolveTask!: () => void;
        const slowProvider = new MockTaskProvider([], 'slowType');
        slowProvider.getTasks = () => new Promise<TaskItem[]>((resolve) => {
            resolveTask = () => resolve([]);
        });
        (service as any).providers = [slowProvider];

        const refreshPromise = service.refreshProvider('slowType');
        assert.strictEqual(service.isLoading(), true, 'should be loading mid-refresh');
        resolveTask();
        await refreshPromise;
        assert.strictEqual(service.isLoading(), false, 'should be idle after refresh');
    });

    test('getLoadingProviders() contains the active provider type during refreshProvider', async () => {
        let resolveTask!: () => void;
        const slowProvider = new MockTaskProvider([], 'loadingType');
        slowProvider.getTasks = () => new Promise<TaskItem[]>((resolve) => {
            resolveTask = () => resolve([]);
        });
        (service as any).providers = [slowProvider];

        const refreshPromise = service.refreshProvider('loadingType');
        assert.ok(service.getLoadingProviders().has('loadingType'), 'loadingType should be in set');
        resolveTask();
        await refreshPromise;
        assert.ok(!service.getLoadingProviders().has('loadingType'), 'loadingType should be removed after resolve');
    });

    test('onDidLoadingStateChange fires when provider starts and finishes in refreshProvider', async () => {
        const events: string[] = [];
        service.onDidLoadingStateChange(() => {
            events.push(service.isLoading() ? 'loading' : 'idle');
        });

        let resolveTask!: () => void;
        const slowProvider = new MockTaskProvider([], 'eventType');
        slowProvider.getTasks = () => new Promise<TaskItem[]>((resolve) => {
            resolveTask = () => resolve([]);
        });
        (service as any).providers = [slowProvider];

        const refreshPromise = service.refreshProvider('eventType');
        // Should have fired on start (idle→loading transition)
        assert.ok(events.length >= 1, 'event should fire when provider starts');
        assert.strictEqual(events[0], 'loading');
        resolveTask();
        await refreshPromise;
        // Should have fired on finish (loading→idle transition)
        assert.ok(events.length >= 2, 'event should fire when provider finishes');
        assert.strictEqual(events[events.length - 1], 'idle');
    });

    test('getLoadingProviders() is empty after refresh() completes', async () => {
        const item = createTaskItem('T1', 'mockType');
        mockTasks.push(item);
        await service.refresh();
        assert.strictEqual(service.getLoadingProviders().size, 0, 'no providers should be loading after refresh');
    });

    test('isLoading() returns false after refresh() with multiple providers', async () => {
        const p1 = new MockTaskProvider([createTaskItem('a', 'typeA')], 'typeA');
        const p2 = new MockTaskProvider([createTaskItem('b', 'typeB')], 'typeB');
        (service as any).providers = [p1, p2];
        await service.refresh();
        assert.strictEqual(service.isLoading(), false);
    });

    test('hasTasksForProviderType() returns false before tasks are committed', async () => {
        assert.strictEqual(service.hasTasksForProviderType('mockType'), false);
    });

    test('hasTasksForProviderType() returns true after tasks are committed', async () => {
        mockTasks.push(createTaskItem('T1', 'mockType'));
        await service.refreshProvider('mockType');
        assert.strictEqual(service.hasTasksForProviderType('mockType'), true);
    });

    test('hasTasksForProviderType() returns false for empty provider result', async () => {
        mockTasks.length = 0;
        await service.refreshProvider('mockType');
        assert.strictEqual(service.hasTasksForProviderType('mockType'), false);
    });

    test('isLoading() returns true while refresh() is in-flight', async () => {
        let resolveTask!: () => void;
        const slowProvider = new MockTaskProvider([], 'refresh-slow');
        slowProvider.getTasks = () => new Promise<TaskItem[]>((resolve) => {
            resolveTask = () => resolve([]);
        });
        (service as any).providers = [slowProvider];

        let wasLoadingDuringRefresh = false;
        const refreshPromise = service.refresh();
        wasLoadingDuringRefresh = service.isLoading();
        resolveTask();
        await refreshPromise;

        assert.strictEqual(wasLoadingDuringRefresh, true, 'should be loading while refresh is in-flight');
        assert.strictEqual(service.isLoading(), false, 'should be idle after refresh');
    });

    // ── Discovery order (sortingEnabled=false path) ──────────────────────────

    suite('rebuildCache discovery order', () => {
        test('allTasks are ordered by file URI then by startLine within each file', async () => {
            mockTasks.length = 0;
            const uriA = vscode.Uri.file('/alpha/package.json');
            const uriZ = vscode.Uri.file('/zeta/package.json');

            // Tasks in file /alpha: line 10 then line 2 (intentionally reversed)
            const alphaLine10 = createTaskItem('compile', 'npm', uriA);
            alphaLine10.taskFileUri = uriA;
            alphaLine10.startLine = 10;

            const alphaLine2 = createTaskItem('build', 'npm', uriA);
            alphaLine2.taskFileUri = uriA;
            alphaLine2.startLine = 2;

            // Task in /zeta: comes after /alpha alphabetically
            const zetaTask = createTaskItem('test', 'npm', uriZ);
            zetaTask.taskFileUri = uriZ;
            zetaTask.startLine = 0;

            // Push in reverse-alphabetical-by-label order so alphabetical sort on labels
            // does NOT match the expected output, proving the fix works.
            mockTasks.push(zetaTask, alphaLine10, alphaLine2);
            await service.refreshProvider('mockType');

            const tasks = service.getAllTasks();
            // Files: /alpha before /zeta (alphabetical)
            // Within /alpha: startLine 2 (build) before startLine 10 (compile)
            assert.strictEqual(tasks.length, 3, 'all three tasks should be present');
            assert.strictEqual(tasks[0], alphaLine2, 'first task should be build (startLine 2 in /alpha)');
            assert.strictEqual(tasks[1], alphaLine10, 'second task should be compile (startLine 10 in /alpha)');
            assert.strictEqual(tasks[2], zetaTask, 'third task should be from /zeta');
        });

        test('tasks without a file URI are appended last, sorted by label', async () => {
            mockTasks.length = 0;
            const uri = vscode.Uri.file('/some/package.json');

            const fileTask = createTaskItem('aaa', 'npm', uri);
            fileTask.taskFileUri = uri;
            fileTask.startLine = 0;

            const noFileZ = createTaskItem('zzz', 'npm');
            const noFileA = createTaskItem('aaa-no-file', 'npm');

            mockTasks.push(noFileZ, fileTask, noFileA);
            await service.refreshProvider('mockType');

            const tasks = service.getAllTasks();
            // File task comes first, then no-file tasks sorted by label
            assert.strictEqual(tasks[0], fileTask, 'file task should come first');
            assert.strictEqual(tasks[1].label, 'aaa-no-file', 'no-file tasks sorted alphabetically');
            assert.strictEqual(tasks[2].label, 'zzz', 'no-file tasks sorted alphabetically');
        });

        test('IDs remain stable regardless of provider insertion order', async () => {
            // Run once with tasks in one order, record IDs, then swap order and check IDs match.
            mockTasks.length = 0;
            const uri = vscode.Uri.file('/project/package.json');

            const taskA = createTaskItem('alpha', 'npm', uri);
            taskA.taskFileUri = uri;
            taskA.startLine = 0;
            const taskZ = createTaskItem('zeta', 'npm', uri);
            taskZ.taskFileUri = uri;
            taskZ.startLine = 5;

            mockTasks.push(taskZ, taskA); // Z before A in provider
            await service.refreshProvider('mockType');
            const idAlpha1 = taskA.id;
            const idZeta1 = taskZ.id;

            // Reset and push in opposite order
            (service as any).allTasks = [];
            (service as any).fileTaskMap = new Map();
            (service as any).taskMap = new Map();
            (service as any).providerTasks = new Map();
            mockTasks.length = 0;

            const taskA2 = createTaskItem('alpha', 'npm', uri);
            taskA2.taskFileUri = uri;
            taskA2.startLine = 0;
            const taskZ2 = createTaskItem('zeta', 'npm', uri);
            taskZ2.taskFileUri = uri;
            taskZ2.startLine = 5;

            mockTasks.push(taskA2, taskZ2); // A before Z this time
            await service.refreshProvider('mockType');
            const idAlpha2 = taskA2.id;
            const idZeta2 = taskZ2.id;

            assert.strictEqual(idAlpha1, idAlpha2, 'alpha ID should be stable regardless of insertion order');
            assert.strictEqual(idZeta1, idZeta2, 'zeta ID should be stable regardless of insertion order');
        });
    });

    // ── Workspace trust ───────────────────────────────────────────────────────

    suite('workspace trust', () => {
        let originalIsTrusted: PropertyDescriptor | undefined;

        setup(() => {
            originalIsTrusted = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
        });

        teardown(() => {
            if (originalIsTrusted) {
                Object.defineProperty(vscode.workspace, 'isTrusted', originalIsTrusted);
            } else {
                // Restore by deleting the override so the prototype value is used again
                delete (vscode.workspace as any).isTrusted;
            }
        });

        test('refresh() returns empty array and skips all providers when workspace is not trusted', async () => {
            mockTasks.push(createTaskItem('T1', 'mockType'));
            let providerCalled = false;
            mockProvider.getTasks = async () => {
                providerCalled = true;
                return mockTasks;
            };

            Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });

            const tasks = await service.refresh();

            assert.deepStrictEqual(tasks, [], 'refresh() should return [] for untrusted workspace');
            assert.strictEqual(providerCalled, false, 'Provider getTasks() must not be called for untrusted workspace');
            assert.strictEqual(service.getAllTasks().length, 0);
        });

        test('refreshProvider() is a no-op when workspace is not trusted', async () => {
            mockTasks.push(createTaskItem('T1', 'mockType'));
            let providerCalled = false;
            mockProvider.getTasks = async () => {
                providerCalled = true;
                return mockTasks;
            };

            Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });

            await service.refreshProvider('mockType');

            assert.strictEqual(providerCalled, false, 'Provider getTasks() must not be called for untrusted workspace');
            assert.strictEqual(service.getAllTasks().length, 0);
        });

        test('refresh() discovers tasks normally when workspace is trusted', async () => {
            mockTasks.push(createTaskItem('T1', 'mockType'));

            Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });

            const tasks = await service.refresh();

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].label, 'T1');
        });
    });

});
