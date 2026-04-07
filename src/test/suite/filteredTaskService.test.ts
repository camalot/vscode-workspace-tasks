import * as assert from 'assert';
import * as vscode from 'vscode';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';

suite('FilteredTaskService Test Suite', () => {
    let service: FilteredTaskService;
    let contextMock: vscode.ExtensionContext;
    let globalStateMock: Map<string, any>;
    let itemMock: TaskItem;
    let groupMock: TaskItem;

    setup(() => {
        // Reset singleton instance (hacky but necessary for testing singletons without DI)
        // Accessing private static instance via any casting
        (FilteredTaskService as any).instance = undefined;
        service = FilteredTaskService.getInstance();

        // Mock globalState
        globalStateMock = new Map();
        contextMock = {
            globalState: {
                get: (key: string, defaultValue?: any) => {
                    return globalStateMock.has(key) ? globalStateMock.get(key) : defaultValue;
                },
                update: (key: string, value: any) => {
                    if (value === undefined) {
                        globalStateMock.delete(key);
                    } else {
                        globalStateMock.set(key, value);
                    }
                    return Promise.resolve();
                }
            } as any,
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        service.initialize(contextMock);

        // Mock TaskItem
        itemMock = {
            label: 'Test Task',
            taskType: 'npm',
            id: 'test-task-id',
            // taskFileUri: vscode.Uri.file('/path/to/project'), // ensure it doesn't crash if we provide something
        } as unknown as TaskItem;

        groupMock = {
            label: 'Group',
            taskType: 'workspace', // recognized as group in service
            id: 'group-id'
        } as unknown as TaskItem;

        // Stub TaskStateManager.getTaskId to behave predictably if needed
        // Since FilteredTaskService calls real TaskStateManager.getInstance().getTaskId(item),
        // we can either mock getTaskId or ensure itemMock produces a predictable ID.
        // TaskStateManager.getInstance() returns the singleton.
        // We can't easy replace getInstance, but we can assume getTaskId uses item.id if present.
        // In TaskStateManager logic: if item.id is present, it normalizes it.
        // So 'test-task-id' should remain 'test-task-id' essentially.
    });

    test('getInstance returns singleton', () => {
        const instance1 = FilteredTaskService.getInstance();
        const instance2 = FilteredTaskService.getInstance();
        assert.strictEqual(instance1, instance2);
    });

    test('Initialization loads state', () => {
        const prefilledState = new Map<string, any>();
        prefilledState.set('filteredTasks', ['hidden-1']);
        prefilledState.set('unhiddenTasks', ['shown-1']);
        prefilledState.set('showHiddenTasks', true);

        const context = {
            globalState: {
                get: (key: string, def?: any) => prefilledState.has(key) ? prefilledState.get(key) : def,
                update: () => Promise.resolve()
            }
        } as unknown as vscode.ExtensionContext;

        // Reset instance to test init again
        (FilteredTaskService as any).instance = undefined;
        const newService = FilteredTaskService.getInstance();
        newService.initialize(context);

        // Access private members to verify
        assert.ok(newService.isFiltered('hidden-1'));
        assert.ok(newService.isUnhidden('shown-1'));
        assert.strictEqual(newService.isShowHiddenMode(), true);
    });

    test('hideTask hides a task and updates storage', () => {
        // Arrange
        let fired = false;
        service.onDidChange(() => { fired = true; });

        // Act
        service.hideTask(itemMock);

        // Assert
        assert.strictEqual(fired, true, 'Event should fire');
        const taskId = 'test-task-id'; // Assuming TaskStateManager behavior
        assert.strictEqual(service.isFiltered(taskId), true);
        assert.strictEqual(globalStateMock.get('filteredTasks').includes(taskId), true);
    });

    test('hideTask handles groups correctly', () => {
        service.hideTask(groupMock);
        assert.strictEqual(service.isFiltered('group-id'), true);
    });

    test('showTask unhides a task', () => {
        // Arrange
        service.hideTask(itemMock);
        assert.strictEqual(service.isFiltered('test-task-id'), true);

        // Act
        service.showTask(itemMock);

        // Assert
        assert.strictEqual(service.isFiltered('test-task-id'), false);
        assert.strictEqual(service.isUnhidden('test-task-id'), true);
        assert.strictEqual(globalStateMock.get('unhiddenTasks').includes('test-task-id'), true);
    });

    test('isFilteredOrHasFilteredParent checks parent chain', () => {
        const parentGroup = {
            label: 'Parent',
            taskType: 'folder',
            id: 'parent-id'
        } as unknown as TaskItem;

        const childTask = {
            label: 'Child',
            taskType: 'npm',
            id: 'child-id',
            parent: parentGroup
        } as unknown as TaskItem;

        // Initially nothing filtered
        assert.strictEqual(service.isFilteredOrHasFilteredParent(childTask), false);

        // Hide parent
        service.hideTask(parentGroup);

        // Child should be effectively filtered
        assert.strictEqual(service.isFilteredOrHasFilteredParent(childTask), true);

        // Direct check on child (not hiding child itself)
        assert.strictEqual(service.isFiltered('child-id'), false);
    });

    test('isFilteredOrHasFilteredParent returns true for item whose canonical id is filtered (dedup suffix)', () => {
        // Simulate a compound task child whose id has the "|N" dedup suffix.
        // The original task is stored as "ws:path:compile"; the child has "ws:path:compile|1".
        const originalTask = {
            label: 'compile',
            taskType: 'vscode',
            id: 'ws:path:compile',
            parent: undefined,
        } as unknown as TaskItem;

        const depChild = {
            label: 'compile',
            taskType: 'vscode',
            id: 'ws:path:compile|1',
            parent: undefined,
        } as unknown as TaskItem;

        // Hide the original
        service.hideTask(originalTask);
        assert.strictEqual(service.isFiltered('ws:path:compile'), true);

        // The compound child should be considered filtered too (via canonical id match)
        assert.strictEqual(service.isFilteredOrHasFilteredParent(depChild), true);
    });

    test('toggleShowHidden toggles mode', () => {
        assert.strictEqual(service.isShowHiddenMode(), false);

        const newState = service.toggleShowHidden();

        assert.strictEqual(newState, true);
        assert.strictEqual(service.isShowHiddenMode(), true);
        assert.strictEqual(globalStateMock.get('showHiddenTasks'), true);

        service.toggleShowHidden();
        assert.strictEqual(service.isShowHiddenMode(), false);
    });

    test('clearFiltered clears all state', () => {
        service.hideTask(itemMock);
        service.toggleShowHidden(); // set to true

        service.clearFiltered();

        assert.strictEqual(service.getFilteredCount(), 0);
        assert.strictEqual(service.hasFilteredTasks(), false);
        assert.strictEqual(service.isShowHiddenMode(), false);
        assert.deepStrictEqual(globalStateMock.get('filteredTasks'), []);
    });

    test('Initializes with empty defaults if storage missing', () => {
        // contextMock has empty map by default
        assert.strictEqual(service.getFilteredCount(), 0);
        assert.strictEqual(service.isShowHiddenMode(), false);
    });

    test('Re-hiding already hidden task triggers no change', () => {
        service.hideTask(itemMock);

        let fired = false;
        service.onDidChange(() => { fired = true; });

        service.hideTask(itemMock);
        assert.strictEqual(fired, false);
    });

    test('Hiding task moves it from unhidden to filtered', () => {
        // First unhide strictly (simulate user unhiding previously hidden)
        service.showTask(itemMock);
        assert.ok(service.isUnhidden('test-task-id'));

        // Now hide again
        service.hideTask(itemMock);

        assert.ok(service.isFiltered('test-task-id'));
        assert.strictEqual(service.isUnhidden('test-task-id'), false);
    });

});
