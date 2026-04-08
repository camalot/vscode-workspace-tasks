import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopQueueCommand } from '../../commands/stopQueue';
import { TaskItem } from '../../taskItem';
import { QueueService } from '../../services/queueService';
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

suite('StopQueueCommand Test Suite', () => {
  let cmd: StopQueueCommand;
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

    (QueueService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;

    cmd = new StopQueueCommand(makeContext());
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (vscode.window as any).showInformationMessage = originalShowInfo;
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (QueueService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (LoggerService as any).instance = undefined;
  });

  // -------------------------------------------------------------------------
  // run – item with runningQueue contextValue
  // -------------------------------------------------------------------------

  test('run cancels queue and terminates running tasks when given a runningQueue item', async () => {
    const task1 = makeTaskItem('task1');
    const task2 = makeTaskItem('task2');

    const terminatedCalled: string[] = [];
    const fakeExecution1: vscode.TaskExecution = { terminate: () => { terminatedCalled.push('task1'); } } as any;
    executionMap.set('task1', fakeExecution1);

    let cancelledQueue: string | undefined;
    (QueueService as any).instance = {
      cancelQueue: (name: string) => { cancelledQueue = name; },
      getQueue: (_name: string) => [task1, task2],
      getQueueNames: () => ['MyQueue'],
      isQueueRunning: () => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: (id: string) => executionMap.get(id),
      markTerminated: (id: string) => { terminatedIds.push(id); },
    } as any;

    const queueGroupItem = makeTaskItem('MyQueue', 'queue');
    queueGroupItem.contextValue = 'runningQueue';

    await cmd.run(queueGroupItem);

    assert.strictEqual(cancelledQueue, 'MyQueue', 'cancelQueue should be called with the queue name');
    assert.ok(terminatedIds.includes('task1'), 'running task1 should be terminated');
    assert.ok(terminatedCalled.includes('task1'), 'task1 execution.terminate() should be called');
    // task2 has no execution – should simply be skipped
    assert.ok(!terminatedIds.includes('task2'), 'task2 has no execution, should not be in terminatedIds');
  });

  test('run does nothing when item is not runningQueue', async () => {
    const notRunningItem = makeTaskItem('NotARunningQueue', 'queue');
    notRunningItem.contextValue = 'queue'; // not 'runningQueue'

    let cancelCalled = false;
    (QueueService as any).instance = {
      cancelQueue: () => { cancelCalled = true; },
      getQueue: () => [],
      getQueueNames: () => [],
      isQueueRunning: () => false,
    } as any;

    // Should not crash and should not call cancel
    await cmd.run(notRunningItem);

    assert.ok(!cancelCalled, 'cancelQueue should not be called for non-running queue');
  });

  // -------------------------------------------------------------------------
  // run – no item provided (picker path)
  // -------------------------------------------------------------------------

  test('run shows info message when no queues are running and no item given', async () => {
    (QueueService as any).instance = {
      cancelQueue: () => { },
      getQueue: () => [],
      getQueueNames: () => ['Queue1'],
      isQueueRunning: () => false,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    await cmd.run(undefined);

    assert.strictEqual(infos.length, 1);
    assert.ok(infos[0].toLowerCase().includes('no queues'), `Expected 'no queues' message, got: ${infos[0]}`);
  });

  test('run auto-selects when exactly one queue is running', async () => {
    const task1 = makeTaskItem('task1');
    let cancelledQueue: string | undefined;
    (QueueService as any).instance = {
      cancelQueue: (name: string) => { cancelledQueue = name; },
      getQueue: (_name: string) => [task1],
      getQueueNames: () => ['OnlyQueue'],
      isQueueRunning: (_name: string) => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    await cmd.run(undefined);

    assert.strictEqual(cancelledQueue, 'OnlyQueue');
    assert.strictEqual(infos.length, 0);
  });

  test('run uses quickpick when multiple queues are running', async () => {
    const task1 = makeTaskItem('task1');
    let cancelledQueue: string | undefined;
    (QueueService as any).instance = {
      cancelQueue: (name: string) => { cancelledQueue = name; },
      getQueue: (_name: string) => [task1],
      getQueueNames: () => ['Queue1', 'Queue2'],
      isQueueRunning: (_name: string) => true,
    } as any;

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getExecution: () => undefined,
      markTerminated: () => { },
    } as any;

    (vscode.window as any).showQuickPick = (_items: string[]) => Promise.resolve('Queue2');

    await cmd.run(undefined);

    assert.strictEqual(cancelledQueue, 'Queue2');
  });

  test('run does nothing when quickpick is dismissed', async () => {
    let cancelCalled = false;
    (QueueService as any).instance = {
      cancelQueue: () => { cancelCalled = true; },
      getQueue: () => [],
      getQueueNames: () => ['Queue1', 'Queue2'],
      isQueueRunning: (_name: string) => true,
    } as any;

    (vscode.window as any).showQuickPick = (_items: string[]) => Promise.resolve(undefined);

    await cmd.run(undefined);

    assert.ok(!cancelCalled, 'cancelQueue should not be called when quickpick dismissed');
  });
});
