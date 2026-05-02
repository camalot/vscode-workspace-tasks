import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskRunner } from '../../taskRunner';
import { TaskItem } from '../../taskItem';
import { TaskStateManager, TaskStatus } from '../../taskStateManager';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { LoggerService } from '../../services/loggerService';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { RecentTasksService } from '../../services/recentTasksService';
import { TaskRunGuardService } from '../../services/taskRunGuardService';

// CommonJS module references for monkey-patching
// eslint-disable-next-line @typescript-eslint/no-require-imports
const taskFactoryModule = require('../../taskFactory');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const configModule = require('../../libs/configuration');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const taskfileVarPromptModule = require('../../libs/taskfileVarPromptUtils');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskItem(label: string, taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.originalLabel = label;
  return item;
}

function makeVscodeTask(label = 'test-task', withExecution = true): vscode.Task {
  return new vscode.Task(
    { type: 'shell' },
    vscode.TaskScope.Workspace,
    label,
    'shell',
    withExecution ? new vscode.ShellExecution('echo hello') : undefined,
  );
}

function makeCreatedTask(native: boolean, withExecution = true) {
  const task = makeVscodeTask('test', withExecution);
  return { task, native, command: 'echo hello', cwd: '/tmp' };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

suite('TaskRunner Test Suite', () => {
  let runner: TaskRunner;
  let originalCreateTaskForItem: typeof taskFactoryModule.createTaskForItem;
  let originalExecuteTask: typeof vscode.tasks.executeTask;
  let originalShowWarning: typeof vscode.window.showWarningMessage;
  let originalShowError: typeof vscode.window.showErrorMessage;
  let originalShowInfo: typeof vscode.window.showInformationMessage;
  let originalConfigGet: (...args: any[]) => any;
  let originalPromptAndResolveRequiredVars: typeof taskfileVarPromptModule.promptAndResolveRequiredVars;

  let stateMap: Map<string, TaskStatus>;
  let executionMap: Map<string, vscode.TaskExecution>;
  let stateChangeEmitter: vscode.EventEmitter<{ id: string; status: TaskStatus }>;

  let warnings: string[];
  let errors: string[];
  let infos: string[];
  let executedTasks: vscode.Task[];
  let recentAdds: string[];

  function buildFakeStateManager(
    getStatusOverride?: (id: string) => TaskStatus,
  ): Partial<TaskStateManager> {
    return {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      // Test IDs are simple label strings without fav:/recent:/queue: prefixes;
      // normalizeTaskId is a no-op in this context.
      normalizeTaskId: (id: string) => id,
      getStatus: (id: string) => getStatusOverride ? getStatusOverride(id) : (stateMap.get(id) ?? 'idle'),
      setStatus: (id: string, status: TaskStatus) => {
        stateMap.set(id, status);
        stateChangeEmitter.fire({ id, status });
      },
      setExecution: (id: string, exec: vscode.TaskExecution) => {
        executionMap.set(id, exec);
      },
      unblockTask: (_id: string) => { /* no-op in tests unless overridden */ },
      clearAllBlocks: () => { /* no-op in tests unless overridden */ },
      onDidStateChange: stateChangeEmitter.event,
    };
  }

  setup(() => {
    // Reset TaskRunner singleton
    (TaskRunner as any).instance = undefined;
    runner = TaskRunner.getInstance();

    warnings = [];
    errors = [];
    infos = [];
    executedTasks = [];
    recentAdds = [];
    stateMap = new Map();
    executionMap = new Map();
    stateChangeEmitter = new vscode.EventEmitter();

    // Stub window messages
    originalShowWarning = vscode.window.showWarningMessage;
    originalShowError = vscode.window.showErrorMessage;
    originalShowInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showErrorMessage = (msg: string) => { errors.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg); return Promise.resolve(undefined); };

    // Stub vscode.tasks.executeTask
    originalExecuteTask = vscode.tasks.executeTask;
    (vscode.tasks as any).executeTask = async (t: vscode.Task) => {
      executedTasks.push(t);
      return { terminate: () => { } } as vscode.TaskExecution;
    };

    // Stub createTaskForItem (default: return a native task)
    originalCreateTaskForItem = taskFactoryModule.createTaskForItem;
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);

    // Stub configuration.get
    originalConfigGet = configModule.configuration.get.bind(configModule.configuration);
    configModule.configuration.get = (_key: string, defaultValue: any) => defaultValue ?? {};
    originalPromptAndResolveRequiredVars = taskfileVarPromptModule.promptAndResolveRequiredVars;
    taskfileVarPromptModule.promptAndResolveRequiredVars = async () => undefined;

    // Stub dependent services
    (TaskStateManager as any).instance = buildFakeStateManager();
    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };
    (RecentTasksService as any).instance = {
      addRecentTask: (id: string) => { recentAdds.push(id); },
    };
    (LoggerService as any).instance = {
      error: () => { },
      info: () => { },
      warn: () => { },
      debug: () => { },
    };
  });

  teardown(() => {
    taskFactoryModule.createTaskForItem = originalCreateTaskForItem;
    (vscode.window as any).showWarningMessage = originalShowWarning;
    (vscode.window as any).showErrorMessage = originalShowError;
    (vscode.window as any).showInformationMessage = originalShowInfo;
    (vscode.tasks as any).executeTask = originalExecuteTask;
    configModule.configuration.get = originalConfigGet;
    taskfileVarPromptModule.promptAndResolveRequiredVars = originalPromptAndResolveRequiredVars;

    stateChangeEmitter.dispose();

    (TaskRunner as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (RecentTasksService as any).instance = undefined;
    (LoggerService as any).instance = undefined;
    (CompoundTaskService as any).instance = undefined;
    (TaskRunGuardService as any)._instance = undefined;
  });

  // -------------------------------------------------------------------------
  // getInstance
  // -------------------------------------------------------------------------

  test('getInstance returns a TaskRunner instance', () => {
    const instance = TaskRunner.getInstance();
    assert.ok(instance instanceof TaskRunner);
  });

  test('getInstance returns the same singleton', () => {
    const a = TaskRunner.getInstance();
    const b = TaskRunner.getInstance();
    assert.strictEqual(a, b);
  });

  // -------------------------------------------------------------------------
  // runTask – no task created
  // -------------------------------------------------------------------------

  test('runTask shows warning when createTaskForItem returns undefined', async () => {
    taskFactoryModule.createTaskForItem = async () => undefined;
    const item = makeTaskItem('my-build');
    await runner.runTask(item);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('my-build'), `Expected warning to mention 'my-build', got: ${warnings[0]}`);
    assert.strictEqual(executedTasks.length, 0);
  });

  test('runTask shows warning when created.task is falsy', async () => {
    taskFactoryModule.createTaskForItem = async () => ({ task: undefined, native: false });
    const item = makeTaskItem('my-build');
    await runner.runTask(item);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(executedTasks.length, 0);
  });

  test('runTask uses originalLabel in warning when available', async () => {
    taskFactoryModule.createTaskForItem = async () => undefined;
    const item = makeTaskItem('label');
    item.originalLabel = 'original-label';
    await runner.runTask(item);
    assert.ok(warnings[0].includes('original-label'));
  });

  test('runTask falls back to label when originalLabel is empty', async () => {
    taskFactoryModule.createTaskForItem = async () => undefined;
    const item = makeTaskItem('fallback-label');
    (item as any).originalLabel = ''; // Force falsy to exercise || branch
    await runner.runTask(item);
    assert.ok(warnings[0].includes('fallback-label'));
  });

  test('runTask prompts required vars and forwards varAssignments', async () => {
    const captured: { varAssignments?: string[] } = {};
    taskFactoryModule.createTaskForItem = async (
      _item: TaskItem,
      _args?: string,
      _resolvedLabel?: string,
      varAssignments?: string[],
    ) => {
      captured.varAssignments = varAssignments;
      return makeCreatedTask(true);
    };

    taskfileVarPromptModule.promptAndResolveRequiredVars = async () => ["ENV='prod'"];

    const item = makeTaskItem('deploy', 'taskfile');
    item.metadata = {
      requiredVars: [{ name: 'ENV' }],
    };

    const started = await runner.runTask(item);
    assert.strictEqual(started, true);
    assert.deepStrictEqual(captured.varAssignments, ["ENV='prod'"]);
  });

  test('runTask aborts when required-var prompt is cancelled', async () => {
    let createCalled = false;
    taskFactoryModule.createTaskForItem = async () => {
      createCalled = true;
      return makeCreatedTask(true);
    };

    taskfileVarPromptModule.promptAndResolveRequiredVars = async () => undefined;

    const item = makeTaskItem('deploy', 'taskfile');
    item.metadata = {
      requiredVars: [{ name: 'ENV' }],
    };

    const started = await runner.runTask(item);
    assert.strictEqual(started, false);
    assert.strictEqual(createCalled, false);
    assert.strictEqual(executedTasks.length, 0);
  });

  test('runTask passes runTask mode and predefined defaults to prompt helper', async () => {
    let capturedOptions: { mode?: string; defaultsByName?: Record<string, string | undefined> } | undefined;
    taskfileVarPromptModule.promptAndResolveRequiredVars = async (
      _vars: unknown,
      _taskName: string,
      options?: { mode?: string; defaultsByName?: Record<string, string | undefined> },
    ) => {
      capturedOptions = options;
      return [];
    };

    const item = makeTaskItem('deploy', 'taskfile');
    item.metadata = {
      requiredVars: [{ name: 'ENV' }],
      predefinedVarValues: { ENV: 'prod' },
    };

    const started = await runner.runTask(item);
    assert.strictEqual(started, true);
    assert.strictEqual(capturedOptions?.mode, 'runTask');
    assert.deepStrictEqual(capturedOptions?.defaultsByName, { ENV: 'prod' });
    assert.strictEqual(executedTasks.length, 1);
  });

  test('runTask does not prompt required vars for queuedTask context', async () => {
    taskfileVarPromptModule.promptAndResolveRequiredVars = async () => {
      throw new Error('should not prompt queued tasks');
    };

    const item = makeTaskItem('deploy', 'taskfile');
    item.contextValue = 'queuedTask';
    item.metadata = {
      requiredVars: [{ name: 'ENV' }],
    };

    const started = await runner.runTask(item);
    assert.strictEqual(started, true);
    assert.strictEqual(executedTasks.length, 1);
  });

  // -------------------------------------------------------------------------
  // runTask – native path (isNative = true)
  // -------------------------------------------------------------------------

  test('runTask native path sets status to running and calls executeTask', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    const item = makeTaskItem('build');
    await runner.runTask(item);

    assert.strictEqual(stateMap.get('build'), 'running');
    assert.deepStrictEqual(recentAdds, []);
    assert.strictEqual(executedTasks.length, 1);
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(errors.length, 0);
  });

  test('runTask native path stores execution in state manager', async () => {
    const fakeExecution = { terminate: () => { } } as vscode.TaskExecution;
    (vscode.tasks as any).executeTask = async () => fakeExecution;
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);

    const item = makeTaskItem('store-exec');
    await runner.runTask(item);

    assert.strictEqual(executionMap.get('store-exec'), fakeExecution);
  });

  test('runTask native path with task.execution === undefined treats as native', async () => {
    // task.execution is undefined → isNative = true regardless of created.native
    taskFactoryModule.createTaskForItem = async () => ({ task: makeVscodeTask('test', false), native: false });
    const item = makeTaskItem('compound');
    await runner.runTask(item);

    // No presentation options modifications, task just runs
    assert.strictEqual(executedTasks.length, 1);
    assert.strictEqual(errors.length, 0);
  });

  test('runTask native true overrides even when execution exists', async () => {
    // when created.native = true → isNative = true (no presentationOptions merge)
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true, true);
    const item = makeTaskItem('native-exec');
    await runner.runTask(item);
    assert.strictEqual(executedTasks.length, 1);
  });

  test('runTask calls clearAllBlocks before executing to clear any compound-stop blocks', async () => {
    let clearAllBlocksCalled = false;
    (TaskStateManager as any).instance = {
      ...buildFakeStateManager(),
      clearAllBlocks: () => { clearAllBlocksCalled = true; },
    };

    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    const item = makeTaskItem('blocked-task');
    await runner.runTask(item);

    assert.ok(clearAllBlocksCalled, 'clearAllBlocks should be called before executing to lift stale blocks');
  });

  // -------------------------------------------------------------------------
  // runTask – non-native path, reveal options
  // -------------------------------------------------------------------------

  test('runTask non-native: reveal "always" maps to TaskRevealKind.Always', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);

    assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Always);
  });

  test('runTask non-native: reveal "silent" maps to TaskRevealKind.Silent', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'silent', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Silent);
  });

  test('runTask non-native: reveal "never" maps to TaskRevealKind.Never', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'never', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Never);
  });

  test('runTask non-native: unknown reveal defaults to TaskRevealKind.Always', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'unknown-value', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Always);
  });

  test('runTask non-native: undefined reveal defaults to TaskRevealKind.Always', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Always);
  });

  // -------------------------------------------------------------------------
  // runTask – non-native path, panel options
  // -------------------------------------------------------------------------

  test('runTask non-native: panel "dedicated" maps to TaskPanelKind.Dedicated', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'dedicated' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.panel, vscode.TaskPanelKind.Dedicated);
  });

  test('runTask non-native: panel "shared" maps to TaskPanelKind.Shared', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.panel, vscode.TaskPanelKind.Shared);
  });

  test('runTask non-native: panel "new" maps to TaskPanelKind.New', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'new' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.panel, vscode.TaskPanelKind.New);
  });

  test('runTask non-native: unknown panel defaults to TaskPanelKind.Shared', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'unknown-value' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.panel, vscode.TaskPanelKind.Shared);
  });

  test('runTask non-native: undefined panel defaults to TaskPanelKind.Shared', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);
    assert.strictEqual(executedTasks[0].presentationOptions.panel, vscode.TaskPanelKind.Shared);
  });

  // -------------------------------------------------------------------------
  // runTask – non-native presentation boolean defaults
  // -------------------------------------------------------------------------

  test('runTask non-native: defaults clear/close/echo/focus when not specified', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return {}; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);

    const opts = executedTasks[0].presentationOptions;
    assert.strictEqual(opts.clear, false);
    assert.strictEqual(opts.close, false);
    assert.strictEqual(opts.echo, true);
    assert.strictEqual(opts.focus, false);
  });

  test('runTask non-native: explicit clear/close/echo/focus values are applied', async () => {
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(false, true);
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') {
        return { clear: true, close: true, echo: false, focus: true };
      }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);

    const opts = executedTasks[0].presentationOptions;
    assert.strictEqual(opts.clear, true);
    assert.strictEqual(opts.close, true);
    assert.strictEqual(opts.echo, false);
    assert.strictEqual(opts.focus, true);
  });

  test('runTask non-native: task\'s own presentationOptions take precedence', async () => {
    const task = makeVscodeTask('test', true);
    // Pre-set presentation options on the task that should override defaulted settings
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.New };
    taskFactoryModule.createTaskForItem = async () => ({ task, native: false, command: 'echo', cwd: '/tmp' });
    configModule.configuration.get = (key: string, def: any) => {
      if (key === 'task.presentationOptions') { return { reveal: 'always', panel: 'shared' }; }
      return def;
    };
    const item = makeTaskItem('build');
    await runner.runTask(item);

    // Task's own options (Never/New) should win over config (Always/Shared)
    assert.strictEqual(task.presentationOptions.reveal, vscode.TaskRevealKind.Never);
    assert.strictEqual(task.presentationOptions.panel, vscode.TaskPanelKind.New);
  });

  // -------------------------------------------------------------------------
  // runTask – executeTask failure
  // -------------------------------------------------------------------------

  test('runTask sets failure status and shows error when executeTask throws', async () => {
    const boom = new Error('execute failed');
    (vscode.tasks as any).executeTask = async () => { throw boom; };
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true, true);

    const item = makeTaskItem('fail-task');
    await assert.rejects(() => runner.runTask(item), (err: Error) => err.message === 'execute failed');

    assert.strictEqual(stateMap.get('fail-task'), 'failure');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('execute failed'));
  });

  test('runTask rethrows the error from executeTask', async () => {
    (vscode.tasks as any).executeTask = async () => { throw new Error('thrown'); };
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true, true);

    const item = makeTaskItem('rethrow');
    let caught: Error | undefined;
    try {
      await runner.runTask(item);
    } catch (e) {
      caught = e as Error;
    }
    assert.ok(caught);
    assert.strictEqual(caught!.message, 'thrown');
  });

  // -------------------------------------------------------------------------
  // runCompoundTask – empty / missing compound task
  // -------------------------------------------------------------------------

  test('runCompoundTask shows info when compound task is empty', async () => {
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [] as TaskItem[],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    await runner.runCompoundTask('EmptyCompoundTask');

    assert.strictEqual(infos.length, 1);
    assert.ok(infos[0].includes('EmptyCompoundTask'));
  });

  test('runCompoundTask shows info when compound task does not exist', async () => {
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => undefined,
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    await runner.runCompoundTask('NoSuchCompoundTask');

    assert.strictEqual(infos.length, 1);
    assert.ok(infos[0].includes('NoSuchCompoundTask'));
  });

  // -------------------------------------------------------------------------
  // runCompoundTask – successful execution
  // -------------------------------------------------------------------------

  test('runCompoundTask runs all tasks when none fail', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    // Inject runTask / waitForTask stubs so we don't need real execution
    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask');

    assert.deepStrictEqual(ranTasks, ['task1', 'task2']);
    assert.strictEqual(errors.length, 0);
  });

  test('runCompoundTask stops at first failure and shows error', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const item3 = makeTaskItem('task3');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2, item3],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (item: TaskItem): Promise<TaskStatus> => {
      return (item.originalLabel || item.label) === 'task2' ? 'failure' : 'success';
    };

    await runner.runCompoundTask('MyCompoundTask');

    assert.deepStrictEqual(ranTasks, ['task1', 'task2']);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('task2'));
    assert.ok(errors[0].includes('MyCompoundTask'));
  });

  test('runCompoundTask stops when a task launch throws', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    let callCount = 0;
    (runner as any).runTask = async (_item: TaskItem) => {
      callCount++;
      if (callCount === 1) { throw new Error('launch failed'); }
    };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask');

    assert.strictEqual(callCount, 1);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('task1'));
  });

  // -------------------------------------------------------------------------
  // runCompoundTask – startItem
  // -------------------------------------------------------------------------

  test('runCompoundTask starts from startItem when found in compound task', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const item3 = makeTaskItem('task3');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2, item3],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask', item2);

    // Should only run item2 and item3
    assert.deepStrictEqual(ranTasks, ['task2', 'task3']);
  });

  test('runCompoundTask starts from index 0 when startItem not found in compound task', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const outsider = makeTaskItem('outsider');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask', outsider);

    // startItem not in compound task → start from index 0 (all tasks run)
    assert.deepStrictEqual(ranTasks, ['task1', 'task2']);
  });

  // -------------------------------------------------------------------------
  // runCompoundTask – parallel execution
  // -------------------------------------------------------------------------

  test('runCompoundTask parallel runs all tasks concurrently', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const item3 = makeTaskItem('task3');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2, item3],
      getCompoundTaskExecutionType: (_name: string) => 'parallel',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask');

    // All tasks should have started
    assert.strictEqual(ranTasks.length, 3);
    assert.ok(ranTasks.includes('task1'));
    assert.ok(ranTasks.includes('task2'));
    assert.ok(ranTasks.includes('task3'));
    assert.strictEqual(errors.length, 0);
  });

  test('runCompoundTask parallel continues other tasks even if one fails', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const item3 = makeTaskItem('task3');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2, item3],
      getCompoundTaskExecutionType: (_name: string) => 'parallel',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (item: TaskItem): Promise<TaskStatus> => {
      return (item.originalLabel || item.label) === 'task2' ? 'failure' : 'success';
    };

    await runner.runCompoundTask('MyCompoundTask');

    // All 3 tasks should still have been launched in parallel
    assert.strictEqual(ranTasks.length, 3);
    assert.strictEqual(errors.length, 0); // parallel does not stop on failure
  });

  test('runCompoundTask parallel shows error when task launch throws', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2],
      getCompoundTaskExecutionType: (_name: string) => 'parallel',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    (runner as any).runTask = async (item: TaskItem) => {
      if ((item.originalLabel || item.label) === 'task1') { throw new Error('launch failed'); }
    };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('ParallelCompoundTask');

    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('task1'));
    assert.ok(errors[0].includes('ParallelCompoundTask'));
  });

  // -------------------------------------------------------------------------
  // runCompoundTask – cancellation
  // -------------------------------------------------------------------------

  test('runCompoundTask stops sequential execution when token is cancelled before next task', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    const item3 = makeTaskItem('task3');
    let token = { cancelled: false };
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2, item3],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => { token = { cancelled: false }; return token; },
      markCompoundTaskStopped: (_name: string) => { },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (item: TaskItem): Promise<TaskStatus> => {
      if ((item.originalLabel || item.label) === 'task1') {
        token.cancelled = true; // cancel after task1 completes
      }
      return 'success';
    };

    await runner.runCompoundTask('MyCompoundTask');

    // Only task1 should have run; task2 and task3 are skipped due to cancellation
    assert.deepStrictEqual(ranTasks, ['task1']);
  });

  test('runCompoundTask calls markCompoundTaskRunning and markCompoundTaskStopped', async () => {
    const item1 = makeTaskItem('task1');
    let runningMarked = false;
    let stoppedMarked = false;
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => { runningMarked = true; return { cancelled: false }; },
      markCompoundTaskStopped: (_name: string) => { stoppedMarked = true; },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    (runner as any).runTask = async (_item: TaskItem) => { };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask');

    assert.ok(runningMarked, 'markCompoundTaskRunning should be called');
    assert.ok(stoppedMarked, 'markCompoundTaskStopped should be called in finally');
  });

  test('runCompoundTask calls markCompoundTaskStopped even when a task throws', async () => {
    const item1 = makeTaskItem('task1');
    let stoppedMarked = false;
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1],
      getCompoundTaskExecutionType: (_name: string) => 'sequential',
      markCompoundTaskRunning: (_name: string) => ({ cancelled: false }),
      markCompoundTaskStopped: (_name: string) => { stoppedMarked = true; },
      isItemDefinitelyNotRunnable: (_item: any) => false,
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    (runner as any).runTask = async (_item: TaskItem) => { throw new Error('task failed'); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('MyCompoundTask');

    assert.ok(stoppedMarked, 'markCompoundTaskStopped should be called even after task throws');
  });

  test('runCompoundTask parallel skips cancelled tasks', async () => {
    const item1 = makeTaskItem('task1');
    const item2 = makeTaskItem('task2');
    let token = { cancelled: false };
    const fakeCompoundTaskService = {
      getCompoundTask: (_name: string) => [item1, item2],
      getCompoundTaskExecutionType: (_name: string) => 'parallel',
      markCompoundTaskRunning: (_name: string) => { token.cancelled = true; return token; }, // already cancelled
      markCompoundTaskStopped: (_name: string) => { },
    } as any;
    (CompoundTaskService as any).instance = fakeCompoundTaskService;

    const ranTasks: string[] = [];
    (runner as any).runTask = async (item: TaskItem) => { ranTasks.push(item.originalLabel || item.label); };
    (runner as any).waitForTask = async (_item: TaskItem): Promise<TaskStatus> => 'success';

    await runner.runCompoundTask('ParallelCompoundTask');

    // All tasks skipped because token was already cancelled
    assert.strictEqual(ranTasks.length, 0);
  });

  // -------------------------------------------------------------------------
  // waitForTask (private) – accessed via (runner as any)
  // -------------------------------------------------------------------------

  test('waitForTask resolves immediately when status is success', async () => {
    stateMap.set('instant', 'success');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('instant');
    const status = await (runner as any).waitForTask(item);
    assert.strictEqual(status, 'success');
  });

  test('waitForTask resolves immediately when status is failure', async () => {
    stateMap.set('instant', 'failure');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('instant');
    const status = await (runner as any).waitForTask(item);
    assert.strictEqual(status, 'failure');
  });

  test('waitForTask resolves immediately when status is idle', async () => {
    stateMap.set('instant', 'idle');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('instant');
    const status = await (runner as any).waitForTask(item);
    assert.strictEqual(status, 'idle');
  });

  test('waitForTask resolves on onDidStateChange event with success', async () => {
    // Start with non-terminal status
    stateMap.set('async-task', 'running');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('async-task');
    const promise = (runner as any).waitForTask(item) as Promise<TaskStatus>;

    // Fire state change after a tick
    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'async-task', status: 'success' });

    const status = await promise;
    assert.strictEqual(status, 'success');
  });

  test('waitForTask resolves on onDidStateChange event with failure', async () => {
    stateMap.set('async-fail', 'running');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('async-fail');
    const promise = (runner as any).waitForTask(item) as Promise<TaskStatus>;

    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'async-fail', status: 'failure' });

    const status = await promise;
    assert.strictEqual(status, 'failure');
  });

  test('waitForTask ignores state change events for other task ids', async () => {
    stateMap.set('my-task', 'running');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('my-task');
    const promise = (runner as any).waitForTask(item) as Promise<TaskStatus>;

    // Fire for a different id – should be ignored
    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'other-task', status: 'success' });
    // Now fire for correct id
    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'my-task', status: 'success' });

    const status = await promise;
    assert.strictEqual(status, 'success');
  });

  test('waitForTask ignores non-terminal state change events', async () => {
    stateMap.set('my-task', 'running');
    (TaskStateManager as any).instance = buildFakeStateManager();

    const item = makeTaskItem('my-task');
    const promise = (runner as any).waitForTask(item) as Promise<TaskStatus>;

    // Fire non-terminal status – should be ignored
    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'my-task', status: 'running' });
    // Fire terminal status
    await new Promise<void>(r => setTimeout(r, 0));
    stateChangeEmitter.fire({ id: 'my-task', status: 'success' });

    const status = await promise;
    assert.strictEqual(status, 'success');
  });

  test('waitForTask resolves via timeout when state never changes', async () => {
    // Status stays non-terminal so the immediate-resolve branch is skipped
    stateMap.set('timeout-task', 'running');
    (TaskStateManager as any).instance = buildFakeStateManager();

    // Use a very short real timeout so the test does not take minutes
    runner.taskWaitTimeoutMs = 20;

    const item = makeTaskItem('timeout-task');
    const promise = (runner as any).waitForTask(item) as Promise<TaskStatus>;

    // Wait beyond the 20 ms timeout and then await the promise
    await new Promise<void>(r => setTimeout(r, 60));
    const status = await promise;

    assert.strictEqual(status, 'running');
  });

  // -------------------------------------------------------------------------
  // runTask — guard integration
  // -------------------------------------------------------------------------

  function stubGuard(confirmedValue: boolean) {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: () => Promise.resolve(confirmedValue),
      isGuarded: () => !confirmedValue,
    };
  }

  test('runTask — not guarded: calls executeTask and returns true', async () => {
    stubGuard(true); // confirmIfNeeded always passes
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    const item = makeTaskItem('build');
    const result = await runner.runTask(item);
    assert.strictEqual(result, true);
    assert.strictEqual(executedTasks.length, 1);
  });

  test('runTask — guarded, user confirms: calls executeTask and returns true', async () => {
    stubGuard(true); // user confirmed
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    const item = makeTaskItem('deploy');
    const result = await runner.runTask(item);
    assert.strictEqual(result, true);
    assert.strictEqual(executedTasks.length, 1);
  });

  test('runTask — guarded, user cancels: does NOT call executeTask, returns false, no status change', async () => {
    stubGuard(false); // user cancelled
    const item = makeTaskItem('deploy');
    const result = await runner.runTask(item);
    assert.strictEqual(result, false);
    assert.strictEqual(executedTasks.length, 0);
    // Status should remain unchanged (not set to 'running')
    assert.strictEqual(stateMap.get('deploy'), undefined);
  });

  test('runTask — guarded + skipGuard:true: skips dialog, calls executeTask, returns true', async () => {
    // confirmIfNeeded would return false if called, but skipGuard bypasses it entirely
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: () => { throw new Error('confirmIfNeeded should not be called with skipGuard=true'); },
      isGuarded: () => true,
    };
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    const item = makeTaskItem('deploy');
    const result = await runner.runTask(item, undefined, true);
    assert.strictEqual(result, true);
    assert.strictEqual(executedTasks.length, 1);
  });

  // -------------------------------------------------------------------------
  // runCompoundTask — guard integration
  // -------------------------------------------------------------------------

  function makeCompoundItem(label: string): TaskItem {
    const item = makeTaskItem(label);
    item.id = label;
    return item;
  }

  function setupCompoundService(tasks: TaskItem[], executionType: 'sequential' | 'parallel' = 'sequential') {
    const token = { cancelled: false };
    (CompoundTaskService as any).instance = {
      getCompoundTask: () => tasks,
      getCompoundTaskExecutionType: () => executionType,
      markCompoundTaskRunning: () => token,
      markCompoundTaskStopped: () => {},
      isItemDefinitelyNotRunnable: () => false,
      onCompoundTaskStateChanged: () => ({ dispose: () => {} }),
    };
    return token;
  }

  test('runCompoundTask sequential — guard cancelled at step 2: steps 3+ not run', async () => {
    const item1 = makeCompoundItem('task1');
    const item2 = makeCompoundItem('task2');
    const item3 = makeCompoundItem('task3');
    setupCompoundService([item1, item2, item3]);

    let callCount = 0;
    // task1 passes, task2 cancelled, task3 should never run
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: (item: TaskItem) => {
        callCount++;
        return Promise.resolve(item.id !== 'task2');
      },
      isGuarded: () => false,
    };
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);

    // Stub waitForTask to immediately resolve with success
    (runner as any).waitForTask = () => Promise.resolve('success');

    await runner.runCompoundTask('test');

    assert.ok(executedTasks.length < 3, `Expected fewer than 3 tasks launched, got ${executedTasks.length}`);
    // task1 should have run, task2 cancelled, task3 skipped
    assert.strictEqual(executedTasks.length, 1);
  });

  test('runCompoundTask sequential — step 2 fails naturally: breaks on failure-status check', async () => {
    const item1 = makeCompoundItem('task1');
    const item2 = makeCompoundItem('task2');
    const item3 = makeCompoundItem('task3');
    setupCompoundService([item1, item2, item3]);

    stubGuard(true); // no guard cancellation
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);

    let waitCallCount = 0;
    (runner as any).waitForTask = (_item: TaskItem) => {
      waitCallCount++;
      // task2 (second call) returns failure
      return Promise.resolve(waitCallCount === 2 ? 'failure' : 'success');
    };

    await runner.runCompoundTask('test');

    // Only task1 and task2 started; task3 skipped after task2 failure
    assert.strictEqual(executedTasks.length, 2);
    assert.ok(errors.length > 0, 'Expected an error message for the failed task');
  });

  test('runCompoundTask parallel — guard cancelled for one item: only that item skipped, others run', async () => {
    const item1 = makeCompoundItem('task1');
    const item2 = makeCompoundItem('task2');
    const item3 = makeCompoundItem('task3');
    setupCompoundService([item1, item2, item3], 'parallel');

    // task2 is cancelled; task1 and task3 proceed
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: (item: TaskItem) => Promise.resolve(item.id !== 'task2'),
      isGuarded: () => false,
    };
    taskFactoryModule.createTaskForItem = async () => makeCreatedTask(true);
    (runner as any).waitForTask = () => Promise.resolve('success');

    await runner.runCompoundTask('test');

    // Only task1 and task3 should have been executed (task2 was guard-cancelled)
    assert.strictEqual(executedTasks.length, 2);
  });
});
