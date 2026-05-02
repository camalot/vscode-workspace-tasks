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
  let runTaskCalls: Array<{ item: TaskItem; args?: string; skipGuard?: boolean; varAssignments?: string[] }>;
  let confirmCalls: TaskItem[];
  let showInputBoxResponses: Array<string | undefined>;
  let showInputBoxCalls: number;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalActiveTextEditor: PropertyDescriptor | undefined;

  setup(() => {
    context = makeContext();
    runTaskCalls = [];
    confirmCalls = [];
    showInputBoxResponses = [];
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
      runTask: async (
        item: TaskItem,
        args?: string,
        skipGuard?: boolean,
        _resolvedLabel?: string,
        varAssignments?: string[],
      ) => {
        runTaskCalls.push({ item, args, skipGuard, varAssignments });
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
      if (showInputBoxResponses.length === 0) {
        return undefined;
      }
      return showInputBoxResponses.shift();
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

  test('run — no tasks registered for file returns early', async () => {
    const uri = makeFileUri('/workspace/package.json');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [],
    };
    const cmd = new RunActiveEditorTaskWithArgsCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(showInputBoxCalls, 0);
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
    const cmd = new RunActiveEditorTaskWithArgsCommand(context);
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(showInputBoxCalls, 0);
  });

  test('run — npm task in package.json runs with args', async () => {
    const uri = makeFileUri('/workspace/package.json');
    const npmTask = makeTaskItem('lint', 'npm');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [npmTask],
    };
    showInputBoxResponses = ['--fix', ''];
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = npmTask;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, npmTask);
    assert.strictEqual(runTaskCalls[0].args, '--fix');
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
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
    };

    const order: string[] = [];
    showInputBoxResponses = ['someArg', ''];
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
      if (showInputBoxResponses.length === 0) {
        return undefined;
      }
      return showInputBoxResponses.shift();
    };

    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();

    assert.deepStrictEqual(order, ['guard', 'inputBox', 'inputBox'],
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
    };
    showInputBoxResponses = [undefined];
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
    };
    showInputBoxResponses = [''];
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
    };
    showInputBoxResponses = ['--env', 'prod', ''];
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, taskItem);
    assert.strictEqual(runTaskCalls[0].args, '--env prod');
    assert.strictEqual(runTaskCalls[0].skipGuard, true);
  });

  test('run — collects required vars before additional args and forwards assignments', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'taskfile');
    taskItem.metadata = { requiredVars: [{ name: 'ENV', enum: ['dev', 'prod'] }] };
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };

    const originalQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => 'prod';
    showInputBoxResponses = ['--verbose', ''];

    try {
      const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
      (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
      await cmd.run();

      assert.strictEqual(runTaskCalls.length, 1);
      assert.deepStrictEqual(runTaskCalls[0].varAssignments, ["ENV='prod'"]);
      assert.strictEqual(runTaskCalls[0].args, '--verbose');
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
    }
  });

  test('run — escape after one entered argument cancels execution', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };
    showInputBoxResponses = ['--env=prod', undefined];

    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();

    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('run — item returned by getRunnableTasksForFile is used directly (no secondary lookup)', async () => {
    const uri = makeFileUri('/workspace/deploy.sh');
    const taskItem = makeTaskItem('deploy', 'shell');
    taskItem.guardedByDefinition = true;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [taskItem],
    };
    showInputBoxResponses = ['arg1', ''];
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = taskItem;
    await cmd.run();
    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, taskItem);
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
    };
    showInputBoxResponses = ['--dry-run', ''];
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
    };
    showInputBoxResponses = ['--flag', ''];
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
    };
    const cmd = new TestableRunActiveEditorTaskWithArgsCommand(context);
    (cmd as TestableRunActiveEditorTaskWithArgsCommand).pickTaskResult = undefined;
    await cmd.run();
    assert.strictEqual(showInputBoxCalls, 0);
    assert.strictEqual(runTaskCalls.length, 0);
  });
});
