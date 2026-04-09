import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopCompoundTaskCommand } from '../../commands/stopCompoundTask';
import { TaskItem } from '../../taskItem';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { TaskStateManager } from '../../taskStateManager';
import { LoggerService } from '../../services/loggerService';

function makeTaskItem(label: string, taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.originalLabel = label;
  return item;
}

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

suite('StopCompoundTaskCommand Test Suite', () => {
  let cmd: StopCompoundTaskCommand;
  let infos: string[];
  let originalShowInfo: typeof vscode.window.showInformationMessage;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let terminatedIds: string[];
  let executionMap: Map<string, vscode.TaskExecution>;

  setup(() => {
    // Prevent "command already registered" errors from BaseCommand constructor
    originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = () => ({ dispose: () => { } });

    (LoggerService as any).instance = {
      error: () => { },
      info: () => { },
      warn: () => { },
      debug: () => { },
    };

    infos = [];
    terminatedIds = [];
    executionMap = new Map();

    originalShowInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = (msg: string) => {
      infos.push(msg);
      return Promise.resolve(undefined);
    };

    originalShowQuickPick = vscode.window.showQuickPick;

    (CompoundTaskService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    cmd = new StopCompoundTaskCommand(makeContext());
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (vscode.window as any).showInformationMessage = originalShowInfo;
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (CompoundTaskService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (LoggerService as any).instance = undefined;
  });

  // -------------------------------------------------------------------------
  // run – item with runningCompoundTask contextValue
  // -------------------------------------------------------------------------
  test('run cancels compound task when given a runningFavoriteCompoundTask item', async () => {
    const task1 = makeTaskItem('task1');
    let cancelledCompoundTask: string | undefined;

    (CompoundTaskService as any).instance = {
      cancelCompoundTask: (name: string) => { cancelledCompoundTask = name; },
      getCompoundTask: (_name: string) => [task1],
      getCompoundTaskNames: () => ['MyCompoundTask'],
      isCompoundTaskRunning: () => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    const favCompoundItem = makeTaskItem('MyCompoundTask', 'compoundTask');
    favCompoundItem.contextValue = 'runningFavoriteCompoundTask';

    await cmd.run(favCompoundItem);

    assert.strictEqual(cancelledCompoundTask, 'MyCompoundTask', 'Should cancel by label when given runningFavoriteCompoundTask item');
  });
  test('run cancels compound task and terminates running tasks when given a runningCompoundTask item', async () => {
    const task1 = makeTaskItem('task1');
    const task2 = makeTaskItem('task2');

    const terminatedCalled: string[] = [];
    const fakeExecution1: vscode.TaskExecution = { terminate: () => { terminatedCalled.push('task1'); } } as any;
    executionMap.set('task1', fakeExecution1);

    let cancelledCompoundTask: string | undefined;
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: (name: string) => { cancelledCompoundTask = name; },
      getCompoundTask: (_name: string) => [task1, task2],
      getCompoundTaskNames: () => ['MyCompoundTask'],
      isCompoundTaskRunning: () => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: (id: string) => executionMap.get(id),
      markTerminated: (id: string) => { terminatedIds.push(id); },
    } as any;

    const compoundTaskItem = makeTaskItem('MyCompoundTask', 'compoundTask');
    compoundTaskItem.contextValue = 'runningCompoundTask';

    await cmd.run(compoundTaskItem);

    assert.strictEqual(cancelledCompoundTask, 'MyCompoundTask', 'cancelCompoundTask should be called with the compound task name');
    assert.ok(terminatedIds.includes('task1'), 'running task1 should be terminated');
    assert.ok(terminatedCalled.includes('task1'), 'task1 execution.terminate() should be called');
    // task2 has no execution – should simply be skipped
    assert.ok(!terminatedIds.includes('task2'), 'task2 has no execution, should not be in terminatedIds');
  });

  test('run does nothing when item is not runningCompoundTask', async () => {
    const notRunningItem = makeTaskItem('NotARunningCompoundTask', 'compoundTask');
    notRunningItem.contextValue = 'compoundTask'; // not 'runningCompoundTask'

    let cancelCalled = false;
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: () => { cancelCalled = true; },
      getCompoundTask: () => [],
      getCompoundTaskNames: () => [],
      isCompoundTaskRunning: () => false,
    } as any;

    // Should not crash and should not call cancel
    await cmd.run(notRunningItem);

    assert.ok(!cancelCalled, 'cancelCompoundTask should not be called for non-running compound task');
  });

  // -------------------------------------------------------------------------
  // run – no item provided (picker path)
  // -------------------------------------------------------------------------

  test('run shows info message when no compound tasks are running and no item given', async () => {
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: () => { },
      getCompoundTask: () => [],
      getCompoundTaskNames: () => ['CompoundTask1'],
      isCompoundTaskRunning: () => false,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    await cmd.run(undefined);

    assert.strictEqual(infos.length, 1);
    assert.ok(infos[0].toLowerCase().includes('no compound tasks'), `Expected 'no compound tasks' message, got: ${infos[0]}`);
  });

  test('run auto-selects when exactly one compound task is running', async () => {
    const task1 = makeTaskItem('task1');
    let cancelledCompoundTask: string | undefined;
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: (name: string) => { cancelledCompoundTask = name; },
      getCompoundTask: (_name: string) => [task1],
      getCompoundTaskNames: () => ['OnlyCompoundTask'],
      isCompoundTaskRunning: (_name: string) => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    await cmd.run(undefined);

    assert.strictEqual(cancelledCompoundTask, 'OnlyCompoundTask');
    assert.strictEqual(infos.length, 0);
  });

  test('run uses quick-pick when multiple compound tasks are running', async () => {
    const task1 = makeTaskItem('task1');
    let cancelledCompoundTask: string | undefined;
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: (name: string) => { cancelledCompoundTask = name; },
      getCompoundTask: (_name: string) => [task1],
      getCompoundTaskNames: () => ['CompoundTask1', 'CompoundTask2'],
      isCompoundTaskRunning: (_name: string) => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    (vscode.window as any).showQuickPick = (_items: string[]) => Promise.resolve('CompoundTask2');

    await cmd.run(undefined);

    assert.strictEqual(cancelledCompoundTask, 'CompoundTask2');
  });

  test('run does nothing when quick-pick is dismissed', async () => {
    let cancelCalled = false;
    (CompoundTaskService as any).instance = {
      cancelCompoundTask: () => { cancelCalled = true; },
      getCompoundTask: () => [],
      getCompoundTaskNames: () => ['CompoundTask1', 'CompoundTask2'],
      isCompoundTaskRunning: (_name: string) => true,
    } as any;

    (vscode.window as any).showQuickPick = (_items: string[]) => Promise.resolve(undefined);

    await cmd.run(undefined);

    assert.ok(!cancelCalled, 'cancelCompoundTask should not be called when quick-pick dismissed');
  });
});
