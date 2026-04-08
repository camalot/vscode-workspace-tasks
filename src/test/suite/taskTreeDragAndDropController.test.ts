import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskTreeDragAndDropController } from '../../taskTreeDragAndDropController';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';

/**
 * Creates a minimal TaskItem for testing purposes.
 */
function makeTaskItem(label: string, contextValue: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'shell');
  item.contextValue = contextValue;
  item.originalLabel = label;
  return item;
}

/**
 * Creates a mock vscode.DataTransfer backed by a simple Map.
 */
function makeDataTransfer(
  items: Map<string, vscode.DataTransferItem> = new Map(),
): vscode.DataTransfer {
  return {
    get: (mimeType: string) => items.get(mimeType) ?? null as unknown as vscode.DataTransferItem,
    set: (mimeType: string, value: vscode.DataTransferItem) => { items.set(mimeType, value); },
    forEach: () => { },
    [Symbol.iterator]: function* () { yield* items.entries(); },
  } as unknown as vscode.DataTransfer;
}

/**
 * Creates a mock DataTransferItem whose asString() resolves to the given value.
 */
function makeTransferItem(value: string): vscode.DataTransferItem {
  return {
    asString: () => Promise.resolve(value),
    value,
  } as unknown as vscode.DataTransferItem;
}

suite('TaskTreeDragAndDropController Test Suite', () => {
  let controller: TaskTreeDragAndDropController;
  let fakeStateManager: TaskStateManager;
  let fakeCompoundService: CompoundTaskService;
  let executedCommands: string[];
  let originalExecuteCommand: typeof vscode.commands.executeCommand;

  setup(() => {
    controller = new TaskTreeDragAndDropController();
    executedCommands = [];

    // Intercept vscode.commands.executeCommand
    originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (cmd: string, ..._args: any[]) => {
      executedCommands.push(cmd);
    };

    // Set up fake TaskStateManager – must include getStatus since TaskItem.updateContextValue uses it
    fakeStateManager = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getStatus: (_id: string) => 'idle',
    } as unknown as TaskStateManager;
    (TaskStateManager as any).instance = fakeStateManager;

    // Set up fake FavoritesService – TaskItem.updateContextValue calls isFavorite
    const fakeFavoritesService = {
      isFavorite: (_item: TaskItem | string) => false,
    } as unknown as FavoritesService;
    (FavoritesService as any).instance = fakeFavoritesService;

    // Set up fake FilteredTaskService – TaskItem.updateContextValue calls isFiltered / isFilteredOrHasFilteredParent
    const fakeFilteredTaskService = {
      isFiltered: (_id: string) => false,
      isFilteredOrHasFilteredParent: (_item: TaskItem) => false,
    } as unknown as FilteredTaskService;
    (FilteredTaskService as any).instance = fakeFilteredTaskService;

    // Set up fake CompoundTaskService
    fakeCompoundService = {
      getAllCompoundTasks: () => new Map<string, TaskItem[]>(),
      moveCompoundTaskItem: (_source: TaskItem, _target: TaskItem) => { },
    } as unknown as CompoundTaskService;
    (CompoundTaskService as any).instance = fakeCompoundService;
  });

  teardown(() => {
    (vscode.commands as any).executeCommand = originalExecuteCommand;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (CompoundTaskService as any).instance = undefined;
  });

  // ---------------------------------------------------------------------------
  // Static properties
  // ---------------------------------------------------------------------------

  test('dragMimeTypes contains the expected MIME type', () => {
    assert.deepStrictEqual(controller.dragMimeTypes, [
      'application/vnd.code.tree.workspaceTasksView',
    ]);
  });

  test('dropMimeTypes contains the expected MIME type', () => {
    assert.deepStrictEqual(controller.dropMimeTypes, [
      'application/vnd.code.tree.workspaceTasksView',
    ]);
  });

  // ---------------------------------------------------------------------------
  // handleDrag
  // ---------------------------------------------------------------------------

  test('handleDrag does nothing when source is empty', () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    controller.handleDrag([], dataTransfer, token);

    assert.strictEqual(transferItems.size, 0, 'No items should have been set on the data transfer');
  });

  test('handleDrag does nothing when source item is not a queuedTask', () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;
    const item = makeTaskItem('Build', 'task');

    controller.handleDrag([item], dataTransfer, token);

    assert.strictEqual(transferItems.size, 0, 'Non-queued tasks should not be draggable');
  });

  test('handleDrag sets transfer item for a queuedTask', () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;
    const item = makeTaskItem('Build', 'queuedTask');

    controller.handleDrag([item], dataTransfer, token);

    assert.strictEqual(transferItems.size, 1, 'Exactly one item should be set');
    assert.ok(
      transferItems.has('application/vnd.code.tree.workspaceTasksView'),
      'MIME type key should be set',
    );
  });

  test('handleDrag serializes the task ID as JSON', () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;
    const item = makeTaskItem('MyTask', 'queuedTask');

    controller.handleDrag([item], dataTransfer, token);

    const transferItem = transferItems.get('application/vnd.code.tree.workspaceTasksView') as any;
    assert.ok(transferItem, 'Transfer item must be set');
    // The DataTransferItem wraps a JSON-stringified id
    const storedValue = transferItem.value;
    const parsedId = JSON.parse(storedValue);
    assert.strictEqual(parsedId, 'MyTask', 'ID should match the task label from getTaskId');
  });

  test('handleDrag only uses the first item when multiple are dragged', () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;
    const item1 = makeTaskItem('Task1', 'queuedTask');
    const item2 = makeTaskItem('Task2', 'queuedTask');

    controller.handleDrag([item1, item2], dataTransfer, token);

    const transferItem = transferItems.get('application/vnd.code.tree.workspaceTasksView') as any;
    const parsedId = JSON.parse(transferItem.value);
    assert.strictEqual(parsedId, 'Task1', 'Only the first item should be used');
  });

  // ---------------------------------------------------------------------------
  // handleDrop
  // ---------------------------------------------------------------------------

  test('handleDrop does nothing when there is no matching transfer item', async () => {
    const dataTransfer = makeDataTransfer();
    const target = makeTaskItem('Target', 'queuedTask');
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(target, dataTransfer, token);

    assert.strictEqual(executedCommands.length, 0, 'No command should be executed');
  });

  test('handleDrop does nothing when target is undefined', async () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem(JSON.stringify('someId')),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(undefined, dataTransfer, token);

    assert.strictEqual(executedCommands.length, 0, 'No command should be executed');
  });

  test('handleDrop does nothing when target is not a queuedTask', async () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem(JSON.stringify('someId')),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const target = makeTaskItem('Target', 'task');
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(target, dataTransfer, token);

    assert.strictEqual(executedCommands.length, 0, 'No command should be executed');
  });

  test('handleDrop does nothing when transfer item JSON is invalid', async () => {
    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem('not-valid-json{{{'),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const target = makeTaskItem('Target', 'queuedTask');
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(target, dataTransfer, token);

    assert.strictEqual(executedCommands.length, 0, 'No command should be executed on parse error');
  });

  test('handleDrop does nothing when source item is not found in any queue', async () => {
    const sourceId = 'missingTask';
    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem(JSON.stringify(sourceId)),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const target = makeTaskItem('Target', 'queuedTask');
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    let moveCompoundTaskItemCalled = false;
    (fakeCompoundService as any).moveCompoundTaskItem = () => { moveCompoundTaskItemCalled = true; };

    await controller.handleDrop(target, dataTransfer, token);

    assert.strictEqual(moveCompoundTaskItemCalled, false, 'moveCompoundTaskItem should not be called');
    assert.strictEqual(executedCommands.length, 0, 'No command should be executed');
  });

  test('handleDrop moves item and refreshes when source is found in a compound task', async () => {
    const sourceItem = makeTaskItem('SourceTask', 'queuedTask');
    const targetItem = makeTaskItem('TargetTask', 'queuedTask');

    // Return a compound task containing the source item
    const compoundTasks = new Map<string, TaskItem[]>();

    compoundTasks.set('MyCompoundTask', [sourceItem]);
    (fakeCompoundService as any).getAllCompoundTasks = () => compoundTasks;

    let movedSource: TaskItem | undefined;
    let movedTarget: TaskItem | undefined;
    (fakeCompoundService as any).moveCompoundTaskItem = (src: TaskItem, tgt: TaskItem) => {
      movedSource = src;
      movedTarget = tgt;
    };

    const sourceId = 'SourceTask'; // matches fakeStateManager.getTaskId
    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem(JSON.stringify(sourceId)),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(targetItem, dataTransfer, token);

    assert.strictEqual(movedSource, sourceItem, 'Source item should be the one from the compound task');
    assert.strictEqual(movedTarget, targetItem, 'Target item should be the drop target');
    assert.ok(
      executedCommands.includes('workspaceTasks.refresh'),
      'workspaceTasks.refresh should be executed after a successful move',
    );
  });

  test('handleDrop finds source in second compound task when first compound task has no match', async () => {
    const sourceItem = makeTaskItem('LaterTask', 'queuedTask');
    const otherItem = makeTaskItem('OtherTask', 'queuedTask');
    const targetItem = makeTaskItem('TargetTask', 'queuedTask');

    const compoundTasks = new Map<string, TaskItem[]>();
    compoundTasks.set('CompoundTask1', [otherItem]);
    compoundTasks.set('CompoundTask2', [sourceItem]);
    (fakeCompoundService as any).getAllCompoundTasks = () => compoundTasks;

    let movedSource: TaskItem | undefined;
    (fakeCompoundService as any).moveCompoundTaskItem = (src: TaskItem, _tgt: TaskItem) => {
      movedSource = src;
    };

    const transferItems = new Map<string, vscode.DataTransferItem>();
    transferItems.set(
      'application/vnd.code.tree.workspaceTasksView',
      makeTransferItem(JSON.stringify('LaterTask')),
    );
    const dataTransfer = makeDataTransfer(transferItems);
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    await controller.handleDrop(targetItem, dataTransfer, token);

    assert.strictEqual(movedSource, sourceItem, 'Source item should be found in the second compound task');
    assert.ok(
      executedCommands.includes('workspaceTasks.refresh'),
      'Refresh command should be called after a move',
    );
  });
});
