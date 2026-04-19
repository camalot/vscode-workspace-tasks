import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { WatchTaskfileCommand } from '../../commands/watchTaskfileCommand';

function makeFakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve(), keys: () => [] },
    globalState: {
      get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

suite('WatchTaskfileCommand Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalCreateTerminal: typeof vscode.window.createTerminal;
  let originalRegisterCommand: typeof vscode.commands.registerCommand;
  let cmd: WatchTaskfileCommand;

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : '/workspace';

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    originalCreateTerminal = vscode.window.createTerminal;
    originalRegisterCommand = vscode.commands.registerCommand;

    // Stub registerCommand to prevent "command already exists" errors — the extension
    // has already activated and registered all commands before the test suite runs.
    (vscode.commands as any).registerCommand = () => ({ dispose: () => {} });

    cmd = new WatchTaskfileCommand(makeFakeContext());

    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegisterCommand;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.window as any).createTerminal = originalCreateTerminal;
  });

  function makeTaskfileItem(label: string, taskfilePath?: string): TaskItem {
    const uri = vscode.Uri.file(taskfilePath ?? path.join(rootPath, 'Taskfile.yml'));
    const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    return item;
  }

  function makeFakeTerminal(): { name: string | undefined; cwd: string | undefined; showCalled: boolean; sentText: string | undefined } {
    const record = { name: undefined as string | undefined, cwd: undefined as string | undefined, showCalled: false, sentText: undefined as string | undefined };
    (vscode.window as any).createTerminal = (options: vscode.TerminalOptions) => {
      record.name = options.name;
      record.cwd = options.cwd as string | undefined;
      return {
        show: () => { record.showCalled = true; },
        sendText: (text: string) => { record.sentText = text; },
        dispose: () => undefined,
      };
    };
    return record;
  }

  test('returns early when item is undefined', async () => {
    const record = makeFakeTerminal();
    await (cmd as any).run(undefined);
    assert.strictEqual(record.showCalled, false);
  });

  test('returns early when item.taskType is not taskfile', async () => {
    const record = makeFakeTerminal();
    const uri = vscode.Uri.file(path.join(rootPath, 'Makefile'));
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'makefile', uri);
    await (cmd as any).run(item);
    assert.strictEqual(record.showCalled, false);
  });

  test('returns early when enableWatchMode is false', async () => {
    const previous = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            if (key === 'taskfile.enableWatchMode') { return false as T; }
            return def as T;
          },
        };
      }
      return previous(section);
    };

    try {
      const record = makeFakeTerminal();
      const item = makeTaskfileItem('build');
      await (cmd as any).run(item);
      assert.strictEqual(record.showCalled, false);
    } finally {
      (vscode.workspace as any).getConfiguration = previous;
    }
  });

  test('creates terminal with correct name', async () => {
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('build');
    await (cmd as any).run(item);
    assert.strictEqual(record.name, 'task watch: build');
  });

  test('creates terminal with cwd set to Taskfile directory', async () => {
    const subDir = path.join(rootPath, 'subproject');
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('test', path.join(subDir, 'Taskfile.yml'));
    await (cmd as any).run(item);
    assert.strictEqual(record.cwd?.toLowerCase(), subDir.toLowerCase());
  });

  test('cwd is undefined when taskFileUri is not set', async () => {
    const record = makeFakeTerminal();
    const uri = vscode.Uri.file(path.join(rootPath, 'Taskfile.yml'));
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = undefined;
    await (cmd as any).run(item);
    assert.strictEqual(record.cwd, undefined);
  });

  test('sendText includes --watch and task name', async () => {
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('deploy');
    await (cmd as any).run(item);
    assert.ok(record.sentText, 'sendText should have been called');
    assert.ok(record.sentText!.includes('--watch'), `Expected --watch in: ${record.sentText}`);
    assert.ok(record.sentText!.includes('deploy'), `Expected task name in: ${record.sentText}`);
  });

  test('--watch appears before task name in sent text', async () => {
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('lint');
    await (cmd as any).run(item);
    assert.ok(record.sentText, 'sendText should have been called');
    const watchIdx = record.sentText!.indexOf('--watch');
    const nameIdx = record.sentText!.indexOf(' lint');
    assert.ok(watchIdx >= 0, `--watch missing in: ${record.sentText}`);
    assert.ok(nameIdx > watchIdx, `--watch should precede task name in: ${record.sentText}`);
  });

  test('shows terminal after creation', async () => {
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('build');
    await (cmd as any).run(item);
    assert.strictEqual(record.showCalled, true);
  });

  test('uses originalLabel when set', async () => {
    const record = makeFakeTerminal();
    const uri = vscode.Uri.file(path.join(rootPath, 'Taskfile.yml'));
    const item = new TaskItem('b', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    (item as any).originalLabel = 'build';
    await (cmd as any).run(item);
    assert.ok(record.sentText?.includes('build'), `Expected originalLabel 'build' in: ${record.sentText}`);
  });

  test('uses label when originalLabel is not set', async () => {
    const record = makeFakeTerminal();
    const item = makeTaskfileItem('ci');
    await (cmd as any).run(item);
    assert.ok(record.sentText?.includes('ci'), `Expected label 'ci' in: ${record.sentText}`);
  });
});
