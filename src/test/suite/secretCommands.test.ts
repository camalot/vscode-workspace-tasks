import * as assert from 'assert';
import * as vscode from 'vscode';
import { StoreSecretCommand } from '../../commands/storeSecretCommand';
import { DeleteSecretCommand } from '../../commands/deleteSecretCommand';
import { TaskEnvService } from '../../services/taskEnvService';

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
});
