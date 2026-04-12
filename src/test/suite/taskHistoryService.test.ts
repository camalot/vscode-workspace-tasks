import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskHistoryService } from '../../services/taskHistoryService';
import { TaskStateManager } from '../../taskStateManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(name = 'build', source = 'npm'): vscode.Task {
  return new vscode.Task(
    { type: source },
    vscode.TaskScope.Workspace,
    name,
    source,
    new vscode.ShellExecution('echo test'),
  );
}

function makeExecution(task: vscode.Task): vscode.TaskExecution {
  return { task, terminate: () => {} } as vscode.TaskExecution;
}

function makeStartEvent(execution: vscode.TaskExecution): vscode.TaskStartEvent {
  return { execution } as vscode.TaskStartEvent;
}

function makeProcessEndEvent(execution: vscode.TaskExecution, exitCode: number | undefined): vscode.TaskProcessEndEvent {
  return { execution, exitCode } as vscode.TaskProcessEndEvent;
}

function makeEndEvent(execution: vscode.TaskExecution): vscode.TaskEndEvent {
  return { execution } as vscode.TaskEndEvent;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskHistoryService Test Suite', () => {
  let service: TaskHistoryService;
  let stateManager: TaskStateManager;

  const resetSingletons = () => {
    (TaskHistoryService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  };

  setup(() => {
    resetSingletons();
    service = TaskHistoryService.getInstance();
    stateManager = TaskStateManager.getInstance();
  });

  teardown(() => {
    resetSingletons();
  });

  // ---------------------------------------------------------------------------
  // handleTaskProcessEnd — status classification
  // ---------------------------------------------------------------------------

  test('records Success when exit code is 0', () => {
    const task = makeTask('clean');
    const execution = makeExecution(task);

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 0));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].executions[0].status, 'Success');
  });

  test('records Failed when exit code is non-zero and task is not marked terminated', () => {
    const task = makeTask('lint');
    const execution = makeExecution(task);

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 1));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Failed');
  });

  test('records Terminated when exit code is undefined', () => {
    const task = makeTask('serve');
    const execution = makeExecution(task);

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, undefined));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Terminated');
  });

  test('records Terminated (not Failed) when task is marked terminated and exits with non-zero code (SIGINT)', () => {
    const task = makeTask('watch');
    const execution = makeExecution(task);

    // Simulate stop command registering the execution and marking terminated (as done when SIGINT is sent)
    stateManager.setExecution('watch', execution);
    stateManager.markTerminated('watch');

    (service as any).handleTaskStart(makeStartEvent(execution));
    // SIGINT on Unix typically produces exit code 130
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 130));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Terminated',
      'a task stopped via SIGINT should be recorded as Terminated, not Failed');
  });

  test('records Terminated (not Failed) when exit code is 2 and task is marked terminated', () => {
    const task = makeTask('dev');
    const execution = makeExecution(task);

    stateManager.setExecution('dev', execution);
    stateManager.markTerminated('dev');

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 2));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Terminated');
  });

  test('records Success even when task is marked terminated and exits with code 0', () => {
    // Edge case: the task was "terminated" but still exited cleanly.
    const task = makeTask('quick');
    const execution = makeExecution(task);

    stateManager.setExecution('quick', execution);
    stateManager.markTerminated('quick');

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 0));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Success',
      'a zero exit code should always be recorded as Success regardless of terminated flag');
  });

  test('records Failed (not Terminated) when non-zero exit code and task is NOT marked terminated', () => {
    const task = makeTask('test');
    const execution = makeExecution(task);

    stateManager.setExecution('test', execution);
    // markTerminated is NOT called

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 130));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Failed',
      'exit code 130 without markTerminated should still be Failed (e.g. process exited on its own)');
  });

  // ---------------------------------------------------------------------------
  // handleTaskEnd — cleanup for non-process tasks
  // ---------------------------------------------------------------------------

  test('records Terminated via handleTaskEnd when still Running', () => {
    const task = makeTask('compound');
    const execution = makeExecution(task);

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskEnd(makeEndEvent(execution));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Terminated');
  });

  test('handleTaskEnd does not override already-resolved status', () => {
    const task = makeTask('build-end');
    const execution = makeExecution(task);

    (service as any).handleTaskStart(makeStartEvent(execution));
    (service as any).handleTaskProcessEnd(makeProcessEndEvent(execution, 0));
    (service as any).handleTaskEnd(makeEndEvent(execution));

    const groups = service.getHistoryGroups();
    assert.strictEqual(groups[0].executions[0].status, 'Success',
      'handleTaskEnd should not overwrite status set by handleTaskProcessEnd');
  });
});
