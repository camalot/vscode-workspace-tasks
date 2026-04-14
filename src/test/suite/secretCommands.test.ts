import * as assert from 'assert';
import * as vscode from 'vscode';
import { StoreSecretCommand } from '../../commands/storeSecretCommand';
import { DeleteSecretCommand } from '../../commands/deleteSecretCommand';
import { UpdateSecretCommand } from '../../commands/updateSecretCommand';
import { CopySecretKeyCommand } from '../../commands/copySecretKeyCommand';
import { TaskEnvService } from '../../services/taskEnvService';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSecrets(initial: Record<string, string> = {}): vscode.SecretStorage {
  const store = new Map(Object.entries(initial));
  return {
    keys: async () => Array.from(store.keys()),
    get: async (k: string) => store.get(k),
    store: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    _store: store, // exposed for assertion
  } as unknown as vscode.SecretStorage;
}

function makeFakeContext(secrets: vscode.SecretStorage): vscode.ExtensionContext {
  return {
    subscriptions: [],
    secrets,
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: {
      get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('StoreSecretCommand Test Suite', () => {
  let fakeSecrets: vscode.SecretStorage & { _store: Map<string, string> };
  let fakeContext: vscode.ExtensionContext;
  let envChangedFired: boolean;
  let inputBoxResponses: Array<string | undefined>;
  let infoMessages: string[];
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let cmd: StoreSecretCommand;

  setup(() => {
    fakeSecrets = makeFakeSecrets() as vscode.SecretStorage & { _store: Map<string, string> };
    fakeContext = makeFakeContext(fakeSecrets);
    envChangedFired = false;
    inputBoxResponses = [];
    infoMessages = [];

    // Reset singleton
    (TaskEnvService as any).instance = undefined;
    const svc = TaskEnvService.getInstance();
    (svc as any).context = fakeContext;
    (svc as any)._onDidChangeEnvSources = new vscode.EventEmitter<void>();
    (svc as any).onDidChangeEnvSources = (svc as any)._onDidChangeEnvSources.event;
    svc.onDidChangeEnvSources(() => { envChangedFired = true; });

    originalShowInputBox = vscode.window.showInputBox;
    originalShowInformationMessage = vscode.window.showInformationMessage;

    let callCount = 0;
    (vscode.window as any).showInputBox = async (_opts?: vscode.InputBoxOptions) => {
      return inputBoxResponses[callCount++];
    };
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      infoMessages.push(msg);
      return undefined;
    };

    // Create command once per test — disposed in teardown
    cmd = new StoreSecretCommand(fakeContext);
  });

  teardown(() => {
    // Dispose registered command disposables to allow re-registration in next test
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (vscode.window as any).showInputBox = originalShowInputBox;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (TaskEnvService as any).instance = undefined;
  });

  test('stores secret and fires env changed when key and value provided', async () => {
    inputBoxResponses = ['myapp.token', 'super-secret'];
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'super-secret');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('does nothing when key input cancelled', async () => {
    inputBoxResponses = [undefined, 'super-secret'];
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.size, 0);
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('does nothing when key input is empty string', async () => {
    inputBoxResponses = ['', 'super-secret'];
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.size, 0);
    assert.strictEqual(envChangedFired, false);
  });

  test('does nothing when value input cancelled', async () => {
    inputBoxResponses = ['myapp.token', undefined];
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.size, 0);
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('trims whitespace from the key name', async () => {
    inputBoxResponses = ['  myapp.token  ', 'secret-value'];
    await cmd.run();

    assert.ok(fakeSecrets._store.has('myapp.token'), 'Key should be trimmed');
    assert.ok(!fakeSecrets._store.has('  myapp.token  '), 'Untrimmed key should not exist');
  });

  test('overwrites an existing secret with the same key', async () => {
    fakeSecrets._store.set('myapp.token', 'old-value');
    inputBoxResponses = ['myapp.token', 'new-value'];
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'new-value');
    assert.strictEqual(envChangedFired, true);
  });
});

// ---------------------------------------------------------------------------

suite('DeleteSecretCommand Test Suite', () => {
  let fakeSecrets: vscode.SecretStorage & { _store: Map<string, string> };
  let fakeContext: vscode.ExtensionContext;
  let envChangedFired: boolean;
  let quickPickResponse: string | undefined;
  let warningResponse: string | undefined;
  let infoMessages: string[];
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let cmd: DeleteSecretCommand;

  setup(() => {
    fakeSecrets = makeFakeSecrets({ 'myapp.token': 'value1', 'myapp.password': 'value2' }) as vscode.SecretStorage & { _store: Map<string, string> };
    fakeContext = makeFakeContext(fakeSecrets);
    envChangedFired = false;
    quickPickResponse = undefined;
    warningResponse = undefined;
    infoMessages = [];

    // Reset singleton
    (TaskEnvService as any).instance = undefined;
    const svc = TaskEnvService.getInstance();
    (svc as any).context = fakeContext;
    (svc as any)._onDidChangeEnvSources = new vscode.EventEmitter<void>();
    (svc as any).onDidChangeEnvSources = (svc as any)._onDidChangeEnvSources.event;
    svc.onDidChangeEnvSources(() => { envChangedFired = true; });

    originalShowQuickPick = vscode.window.showQuickPick;
    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalShowInformationMessage = vscode.window.showInformationMessage;

    (vscode.window as any).showQuickPick = async (_items: string[], _opts?: vscode.QuickPickOptions) => quickPickResponse;
    (vscode.window as any).showWarningMessage = async (_msg: string, ..._rest: any[]) => warningResponse;
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      infoMessages.push(msg);
      return undefined;
    };

    // Create command once per test — disposed in teardown
    cmd = new DeleteSecretCommand(fakeContext);
  });

  teardown(() => {
    // Dispose registered command disposables to allow re-registration in next test
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (TaskEnvService as any).instance = undefined;
  });

  test('shows info message when no secrets stored', async () => {
    fakeSecrets._store.clear();
    await cmd.run();

    assert.ok(infoMessages.some((m) => m.includes('No secrets')));
    assert.strictEqual(envChangedFired, false);
  });

  test('deletes secret and fires env changed when confirmed', async () => {
    quickPickResponse = 'myapp.token';
    warningResponse = 'Delete';
    await cmd.run();

    assert.ok(!fakeSecrets._store.has('myapp.token'), 'Secret should be deleted');
    assert.ok(fakeSecrets._store.has('myapp.password'), 'Other secret should remain');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('does not delete when user cancels QuickPick', async () => {
    quickPickResponse = undefined;
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.size, 2);
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('does not delete when user declines confirmation', async () => {
    quickPickResponse = 'myapp.token';
    warningResponse = undefined; // user dismissed dialog
    await cmd.run();

    assert.ok(fakeSecrets._store.has('myapp.token'), 'Secret should not be deleted');
    assert.strictEqual(envChangedFired, false);
  });

  test('passes sorted keys to QuickPick', async () => {
    fakeSecrets._store.clear();
    fakeSecrets._store.set('zzz.key', 'v');
    fakeSecrets._store.set('aaa.key', 'v');
    fakeSecrets._store.set('mmm.key', 'v');

    let capturedItems: string[] | undefined;
    (vscode.window as any).showQuickPick = async (items: string[]) => {
      capturedItems = items;
      return undefined;
    };

    await cmd.run();

    assert.deepStrictEqual(capturedItems, ['aaa.key', 'mmm.key', 'zzz.key']);
  });

  // --- tree context menu path (secretName provided) ---

  test('deletes secret directly when called with secretName and user confirms', async () => {
    warningResponse = 'Delete';
    await cmd.run('myapp.token');

    assert.ok(!fakeSecrets._store.has('myapp.token'), 'Secret should be deleted');
    assert.ok(fakeSecrets._store.has('myapp.password'), 'Other secret should remain');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('does not delete when called with secretName but user declines confirmation', async () => {
    warningResponse = undefined; // user dismissed
    await cmd.run('myapp.token');

    assert.ok(fakeSecrets._store.has('myapp.token'), 'Secret should NOT be deleted');
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('deletes secret when called with a TaskItem and user confirms', async () => {
    warningResponse = 'Delete';
    const item = new TaskItem('myapp.token', vscode.TreeItemCollapsibleState.None, 'storedSecret');
    await cmd.run(item);

    assert.ok(!fakeSecrets._store.has('myapp.token'), 'Secret should be deleted');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('does not delete when called with a TaskItem but user declines', async () => {
    warningResponse = undefined;
    const item = new TaskItem('myapp.token', vscode.TreeItemCollapsibleState.None, 'storedSecret');
    await cmd.run(item);

    assert.ok(fakeSecrets._store.has('myapp.token'), 'Secret should NOT be deleted');
    assert.strictEqual(envChangedFired, false);
  });
});

// ---------------------------------------------------------------------------

suite('UpdateSecretCommand Test Suite', () => {
  let fakeSecrets: vscode.SecretStorage & { _store: Map<string, string> };
  let fakeContext: vscode.ExtensionContext;
  let envChangedFired: boolean;
  let quickPickResponse: string | undefined;
  let inputBoxResponse: string | undefined;
  let infoMessages: string[];
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let cmd: UpdateSecretCommand;

  setup(() => {
    fakeSecrets = makeFakeSecrets({ 'myapp.token': 'old-value', 'myapp.key': 'key-value' }) as vscode.SecretStorage & { _store: Map<string, string> };
    fakeContext = makeFakeContext(fakeSecrets);
    envChangedFired = false;
    quickPickResponse = undefined;
    inputBoxResponse = undefined;
    infoMessages = [];

    (TaskEnvService as any).instance = undefined;
    const svc = TaskEnvService.getInstance();
    (svc as any).context = fakeContext;
    (svc as any)._onDidChangeEnvSources = new vscode.EventEmitter<void>();
    (svc as any).onDidChangeEnvSources = (svc as any)._onDidChangeEnvSources.event;
    svc.onDidChangeEnvSources(() => { envChangedFired = true; });

    originalShowQuickPick = vscode.window.showQuickPick;
    originalShowInputBox = vscode.window.showInputBox;
    originalShowInformationMessage = vscode.window.showInformationMessage;

    (vscode.window as any).showQuickPick = async (_items: string[], _opts?: vscode.QuickPickOptions) => quickPickResponse;
    (vscode.window as any).showInputBox = async (_opts?: vscode.InputBoxOptions) => inputBoxResponse;
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      infoMessages.push(msg);
      return undefined;
    };

    cmd = new UpdateSecretCommand(fakeContext);
  });

  teardown(() => {
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (TaskEnvService as any).instance = undefined;
  });

  // --- palette path (no secretName arg) ---

  test('shows info message and does nothing when no secrets stored', async () => {
    fakeSecrets._store.clear();
    await cmd.run();

    assert.ok(infoMessages.some((m) => m.includes('No secrets')));
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(fakeSecrets._store.size, 0);
  });

  test('does nothing when user cancels QuickPick', async () => {
    quickPickResponse = undefined;
    await cmd.run();

    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'old-value');
  });

  test('passes sorted keys to QuickPick', async () => {
    let capturedItems: string[] | undefined;
    (vscode.window as any).showQuickPick = async (items: string[]) => {
      capturedItems = items;
      return undefined;
    };

    await cmd.run();

    assert.deepStrictEqual(capturedItems, ['myapp.key', 'myapp.token']);
  });

  test('does nothing when user cancels InputBox after QuickPick', async () => {
    quickPickResponse = 'myapp.token';
    inputBoxResponse = undefined;
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'old-value');
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('updates secret and fires env changed (palette flow)', async () => {
    quickPickResponse = 'myapp.token';
    inputBoxResponse = 'new-value';
    await cmd.run();

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'new-value');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  // --- tree context menu path (secretName provided) ---

  test('does nothing when user cancels InputBox (tree context)', async () => {
    inputBoxResponse = undefined;
    await cmd.run('myapp.token');

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'old-value');
    assert.strictEqual(envChangedFired, false);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('updates secret directly without QuickPick (tree context)', async () => {
    inputBoxResponse = 'tree-updated-value';
    await cmd.run('myapp.token');

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'tree-updated-value');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('whitespace-only secretName falls through to QuickPick flow', async () => {
    quickPickResponse = 'myapp.key';
    inputBoxResponse = 'whitespace-test-value';
    await cmd.run('   ');

    assert.strictEqual(fakeSecrets._store.get('myapp.key'), 'whitespace-test-value');
    assert.strictEqual(envChangedFired, true);
  });

  test('updates secret when called with a TaskItem (tree action bar)', async () => {
    inputBoxResponse = 'item-updated-value';
    const item = new TaskItem('myapp.token', vscode.TreeItemCollapsibleState.None, 'storedSecret');
    await cmd.run(item);

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'item-updated-value');
    assert.strictEqual(envChangedFired, true);
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('does nothing when called with a TaskItem but user cancels InputBox', async () => {
    inputBoxResponse = undefined;
    const item = new TaskItem('myapp.token', vscode.TreeItemCollapsibleState.None, 'storedSecret');
    await cmd.run(item);

    assert.strictEqual(fakeSecrets._store.get('myapp.token'), 'old-value');
    assert.strictEqual(envChangedFired, false);
  });
});

// ---------------------------------------------------------------------------

suite('CopySecretKeyCommand Test Suite', () => {
  let fakeSecrets: vscode.SecretStorage & { _store: Map<string, string> };
  let fakeContext: vscode.ExtensionContext;
  let writtenText: string | undefined;
  let quickPickResponse: string | undefined;
  let infoMessages: string[];
  let fakeClipboard: { writeText: (text: string) => Promise<void> };
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let cmd: CopySecretKeyCommand;

  setup(() => {
    fakeSecrets = makeFakeSecrets({ 'myapp.token': 'v1', 'myapp.key': 'v2' }) as vscode.SecretStorage & { _store: Map<string, string> };
    fakeContext = makeFakeContext(fakeSecrets);
    writtenText = undefined;
    quickPickResponse = undefined;
    infoMessages = [];

    fakeClipboard = { writeText: async (text: string) => { writtenText = text; } };
    originalShowQuickPick = vscode.window.showQuickPick;
    originalShowInformationMessage = vscode.window.showInformationMessage;

    (vscode.window as any).showQuickPick = async (_items: string[]) => quickPickResponse;
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      infoMessages.push(msg);
      return undefined;
    };

    cmd = new CopySecretKeyCommand(fakeContext, fakeClipboard);
  });

  teardown(() => {
    for (const sub of (fakeContext as any).subscriptions) {
      if (sub && typeof sub.dispose === 'function') { sub.dispose(); }
    }
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
  });

  // --- string argument (from tree action bar / double-click) ---

  test('copies key when called with a string argument', async () => {
    await cmd.run('myapp.token');

    assert.strictEqual(writtenText, 'myapp.token');
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  test('trims whitespace from string argument', async () => {
    await cmd.run('  myapp.token  ');

    assert.strictEqual(writtenText, 'myapp.token');
  });

  test('falls through to QuickPick when string argument is only whitespace', async () => {
    quickPickResponse = 'myapp.key';
    await cmd.run('   ');

    assert.strictEqual(writtenText, 'myapp.key');
  });

  // --- TaskItem argument (from tree context menu) ---

  test('copies key when called with a TaskItem whose label is the key', async () => {
    const item = new TaskItem('myapp.token', vscode.TreeItemCollapsibleState.None, 'storedSecret');
    await cmd.run(item);

    assert.strictEqual(writtenText, 'myapp.token');
    assert.ok(infoMessages.some((m) => m.includes('myapp.token')));
  });

  // --- palette path (no argument) ---

  test('shows info message when no secrets stored (palette)', async () => {
    fakeSecrets._store.clear();
    await cmd.run();

    assert.strictEqual(writtenText, undefined);
    assert.ok(infoMessages.some((m) => m.includes('No secrets')));
  });

  test('does nothing when user cancels QuickPick (palette)', async () => {
    quickPickResponse = undefined;
    await cmd.run();

    assert.strictEqual(writtenText, undefined);
    assert.strictEqual(infoMessages.length, 0);
  });

  test('copies selected key from QuickPick (palette)', async () => {
    quickPickResponse = 'myapp.key';
    await cmd.run();

    assert.strictEqual(writtenText, 'myapp.key');
    assert.ok(infoMessages.some((m) => m.includes('myapp.key')));
  });

  test('passes sorted keys to QuickPick', async () => {
    let capturedItems: string[] | undefined;
    (vscode.window as any).showQuickPick = async (items: string[]) => {
      capturedItems = items;
      return undefined;
    };

    await cmd.run();

    assert.deepStrictEqual(capturedItems, ['myapp.key', 'myapp.token']);
  });

  test('does nothing when argument is neither string nor TaskItem', async () => {
    await cmd.run({ some: 'object' } as any);

    // Should fall through to QuickPick — but secrets exist and quickPickResponse is undefined (cancel)
    assert.strictEqual(writtenText, undefined);
  });
});
