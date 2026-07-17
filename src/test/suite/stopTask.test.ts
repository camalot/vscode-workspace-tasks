import * as assert from 'assert';
import * as vscode from 'vscode';
import { StopTaskCommand, findTerminalForTask, getCompoundDependencyLabels, forceKillPreservingTerminal, ForceStopSignal } from '../../commands/stopTask';
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
    assert.ok(fakeStateManager.getStopTimer(id) !== undefined, 'pending marker should be set so a second click can be detected');

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

  test('findTerminalForTask returns the last matching terminal when multiple share the same name (most recently opened wins)', () => {
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'build', 'shell',
      new vscode.ShellExecution('make'),
    );
    const stale = makeTerminal();
    (stale as any).name = 'build';
    const current = makeTerminal();
    (current as any).name = 'build';

    assert.strictEqual(findTerminalForTask(task, [stale, current]), current, 'should return the last (most recent) match');
  });

  test('findTerminalForTask finds terminal with "{name} (workspaceFolder)" format for multi-root workspaces', () => {
    const folder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/workspace/simple'),
      name: 'simple',
      index: 0,
    };
    const task = new vscode.Task(
      { type: 'shell' }, folder, 'Cancelable', 'shell',
      new vscode.ShellExecution('sleep infinity'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'Cancelable (simple)';
    assert.strictEqual(findTerminalForTask(task, [terminal]), terminal);
  });

  test('findTerminalForTask finds terminal with "{source}: {name} (workspaceFolder)" format for multi-root workspaces', () => {
    const folder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/workspace/simple'),
      name: 'simple',
      index: 0,
    };
    const task = new vscode.Task(
      { type: 'npm' }, folder, 'build', 'npm',
      new vscode.ShellExecution('npm run build'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'npm: build (simple)';
    assert.strictEqual(findTerminalForTask(task, [terminal]), terminal);
  });

  test('findTerminalForTask does not match workspace-scoped terminal name when task has no workspace folder', () => {
    const task = new vscode.Task(
      { type: 'shell' }, vscode.TaskScope.Workspace, 'Cancelable', 'shell',
      new vscode.ShellExecution('sleep infinity'),
    );
    const terminal = makeTerminal();
    (terminal as any).name = 'Cancelable (simple)';
    assert.strictEqual(findTerminalForTask(task, [terminal]), undefined);
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
  // No terminal at all – warn the user rather than force-terminating
  // Task names are intentionally unique so findTerminalForTask won't match
  // any real terminal open in the test environment.
  // -------------------------------------------------------------------------

  test('run shows warning and does not terminate when no terminal can be found', async () => {
    const item = makeTaskItem('xyzzy-unreachable-a1b2c3');
    const terminateCalls: number[] = [];
    const execution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => undefined;

    const warnings: string[] = [];
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => { warnings.push(msg); };

    try {
      await cmd.run(item);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(terminateCalls.length, 0, 'terminate should NOT be called when no terminal exists');
    assert.strictEqual(warnings.length, 1, 'a warning should be shown when no terminal exists');
    assert.ok(warnings[0].includes('Unable to stop'), 'warning message should indicate failure to stop');
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
    assert.ok(fakeStateManager.getStopTimer('dependency-task-graceful') !== undefined, 'pending marker should be set for the dependency');

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

  test('stopCompoundDependencies force kills a dependency when a stop marker already exists', async () => {
    const item = makeTaskItem('timer-forced-root');
    const terminateCalls: number[] = [];
    const dependencyExecution = makeExecution(() => terminateCalls.push(1));

    (fakeStateManager as any).getExecution = (id: string) => (id === 'dependency-with-timer' ? dependencyExecution : undefined);
    let clearedTimerId: string | undefined;
    (fakeStateManager as any).getStopTimer = (id: string) => (id === 'dependency-with-timer' ? setTimeout(() => {}, 60000) : undefined);
    (fakeStateManager as any).clearStopTimer = (id: string) => { clearedTimerId = id; };
    (fakeStateManager as any).getTerminal = () => undefined;

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'SIGKILL'; }
      if (key === 'task.stopCompoundDependencies') { return true; }
      return defaultValue;
    };

    await (cmd as any).stopCompoundDependencies(item, 'timer-forced-root', 'force-timer', ['dependency-with-timer']);

    assert.strictEqual(terminateCalls.length, 1, 'dependency should be terminated immediately when a stop marker already exists');
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

  // -------------------------------------------------------------------------
  // Second click while pending – force stop with configured/chosen signal
  // -------------------------------------------------------------------------

  test('run force kills on second click using configured SIGKILL when a stop marker is pending', async () => {
    const item = makeTaskItem('second-click-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const killSpy: Array<{ pid: number; signal: string }> = [];
    const originalProcessKill = process.kill;
    (process as any).kill = (pid: number, signal: string) => { killSpy.push({ pid, signal }); return true; };

    const pid = 65001;
    const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminalWithPid(pid);
    (fakeStateManager as any).getTerminal = () => terminal;

    // Simulate a pending marker already stored (mimics that SIGINT was already sent)
    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'SIGKILL'; }
      return defaultValue;
    };

    try {
      await cmd.run(item);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called immediately on second click');
      assert.strictEqual(killSpy[0].signal, 'SIGKILL');
      assert.strictEqual(killSpy[0].pid, pid);
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
      assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'pending marker should be cleared after force kill');
    } finally {
      (process as any).kill = originalProcessKill;
    }
  });

  test('second click shows QuickPick when forceStopMethod is ask', async () => {
    const item = makeTaskItem('second-click-ask-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const killSpy: Array<{ pid: number; signal: string }> = [];
    const originalProcessKill = process.kill;
    (process as any).kill = (pid: number, signal: string) => { killSpy.push({ pid, signal }); return true; };
    const originalShowQuickPick = vscode.window.showQuickPick;
    let quickPickShown = false;
    (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
      quickPickShown = true;
      return items.find(i => i.label === 'SIGKILL');
    };

    const pid = 65002;
    const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminalWithPid(pid);
    (fakeStateManager as any).getTerminal = () => terminal;

    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'ask'; }
      return defaultValue;
    };

    try {
      await cmd.run(item);

      assert.ok(quickPickShown, 'QuickPick should be shown when forceStopMethod is ask');
      assert.strictEqual(killSpy.length, 1, 'process.kill should be called after QuickPick selection');
      assert.strictEqual(killSpy[0].signal, 'SIGKILL');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
    } finally {
      (process as any).kill = originalProcessKill;
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  test('second click does nothing when QuickPick is dismissed', async () => {
    const item = makeTaskItem('second-click-cancelled-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;

    const execution = makeExecution(() => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    (fakeStateManager as any).getTerminal = () => makeTerminal();

    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'ask'; }
      return defaultValue;
    };

    try {
      await cmd.run(item);

      assert.strictEqual(terminateCalls.length, 0, 'nothing should happen when QuickPick is dismissed');
      assert.strictEqual(fakeStateManager.getStopTimer(id), undefined, 'pending marker should still be cleared');
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  test('second click applies SIGTERM via process.kill when configured', async () => {
    const item = makeTaskItem('second-click-sigterm-task');
    const id = fakeStateManager.getTaskId(item);
    const killSpy: Array<{ pid: number; signal: string }> = [];
    const originalProcessKill = process.kill;
    (process as any).kill = (pid: number, signal: string) => { killSpy.push({ pid, signal }); return true; };

    const pid = 65003;
    const execution = makeExecutionWithPresentation({ close: false });
    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminalWithPid(pid);
    (fakeStateManager as any).getTerminal = () => terminal;

    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'SIGTERM'; }
      return defaultValue;
    };

    try {
      await cmd.run(item);

      assert.strictEqual(killSpy.length, 1);
      assert.strictEqual(killSpy[0].signal, 'SIGTERM');
      assert.strictEqual(killSpy[0].pid, pid);
    } finally {
      (process as any).kill = originalProcessKill;
    }
  });

  test('second click applies SIGINT via sendText when configured', async () => {
    const item = makeTaskItem('second-click-sigint-task');
    const id = fakeStateManager.getTaskId(item);
    const sentTexts: Array<{ text: string; nl: boolean }> = [];
    const terminateCalls: number[] = [];

    const execution = makeExecution(() => terminateCalls.push(1));
    (fakeStateManager as any).getExecution = () => execution;
    const terminal = makeTerminal((text, nl) => sentTexts.push({ text, nl: nl ?? false }));
    (fakeStateManager as any).getTerminal = () => terminal;

    const existingTimer = setTimeout(() => {}, 60_000);
    fakeStateManager.setStopTimer(id, existingTimer);

    configModule.configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.forceStopMethod') { return 'SIGINT'; }
      return defaultValue;
    };

    await cmd.run(item);

    assert.strictEqual(sentTexts.length, 1, 'sendText should be called once');
    assert.strictEqual(sentTexts[0].text, '\u0003', 'should send SIGINT character');
    assert.strictEqual(sentTexts[0].nl, false);
    assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
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
  // forceKillPreservingTerminal
  // -------------------------------------------------------------------------

  suite('forceKillPreservingTerminal', () => {
    let originalProcessKill: typeof process.kill;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
    const killSpy: Array<{ pid: number; signal: string | number | undefined }> = [];
    const warningSpy: string[] = [];

    setup(() => {
      killSpy.length = 0;
      warningSpy.length = 0;
      originalProcessKill = process.kill;
      (process as any).kill = (pid: number, signal: string | number | undefined) => {
        killSpy.push({ pid, signal });
        return true;
      };
      originalShowWarningMessage = vscode.window.showWarningMessage;
      (vscode.window as any).showWarningMessage = (msg: string) => {
        warningSpy.push(msg);
        return Promise.resolve(undefined);
      };
    });

    teardown(() => {
      (process as any).kill = originalProcessKill;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    });

    test('calls process.kill with SIGKILL by default when presentation.close is false and processId is available', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99001);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called once');
      assert.strictEqual(killSpy[0].pid, 99001, 'should kill the correct pid');
      assert.strictEqual(killSpy[0].signal, 'SIGKILL', 'should use SIGKILL by default');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
    });

    test('calls process.kill with SIGTERM when signal is SIGTERM', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99010);

      await forceKillPreservingTerminal(terminal, execution, 'SIGTERM');

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called once');
      assert.strictEqual(killSpy[0].pid, 99010, 'should kill the correct pid');
      assert.strictEqual(killSpy[0].signal, 'SIGTERM', 'should use SIGTERM');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
    });

    test('sends terminal sendText \\u0003 when signal is SIGINT and terminal is available', async () => {
      const terminateCalls: number[] = [];
      const sentTexts: Array<{ text: string; nl: boolean }> = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99011, (text, nl) => sentTexts.push({ text, nl: nl ?? false }));

      await forceKillPreservingTerminal(terminal, execution, 'SIGINT');

      assert.strictEqual(sentTexts.length, 1, 'sendText should be called for SIGINT');
      assert.strictEqual(sentTexts[0].text, '\u0003');
      assert.strictEqual(sentTexts[0].nl, false);
      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called for SIGINT');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called for SIGINT');
    });

    test('shows warning for SIGINT when no terminal is provided and close is false', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));

      await forceKillPreservingTerminal(undefined, execution, 'SIGINT');

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called when no terminal is provided');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
      assert.strictEqual(warningSpy.length, 1, 'a warning notification should be shown');
      assert.ok(warningSpy[0].includes('test-task'), 'warning should include the task name');
    });

    test('calls execution.terminate when presentation.close is true', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: true }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99002);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called when close is true');
      assert.strictEqual(terminateCalls.length, 1, 'execution.terminate should be called');
    });

    test('shows warning when no terminal is provided and close is false', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));

      await forceKillPreservingTerminal(undefined, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called without a terminal');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
      assert.strictEqual(warningSpy.length, 1, 'a warning notification should be shown');
      assert.ok(warningSpy[0].includes('test-task'), 'warning should include the task name');
    });

    test('shows warning when processId is unavailable and close is false', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminal(); // no processId property

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 0, 'process.kill should NOT be called when processId is unavailable');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
      assert.strictEqual(warningSpy.length, 1, 'a warning notification should be shown');
      assert.ok(warningSpy[0].includes('test-task'), 'warning should include the task name');
    });

    test('shows warning when process.kill throws and close is false', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99003);
      (process as any).kill = () => { throw new Error('Permission denied'); };

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called when close is false');
      assert.strictEqual(warningSpy.length, 1, 'a warning notification should be shown');
      assert.ok(warningSpy[0].includes('test-task'), 'warning should include the task name');
    });

    test('calls process.kill when presentation.close is not set (defaults to false)', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({}, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99004);

      await forceKillPreservingTerminal(terminal, execution);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called when close is unset (defaults to false)');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
    });

    test('falls back to findTerminalForTask when terminal is undefined and task name matches an open terminal', async () => {
      const terminateCalls: number[] = [];
      const execution = makeExecutionWithPresentation({ close: false }, () => terminateCalls.push(1));
      const terminal = makeTerminalWithPid(99020);
      // The execution's task name is 'test-task'; give the terminal the same name.
      (terminal as any).name = 'test-task';

      const originalTerminals = Object.getOwnPropertyDescriptor(vscode.window, 'terminals');
      Object.defineProperty(vscode.window, 'terminals', { value: [terminal], configurable: true });

      try {
        await forceKillPreservingTerminal(undefined, execution, 'SIGKILL');
      } finally {
        if (originalTerminals) {
          Object.defineProperty(vscode.window, 'terminals', originalTerminals);
        }
      }

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called after fallback terminal lookup');
      assert.strictEqual(killSpy[0].pid, 99020);
      assert.strictEqual(killSpy[0].signal, 'SIGKILL');
      assert.strictEqual(terminateCalls.length, 0, 'execution.terminate should NOT be called');
      assert.strictEqual(warningSpy.length, 0, 'no warning should be shown when terminal is found via fallback');
    });

    test('falls back to findTerminalForTask for SIGINT when terminal is undefined', async () => {
      const sentTexts: Array<{ text: string; nl: boolean }> = [];
      const execution = makeExecutionWithPresentation({ close: false });
      const terminal = makeTerminal((text, nl) => sentTexts.push({ text, nl: nl ?? false }));
      (terminal as any).name = 'test-task';

      const originalTerminals = Object.getOwnPropertyDescriptor(vscode.window, 'terminals');
      Object.defineProperty(vscode.window, 'terminals', { value: [terminal], configurable: true });

      try {
        await forceKillPreservingTerminal(undefined, execution, 'SIGINT');
      } finally {
        if (originalTerminals) {
          Object.defineProperty(vscode.window, 'terminals', originalTerminals);
        }
      }

      assert.strictEqual(sentTexts.length, 1, 'sendText should be called after fallback lookup');
      assert.strictEqual(sentTexts[0].text, '\u0003');
      assert.strictEqual(warningSpy.length, 0, 'no warning should be shown when terminal is found via fallback');
    });
  });

  // -------------------------------------------------------------------------
  // resolveForceStopSignal – via second-click run() path
  // -------------------------------------------------------------------------

  test('resolveForceStopSignal uses configured SIGTERM without QuickPick', async () => {
    const item = makeTaskItem('resolve-sigterm-task');
    const id = fakeStateManager.getTaskId(item);
    const killSpy: Array<{ pid: number; signal: string }> = [];
    const originalProcessKill = process.kill;
    (process as any).kill = (pid: number, signal: string) => { killSpy.push({ pid, signal }); return true; };

    try {
      const execution = makeExecutionWithPresentation({ close: false });
      (fakeStateManager as any).getExecution = () => execution;
      const terminal = makeTerminalWithPid(55010);
      (fakeStateManager as any).getTerminal = () => terminal;

      fakeStateManager.setStopTimer(id, setTimeout(() => {}, 60_000));

      configModule.configuration.get = (key: string, defaultValue: any) => {
        if (key === 'task.forceStopMethod') { return 'SIGTERM'; }
        return defaultValue;
      };

      await cmd.run(item);

      assert.strictEqual(killSpy.length, 1, 'process.kill should be called without showing QuickPick');
      assert.strictEqual(killSpy[0].signal, 'SIGTERM');
    } finally {
      (process as any).kill = originalProcessKill;
    }
  });

  test('resolveForceStopSignal returns undefined when QuickPick is dismissed and no kill occurs', async () => {
    const item = makeTaskItem('resolve-dismissed-task');
    const id = fakeStateManager.getTaskId(item);
    const terminateCalls: number[] = [];
    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;

    try {
      const execution = makeExecution(() => terminateCalls.push(1));
      (fakeStateManager as any).getExecution = () => execution;
      (fakeStateManager as any).getTerminal = () => makeTerminal();

      fakeStateManager.setStopTimer(id, setTimeout(() => {}, 60_000));

      configModule.configuration.get = (key: string, defaultValue: any) => {
        if (key === 'task.forceStopMethod') { return 'ask'; }
        return defaultValue;
      };

      await cmd.run(item);

      assert.strictEqual(terminateCalls.length, 0, 'no kill should occur when QuickPick is dismissed');
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });
});
