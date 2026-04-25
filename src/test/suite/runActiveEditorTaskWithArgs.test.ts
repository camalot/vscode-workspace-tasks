import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunActiveEditorTaskWithArgsCommand } from '../../commands/runActiveEditorTaskWithArgs';
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
class TestableRunActiveEditorTaskWithArgsCommand extends RunActiveEditorTaskWithArgsCommand {
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

suite('RunActiveEditorTaskWithArgsCommand Test Suite', () => {
  let context: vscode.ExtensionContext;
  let runTaskCalls: Array<{ item: TaskItem; args?: string; skipGuard?: boolean }>;
  let confirmCalls: TaskItem[];
  let showInputBoxResult: string | undefined;
  let showInputBoxCalls: number;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalActiveTextEditor: PropertyDescriptor | undefined;

  setup(() => {
    context = makeContext();
    runTaskCalls = [];
    confirmCalls = [];
    showInputBoxResult = undefined;
    showInputBoxCalls = 0;

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
      confirmIfNeeded: async (item: TaskItem) => {
        confirmCalls.push(item);
        return true;
      },
      isGuarded: () => false,
    };

    (TaskCacheService as any).instance = undefined;

    originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => {
      showInputBoxCalls++;
      return showInputBoxResult;
    };
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (vscode.window as any).showInputBox = originalShowInputBox;
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
    const cmd = new RunActiveEditorTaskWithArgsCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(showInputBoxCalls, 0);
    assert.strictEqual(confirmCalls.length, 0);
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
    const cmd = new RunActiveEditorTaskWithArgsCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(showInputBoxCalls, 0);
  });

  // ── No matching tasks ──────────────────────────────────────────────────────

  test('run — no runnable tasks for file returns early', async () => {
    const uri = makeFileUri('/workspace/package.json');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('lint', 'npm')],
    };
    const cmd = new RunActiveEditorTaskWithArgsCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(showInputBoxCalls, 0);
  });

  // ── Run guard fires BEFORE showInputBox ────────────────────────────────────

  test('run — guard is called before showInputBox', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => undefined,
    };

    const order: string[] = [];
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async (item: TaskItem) => {
        order.push('guard');
        confirmCalls.push(item);
        return true;
      },
      isGuarded: () => false,
    };
    (vscode.window as any).showInputBox = async () => {
      order.push('inputBox');
      showInputBoxCalls++;
      return 'someArg';
    };

    showInputBoxResult = 'someArg';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();

    assert.deepStrictEqual(order, ['guard', 'inputBox'],
      'Guard must be called before input box');
  });

  test('run — confirmIfNeeded returns false aborts execution (no showInputBox)', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => undefined,
    };
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => false,
      isGuarded: () => true,
    };
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(showInputBoxCalls, 0);
    assert.strictEqual(runTaskCalls.length, 0);
  });

  // ── showInputBox cancelled ─────────────────────────────────────────────────

  test('run — showInputBox cancelled (undefined) does not call runTask', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => undefined,
    };
    showInputBoxResult = undefined;
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('run — showInputBox returns empty string calls runTask with empty args', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => undefined,
    };
    showInputBoxResult = '';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].args, '');
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  // ── Normal execution ───────────────────────────────────────────────────────

  test('run — single shell task runs with provided args and skipGuard=true', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => taskItem,
    };
    showInputBoxResult = '--env prod';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, taskItem);
    assert.strictEqual(runTaskCalls[0].args, '--env prod');
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  test('run — single task resolves from cache when cached item differs', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const staleItem = makeTaskItem('deploy', 'shell');
    const freshItem = makeTaskItem('deploy', 'shell');
    freshItem.guardedByDefinition = true;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [staleItem],
      getTask: (id: string) => (id === 'deploy' ? freshItem : undefined),
    };
    showInputBoxResult = 'arg1';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = freshItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, freshItem);
    assert.strictEqual(runTaskCalls[0].item.guardedByDefinition, true);
  });

  test('run — single github-actions task runs with args', async () => {
    const uri = makeFileUri('/workspace/.github/workflows/ci.yml');
    const taskItem = makeTaskItem('ci', 'github-actions');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
      getTask: () => undefined,
    };
    showInputBoxResult = '--dry-run';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].args, '--dry-run');
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  // ── Multiple tasks — QuickPick ─────────────────────────────────────────────

  test('run — multiple runnable tasks shows QuickPick then prompts for args', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const task1 = makeTaskItem('build', 'shell');
    const task2 = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [task1, task2],
      getTask: (id: string) => (id === 'build' ? task1 : id === 'deploy' ? task2 : undefined),
    };
    showInputBoxResult = '--flag';
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = task1;
    await cmd.run();
    assert.strictEqual((cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskCalled, true);
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, task1);
    assert.strictEqual(runTaskCalls[0].args, '--flag');
  });

  test('run — multiple tasks QuickPick cancelled returns early without prompting for args', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const task1 = makeTaskItem('build', 'shell');
    const task2 = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [task1, task2],
      getTask: () => undefined,
    };
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = undefined;
    await cmd.run();
    assert.strictEqual(showInputBoxCalls, 0);
    assert.strictEqual(runTaskCalls.length, 0);
  });
});
