import * as assert from 'assert';
import * as vscode from 'vscode';
import { ScriptArgumentResolverRegistry } from '../../libs/scriptArgumentResolverRegistry';
import { ScriptArgumentResolver, ArgumentResolveResult } from '../../libs/scriptArgumentResolver';
import { tryGuidedInput } from '../../libs/guidedArgInput';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver(name: string, canHandleExt: string, result: ArgumentResolveResult): ScriptArgumentResolver {
  return {
    name,
    canHandle: (fp: string) => fp.toLowerCase().endsWith(canHandleExt.toLowerCase()),
    resolve: async () => result,
  };
}

// ---------------------------------------------------------------------------
// Registry unit tests
// ---------------------------------------------------------------------------

suite('ScriptArgumentResolverRegistry', () => {
  let registry: ScriptArgumentResolverRegistry;

  setup(() => {
    // Reset singleton for isolation
    (ScriptArgumentResolverRegistry as any).instance = undefined;
    registry = ScriptArgumentResolverRegistry.getInstance();
  });

  teardown(() => {
    (ScriptArgumentResolverRegistry as any).instance = undefined;
  });

  test('getInstance returns the same instance', () => {
    const a = ScriptArgumentResolverRegistry.getInstance();
    const b = ScriptArgumentResolverRegistry.getInstance();
    assert.strictEqual(a, b);
  });

  test('register and getResolverNames', () => {
    registry.register('.ps1', makeResolver('R1', '.ps1', { supported: true, parameters: [] }));
    registry.register('.ps1', makeResolver('R2', '.ps1', { supported: true, parameters: [] }));
    assert.deepStrictEqual(registry.getResolverNames('.ps1'), ['R1', 'R2']);
  });

  test('unregisterAll removes all resolvers for extension', () => {
    registry.register('.ps1', makeResolver('R1', '.ps1', { supported: true, parameters: [] }));
    registry.unregisterAll('.ps1');
    assert.deepStrictEqual(registry.getResolverNames('.ps1'), []);
  });

  test('resolveForFile returns undefined when no resolvers are registered', async () => {
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.strictEqual(result, undefined);
  });

  test('resolveForFile returns undefined when all resolvers return supported: false', async () => {
    registry.register('.ps1', makeResolver('R1', '.ps1', { supported: false, parameters: [] }));
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.strictEqual(result, undefined);
  });

  test('resolveForFile returns undefined when resolver returns supported: true but no parameters', async () => {
    registry.register('.ps1', makeResolver('R1', '.ps1', { supported: true, parameters: [] }));
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.strictEqual(result, undefined);
  });

  test('resolveForFile returns first successful result', async () => {
    const params = [{ name: 'Env', type: 'string' as const, required: true }];
    registry.register('.ps1', makeResolver('R1', '.ps1', { supported: false, parameters: [] }));
    registry.register('.ps1', makeResolver('R2', '.ps1', { supported: true, parameters: params }));
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.ok(result);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].name, 'Env');
  });

  test('resolveForFile stops at first success — does not call later resolvers', async () => {
    let r2Called = false;
    const params = [{ name: 'Env', type: 'string' as const, required: true }];
    const r1 = makeResolver('R1', '.ps1', { supported: true, parameters: params });
    const r2: ScriptArgumentResolver = {
      name: 'R2',
      canHandle: (fp) => fp.endsWith('.ps1'),
      resolve: async () => { r2Called = true; return { supported: true, parameters: params }; },
    };
    registry.register('.ps1', r1);
    registry.register('.ps1', r2);
    await registry.resolveForFile('/script.ps1', '');
    assert.strictEqual(r2Called, false);
  });

  test('resolveForFile skips resolver whose canHandle returns false', async () => {
    let resolveCalled = false;
    const resolver: ScriptArgumentResolver = {
      name: 'R1',
      canHandle: () => false,
      resolve: async () => { resolveCalled = true; return { supported: true, parameters: [] }; },
    };
    registry.register('.ps1', resolver);
    await registry.resolveForFile('/script.ps1', '');
    assert.strictEqual(resolveCalled, false);
  });

  test('resolveForFile continues after a resolver throws', async () => {
    const throwing: ScriptArgumentResolver = {
      name: 'Thrower',
      canHandle: () => true,
      resolve: async () => { throw new Error('boom'); },
    };
    const params = [{ name: 'Env', type: 'string' as const, required: true }];
    const good = makeResolver('Good', '.ps1', { supported: true, parameters: params });
    registry.register('.ps1', throwing);
    registry.register('.ps1', good);
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.ok(result);
    assert.strictEqual(result.parameters[0].name, 'Env');
  });

  test('extension matching is case-insensitive', async () => {
    const params = [{ name: 'X', type: 'string' as const, required: false }];
    registry.register('.PS1', makeResolver('R1', '.PS1', { supported: true, parameters: params }));
    const result = await registry.resolveForFile('/script.ps1', '');
    assert.ok(result);
  });

  test('multiple extensions are independent', async () => {
    const ps1Params = [{ name: 'PSParam', type: 'string' as const, required: true }];
    const pyParams = [{ name: 'pyParam', type: 'int' as const, required: false }];
    registry.register('.ps1', makeResolver('PS', '.ps1', { supported: true, parameters: ps1Params }));
    registry.register('.py', makeResolver('PY', '.py', { supported: true, parameters: pyParams }));

    const ps1Result = await registry.resolveForFile('/script.ps1', '');
    const pyResult = await registry.resolveForFile('/script.py', '');

    assert.strictEqual(ps1Result?.parameters[0].name, 'PSParam');
    assert.strictEqual(pyResult?.parameters[0].name, 'pyParam');
  });
});

// ---------------------------------------------------------------------------
// Integration: RunActiveEditorTaskWithArgsCommand guided path
// ---------------------------------------------------------------------------
import { RunActiveEditorTaskWithArgsCommand } from '../../commands/runActiveEditorTaskWithArgs';
import { TaskItem } from '../../taskItem';
import { TaskRunner } from '../../taskRunner';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { LoggerService } from '../../services/loggerService';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskStateManager } from '../../taskStateManager';
import { TaskCacheService } from '../../services/taskCacheService';

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {} },
  } as unknown as vscode.ExtensionContext;
}

function makeTaskItem(label: string, taskType: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = label;
  item.originalLabel = label;
  item.taskFileUri = vscode.Uri.file(`/workspace/${label}.ps1`);
  return item;
}

class TestableCmd extends RunActiveEditorTaskWithArgsCommand {
  public pickTaskResult: TaskItem | undefined = undefined;
  protected override async pickTask(_tasks: TaskItem[]): Promise<TaskItem | undefined> {
    return this.pickTaskResult;
  }
}

suite('RunActiveEditorTaskWithArgsCommand — guided arg input integration', () => {
  let context: vscode.ExtensionContext;
  let runTaskCalls: Array<{ item: TaskItem; args?: string }>;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalActiveTextEditor: PropertyDescriptor | undefined;
  let registrySingleton: ScriptArgumentResolverRegistry;

  setup(() => {
    context = makeContext();
    runTaskCalls = [];

    originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = () => ({ dispose: () => {} });

    (LoggerService as any).instance = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? item.label,
      normalizeTaskId: (id: string) => id,
      getStatus: () => 'idle',
    };
    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false, isFilteredOrHasFilteredParent: () => false,
    };
    (TaskRunner as any).instance = {
      runTask: async (item: TaskItem, args?: string) => { runTaskCalls.push({ item, args }); return true; },
    };
    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
      isGuarded: () => false,
    };
    (TaskCacheService as any).instance = undefined;

    // Reset registry singleton
    (ScriptArgumentResolverRegistry as any).instance = undefined;
    registrySingleton = ScriptArgumentResolverRegistry.getInstance();

    originalShowInputBox = vscode.window.showInputBox;
    originalShowQuickPick = vscode.window.showQuickPick;
    originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (vscode.window as any).showInputBox = originalShowInputBox;
    (vscode.window as any).showQuickPick = originalShowQuickPick;
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
    (ScriptArgumentResolverRegistry as any).instance = undefined;
  });

  // T27 — guidedArgInput: false uses free-text regardless
  test('T27 — guidedArgInput false: free-text input is used', async () => {
    const uri = vscode.Uri.file('/workspace/script.ps1');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => ({ document: { uri } } as unknown as vscode.TextEditor),
      configurable: true,
    });

    const item = makeTaskItem('script', 'shell');
    (TaskCacheService as any).instance = { getTasksForFile: () => [item] };

    let showInputBoxCalled = false;
    (vscode.window as any).showInputBox = async () => { showInputBoxCalled = true; return '--foo bar'; };

    // Register a resolver that would succeed (to confirm it's not used)
    registrySingleton.register('.ps1', makeResolver('R', '.ps1', {
      supported: true,
      parameters: [{ name: 'Env', type: 'string', required: true }],
    }));

    // Patch configuration to return false for guidedArgInput
    const origGetConfig = vscode.workspace.getConfiguration.bind(vscode.workspace);
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: (key: string, def?: any) => key === 'task.guidedArgInput' ? false : def };
      }
      return origGetConfig(section);
    };

    try {
      const cmd = new TestableCmd(context);
      await cmd.run();
      assert.ok(showInputBoxCalled, 'showInputBox should have been called');
    } finally {
      (vscode.workspace as any).getConfiguration = origGetConfig;
    }
  });

  // T28 — guidedArgInput: true, discovery succeeds → guided input shown
  test('T28 — guidedArgInput true, resolver succeeds: guided input path taken', async () => {
    const item = makeTaskItem('script', 'shell');
    const params = [{ name: 'Env', type: 'string' as const, required: true }];

    registrySingleton.register('.ps1', makeResolver('R', '.ps1', { supported: true, parameters: params }));

    // Mock workspace.fs.readFile
    const origFs = vscode.workspace.fs;
    (vscode.workspace as any).fs = {
      ...origFs,
      readFile: async () => new Uint8Array(Buffer.from('')),
    };

    let quickPickCalled = false;
    (vscode.window as any).showInputBox = async () => { quickPickCalled = true; return 'production'; };

    const result = await tryGuidedInput(item);
    assert.ok(Array.isArray(result), 'tryGuidedInput should return an array when guided input succeeds');

    (vscode.workspace as any).fs = origFs;
  });

  // T29/T30 — resolver returns supported: false, tryGuidedInput returns undefined
  test('T29/T30 — resolver unsupported: tryGuidedInput returns undefined', async () => {
    const item = makeTaskItem('script', 'shell');

    registrySingleton.register('.ps1', makeResolver('R', '.ps1', { supported: false, parameters: [] }));

    const origFs = vscode.workspace.fs;
    (vscode.workspace as any).fs = {
      ...origFs,
      readFile: async () => new Uint8Array(Buffer.from('')),
    };

    const result = await tryGuidedInput(item);
    assert.strictEqual(result, undefined);

    (vscode.workspace as any).fs = origFs;
  });

  // T31 — cancelling a required param returns undefined → task not run
  test('T31 — cancelling required param: tryGuidedInput returns undefined', async () => {
    const item = makeTaskItem('script', 'shell');
    const params = [{ name: 'Env', type: 'string' as const, required: true }];

    registrySingleton.register('.ps1', makeResolver('R', '.ps1', { supported: true, parameters: params }));

    const origFs = vscode.workspace.fs;
    (vscode.workspace as any).fs = {
      ...origFs,
      readFile: async () => new Uint8Array(Buffer.from('')),
    };

    // User cancels the input box (returns undefined)
    (vscode.window as any).showInputBox = async () => undefined;

    const result = await tryGuidedInput(item);
    assert.strictEqual(result, undefined, 'Cancelled required param should produce undefined');

    (vscode.workspace as any).fs = origFs;
  });

  // T32 — no taskFileUri: tryGuidedInput returns undefined
  test('T32 — no taskFileUri: tryGuidedInput returns undefined', async () => {
    const item = makeTaskItem('script', 'shell');
    item.taskFileUri = undefined;

    const result = await tryGuidedInput(item);
    assert.strictEqual(result, undefined);
  });
});
