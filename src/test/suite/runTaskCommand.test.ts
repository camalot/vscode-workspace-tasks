import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunTaskCommand } from '../../commands/runTask';
import { RunTaskWithArgsCommand } from '../../commands/runTaskWithArgs';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskRunner } from '../../taskRunner';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { LoggerService } from '../../services/loggerService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: {
      get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

function makeTaskItem(label: string, taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = label;
  item.originalLabel = label;
  return item;
}

/**
 * Returns a serialized (plain object) representation of a TaskItem, mimicking what
 * VS Code produces when it serializes command arguments via TaskItem.toJSON().
 * guardedByDefinition is intentionally absent.
 */
function serializeItem(item: TaskItem): TaskItem {
  return {
    id: item.id,
    label: item.label,
    taskType: item.taskType,
    contextValue: item.contextValue,
  } as unknown as TaskItem;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('RunTaskCommand Test Suite', () => {
  let context: vscode.ExtensionContext;

  // Captured calls
  let runTaskCalls: Array<{ item: TaskItem; args?: string; skipGuard?: boolean }>;
  let runCompoundCalls: Array<{ name: string; item: TaskItem }>;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;

  setup(() => {
    context = makeFakeContext();
    runTaskCalls = [];
    runCompoundCalls = [];

    // Stub vscode.commands.registerCommand to prevent 'command already exists' errors
    // when creating command instances inside tests (extension is already activated).
    originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = () => ({ dispose: () => {} });

    // Stub logger
    (LoggerService as any).instance = {
      error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    };

    // Stub state manager
    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? item.label,
      normalizeTaskId: (id: string) => id,
      getStatus: () => 'idle',
    };

    // Stub favorites and filter services so TaskItem.updateContextValue() doesn't throw
    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };

    // Stub TaskRunner so no real execution happens
    (TaskRunner as any).instance = {
      runTask: async (item: TaskItem, args?: string, skipGuard?: boolean) => {
        runTaskCalls.push({ item, args, skipGuard });
        return true;
      },
      runCompoundTask: async (name: string, item: TaskItem) => {
        runCompoundCalls.push({ name, item });
      },
    };

    // Stub TaskRunGuardService so no real dialogs appear
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    // Reset TaskCacheService so each test controls what's in the cache
    (TaskCacheService as any).instance = undefined;
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (TaskCacheService as any).instance = undefined;
    (TaskRunner as any).instance = undefined;
    (TaskRunGuardService as any)._instance = undefined;
    (LoggerService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
  });

  // ── RunTaskCommand ─────────────────────────────────────────────────────────

  test('RunTaskCommand: no item — returns early without calling runTask', async () => {
    const cmd = new RunTaskCommand(context);
    await cmd.run(undefined as unknown as TaskItem);
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('RunTaskCommand: item with no contextValue — returns early without calling runTask', async () => {
    const cmd = new RunTaskCommand(context);
    const item = makeTaskItem('build');
    (item as any).contextValue = undefined;
    await cmd.run(item);
    assert.strictEqual(runTaskCalls.length, 0);
  });

  test('RunTaskCommand: normal item not in cache — calls runTask with item as-is', async () => {
    // Nothing in cache
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const cmd = new RunTaskCommand(context);
    const item = makeTaskItem('build');
    item.contextValue = 'task';
    await cmd.run(item);

    assert.strictEqual(runTaskCalls.length, 1);
    assert.strictEqual(runTaskCalls[0].item, item);
  });

  test('RunTaskCommand: serialized item (no guardedByDefinition) — resolves real item from cache', async () => {
    // Real item in cache has guardedByDefinition set
    const real = makeTaskItem('deploy');
    real.contextValue = 'task';
    real.guardedByDefinition = true;

    (TaskCacheService as any).instance = {
      getTask: (id: string) => (id === 'deploy' ? real : undefined),
    };

    const cmd = new RunTaskCommand(context);

    // Simulate serialized item: has id/contextValue but NOT guardedByDefinition
    const serialized = serializeItem(real);
    serialized.contextValue = 'task';
    await cmd.run(serialized);

    assert.strictEqual(runTaskCalls.length, 1);
    // The command must pass the REAL (cached) item to runTask, not the stripped copy
    assert.strictEqual(runTaskCalls[0].item, real,
      'RunTaskCommand should pass the cached item (with guardedByDefinition) to runTask');
    assert.strictEqual(runTaskCalls[0].item.guardedByDefinition, true);
  });

  test('RunTaskCommand: queuedTask context — calls runCompoundTask instead of runTask', async () => {
    const parentItem = makeTaskItem('my-queue');
    parentItem.contextValue = 'compoundTask';

    const child = makeTaskItem('deploy');
    child.contextValue = 'queuedTask';
    child.parent = parentItem;

    (TaskCacheService as any).instance = {
      getTask: (id: string) => (id === 'deploy' ? child : undefined),
    };

    const cmd = new RunTaskCommand(context);
    await cmd.run(child);

    assert.strictEqual(runCompoundCalls.length, 1);
    assert.strictEqual(runTaskCalls.length, 0);
    assert.strictEqual(runCompoundCalls[0].name, 'my-queue');
  });

  // ── RunTaskWithArgsCommand ─────────────────────────────────────────────────

  test('RunTaskWithArgsCommand: no item — returns early without calling confirmIfNeeded', async () => {
    let confirmCalled = false;
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => { confirmCalled = true; return true; },
      isGuarded: () => false,
    };

    const cmd = new RunTaskWithArgsCommand(context);
    await cmd.run(undefined);
    assert.strictEqual(confirmCalled, false);
  });

  test('RunTaskWithArgsCommand: guard cancelled — does not prompt for args or run task', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => false,
      isGuarded: () => true,
    };

    let inputBoxShown = false;
    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => { inputBoxShown = true; return undefined; };

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('deploy');
      item.contextValue = 'task';
      (TaskCacheService as any).instance = { getTask: () => undefined };
      await cmd.run(item);

      assert.strictEqual(inputBoxShown, false, 'showInputBox should not be called when guard is cancelled');
      assert.strictEqual(runTaskCalls.length, 0);
    } finally {
      (vscode.window as any).showInputBox = originalInputBox;
    }
  });

  test('RunTaskWithArgsCommand: serialized item (no guardedByDefinition) — resolves real item from cache for guard check', async () => {
    const real = makeTaskItem('deploy');
    real.contextValue = 'task';
    real.guardedByDefinition = true;

    let itemPassedToConfirm: TaskItem | undefined;
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async (item: TaskItem) => {
        itemPassedToConfirm = item;
        return true;
      },
      isGuarded: () => true,
    };

    (TaskCacheService as any).instance = {
      getTask: (id: string) => (id === 'deploy' ? real : undefined),
    };

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => 'some-arg';

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const serialized = serializeItem(real);
      serialized.contextValue = 'task';
      await cmd.run(serialized);

      assert.strictEqual(itemPassedToConfirm, real,
        'confirmIfNeeded should receive the real cached item (with guardedByDefinition), not the serialized copy');
      assert.strictEqual(itemPassedToConfirm?.guardedByDefinition, true);
    } finally {
      (vscode.window as any).showInputBox = originalInputBox;
    }
  });

  test('RunTaskWithArgsCommand: guard confirmed, args entered — runs task with skipGuard=true', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => '--verbose';

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].args, '--verbose');
      assert.strictEqual(runTaskCalls[0].skipGuard, true,
        'runTask should be called with skipGuard=true to avoid double guard dialog');
    } finally {
      (vscode.window as any).showInputBox = originalInputBox;
    }
  });

  test('RunTaskWithArgsCommand: args dialog dismissed (undefined) — does not run task', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => undefined; // user dismisses

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 0, 'Task should not run when input box is dismissed');
    } finally {
      (vscode.window as any).showInputBox = originalInputBox;
    }
  });
});
