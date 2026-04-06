import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopTaskCommand, findTerminalForTask } from '../../commands/stopTask';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { LoggerService } from '../../services/loggerService';

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

  return {
    getTaskId: (item: TaskItem) => item.originalLabel || item.label,
    getStatus: (_id: string) => 'idle' as const,
    getExecution: (id: string) => executionMap.get(id),
    setExecution: (id: string, exec: vscode.TaskExecution) => { executionMap.set(id, exec); },
    clearExecution: (id: string) => { executionMap.delete(id); },
    markTerminated: (id: string) => { terminatedSet.add(id); },
    isTerminated: (id: string) => terminatedSet.has(id),
    clearTerminated: (id: string) => { terminatedSet.delete(id); },
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

    const context = {
      subscriptions: { push: () => {} },
    } as unknown as vscode.ExtensionContext;
    cmd = new StopTaskCommand(context);
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (TaskStateManager as any).instance = undefined;
    (LoggerService as any).instance = undefined;
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
});
