import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopTaskCommand, findTerminalForTask, getCompoundDependencyLabels, forceKillPreservingTerminal } from '../../commands/stopTask';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { TaskCacheService } from '../../services/taskCacheService';
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

function makeTerminalWithPid(pid: number, sendTextFn?: (text: string, addNewLine: boolean) => void): vscode.Terminal {
  const terminal = makeTerminal(sendTextFn);
  (terminal as any).processId = Promise.resolve(pid);
  return terminal;
}

function makeExecutionWithPresentation(
  presentationOptions: vscode.TaskPresentationOptions,
  terminateFn?: () => void,
): vscode.TaskExecution {
  const task = new vscode.Task(
    { type: 'shell' },
    vscode.TaskScope.Workspace,
    'test-task',
    'shell',
    new vscode.ShellExecution('echo hello'),
  );
  task.presentationOptions = presentationOptions;
  return {
    task,
    terminate: terminateFn ?? (() => {}),
  } as vscode.TaskExecution;
}

function buildFakeStateManager(overrides: Partial<TaskStateManager> = {}): TaskStateManager {
  const terminalMap = new Map<string, vscode.Terminal>();
  const stopTimerMap = new Map<string, NodeJS.Timeout>();
  const executionMap = new Map<string, vscode.TaskExecution>();
  const terminatedSet = new Set<string>();
  const blockedSet = new Set<string>();

  return {
    getTaskId: (item: TaskItem) => item.originalLabel || item.label,
    normalizeTaskId: (id: string) => id,
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
    setStatus: (_id: string, _status: string) => {},
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
    assert.ok(fakeStateManager.isTerminated(id), 'task should be marked as terminated when SIGINT is sent');

    fakeStateManager.clearStopTimer(id);
  });

  test('run marks task as terminated before sending SIGINT', async () => {
    const item = makeTaskItem('my-task-sigint-order');
    const id = fakeStateManager.getTaskId(item);
    const order: string[] = [];

    const execution = makeExecution();
    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).markTerminated = (_id: string) => { order.push('markTerminated'); };

    const terminal = makeTerminal((_text, _nl) => { order.push('sendText'); });
    (fakeStateManager as any).getTerminal = () => terminal;

    await cmd.run(item);

    assert.strictEqual(order[0], 'markTerminated', 'markTerminated should be called before sendText');
    assert.strictEqual(order[1], 'sendText', 'sendText should be called after markTerminated');

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

  test('findTerminalForTask ignores unrelated terminals when multiple are open', () => {
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'my-task', 'shell',
      new vscode.ShellExecution('echo hi'),
    );
    const unrelated1 = makeTerminal();
    (unrelated1 as any).name = 'zsh';
    const unrelated2 = makeTerminal();
    (unrelated2 as any).name = 'bash';
    const matching = makeTerminal();
    (matching as any).name = 'my-task';

    assert.strictEqual(findTerminalForTask(task, [unrelated1, unrelated2, matching]), matching);
  });

  test('findTerminalForTask does not match a terminal opened by a different concurrent task', () => {
    // Simulate two tasks running simultaneously; each should only match its own terminal.
    const taskA = new vscode.Task(
      { type: 'npm' }, vscode.TaskScope.Workspace, 'build', 'npm',
      new vscode.ShellExecution('npm run build'),
    );
    const taskB = new vscode.Task(
      { type: 'npm' }, vscode.TaskScope.Workspace, 'test', 'npm',
      new vscode.ShellExecution('npm test'),
    );
    const terminalA = makeTerminal();
    (terminalA as any).name = 'npm: build';
    const terminalB = makeTerminal();
    (terminalB as any).name = 'npm: test';
    const allTerminals = [terminalA, terminalB];

    assert.strictEqual(findTerminalForTask(taskA, allTerminals), terminalA, 'taskA should match terminalA');
    assert.strictEqual(findTerminalForTask(taskB, allTerminals), terminalB, 'taskB should match terminalB');
  });

  test('findTerminalForTask does not match via substring when name is a subset of another terminal name', () => {
    // "build" must not match a terminal named "npm: build-watch" via substring.
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'build', 'shell',
      new vscode.ShellExecution('make'),
    );
    const unrelated = makeTerminal();
    (unrelated as any).name = 'npm: build-watch';
    assert.strictEqual(findTerminalForTask(task, [unrelated]), undefined, 'substring-only match must not be accepted');
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

  test('getCompoundDependencyLabels handles self references and cycles without infinite recursion', () => {
    const tasksJson = JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'root', dependsOn: ['root', '', 'child'] },
        { label: 'child', dependsOn: 'root' },
      ],
    });

    const labels = getCompoundDependencyLabels(tasksJson, 'root');
    const asSet = new Set(labels);

    assert.strictEqual(asSet.has('child'), true);
    assert.strictEqual(asSet.has('root'), false);
    assert.strictEqual(asSet.has(''), false);
    assert.strictEqual(labels.length, 1);
  });

  test('getCompoundDependencyLabels returns empty array when tasks array is missing', () => {
    const labels = getCompoundDependencyLabels(JSON.stringify({ version: '2.0.0' }), 'build');
    assert.deepStrictEqual(labels, []);
  });

  test('getCompoundDependencyLabels ignores tasks without a label and invalid dependency objects', () => {
    const tasksJson = JSON.stringify({
      version: '2.0.0',
      tasks: [
        { dependsOn: 'prepare' },
        { label: 'build', dependsOn: [{ foo: 'bar' }, { task: 'prepare' }] },
        { label: 'prepare' },
      ],
    });

    const labels = getCompoundDependencyLabels(tasksJson, 'build');
    assert.deepStrictEqual(new Set(labels), new Set(['prepare']));
  });

  test('getCompoundDependencyLabels parses JSON with comments (catch block with regex fixes)', () => {
    const tasksJsonWithComments = `{
      /* this is a block comment */
      "version": "2.0.0",
      "tasks": [
        { "label": "build", "dependsOn": "compile" },
        { "label": "compile" }
      ]
    }`;

    const labels = getCompoundDependencyLabels(tasksJsonWithComments, 'build');
    const asSet = new Set(labels);

    assert.strictEqual(asSet.has('compile'), true);
    assert.strictEqual(labels.length, 1);
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

  test('run uses cached task when item.id is present', async () => {
    const staleItem = makeTaskItem('stale-task');
    staleItem.id = 'cached-task-id';

    const cachedItem = makeTaskItem('cached-task');
    cachedItem.id = 'cached-task-id';
    cachedItem.originalLabel = 'cached-task';

    const originalGetTask = TaskCacheService.getInstance().getTask.bind(TaskCacheService.getInstance());
    TaskCacheService.getInstance().getTask = (id: string) => (id === 'cached-task-id' ? cachedItem : undefined);

    try {
      const terminateCalls: number[] = [];
      const execution = makeExecution(() => terminateCalls.push(1));
      (fakeStateManager as any).getExecution = (id: string) => (id === 'cached-task' ? execution : undefined);
      (fakeStateManager as any).getTerminal = () => undefined;

      await cmd.run(staleItem);
      assert.strictEqual(terminateCalls.length, 1, 'cached task should be used for execution lookup');
    } finally {
      TaskCacheService.getInstance().getTask = originalGetTask;
    }
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
    assert.ok(fakeStateManager.isTerminated('dependency-task-graceful'), 'dependency should be marked as terminated when SIGINT is sent');

    fakeStateManager.clearStopTimer('dependency-task-graceful');
  });

  test('stopCompoundDependencies returns immediately when dependency stopping is disabled', async () => {
    const item = makeTaskItem('disabled-deps-root');
    const blockedIds: string[] = [];
    (fakeStateManager as any).blockTask = (id: string) => { blockedIds.push(id); };

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') {
        return false;
      }
      return defaultValue;
    };

    await (cmd as any).stopCompoundDependencies(item, 'disabled-deps-root', 'disabled');
    assert.strictEqual(blockedIds.length, 0, 'no dependencies should be blocked when stopping is disabled');
  });

  test('stopCompoundDependencies skips self dependencies and does not block them', async () => {
    const item = makeTaskItem('self-skip-root');
    const blockedIds: string[] = [];
    (fakeStateManager as any).getExecution = () => undefined;
    (fakeStateManager as any).blockTask = (id: string) => { blockedIds.push(id); };

    await (cmd as any).stopCompoundDependencies(item, 'self-skip-root', 'self-skip', ['self-skip-root']);
    assert.strictEqual(blockedIds.length, 0, 'self dependency should be skipped');
  });

  test('stopCompoundDependencies force kills a dependency when a stop timer already exists', async () => {
    const item = makeTaskItem('timer-forced-root');
    const terminateCalls: number[] = [];
    const dependencyExecution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = (id: string) => (id === 'dependency-with-timer' ? dependencyExecution : undefined);
    let clearedTimerId: string | undefined;
    (fakeStateManager as any).getStopTimer = (id: string) => (id === 'dependency-with-timer' ? setTimeout(() => {}, 60000) : undefined);
    (fakeStateManager as any).clearStopTimer = (id: string) => { clearedTimerId = id; };

    await (cmd as any).stopCompoundDependencies(item, 'timer-forced-root', 'force-timer', ['dependency-with-timer']);

    assert.strictEqual(terminateCalls.length, 1, 'dependency should be terminated immediately when a stop timer already exists');
    assert.strictEqual(clearedTimerId, 'dependency-with-timer');
  });

  test('stopCompoundDependencies blocks dependencies that are not currently running', async () => {
    const item = makeTaskItem('no-running-deps-root');
    const blockedIds: string[] = [];
    (fakeStateManager as any).getExecution = () => undefined;
    (fakeStateManager as any).blockTask = (id: string) => { blockedIds.push(id); };

    await (cmd as any).stopCompoundDependencies(item, 'no-running-deps-root', 'none-running', ['dep-a', 'dep-b']);

    assert.deepStrictEqual(blockedIds.sort(), ['dep-a', 'dep-b']);
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

  test('run fallback timer force-terminates primary task when it is still running', async () => {
    const item = makeTaskItem('primary-timeout-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = (_taskId: string) => execution;
    (fakeStateManager as any).getTerminal = (_taskId: string) => makeTerminal();

    const originalGet = configModule.configuration.get;
    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopGracefulDelayMilliseconds') {
        return 20;
      }
      return defaultValue;
    };

    await cmd.run(item);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(terminateCalls.length, 1, 'fallback timer should force-terminate when execution is unchanged');
    assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'timer should be cleared after fallback fires');

    configModule.configuration.get = originalGet;
  });

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

  test('getCompoundDependencyTaskIds returns an empty array when no task file URI can be resolved', async () => {
    const item = makeTaskItem('missing-file-uri');
    const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
    assert.deepStrictEqual(ids, []);
  });

  test('getCompoundDependencyTaskIds returns an empty array for non-file URIs', async () => {
    const item = makeTaskItem('non-file-uri');
    item.taskFileUri = vscode.Uri.parse('untitled:tasks.json');
    const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
    assert.deepStrictEqual(ids, []);
  });

  test('getCompoundDependencyTaskIds returns an empty array when the task file cannot be opened', async () => {
    const item = makeTaskItem('cannot-open-file');
    item.taskFileUri = vscode.Uri.file('/tmp/tasks.json');
    const originalOpen = vscode.workspace.openTextDocument;
    (vscode.workspace as any).openTextDocument = async () => { throw new Error('read error'); };

    try {
      const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
      assert.deepStrictEqual(ids, []);
    } finally {
      (vscode.workspace as any).openTextDocument = originalOpen;
    }
  });

  test('getCompoundDependencyTaskIds returns an empty array when task dependencies cannot be parsed', async () => {
    const item = makeTaskItem('parse-error');
    item.taskFileUri = vscode.Uri.file('/tmp/invalid-tasks.json');
    const originalOpen = vscode.workspace.openTextDocument;
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => 'not-a-valid-json' } as any);

    try {
      const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
      assert.deepStrictEqual(ids, []);
    } finally {
      (vscode.workspace as any).openTextDocument = originalOpen;
    }
  });

  test('getCompoundDependencyTaskIds returns an empty array when there are no resolved dependency labels', async () => {
    const item = makeTaskItem('no-dependency-labels');
    item.taskFileUri = vscode.Uri.file('/tmp/empty-tasks.json');
    const originalOpen = vscode.workspace.openTextDocument;
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => JSON.stringify({ version: '2.0.0', tasks: [{ label: 'root' }] }) } as any);

    try {
      const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
      assert.deepStrictEqual(ids, []);
    } finally {
      (vscode.workspace as any).openTextDocument = originalOpen;
    }
  });

  test('getCompoundDependencyTaskIds includes duplicate fallback IDs when the task cache has deconflicted IDs', async () => {
    const item = makeTaskItem('build-root');
    item.taskFileUri = vscode.Uri.file('/tmp/build-tasks.json');
    const originalOpen = vscode.workspace.openTextDocument;
    const originalGetAllTasks = TaskCacheService.getInstance().getAllTasks.bind(TaskCacheService.getInstance());
    const originalGetTaskId = fakeStateManager.getTaskId.bind(fakeStateManager);

    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'build-root', dependsOn: ['build'] },
        { label: 'build' },
      ],
    }) } as any);

    TaskCacheService.getInstance().getAllTasks = () => [
      Object.assign(makeTaskItem('build'), {
        taskType: 'vscode',
        taskFileUri: vscode.Uri.file('/tmp/build-tasks.json'),
        id: 'build|1',
      }),
    ];
    fakeStateManager.getTaskId = (taskItem: TaskItem) => taskItem.id ?? taskItem.originalLabel ?? taskItem.label;

    try {
      const ids = await (cmd as any).getCompoundDependencyTaskIds(item);
      assert.ok(ids.includes('build|1'), 'canonical deconflicted ID should be included');
      assert.ok(ids.includes('build'), 'base ID fallback should be included');
    } finally {
      (vscode.workspace as any).openTextDocument = originalOpen;
      TaskCacheService.getInstance().getAllTasks = originalGetAllTasks;
      fakeStateManager.getTaskId = originalGetTaskId;
    }
  });

  // -------------------------------------------------------------------------
  // CircleCI workflow cancellation
  // -------------------------------------------------------------------------

  test('run cancels circleci workflow and terminates all job executions', async () => {
    const item = new TaskItem('my-workflow', vscode.TreeItemCollapsibleState.None, 'circleci');
    item.originalLabel = 'my-workflow';
    (item as any).metadata = { type: 'workflow', workflowRunId: 'run-abc-123' };

    const cancelledWorkflows: string[] = [];
    const jobTerminateCalls: string[] = [];
    const statusSet: Array<{ id: string; status: string }> = [];

    const jobItem1 = makeTaskItem('job-1');
    const jobItem2 = makeTaskItem('job-2');
    const jobExecution1 = makeExecution(() => jobTerminateCalls.push('job-1'));
    const jobExecution2 = makeExecution(() => jobTerminateCalls.push('job-2'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const CompoundTaskServiceModule = require('../../services/compoundTaskService');
    const fakeCompoundService = {
      cancelCompoundTask: (id: string) => { cancelledWorkflows.push(id); },
      getCompoundTask: (_id: string) => [jobItem1, jobItem2],
    };
    (CompoundTaskServiceModule.CompoundTaskService as any).instance = fakeCompoundService;

    const markedTerminated: string[] = [];
    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'job-1') { return jobExecution1; }
      if (id === 'job-2') { return jobExecution2; }
      return undefined;
    };
    (fakeStateManager as any).markTerminated = (id: string) => { markedTerminated.push(id); };
    (fakeStateManager as any).setStatus = (id: string, status: string) => { statusSet.push({ id, status }); };

    await cmd.run(item);

    assert.ok(cancelledWorkflows.includes('run-abc-123'), 'workflow should be cancelled');
    assert.ok(jobTerminateCalls.includes('job-1'), 'job-1 execution should be terminated');
    assert.ok(jobTerminateCalls.includes('job-2'), 'job-2 execution should be terminated');
    assert.ok(markedTerminated.includes('job-1'), 'job-1 should be marked as terminated');
    assert.ok(markedTerminated.includes('job-2'), 'job-2 should be marked as terminated');
    assert.ok(statusSet.some(s => s.status === 'idle'), 'workflow status should be set to idle');

    (CompoundTaskServiceModule.CompoundTaskService as any).instance = undefined;
  });

  test('run skips workflow cancellation when workflowRunId cannot be resolved', async () => {
    // metadata has type 'workflow' but no workflowRunId, and item has no taskFileUri/resourceUri
    // → getCircleCiWorkflowRunId returns undefined → the if(workflowRunId) block is NOT entered
    // → falls through to the no-execution branch (no execution tracked → early return)
    const item = new TaskItem('no-run-id-workflow', vscode.TreeItemCollapsibleState.None, 'circleci');
    item.originalLabel = 'no-run-id-workflow';
    (item as any).metadata = { type: 'workflow' };

    // No execution tracked, no crash expected
    await cmd.run(item);
  });

  test('run cancels circleci workflow job that has no execution (skips jobExecution guard)', async () => {
    const item = new TaskItem('workflow-with-unstarted-job', vscode.TreeItemCollapsibleState.None, 'circleci');
    item.originalLabel = 'workflow-with-unstarted-job';
    (item as any).metadata = { type: 'workflow', workflowRunId: 'run-xyz-999' };

    const statusSet: Array<{ id: string; status: string }> = [];
    const jobItem = makeTaskItem('unstarted-job');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const CompoundTaskServiceModule = require('../../services/compoundTaskService');
    (CompoundTaskServiceModule.CompoundTaskService as any).instance = {
      cancelCompoundTask: () => {},
      getCompoundTask: () => [jobItem],
    };

    // Job has no execution — the inner if(jobExecution) block should be skipped gracefully
    (fakeStateManager as any).getExecution = (_id: string) => undefined;
    (fakeStateManager as any).setStatus = (id: string, status: string) => { statusSet.push({ id, status }); };

    await cmd.run(item);

    assert.ok(statusSet.some(s => s.status === 'idle'), 'workflow status should still be set to idle');

    (CompoundTaskServiceModule.CompoundTaskService as any).instance = undefined;
  });

  // -------------------------------------------------------------------------
  // Dependency graceful-stop timer fires – force-terminate after timeout
  // -------------------------------------------------------------------------

  test('stopCompoundDependencies timer fires and force-terminates dependency if still running', (done) => {
    const item = makeTaskItem('parent-timer-test');
    const parentExecution = makeExecution();
    const depTerminateCalls: number[] = [];
    const depExecution = makeExecution(() => depTerminateCalls.push(1));

    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'parent-timer-test') { return parentExecution; }
      if (id === 'dep-timer-task') { return depExecution; }
      return undefined;
    };

    const depTerminal = makeTerminal();
    (fakeStateManager as any).getTerminal = (id: string) => {
      if (id === 'dep-timer-task') { return depTerminal; }
      return undefined;
    };

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') { return true; }
      if (key === 'task.stopGracefulDelayMilliseconds') { return 20; }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['dep-timer-task'];

    cmd.run(item).then(() => {
      setTimeout(() => {
        assert.strictEqual(depTerminateCalls.length, 1, 'dependency should be force-terminated after graceful stop timeout');
        done();
      }, 100);
    }).catch(done);
  });

  test('stopCompoundDependencies timer does NOT force-terminate if execution has changed', (done) => {
    const item = makeTaskItem('parent-timer-noop-test');
    const parentExecution = makeExecution();
    const depTerminateCalls: number[] = [];
    const depExecution = makeExecution(() => depTerminateCalls.push(1));

    let depExecutionCleared = false;
    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'parent-timer-noop-test') { return parentExecution; }
      if (id === 'dep-timer-noop-task') { return depExecutionCleared ? undefined : depExecution; }
      return undefined;
    };

    const depTerminal = makeTerminal();
    (fakeStateManager as any).getTerminal = (id: string) => {
      if (id === 'dep-timer-noop-task') { return depTerminal; }
      return undefined;
    };

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') { return true; }
      if (key === 'task.stopGracefulDelayMilliseconds') { return 20; }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['dep-timer-noop-task'];

    cmd.run(item).then(() => {
      depExecutionCleared = true;
      setTimeout(() => {
        assert.strictEqual(depTerminateCalls.length, 0, 'terminate must not be called if execution has already cleared');
        done();
      }, 100);
    }).catch(done);
  });

  // -------------------------------------------------------------------------
  // forceKillPreservingTerminal
  // -------------------------------------------------------------------------

  suite('forceKillPreservingTerminal', () => {
    let originalProcessKill: typeof process.kill;
    const killSpy: Array<{ pid: number; signal: string | number | undefined }> = [];

    setup(() => {
      killSpy.length = 0;
      originalProcessKill = process.kill;
      (process as any).kill = (pid: number, signal: string | number | undefined) => {
        killSpy.push({ pid, signal });
        return true;
      };
    });

    teardown(() => {
      (process as any).kill = originalProcessKill;
    });

    test('calls process.kill with SIGKILL when presentation.close is false and processId is available', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99001);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called once');
      assert.strictEqual(killSpy[0].pid, 99001, 'should kill the correct pid');
      assert.strictEqual(killSpy[0].signal, 'SIGKILL', 'should use SIGKILL');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
    });

    test('calls execution.terminate when presentation.close is true', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: true }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99002);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called when close is true');
      assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called');
    });

    test('calls execution.terminate when no terminal is provided', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));

      await forceKillPreservingTerminal(undefined, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called without a terminal');
      assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called as fallback');
    });

    test('calls execution.terminate when processId is unavailable', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminal(); // no processId property

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called when processId is unavailable');
      assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called as fallback');
    });

    test('falls back to execution.terminate when process.kill throws', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99003);
      (process as any).kill = () => { throw new Error('Permission denied'); };

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called when process.kill throws');
    });

    test('calls process.kill when presentation.close is not set (defaults to false)', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({}, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99004);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called when close is unset (defaults to false)');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
    });
  });

  // -------------------------------------------------------------------------
  // Graceful delay of 0 — opt out of force-kill
  // -------------------------------------------------------------------------

  test('delay of 0 with terminal sends SIGINT but does not schedule a fallback timer', async () => {
    const item = makeTaskItem('zero-delay-with-terminal');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const sentTexts: Array<{ text: string }> = [];

    const execution = makeExecution(() => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminal((text) => sentTexts.push({ text }));
    (fakeStateManager as any).getTerminal = () => terminal;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopGracefulDelayMilliseconds') { return 0; }
      return defaultValue;
    };

    await cmd.run(item);

    assert.strictEqual(sentTexts.length, 1, 'SIGINT should still be sent');
    assert.strictEqual(sentTexts[0].text, '\u0003');
    assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'no fallback timer should be scheduled');
    assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when delay is 0');
    assert.ok(fakeStateManager.isTerminated(id), 'task should be marked as terminated');
  });

  test('delay of 0 without terminal does not call execution.terminate', async () => {
    const item = makeTaskItem('zero-delay-no-terminal');
    const terminateCalls: number[] = [];

    const execution = makeExecution(() => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => undefined;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopGracefulDelayMilliseconds') { return 0; }
      return defaultValue;
    };

    await cmd.run(item);

    assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when delay is 0 and no terminal');
    assert.ok(fakeStateManager.isTerminated(fakeStateManager.getTaskId(item)), 'task should be marked as terminated');
  });

  // -------------------------------------------------------------------------
  // Fallback timer uses forceKillPreservingTerminal
  // -------------------------------------------------------------------------

  test('fallback timer calls process.kill when presentation.close is false and processId available', (done) => {
    const originalProcessKill = process.kill;
    const killSpy: Array<{ pid: number }> = [];
    (process as any).kill = (pid: number) => { killSpy.push({ pid }); return true; };

    const item = makeTaskItem('timer-preserve-terminal-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const pid = 77001;

    const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = (_id: string) => execution;
    const terminal = makeTerminalWithPid(pid);
    (fakeStateManager as any).getTerminal = (_id: string) => terminal;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopGracefulDelayMilliseconds') { return 20; }
      return defaultValue;
    };

    cmd.run(item).then(() => {
      setTimeout(() => {
        assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'timer should have fired and been cleared');
        assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
        assert.strictEqual(killSpy.length, 1, 'process.kill should be called to preserve terminal');
        assert.strictEqual(killSpy[0].pid, pid, 'should kill the correct pid');
        (process as any).kill = originalProcessKill;
        done();
      }, 100);
    }).catch((err: Error) => {
      (process as any).kill = originalProcessKill;
      done(err);
    });
  });

  test('fallback timer calls execution.terminate when presentation.close is true', (done) => {
    const item = makeTaskItem('timer-close-terminal-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];

    const execution = makeExecutionWithPresentation({ close: true }, () => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = (_id: string) => execution;
    const terminal = makeTerminalWithPid(77002);
    (fakeStateManager as any).getTerminal = (_id: string) => terminal;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopGracefulDelayMilliseconds') { return 20; }
      return defaultValue;
    };

    cmd.run(item).then(() => {
      setTimeout(() => {
        assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'timer should have fired and been cleared');
        assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called when close is true');
        done();
      }, 100);
    }).catch(done);
  });

  // -------------------------------------------------------------------------
  // Second click uses forceKillPreservingTerminal
  // -------------------------------------------------------------------------

  test('second click uses process.kill to preserve terminal when presentation.close is false', async () => {
    const originalProcessKill = process.kill;
    const killSpy: Array<{ pid: number }> = [];
    (process as any).kill = (pid: number) => { killSpy.push({ pid }); return true; };

    try {
      const item = makeTaskItem('second-click-preserve-terminal');
      const id = fakeStateManager.getTaskId(item);
      const terminateCalls: number[] = [];
      const pid = 88001;

      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      (fakeStateManager as any).getExecution = () => execution;
      const terminal = makeTerminalWithPid(pid);
      (fakeStateManager as any).getTerminal = () => terminal;

      const existingTimer = setTimeout(() => {}, 60_000);
      fakeStateManager.setStopTimer(id, existingTimer);

      await cmd.run(item);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called on second click when close is false');
      assert.strictEqual(killSpy[0].pid, pid, 'should kill the correct pid');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
      assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'timer should be cleared');
    } finally {
      (process as any).kill = originalProcessKill;
    }
  });

  // -------------------------------------------------------------------------
  // Compound dependency delay of 0 — opt out of force-kill
  // -------------------------------------------------------------------------

  test('delay of 0 with dependency terminal sends SIGINT but does not schedule a timer for dependency', async () => {
    const item = makeTaskItem('zero-delay-compound-root');
    const childTerminateCalls: number[] = [];
    const depSignals: Array<{ text: string }> = [];

    const parentTask = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'xyzzy-parent-zero-delay', 'shell',
      new vscode.ShellExecution('echo parent'),
    );
    const parentExecutionObj = { task: parentTask, terminate: () => {} } as vscode.TaskExecution;
    const childExecution = makeExecution(() => childTerminateCalls.push(1));

    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'zero-delay-compound-root') { return parentExecutionObj; }
      if (id === 'zero-delay-dep') { return childExecution; }
      return undefined;
    };

    const depTerminal = makeTerminal((text) => depSignals.push({ text }));
    (fakeStateManager as any).getTerminal = (id: string) => (id === 'zero-delay-dep' ? depTerminal : undefined);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') { return true; }
      if (key === 'task.stopGracefulDelayMilliseconds') { return 0; }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['zero-delay-dep'];

    await cmd.run(item);

    assert.strictEqual(depSignals.length, 1, 'SIGINT should be sent to dependency terminal');
    assert.strictEqual(depSignals[0].text, '\u0003');
    assert.strictEqual(fakeStateManager.getStopTimer('zero-delay-dep'), undefined, 'no timer should be scheduled for dependency when delay is 0');
    assert.strictEqual(childTerminateCalls.length, 0, 'dependency should NOT be force-terminated when delay is 0');
  });

  test('delay of 0 without dependency terminal does not terminate the dependency', async () => {
    const item = makeTaskItem('zero-delay-no-terminal-root');
    const childTerminateCalls: number[] = [];

    const parentTask = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'xyzzy-parent-no-term-zero', 'shell',
      new vscode.ShellExecution('echo parent'),
    );
    const parentExecutionObj = { task: parentTask, terminate: () => {} } as vscode.TaskExecution;
    const childExecution = makeExecution(() => childTerminateCalls.push(1));

    (fakeStateManager as any).getExecution = (id: string) => {
      if (id === 'zero-delay-no-terminal-root') { return parentExecutionObj; }
      if (id === 'zero-delay-no-term-dep') { return childExecution; }
      return undefined;
    };
    (fakeStateManager as any).getTerminal = () => undefined;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.stopCompoundDependencies') { return true; }
      if (key === 'task.stopGracefulDelayMilliseconds') { return 0; }
      return defaultValue;
    };

    (cmd as any).getCompoundDependencyTaskIds = async () => ['zero-delay-no-term-dep'];

    await cmd.run(item);

    assert.strictEqual(childTerminateCalls.length, 0, 'dependency should NOT be force-terminated when delay is 0 and no terminal');
    assert.ok(fakeStateManager.isTerminated('zero-delay-no-term-dep'), 'dependency should still be marked as terminated');
  });
});
