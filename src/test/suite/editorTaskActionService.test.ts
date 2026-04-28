import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorTaskActionService } from '../../services/editorTaskActionService';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskItem } from '../../taskItem';
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

function makeTaskItem(label: string, taskType: string): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = label;
  item.originalLabel = label;
  return item;
}

function makeUri(path: string): vscode.Uri {
  return vscode.Uri.file(path);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('EditorTaskActionService Test Suite', () => {
  let service: EditorTaskActionService;
  let executedContextKey: string | undefined;
  let executedContextValue: boolean | undefined;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let originalActiveTextEditor: vscode.TextEditor | undefined;
  let originalIsTrusted: boolean;
  let onDidUpdateHandlers: Array<() => void>;
  let onDidChangeActiveEditorHandlers: Array<(editor?: vscode.TextEditor) => void>;
  let onDidGrantWorkspaceTrustHandlers: Array<() => void>;

  setup(() => {
    // Reset singleton
    (EditorTaskActionService as any).instance = undefined;
    service = EditorTaskActionService.getInstance();

    // Stub logger
    (LoggerService as any).instance = {
      error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    };

    // Stub TaskStateManager
    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? item.label,
      normalizeTaskId: (id: string) => id,
      getStatus: () => 'idle',
    };

    // Stub FavoritesService and FilteredTaskService so TaskItem.updateContextValue() doesn't throw
    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };

    // Capture executeCommand calls for setContext
    originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = (command: string, key?: string, value?: any) => {
      if (command === 'setContext') {
        executedContextKey = key;
        executedContextValue = value;
      }
      return Promise.resolve();
    };

    // Save and stub workspace.isTrusted
    originalIsTrusted = vscode.workspace.isTrusted;
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });

    // Track event handler registrations
    onDidUpdateHandlers = [];
    onDidChangeActiveEditorHandlers = [];
    onDidGrantWorkspaceTrustHandlers = [];

    // Reset TaskCacheService
    (TaskCacheService as any).instance = undefined;

    // Reset captured values
    executedContextKey = undefined;
    executedContextValue = undefined;
  });

  teardown(() => {
    (vscode.commands as any).executeCommand = originalExecuteCommand;
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });
    (EditorTaskActionService as any).instance = undefined;
    (TaskCacheService as any).instance = undefined;
    (LoggerService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
  });

  // ── getInstance ────────────────────────────────────────────────────────────

  test('getInstance returns singleton', () => {
    const a = EditorTaskActionService.getInstance();
    const b = EditorTaskActionService.getInstance();
    assert.strictEqual(a, b);
  });

  // ── isRunnableFile ─────────────────────────────────────────────────────────

  test('isRunnableFile — undefined URI returns false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    assert.strictEqual(service.isRunnableFile(undefined), false);
  });

  test('isRunnableFile — non-file scheme (untitled) returns false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = vscode.Uri.parse('untitled:foo.sh');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — non-file scheme (output) returns false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = vscode.Uri.parse('output:some-channel');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — workspace not trusted returns false', () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'shell')],
    };
    const uri = makeUri('/workspace/deploy.sh');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — file URI with no tasks returns false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = makeUri('/workspace/Makefile');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — npm task returns true (all task types are runnable)', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'npm')],
    };
    const uri = makeUri('/workspace/package.json');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — make task returns true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('all', 'make')],
    };
    const uri = makeUri('/workspace/Makefile');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — single task that is hidden returns false', () => {
    (FilteredTaskService as any).instance = {
      isFiltered: () => true,
      isFilteredOrHasFilteredParent: () => true,
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'npm')],
    };
    const uri = makeUri('/workspace/package.json');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — mixed hidden and visible leaf returns true', () => {
    const hiddenItem = makeTaskItem('hidden', 'npm');
    const visibleItem = makeTaskItem('visible', 'npm');
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: (item: TaskItem) => item.id === 'hidden',
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [hiddenItem, visibleItem],
    };
    const uri = makeUri('/workspace/package.json');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — parent-only items (no leaf tasks) returns false', () => {
    const parentItem = new TaskItem('group', vscode.TreeItemCollapsibleState.Collapsed, 'npm');
    parentItem.id = 'group';
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [parentItem],
    };
    const uri = makeUri('/workspace/package.json');
    assert.strictEqual(service.isRunnableFile(uri), false);
  });

  test('isRunnableFile — file URI with shell task returns true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('deploy', 'shell')],
    };
    const uri = makeUri('/workspace/deploy.sh');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — file URI with github-actions task returns true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('ci', 'github-actions')],
    };
    const uri = makeUri('/workspace/.github/workflows/ci.yml');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — mixed tasks (npm + shell) returns true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [
        makeTaskItem('lint', 'npm'),
        makeTaskItem('run', 'shell'),
      ],
    };
    const uri = makeUri('/workspace/scripts/run.sh');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  test('isRunnableFile — taskfile task returns true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'taskfile')],
    };
    const uri = makeUri('/workspace/Taskfile.yml');
    assert.strictEqual(service.isRunnableFile(uri), true);
  });

  // ── updateContext ──────────────────────────────────────────────────────────

  test('updateContext — no editor sets context to false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    service.updateContext(undefined);
    assert.strictEqual(executedContextKey, 'workspaceTasks.activeFileIsRunnableTask');
    assert.strictEqual(executedContextValue, false);
  });

  test('updateContext — editor with runnable file sets context to true', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('ci', 'github-actions')],
    };
    const fakeEditor = {
      document: { uri: makeUri('/workspace/.github/workflows/ci.yml') },
    } as unknown as vscode.TextEditor;
    service.updateContext(fakeEditor);
    assert.strictEqual(executedContextKey, 'workspaceTasks.activeFileIsRunnableTask');
    assert.strictEqual(executedContextValue, true);
  });

  test('updateContext — editor with non-runnable file sets context to false', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const fakeEditor = {
      document: { uri: makeUri('/workspace/README.md') },
    } as unknown as vscode.TextEditor;
    service.updateContext(fakeEditor);
    assert.strictEqual(executedContextValue, false);
  });

  // ── initialize ─────────────────────────────────────────────────────────────

  test('initialize — registers 3 subscriptions and calls updateContext immediately', () => {
    const subscriptions: vscode.Disposable[] = [];
    let onDidChangeActiveEditorCallback: ((editor?: vscode.TextEditor) => void) | undefined;
    let onDidUpdateCallback: (() => void) | undefined;
    let onDidGrantTrustCallback: (() => void) | undefined;

    const originalOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    const originalOnDidGrantWorkspaceTrust = vscode.workspace.onDidGrantWorkspaceTrust;

    (vscode.window as any).onDidChangeActiveTextEditor = (cb: (e?: vscode.TextEditor) => void) => {
      onDidChangeActiveEditorCallback = cb;
      return { dispose: () => {} };
    };
    (vscode.workspace as any).onDidGrantWorkspaceTrust = (cb: () => void) => {
      onDidGrantTrustCallback = cb;
      return { dispose: () => {} };
    };

    const onDidUpdateEmitter = new vscode.EventEmitter<void>();
    (TaskCacheService as any).instance = {
      onDidUpdate: onDidUpdateEmitter.event,
      getTasksForFile: () => [],
    };

    const ctx = {
      subscriptions,
      workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
      globalState: {
        get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
      },
    } as unknown as vscode.ExtensionContext;

    // Stub activeTextEditor to null so immediate updateContext gives false
    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => undefined,
      configurable: true,
    });

    service.initialize(ctx);

    // Should have pushed 3 subscriptions
    assert.strictEqual(subscriptions.length, 3);

    // Should have called updateContext immediately (context value should be false since no active editor)
    assert.strictEqual(executedContextKey, 'workspaceTasks.activeFileIsRunnableTask');
    assert.strictEqual(executedContextValue, false);

    // Restore
    (vscode.window as any).onDidChangeActiveTextEditor = originalOnDidChangeActiveTextEditor;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = originalOnDidGrantWorkspaceTrust;
    if (originalActiveTextEditor) {
      Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
    }
  });

  test('initialize — onDidChangeActiveTextEditor triggers updateContext with editor param', () => {
    let capturedEditor: vscode.TextEditor | undefined = undefined;
    let registeredCallback: ((e?: vscode.TextEditor) => void) | undefined;

    const originalOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = (cb: (e?: vscode.TextEditor) => void) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    };
    const originalOnDidGrantWorkspaceTrust = vscode.workspace.onDidGrantWorkspaceTrust;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = () => ({ dispose: () => {} });

    const onDidUpdateEmitter = new vscode.EventEmitter<void>();
    (TaskCacheService as any).instance = {
      onDidUpdate: onDidUpdateEmitter.event,
      getTasksForFile: (uri: vscode.Uri) => {
        capturedEditor = { document: { uri } } as unknown as vscode.TextEditor;
        return [makeTaskItem('ci', 'github-actions')];
      },
    };

    const ctx = {
      subscriptions: [],
      workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
      globalState: {
        get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
      },
    } as unknown as vscode.ExtensionContext;

    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => undefined,
      configurable: true,
    });

    service.initialize(ctx);
    assert.ok(registeredCallback);

    // Simulate active editor change with a runnable file
    const newEditor = {
      document: { uri: makeUri('/workspace/.github/workflows/ci.yml') },
    } as unknown as vscode.TextEditor;
    registeredCallback!(newEditor);

    assert.strictEqual(executedContextValue, true);

    // Restore
    (vscode.window as any).onDidChangeActiveTextEditor = originalOnDidChangeActiveTextEditor;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = originalOnDidGrantWorkspaceTrust;
    if (originalActiveTextEditor) {
      Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
    }
  });

  test('initialize — onDidGrantWorkspaceTrust triggers updateContext', () => {
    let grantTrustCallback: (() => void) | undefined;

    const originalOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });
    const originalOnDidGrantWorkspaceTrust = vscode.workspace.onDidGrantWorkspaceTrust;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = (cb: () => void) => {
      grantTrustCallback = cb;
      return { dispose: () => {} };
    };

    const onDidUpdateEmitter = new vscode.EventEmitter<void>();
    (TaskCacheService as any).instance = {
      onDidUpdate: onDidUpdateEmitter.event,
      getTasksForFile: () => [makeTaskItem('deploy', 'shell')],
    };

    const ctx = {
      subscriptions: [],
      workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
      globalState: {
        get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
      },
    } as unknown as vscode.ExtensionContext;

    const fakeEditor = {
      document: { uri: makeUri('/workspace/deploy.sh') },
    } as unknown as vscode.TextEditor;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => fakeEditor,
      configurable: true,
    });

    service.initialize(ctx);
    // Reset tracking
    executedContextKey = undefined;
    executedContextValue = undefined;

    assert.ok(grantTrustCallback);
    grantTrustCallback!();

    assert.strictEqual(executedContextKey, 'workspaceTasks.activeFileIsRunnableTask');
    assert.strictEqual(executedContextValue, true);

    // Restore
    (vscode.window as any).onDidChangeActiveTextEditor = originalOnDidChangeActiveTextEditor;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = originalOnDidGrantWorkspaceTrust;
  });

  test('initialize — cache onDidUpdate debounces and eventually calls updateContext', async () => {
    let cacheUpdateCallback: (() => void) | undefined;
    const onDidUpdateEmitter = new vscode.EventEmitter<void>();

    const originalOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });
    const originalOnDidGrantWorkspaceTrust = vscode.workspace.onDidGrantWorkspaceTrust;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = () => ({ dispose: () => {} });

    (TaskCacheService as any).instance = {
      onDidUpdate: onDidUpdateEmitter.event,
      getTasksForFile: () => [makeTaskItem('ci', 'github-actions')],
    };

    const ctx = {
      subscriptions: [],
      workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
      globalState: {
        get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
      },
    } as unknown as vscode.ExtensionContext;

    const fakeEditor = {
      document: { uri: makeUri('/workspace/.github/workflows/ci.yml') },
    } as unknown as vscode.TextEditor;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      get: () => fakeEditor,
      configurable: true,
    });

    service.initialize(ctx);

    // Reset tracking after initialization
    executedContextKey = undefined;
    executedContextValue = undefined;

    // Fire cache update multiple times (simulates burst)
    onDidUpdateEmitter.fire();
    onDidUpdateEmitter.fire();
    onDidUpdateEmitter.fire();

    // Wait for debounce timer (75ms + buffer)
    await new Promise<void>(resolve => setTimeout(resolve, 150));

    // Should have updated context after debounce
    assert.strictEqual(executedContextKey, 'workspaceTasks.activeFileIsRunnableTask');
    assert.strictEqual(executedContextValue, true);

    // Restore
    (vscode.window as any).onDidChangeActiveTextEditor = originalOnDidChangeActiveTextEditor;
    (vscode.workspace as any).onDidGrantWorkspaceTrust = originalOnDidGrantWorkspaceTrust;
  });
});
