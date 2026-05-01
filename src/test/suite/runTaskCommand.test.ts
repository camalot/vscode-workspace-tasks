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
import { configuration } from '../../libs/configuration';
import * as guidedArgInput from '../../libs/guidedArgInput';
import { LoggerService } from '../../services/loggerService';
import * as taskfileWildcardUtils from '../../libs/taskfileWildcardUtils';

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
  let runTaskCalls: Array<{ item: TaskItem; args?: string; skipGuard?: boolean; resolvedLabel?: string }>;
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
      runTask: async (item: TaskItem, args?: string, skipGuard?: boolean, resolvedLabel?: string) => {
        runTaskCalls.push({ item, args, skipGuard, resolvedLabel });
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
    const responses: Array<string | undefined> = ['some-arg', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];

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
    const responses: Array<string | undefined> = ['--verbose', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];

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

  test('RunTaskWithArgsCommand: multiple single-argument entries are joined', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalInputBox = vscode.window.showInputBox;
    const responses: Array<string | undefined> = ['--foo=bar', '--verbose', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].args, '--foo=bar --verbose');
    } finally {
      (vscode.window as any).showInputBox = originalInputBox;
    }
  });

  test('RunTaskWithArgsCommand: escape after entering args cancels execution', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalInputBox = vscode.window.showInputBox;
    const responses: Array<string | undefined> = ['--foo=bar', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 0, 'Task should not run when additional-args input is cancelled');
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

  test('RunTaskWithArgsCommand: guided input cancelled — does not run task', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalTryGuided = (guidedArgInput as any).tryGuidedInputWithStatus;
    (guidedArgInput as any).tryGuidedInputWithStatus = async () => ({ status: 'cancelled' });

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 0, 'Task should not run when guided input is cancelled');
    } finally {
      (guidedArgInput as any).tryGuidedInputWithStatus = originalTryGuided;
    }
  });

  test('RunTaskWithArgsCommand: guided input collected and additional args provided — runs merged args', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalTryGuided = (guidedArgInput as any).tryGuidedInputWithStatus;
    const originalCollectAdditional = (guidedArgInput as any).collectAdditionalArgs;
    (guidedArgInput as any).tryGuidedInputWithStatus = async () => ({ status: 'collected', args: ['--foo'] });
    (guidedArgInput as any).collectAdditionalArgs = async () => ['--bar'];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].args, '--foo --bar');
      assert.strictEqual(runTaskCalls[0].skipGuard, true);
    } finally {
      (guidedArgInput as any).tryGuidedInputWithStatus = originalTryGuided;
      (guidedArgInput as any).collectAdditionalArgs = originalCollectAdditional;
    }
  });

  test('RunTaskWithArgsCommand: guidedArgInput disabled falls back to free-form args', async () => {
    const originalConfig = configuration.get.bind(configuration);
    configuration.get = (key: string, defaultValue: any) => {
      if (key === 'task.guidedArgInput') {
        return false;
      }
      return defaultValue;
    };
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = { getTask: () => undefined };

    const originalCollectAdditional = (guidedArgInput as any).collectAdditionalArgs;
    (guidedArgInput as any).collectAdditionalArgs = async () => ['--fallback'];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      const item = makeTaskItem('build');
      item.contextValue = 'task';
      await cmd.run(item);

      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].args, '--fallback');
    } finally {
      configuration.get = originalConfig;
      (guidedArgInput as any).collectAdditionalArgs = originalCollectAdditional;
    }
  });

  // ── Wildcard task tests (RunTaskCommand) ──────────────────────────────────

  test('T-R1: RunTaskCommand calls promptAndResolveWildcards after cache resolution when isWildcardTask', async () => {
    const real = makeTaskItem('start:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = {
      getTask: (id: string) => (id === 'start:*' ? real : undefined),
    };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    let promptCalled = false;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async (name: string, count: number) => {
      promptCalled = true;
      assert.strictEqual(name, 'start:*');
      assert.strictEqual(count, 1);
      return 'start:foo';
    };

    try {
      const cmd = new RunTaskCommand(context);
      await cmd.run(real);
      assert.strictEqual(promptCalled, true);
      assert.strictEqual(runTaskCalls.length, 1);
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
    }
  });

  test('T-R2: RunTaskCommand passes resolvedLabel to runTask', async () => {
    const real = makeTaskItem('start:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => 'start:bar';

    try {
      const cmd = new RunTaskCommand(context);
      await cmd.run(real);
      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].resolvedLabel, 'start:bar');
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
    }
  });

  test('T-R3: RunTaskCommand aborts when wildcard prompt is cancelled', async () => {
    const real = makeTaskItem('start:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => undefined;

    try {
      const cmd = new RunTaskCommand(context);
      await cmd.run(real);
      assert.strictEqual(runTaskCalls.length, 0, 'runTask must not be called when wildcard prompt is cancelled');
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
    }
  });

  test('T-R4: RunTaskCommand skips wildcard prompt for non-wildcard tasks', async () => {
    const real = makeTaskItem('build');
    real.contextValue = 'task';
    real.metadata = {};

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    let promptCalled = false;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => {
      promptCalled = true;
      return 'should-not-be-called';
    };

    try {
      const cmd = new RunTaskCommand(context);
      await cmd.run(real);
      assert.strictEqual(promptCalled, false);
      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].resolvedLabel, undefined);
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
    }
  });

  // ── Wildcard task tests (RunTaskWithArgsCommand) ──────────────────────────

  test('T-A1: RunTaskWithArgsCommand shows wildcard prompt (after cache resolution) before guided input', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    const real = makeTaskItem('deploy:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = { getTask: () => real };

    const callOrder: string[] = [];
    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => {
      callOrder.push('wildcard');
      return 'deploy:prod';
    };

    const originalTryGuided = (guidedArgInput as any).tryGuidedInputWithStatus;
    (guidedArgInput as any).tryGuidedInputWithStatus = async () => {
      callOrder.push('guided');
      return { status: 'unavailable' };
    };

    const originalCollect = (guidedArgInput as any).collectAdditionalArgs;
    (guidedArgInput as any).collectAdditionalArgs = async () => {
      callOrder.push('collect');
      return [];
    };

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      await cmd.run(real);
      assert.ok(callOrder.indexOf('wildcard') < callOrder.indexOf('guided'),
        'wildcard prompt should come before guided input');
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
      (guidedArgInput as any).tryGuidedInputWithStatus = originalTryGuided;
      (guidedArgInput as any).collectAdditionalArgs = originalCollect;
    }
  });

  test('T-A2: RunTaskWithArgsCommand aborts without calling runTask when wildcard prompt cancelled', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    const real = makeTaskItem('deploy:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => undefined;

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      await cmd.run(real);
      assert.strictEqual(runTaskCalls.length, 0, 'runTask must not be called when wildcard cancelled');
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
    }
  });

  test('T-A3: RunTaskWithArgsCommand passes resolvedLabel to runTask when wildcards provided', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    const real = makeTaskItem('deploy:*');
    real.contextValue = 'task';
    real.metadata = { isWildcardTask: true, wildcardCount: 1 };

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalPrompt = taskfileWildcardUtils.promptAndResolveWildcards;
    (taskfileWildcardUtils as any).promptAndResolveWildcards = async () => 'deploy:staging';

    const originalTryGuided = (guidedArgInput as any).tryGuidedInputWithStatus;
    (guidedArgInput as any).tryGuidedInputWithStatus = async () => ({ status: 'unavailable' });

    const originalCollect = (guidedArgInput as any).collectAdditionalArgs;
    (guidedArgInput as any).collectAdditionalArgs = async () => [];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      await cmd.run(real);
      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].resolvedLabel, 'deploy:staging');
    } finally {
      (taskfileWildcardUtils as any).promptAndResolveWildcards = originalPrompt;
      (guidedArgInput as any).tryGuidedInputWithStatus = originalTryGuided;
      (guidedArgInput as any).collectAdditionalArgs = originalCollect;
    }
  });

  test('T-A4: RunTaskWithArgsCommand passes args correctly for hasCLIArgs task', async () => {
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };

    const real = makeTaskItem('yarn');
    real.contextValue = 'task';
    real.metadata = { hasCLIArgs: true };

    (TaskCacheService as any).instance = { getTask: () => real };

    const originalTryGuided = (guidedArgInput as any).tryGuidedInputWithStatus;
    (guidedArgInput as any).tryGuidedInputWithStatus = async () => ({ status: 'unavailable' });

    const originalCollect = (guidedArgInput as any).collectAdditionalArgs;
    (guidedArgInput as any).collectAdditionalArgs = async () => ['install'];

    try {
      const cmd = new RunTaskWithArgsCommand(context);
      await cmd.run(real);
      assert.strictEqual(runTaskCalls.length, 1);
      assert.strictEqual(runTaskCalls[0].args, 'install');
      assert.strictEqual(runTaskCalls[0].skipGuard, true);
    } finally {
      (guidedArgInput as any).tryGuidedInputWithStatus = originalTryGuided;
      (guidedArgInput as any).collectAdditionalArgs = originalCollect;
    }
  });
});
