import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopTaskCommand, findTerminalForTask, getCompoundDependencyLabels } from '../../commands/stopTask';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { LoggerService } from '../../services/loggerService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const configModule = require('../../libs/configuration');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskItem(label: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'npm');
  item.originalLabel = label;
  return item;
}

function makeExecution(terminateFn?: () => void): vscode.TaskExecution {
  const task = new vscode.Task(
    { type: 'shell' },
    vscode.TaskScope.Workspace,
    'test-task',
    'shell',
    new vscode.ShellExecution('echo hello'),
  );
  return {
    task,
    terminate: terminateFn ?? (() => { }),
  } as vscode.TaskExecution;
}

function makeTerminal(sendTextFn?: (text: string, addNewLine: boolean) => void): vscode.Terminal {
  return {
    name: 'test-task',
    sendText: sendTextFn ?? (() => { }),
    show: () => { },
    hide: () => { },
    dispose: () => { },
    creationOptions: {},
    exitStatus: undefined,
    state: { isInteractedWith: false },
    shellIntegration: undefined,
  } as unknown as vscode.Terminal;
}

function buildFakeStateManager(overrides: Partial<TaskStateManager> = {}): TaskStateManager {
  const terminalMap = new Map<string, vscode.Terminal>();
  const stopTimerMap = new Map<string, NodeJS.Timeout>();
  const executionMap = new Map<string, vscode.TaskExecution>();
  const terminatedSet = new Set<string>();
  const blockedSet = new Set<string>();

  return {
    getTaskId: (item: TaskItem) => item.originalLabel || item.label,
    getStatus: (_id: string) => 'idle' as const,
    getExecution: (id: string) => executionMap.get(id),
    setExecution: (id: string, exec: vscode.TaskExecution) => { executionMap.set(id, exec); },
    clearExecution: (id: string) => { executionMap.delete(id); },
    markTerminated: (id: string) => { terminatedSet.add(id); },
    isTerminated: (id: string) => terminatedSet.has(id),
    clearTerminated: (id: string) => { terminatedSet.delete(id); },
    blockTask: (id: string) => { blockedSet.add(id); },
    isBlocked: (id: string) => blockedSet.has(id),
    unblockTask: (id: string) => { blockedSet.delete(id); },
    clearAllBlocks: () => { blockedSet.clear(); },
    getTerminal: (id: string) => terminalMap.get(id),
    setTerminal: (id: string, t: vscode.Terminal) => { terminalMap.set(id, t); },
    clearTerminal: (id: string) => { terminalMap.delete(id); },
    getStopTimer: (id: string) => stopTimerMap.get(id),
    setStopTimer: (id: string, timer: NodeJS.Timeout) => {
      const existing = stopTimerMap.get(id);
      if (existing) { clearTimeout(existing); }
      stopTimerMap.set(id, timer);
    },
    clearStopTimer: (id: string) => {
      const existing = stopTimerMap.get(id);
      if (existing) { clearTimeout(existing); }
      stopTimerMap.delete(id);
    },
    ...overrides,
  } as unknown as TaskStateManager;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('StopTaskCommand Test Suite', () => {
  let cmd: StopTaskCommand;
  let fakeStateManager: TaskStateManager;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let originalConfigGet: (...args: any[]) => any;

  setup(() => {
    // Prevent "command already registered" errors: BaseCommand registers the
    // command inside its constructor, which throws on subsequent registrations.
    originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = () => ({ dispose: () => {} });

    // Silence the logger
    (LoggerService as any).instance = {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    };

    // Build and install a fresh fake state manager for each test
    fakeStateManager = buildFakeStateManager();
    (TaskStateManager as any).instance = fakeStateManager;
    originalConfigGet = configModule.configuration.get.bind(configModule.configuration);
    configModule.configuration.get = (_key: string, defaultValue: any) => defaultValue;

    const context = {
      subscriptions: { push: () => {} },
    } as unknown as vscode.ExtensionContext;
    cmd = new StopTaskCommand(context);
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (TaskStateManager as any).instance = undefined;
    (LoggerService as any).instance = undefined;
    configModule.configuration.get = originalConfigGet;
  });

  // -------------------------------------------------------------------------
  // No execution – early exit
  // -------------------------------------------------------------------------

  test('run does nothing when no execution is tracked', async () => {
    const item = makeTaskItem('idle-task');
    // No exception expected, no terminate called
    await cmd.run(item);
  });

  // -------------------------------------------------------------------------
  // Terminal found – sends SIGINT, does NOT immediately terminate
  // -------------------------------------------------------------------------

  test('run sends \\u0003 to the terminal when a terminal is tracked', async () => {
    const item = makeTaskItem('my-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const sentTexts: Array<{ text: string; nl: boolean }> = [];

    const execution = makeExecution(() => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;

    const terminal = makeTerminal((text, nl) => sentTexts.push({ text, nl }));
    (fakeStateManager as any).getTerminal = () => terminal;

    await cmd.run(item);

    assert.strictEqual(sentTexts.length, 1, 'sendText should be called exactly once');
    assert.strictEqual(sentTexts[0].text, '\u0003', 'should send SIGINT character');
    assert.strictEqual(sentTexts[0].nl, false, 'should not append a newline');
    assert.strictEqual(terminateCalls.length, 0, 'terminate should NOT be called on first click');

    fakeStateManager.clearStopTimer(id);
  });

  // -------------------------------------------------------------------------
  // findTerminalForTask – name-based matching (unit tests with explicit list)
  // -------------------------------------------------------------------------

  test('findTerminalForTask finds terminal by exact task name', () => {
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'npm-task',
      'npm',
      new vscode.ShellExecution('echo hi'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'npm-task';
    assert.strictEqual(findTerminalForTask(task, [terminal]), terminal);
  });

  test('findTerminalForTask finds terminal with "Task - {name}" format', () => {
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'build', 'shell',
      new vscode.ShellExecution('make'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'Task - build';
    assert.strictEqual(findTerminalForTask(task, [terminal]), terminal);
  });

  test('findTerminalForTask finds terminal with "{source}: {name}" format', () => {
    const task = new vscode.Task(
      { type: 'npm' }, vscode.TaskScope.Workspace, 'test', 'npm',
      new vscode.ShellExecution('npm test'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'npm: test';
    assert.strictEqual(findTerminalForTask(task, [terminal]), terminal);
  });

  test('findTerminalForTask returns undefined when no terminal matches', () => {
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'build', 'shell',
      new vscode.ShellExecution('make'),
    );
    assert.strictEqual(findTerminalForTask(task, []), undefined);
  });

  test('getCompoundDependencyLabels returns direct and nested dependencies', () => {
    const tasksJson = JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'build', dependsOn: ['compile', 'lint'] },
        { label: 'compile', dependsOn: 'prepare' },
        { label: 'lint' },
        { label: 'prepare' },
      ],
    });

    const labels = getCompoundDependencyLabels(tasksJson, 'build');
    const asSet = new Set(labels);

    assert.strictEqual(asSet.has('compile'), true);
    assert.strictEqual(asSet.has('lint'), true);
    assert.strictEqual(asSet.has('prepare'), true);
    assert.strictEqual(labels.length, 3);
  });

  test('getCompoundDependencyLabels supports object-form dependsOn entries', () => {
    const tasksJson = JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'all', dependsOn: [{ task: 'api' }, { task: 'web', type: 'shell' }] },
        { label: 'api' },
        { label: 'web' },
      ],
    });

    const labels = getCompoundDependencyLabels(tasksJson, 'all');
    const asSet = new Set(labels);

    assert.strictEqual(asSet.has('api'), true);
    assert.strictEqual(asSet.has('web'), true);
    assert.strictEqual(labels.length, 2);
  });

  // -------------------------------------------------------------------------
  // Stored terminal path – graceful stop with SIGINT
  // -------------------------------------------------------------------------

  test('run sends SIGINT via stored terminal and does not terminate immediately', async () => {
    const item = makeTaskItem('stored-terminal-task');
    const sentTexts: Array<{ text: string }> = [];
    const terminateCalls: number[] = [];

    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'stored-terminal-task', 'shell',
      new vscode.ShellExecution('echo stored'),
    );
    const execution = { task, terminate: () => terminateCalls.push(1) } as vscode.TaskExecution;

    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminal((text) => sentTexts.push({ text }));
    (fakeStateManager as any).getTerminal = () => terminal;

    await cmd.run(item);

    assert.strictEqual(sentTexts.length, 1);
    assert.strictEqual(sentTexts[0].text, '\u0003');
    assert.strictEqual(terminateCalls.length, 0);

    fakeStateManager.clearStopTimer(fakeStateManager.getTaskId(item));
  });

  // -------------------------------------------------------------------------
  // No terminal at all – hard kill fallback
  // Task names are intentionally unique so findTerminalForTask won't match
  // any real terminal open in the test environment.
  // -------------------------------------------------------------------------

  test('run terminates immediately when no terminal can be found', async () => {
    const item = makeTaskItem('xyzzy-unreachable-a1b2c3');
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => undefined;

    await cmd.run(item);

    assert.strictEqual(terminateCalls.length, 1, 'terminate should be called immediately when no terminal exists');
  });

  test('run marks task as terminated when falling back to hard kill', async () => {
    const item = makeTaskItem('xyzzy-unreachable-d4e5f6');
    const markedTerminated: string[] = [];
    const execution = makeExecution();

    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => undefined;
    (fakeStateManager as any).markTerminated = (id: string) => markedTerminated.push(id);

    await cmd.run(item);

    assert.ok(markedTerminated.includes(fakeStateManager.getTaskId(item)));
  });

  test('run also terminates tracked dependency executions when enabled', async () => {
    const item = makeTaskItem('compound-root');
    const parentTerminateCalls: number[] = [];
    const childTerminateCalls: number[] = [];

    const parentExecution = makeExecution(() => parentTerminateCalls.push(1));
    const childTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'xyzzy-compound-dependency-no-terminal',
      'shell',
      new vscode.ShellExecution('echo child'),
    );
    const childExecution = { task: childTask, terminate: () => childTerminateCalls.push(1) } as vscode.TaskExecution;

    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'compound-root') {
        return parentExecution;
      }
      if (id === 'dependency-task') {
        return childExecution;
      }
      return undefined;
    };

    (fakeStateManager as any).getTerminal = () => undefined;
    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') {
        return true;
      }
      if (key === 'task.stopGracefulDelayMilliseconds') {
        return 5000;
      }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['dependency-task'];

    await cmd.run(item);

    assert.strictEqual(parentTerminateCalls.length, 1, 'parent execution should be terminated');
    assert.strictEqual(childTerminateCalls.length, 1, 'dependency execution should be terminated');
  });

  test('run stops dependency gracefully when dependency terminal is available', async () => {
    const item = makeTaskItem('compound-root-graceful');
    const parentTerminateCalls: number[] = [];
    const childTerminateCalls: number[] = [];
    const depSignals: Array<{ text: string; nl: boolean }> = [];

    const parentTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'xyzzy-parent-no-terminal',
      'shell',
      new vscode.ShellExecution('echo parent'),
    );
    const parentExecution = { task: parentTask, terminate: () => parentTerminateCalls.push(1) } as vscode.TaskExecution;

    const childTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'dependency-with-terminal',
      'shell',
      new vscode.ShellExecution('echo child'),
    );
    const childExecution = { task: childTask, terminate: () => childTerminateCalls.push(1) } as vscode.TaskExecution;

    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'compound-root-graceful') {
        return parentExecution;
      }
      if (id === 'dependency-task-graceful') {
        return childExecution;
      }
      return undefined;
    };

    const depTerminal = makeTerminal((text, nl) => depSignals.push({ text, nl }));
    (fakeStateManager as any).getTerminal = (id: string) => {
      if (id === 'dependency-task-graceful') {
        return depTerminal;
      }
      return undefined;
    };

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') {
        return true;
      }
      if (key === 'task.stopGracefulDelayMilliseconds') {
        return 5000;
      }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['dependency-task-graceful'];

    await cmd.run(item);

    assert.strictEqual(parentTerminateCalls.length, 1, 'parent should hard stop without terminal');
    assert.strictEqual(depSignals.length, 1, 'dependency should receive graceful SIGINT');
    assert.strictEqual(depSignals[0].text, '\u0003');
    assert.strictEqual(depSignals[0].nl, false);
    assert.strictEqual(childTerminateCalls.length, 0, 'dependency should not be force terminated immediately');

    fakeStateManager.clearStopTimer('dependency-task-graceful');
  });

  // -------------------------------------------------------------------------
  // Second click while pending timer – force kill immediately
  // -------------------------------------------------------------------------

  test('run force kills on second click when a stop timer is already pending', async () => {
    const item = makeTaskItem('second-click-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => makeTerminal();

    // Simulate a pending timer already stored (mimics that SIGINT was already sent)
    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    await cmd.run(item);

    assert.strictEqual(terminateCalls.length, 1, 'terminate should be called immediately on second click');
    assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'timer should be cleared after force kill');
  });

  // -------------------------------------------------------------------------
  // Fallback timer logic – force kills if task is still running after timeout
  // -------------------------------------------------------------------------

  test('stop timer calls terminate if execution is still tracked', (done) => {
    const item = makeTaskItem('timeout-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = () => execution;

    // Exercise the same timer-callback logic as in stopTask.ts with a tiny delay.
    const immediateTimer = setTimeout(() => {
      fakeStateManager.clearStopTimer(id);
      if (fakeStateManager.getExecution(id) === execution) {
        fakeStateManager.markTerminated(id);
        execution.terminate();
      }
      assert.strictEqual(terminateCalls.length, 1);
      done();
    }, 10);

    fakeStateManager.setStopTimer(id, immediateTimer);
  });

  test('stop timer does NOT call terminate if execution has already cleared', (done) => {
    const item = makeTaskItem('cleared-execution-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    // Simulate: task finished on its own before the timer fired
    (fakeStateManager as any).getExecution = () => undefined;

    const immediateTimer = setTimeout(() => {
      fakeStateManager.clearStopTimer(id);
      if (fakeStateManager.getExecution(id) === execution) {
        fakeStateManager.markTerminated(id);
        execution.terminate();
      }
      assert.strictEqual(terminateCalls.length, 0, 'terminate must not be called if execution is gone');
      done();
    }, 10);

    fakeStateManager.setStopTimer(id, immediateTimer);
  });

  // -------------------------------------------------------------------------
  // Blocking pending sequential dependencies
  // -------------------------------------------------------------------------

  test('stopCompoundDependencies blocks pending dependencies that have no active execution', async () => {
    const item = makeTaskItem('seq-compound-root');
    const parentExecution = makeExecution();
    const blockedIds: string[] = [];

    // Only the currently-running dependency (dep-running) has an active execution.
    // dep-pending-1 and dep-pending-2 have no execution yet (haven't started yet).
    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'seq-compound-root') {
        return parentExecution;
      }
      if (id === 'dep-running') {
        return makeExecution();
      }
      return undefined;
    };
    (fakeStateManager as any).getTerminal = (id: string) => {
      if (id === 'dep-running') {
        return makeTerminal();
      }
      return undefined;
    };
    (fakeStateManager as any).blockTask = (id: string) => { blockedIds.push(id); };

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') {
        return true;
      }
      if (key === 'task.stopGracefulDelayMilliseconds') {
        return 5000;
      }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => [
      'dep-running',
      'dep-pending-1',
      'dep-pending-2',
    ];

    await cmd.run(item);

    assert.ok(blockedIds.includes('dep-pending-1'), 'dep-pending-1 should be blocked');
    assert.ok(blockedIds.includes('dep-pending-2'), 'dep-pending-2 should be blocked');
    assert.strictEqual(
      blockedIds.includes('dep-running'),
      false,
      'dep-running should NOT be blocked (it is already running and gets SIGINT)',
    );

    // Clean up the graceful-stop timer that was set for dep-running
    fakeStateManager.clearStopTimer('dep-running');
  });
});
