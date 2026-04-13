import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { TaskStateManager } from '../../taskStateManager';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskEnvService } from '../../services/taskEnvService';
import { TaskSecretWarningService } from '../../services/taskSecretWarningService';
import { TaskCacheService } from '../../services/taskCacheService';
import { InspectTaskEnvCommand } from '../../commands/inspectTaskEnvCommand';
import { IResolvedEnvEntry } from '../../services/taskEnvTypes';

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
    secrets: {
      keys: async () => [],
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
  } as unknown as vscode.ExtensionContext;
}

function makeMinimalStateManagerStub(): TaskStateManager {
  return {
    getTaskId: (item: TaskItem) => `${item.taskType}:${item.label}`,
    normalizeTaskId: (id: string) => id,
    normalizeTaskIds: (ids: string[]) => ids,
    getStatus: (_id: string) => 'idle',
    generatePortableTaskId: () => 'test-id',
  } as unknown as TaskStateManager;
}

function makeMinimalFilteredTaskServiceStub(): FilteredTaskService {
  return {
    isFiltered: () => false,
    isFilteredOrHasFilteredParent: () => false,
    hasFilteredTasks: () => false,
    isShowHiddenMode: () => false,
  } as unknown as FilteredTaskService;
}

function makeMinimalFavoritesServiceStub(): FavoritesService {
  return {
    isFavorite: () => false,
  } as unknown as FavoritesService;
}

function makeTaskItem(label: string, taskType: string = 'npm'): TaskItem {
  return new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
}

function makeEntry(
  value: string,
  source: IResolvedEnvEntry['source'],
  isSecret: boolean = false,
  sourceFilePath?: string,
): IResolvedEnvEntry {
  return { value, source, sourceLabel: source, isSecret, sourceFilePath };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('InspectTaskEnvCommand Test Suite', () => {
  let fakeContext: vscode.ExtensionContext;
  let cmd: InspectTaskEnvCommand;
  let channelLines: string[];
  let channelCleared: boolean;
  let channelShown: boolean;
  let resolvedEnvMap: Map<string, IResolvedEnvEntry>;
  let quickPickResponse: { task: TaskItem } | undefined;
  let infoMessages: string[];

  let originalCreateOutputChannel: typeof vscode.window.createOutputChannel;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

  setup(() => {
    // Reset singletons
    (TaskStateManager as any).instance = makeMinimalStateManagerStub();
    (FilteredTaskService as any).instance = makeMinimalFilteredTaskServiceStub();
    (FavoritesService as any).instance = makeMinimalFavoritesServiceStub();
    (TaskEnvService as any).instance = undefined;
    (TaskSecretWarningService as any).instance = undefined;
    (TaskCacheService as any).instance = undefined;

    fakeContext = makeFakeContext();

    // Setup TaskEnvService mock — patching the singleton
    const envService = TaskEnvService.getInstance();
    (envService as any).context = fakeContext;
    (envService as any).secretPatterns = ['*_TOKEN', '*_SECRET', '*_KEY', 'PASSWORD'];

    resolvedEnvMap = new Map();
    (envService as any).resolveTaskEnv = async (_item: TaskItem) => resolvedEnvMap;

    // Setup TaskSecretWarningService mock
    const warnService = TaskSecretWarningService.getInstance();
    warnService.initialize(fakeContext);

    // Setup TaskCacheService mock
    const cacheService = {
      getAllTasks: () => [makeTaskItem('build'), makeTaskItem('test'), makeTaskItem('deploy')],
    };
    (TaskCacheService as any).instance = cacheService;

    channelLines = [];
    channelCleared = false;
    channelShown = false;
    infoMessages = [];
    quickPickResponse = undefined;

    // Mock output channel
    originalCreateOutputChannel = vscode.window.createOutputChannel;
    (vscode.window as any).createOutputChannel = (_name: string) => ({
      appendLine: (line: string) => { channelLines.push(line); },
      clear: () => { channelCleared = true; },
      show: (_preserveFocus?: boolean) => { channelShown = true; },
      dispose: () => {},
    });

    // Mock QuickPick
    originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: any[]) => {
      if (quickPickResponse !== undefined) {
        // Return the item whose task label matches the quickPickResponse task label
        return items.find((i) => i.task === quickPickResponse!.task);
      }
      return undefined;
    };

    // Mock showInformationMessage
    originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      infoMessages.push(msg);
      return undefined;
    };

    // Clear output channel singleton between tests
    const mod = require('../../commands/inspectTaskEnvCommand');
    mod.__resetOutputChannelForTest?.();

    cmd = new InspectTaskEnvCommand(fakeContext);
  });

  teardown(() => {
    // Dispose registered disposables to allow re-registration
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (vscode.window as any).createOutputChannel = originalCreateOutputChannel;
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (TaskEnvService as any).instance = undefined;
    (TaskSecretWarningService as any).instance = undefined;
    (TaskCacheService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
  });

  // ── Direct TaskItem invocation ────────────────────────────────────────────

  test('shows task label and type header when item passed directly', async () => {
    resolvedEnvMap.set('NODE_ENV', makeEntry('development', 'globalSetting'));
    const item = makeTaskItem('build', 'npm');
    await cmd.run(item);

    assert.ok(channelLines.some((l) => l.includes('build')), 'Should show task label');
    assert.ok(channelLines.some((l) => l.includes('npm')), 'Should show task type');
    assert.ok(channelShown, 'Output channel should be shown');
    assert.ok(channelCleared, 'Output channel should be cleared');
  });

  test('renders variable key, value, and source in the table', async () => {
    resolvedEnvMap.set('NODE_ENV', makeEntry('development', 'globalSetting', false, '/project/.vscode/settings.json'));
    const item = makeTaskItem('build');
    await cmd.run(item);

    const tableLines = channelLines.filter((l) => l.includes('NODE_ENV'));
    assert.ok(tableLines.length > 0, 'Should render NODE_ENV');
    assert.ok(tableLines[0].includes('development'), 'Should show value');
    assert.ok(tableLines[0].includes('global.env'), 'Should show source label');
  });

  test('redacts secret values with ***', async () => {
    resolvedEnvMap.set('DB_PASSWORD', makeEntry('s3cr3t', 'taskSecretStorage', true));
    const item = makeTaskItem('deploy');
    await cmd.run(item);

    const tableLines = channelLines.filter((l) => l.includes('DB_PASSWORD'));
    assert.ok(tableLines.length > 0, 'Should render DB_PASSWORD');
    assert.ok(tableLines[0].includes('***'), 'Secret value should be redacted');
    assert.ok(!tableLines[0].includes('s3cr3t'), 'Real value should not appear');
  });

  test('shows no variables message when env map is empty', async () => {
    resolvedEnvMap.clear();
    const item = makeTaskItem('lint');
    await cmd.run(item);

    assert.ok(channelLines.some((l) => l.includes('No environment variables')));
  });

  test('shows total count line', async () => {
    resolvedEnvMap.set('FOO', makeEntry('bar', 'taskEnv'));
    resolvedEnvMap.set('BAZ', makeEntry('qux', 'ruleEnv'));
    const item = makeTaskItem('build');
    await cmd.run(item);

    assert.ok(channelLines.some((l) => l.includes('2')), 'Should show count of 2');
  });

  test('shows warning section for suspicious non-secret keys', async () => {
    resolvedEnvMap.set('MY_TOKEN', makeEntry('abc123', 'globalSetting', false));
    const item = makeTaskItem('deploy');
    await cmd.run(item);

    const warningLine = channelLines.find((l) => l.includes('Warning'));
    assert.ok(warningLine !== undefined, 'Should show a warning section');
    assert.ok(channelLines.some((l) => l.includes('MY_TOKEN')), 'Warning should mention the key');
  });

  test('does not show warning for keys from secret sources', async () => {
    resolvedEnvMap.set('MY_TOKEN', makeEntry('abc123', 'taskSecretStorage', true));
    const item = makeTaskItem('deploy');
    await cmd.run(item);

    assert.ok(!channelLines.some((l) => l.includes('Warning')), 'Should NOT show warning for secret entry');
  });

  test('shows file basename in source file column', async () => {
    resolvedEnvMap.set('API_URL', makeEntry('https://api.example.com', 'globalEnvFile', false, '/project/.env.local'));
    const item = makeTaskItem('build');
    await cmd.run(item);

    const tableLines = channelLines.filter((l) => l.includes('API_URL'));
    assert.ok(tableLines[0].includes('.env.local'), 'Should show file basename');
  });

  test('shows SecretStorage for secret storage entries', async () => {
    resolvedEnvMap.set('DEPLOY_TOKEN', makeEntry('tkn', 'ruleSecretStorage', true));
    const item = makeTaskItem('deploy');
    await cmd.run(item);

    const tableLines = channelLines.filter((l) => l.includes('DEPLOY_TOKEN'));
    assert.ok(tableLines[0].includes('SecretStorage'), 'Should show SecretStorage in file column');
  });

  // ── QuickPick invocation (no item arg) ────────────────────────────────────

  test('opens QuickPick when no item arg provided', async () => {
    resolvedEnvMap.set('FOO', makeEntry('bar', 'taskEnv'));
    const taskToSelect = makeTaskItem('build');
    quickPickResponse = { task: taskToSelect };

    // Patch getAllTasks to return item with same instance
    (TaskCacheService as any).instance = {
      getAllTasks: () => [taskToSelect, makeTaskItem('test')],
    };

    await cmd.run();

    assert.ok(channelLines.some((l) => l.includes('build')), 'Should show selected task');
  });

  test('does nothing when QuickPick cancelled', async () => {
    quickPickResponse = undefined;
    await cmd.run();

    assert.strictEqual(channelLines.length, 0, 'No output when cancelled');
  });

  test('shows info message when no tasks in cache', async () => {
    (TaskCacheService as any).instance = {
      getAllTasks: () => [],
    };
    quickPickResponse = undefined;
    await cmd.run();

    assert.ok(infoMessages.some((m) => m.includes('No tasks')));
  });
});
