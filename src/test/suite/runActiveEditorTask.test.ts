import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunActiveEditorTaskCommand } from '../../commands/runActiveEditorTask';
import { TaskItem } from '../../taskItem';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskRunner } from '../../taskRunner';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { LoggerService } from '../../services/loggerService';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskStateManager } from '../../taskStateManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: {
      get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

function makeTaskItem(label: string, taskType: string, id?: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = id ?? label;
  item.originalLabel = label;
  item.taskFileUri = vscode.Uri.file(`/workspace/${label}.sh`);
  return item;
}

function makeFileUri(path: string): vscode.Uri {
  return vscode.Uri.file(path);
}

// A testable subclass that overrides pickTask
class TestableRunActiveEditorTaskCommand extends RunActiveEditorTaskCommand {
  public pickTaskResult: TaskItem | undefined = undefined;
  public pickTaskCalled = false;

  protected override async pickTask(_tasks: TaskItem[]): Promise<TaskItem | undefined> {
    this.pickTaskCalled = true;
    return this.pickTaskResult;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('RunActiveEditorTaskCommand Test Suite', () => {
  let context: vscode.ExtensionContext;
  let runTaskCalls: Array<{ item: TaskItem; args?: string; skipGuard?: boolean }>;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let originalActiveTextEditor: PropertyDescriptor | undefined;

  setup(() => {
    context = makeContext();
    runTaskCalls = [];

    originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = () => ({ dispose: () => {} });

    (LoggerService as any).instance = {
      error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    };
    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? item.label,
      normalizeTaskId: (id: string) => id,
      getStatus: () => 'idle',
    };
    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };

    (TaskRunner as any).instance = {
      runTask: async (item: TaskItem, args?: string, skipGuard?: boolean) => {
        runTaskCalls.push({ item, args, skipGuard });
        return true;
      },
    };

    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    (TaskCacheService as any).instance = undefined;

    originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    if (originalActiveTextEditor) {
      Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
    }
    (TaskCacheService as any).instance = undefined;
    (TaskRunner as any).instance = undefined;
    (TaskRunGuardService as any)._instance = undefined;
    (LoggerService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
  });

  // ── No active editor ───────────────────────────────────────────────────────

  test('run — no active editor returns early without calling runTask', async () => {
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => undefined,
      configurable: true,
    });
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const cmd = new RunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  // ── Non-file scheme ────────────────────────────────────────────────────────

  test('run — non-file scheme URI returns early', async () => {
    const fakeEditor = {
      document: { uri: vscode.Uri.parse('untitled:foo.sh') },
    } as unknown as vscode.TextEditor;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => fakeEditor,
      configurable: true,
    });
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const cmd = new RunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  // ── No matching tasks ──────────────────────────────────────────────────────

  test('run — no tasks registered for file returns early', async () => {
    const uri = makeFileUri('/workspace/package.json');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [],
    };
    const cmd = new RunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('run — all tasks are hidden returns early', async () => {
    const uri = makeFileUri('/workspace/Makefile');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (FilteredTaskService as any).instance = {
      isFiltered: () => true,
      isFilteredOrHasFilteredParent: () => true,
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'make'), makeTaskItem('test', 'npm')],
    };
    const cmd = new RunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('run — npm task in package.json runs directly', async () => {
    const uri = makeFileUri('/workspace/package.json');
    const npmTask = makeTaskItem('lint', 'npm');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [npmTask],
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, npmTask);
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
    assert.strictEqual((cmd as TestableRunActiveEditorTaskCommand).pickTaskCalled, false);
  });

  // ── Single task ────────────────────────────────────────────────────────────

  test('run — single shell task runs directly without QuickPick', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, taskItem);
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
    assert.strictEqual((cmd as TestableRunActiveEditorTaskCommand).pickTaskCalled, false);
  });

  test('run — single github-actions task runs directly', async () => {
    const uri = makeFileUri('/workspace/.github/workflows/ci.yml');
    const taskItem = makeTaskItem('ci', 'github-actions');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, taskItem);
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  // ── Run guard ──────────────────────────────────────────────────────────────

  test('run — confirmIfNeeded returns false aborts execution', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => false,
      isGuarded: () => true,
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  // ── Multiple tasks — QuickPick ─────────────────────────────────────────────

  test('run — multiple runnable tasks shows QuickPick', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const task1 = makeTaskItem('build', 'shell');
    const task2 = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [task1, task2],
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    (cmd as TestableRunActiveEditorTaskCommand).pickTaskResult = task1;
    await cmd.run();
    assert.strictEqual((cmd as TestableRunActiveEditorTaskCommand).pickTaskCalled, true);
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, task1);
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  test('run — multiple tasks QuickPick cancelled returns early', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const task1 = makeTaskItem('build', 'shell');
    const task2 = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [task1, task2],
    };
    const cmd = new TestableRunActiveEditorTaskCommand(context);
    (cmd as TestableRunActiveEditorTaskCommand).pickTaskResult = undefined;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('run — all task types (npm, make, shell, github-actions) are passed to QuickPick', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const shellTask = makeTaskItem('deploy', 'shell');
    const npmTask = makeTaskItem('lint', 'npm');
    const ghTask = makeTaskItem('ci', 'github-actions');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    let pickedTasks: TaskItem[] = [];
    const cmd = new (class extends RunActiveEditorTaskCommand {
      protected override async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
        pickedTasks = tasks;
        return tasks[0];
      }
    })(context);
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [shellTask, npmTask, ghTask],
    };
    await cmd.run();
    // All three task types should reach pickTask
    assert.strictEqual(pickedTasks.length, 3);
    assert.ok(pickedTasks.some(t => t.taskType === 'npm'));
    assert.ok(pickedTasks.some(t => t.taskType === 'shell'));
    assert.ok(pickedTasks.some(t => t.taskType === 'github-actions'));
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  // ── pickTask receives full runnable task list ────────────────────────────

  test('pickTask is called with all non-hidden leaf tasks', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const task1 = makeTaskItem('alpha', 'shell');
    const task2 = makeTaskItem('beta', 'github-actions');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });

    let receivedTasks: TaskItem[] = [];
    const cmd = new (class extends RunActiveEditorTaskCommand {
      protected override async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
        receivedTasks = tasks;
        return tasks[0];
      }
    })(context);
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [task1, task2],
    };
    await cmd.run();
    assert.deepStrictEqual(receivedTasks, [task1, task2]);
  });
});
