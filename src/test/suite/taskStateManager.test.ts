import * as assert from 'assert';
import * as vscode from 'vscode';

import constants from '../../libs/constants';
import { TaskStateManager } from '../../taskStateManager';
import type { TaskItem } from '../../taskItem';

function makeItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    label: 'task-label',
    originalLabel: 'task-label',
    ...overrides,
  } as TaskItem;
}

suite('TaskStateManager Test Suite', () => {
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;
  let originalAsRelativePath: typeof vscode.workspace.asRelativePath;
  let originalUriParse: typeof vscode.Uri.parse;

  setup(() => {
    (TaskStateManager as any).instance = undefined;

    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    originalAsRelativePath = vscode.workspace.asRelativePath;
    originalUriParse = vscode.Uri.parse;

    (vscode.workspace as any).getWorkspaceFolder = () => undefined;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri) => uri.fsPath;
  });

  teardown(() => {
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    (vscode.Uri as any).parse = originalUriParse;

    (TaskStateManager as any).instance = undefined;
  });

  test('getInstance returns singleton', () => {
    const a = TaskStateManager.getInstance();
    const b = TaskStateManager.getInstance();
    assert.strictEqual(a, b);
  });

  test('initialize stores context and getContext returns it', () => {
    const sm = TaskStateManager.getInstance();
    assert.strictEqual(sm.getContext(), undefined);

    const fakeContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    sm.initialize(fakeContext);

    assert.strictEqual(sm.getContext(), fakeContext);
  });

  test('generatePortableTaskId falls back to label when URI is missing', () => {
    const sm = TaskStateManager.getInstance();
    const item = makeItem({ label: 'fallback-label', originalLabel: 'fallback-label' });

    const id = sm.generatePortableTaskId(item);
    assert.strictEqual(id, 'fallback-label');
  });

  test('generatePortableTaskId uses external format when task is outside workspace', () => {
    const sm = TaskStateManager.getInstance();
    const uri = vscode.Uri.file('/outside/script.sh');
    const item = makeItem({ taskFileUri: uri, label: 'run', originalLabel: 'run' });

    const id = sm.generatePortableTaskId(item);
    assert.strictEqual(id, `external:${uri.fsPath}:run`);
  });

  test('generatePortableTaskId uses workspace name and relative path for workspace items', () => {
    const sm = TaskStateManager.getInstance();
    const uri = vscode.Uri.file('/workspace/project/package.json');
    const ws = { uri: vscode.Uri.file('/workspace/project'), name: 'project', index: 0 } as vscode.WorkspaceFolder;

    (vscode.workspace as any).getWorkspaceFolder = () => ws;
    (vscode.workspace as any).asRelativePath = () => 'package.json';

    const id = sm.generatePortableTaskId(makeItem({ taskFileUri: uri, label: 'test', originalLabel: 'test' }));
    assert.strictEqual(id, 'project:package.json:test');
  });

  test('normalizeTaskId strips recent/fav/vscode compound prefixes and dependency suffix', () => {
    const sm = TaskStateManager.getInstance();
    const raw = `recent:recent:fav:fav:${constants.VSCODE_COMPOUND_TASK_ID_PREFIX}:base:dep:real-dep-id`;

    const id = sm.normalizeTaskId(raw);
    assert.strictEqual(id, 'real-dep-id');
  });

  test('normalizeTaskId strips queue prefix when full queue item id is provided', () => {
    const sm = TaskStateManager.getInstance();
    const id = sm.normalizeTaskId(`${constants.COMPOUND_TASK_ID_PREFIX}:build:my-task-id`);
    assert.strictEqual(id, 'my-task-id');
  });

  test('normalizeTaskId keeps queue group id when no second colon exists', () => {
    const sm = TaskStateManager.getInstance();
    const id = sm.normalizeTaskId(`${constants.COMPOUND_TASK_ID_PREFIX}:group-only`);
    assert.strictEqual(id, `${constants.COMPOUND_TASK_ID_PREFIX}:group-only`);
  });

  test('normalizeTaskId migrates old workspace id format to portable format', () => {
    const sm = TaskStateManager.getInstance();
    const fileUri = vscode.Uri.file('/workspace/app/package.json');
    const oldId = `/workspace/app|${fileUri.toString()}|install`;
    const ws = { uri: vscode.Uri.file('/workspace/app'), name: 'app', index: 0 } as vscode.WorkspaceFolder;

    (vscode.workspace as any).getWorkspaceFolder = () => ws;
    (vscode.workspace as any).asRelativePath = () => 'package.json';

    const migrated = sm.normalizeTaskId(oldId);
    assert.strictEqual(migrated, 'app:package.json:install');
  });

  test('normalizeTaskId returns cached migration value on subsequent calls', () => {
    const sm = TaskStateManager.getInstance();
    const fileUri = vscode.Uri.file('/workspace/app/package.json');
    const oldId = `/workspace/app|${fileUri.toString()}|install`;
    const ws = { uri: vscode.Uri.file('/workspace/app'), name: 'app', index: 0 } as vscode.WorkspaceFolder;

    (vscode.workspace as any).getWorkspaceFolder = () => ws;
    (vscode.workspace as any).asRelativePath = () => 'package.json';

    const first = sm.normalizeTaskId(oldId);
    assert.strictEqual(first, 'app:package.json:install');

    // Change resolvers; cached value should still be returned.
    (vscode.workspace as any).getWorkspaceFolder = () => undefined;
    (vscode.workspace as any).asRelativePath = () => 'changed.json';

    const second = sm.normalizeTaskId(oldId);
    assert.strictEqual(second, 'app:package.json:install');
  });

  test('normalizeTaskId converts old ids to external format when URI is outside workspace', () => {
    const sm = TaskStateManager.getInstance();
    const fileUri = vscode.Uri.file('/outside/tool.sh');
    const oldId = `/workspace|${fileUri.toString()}|run`;

    (vscode.workspace as any).getWorkspaceFolder = () => undefined;

    const migrated = sm.normalizeTaskId(oldId);
    assert.strictEqual(migrated, `external:${fileUri.fsPath}:run`);
  });

  test('normalizeTaskId leaves non-migratable old format IDs unchanged', () => {
    const sm = TaskStateManager.getInstance();

    assert.strictEqual(sm.normalizeTaskId('a|b'), 'a|b');
    assert.strictEqual(sm.normalizeTaskId('|file:///tmp/a|label'), '|file:///tmp/a|label');
    assert.strictEqual(sm.normalizeTaskId('ws||label'), 'ws||label');
    assert.strictEqual(sm.normalizeTaskId('ws|not-a-uri|label'), 'ws|not-a-uri|label');
  });

  test('normalizeTaskId handles Uri.parse failures by keeping original id', () => {
    const sm = TaskStateManager.getInstance();
    const oldId = 'ws|file:///tmp/a|label';

    (vscode.Uri as any).parse = () => {
      throw new Error('parse failure');
    };

    const normalized = sm.normalizeTaskId(oldId);
    assert.strictEqual(normalized, oldId);
  });

  test('normalizeTaskIds maps each id through normalizeTaskId', () => {
    const sm = TaskStateManager.getInstance();
    const ids = ['recent:a', 'fav:b', `${constants.COMPOUND_TASK_ID_PREFIX}:x:y`];

    assert.deepStrictEqual(sm.normalizeTaskIds(ids), ['a', 'b', 'y']);
  });

  test('getTaskId generates id when item.id is missing and normalizes when item.id exists', () => {
    const sm = TaskStateManager.getInstance();

    const generated = sm.getTaskId(makeItem({ label: 'gen', originalLabel: 'gen' }));
    assert.strictEqual(generated, 'gen');

    const normalized = sm.getTaskId(makeItem({ id: 'recent:fav:abc' }));
    assert.strictEqual(normalized, 'abc');
  });

  test('setExecution/getExecution/getIdByExecution/clearExecution work as expected', () => {
    const sm = TaskStateManager.getInstance();
    const exec = { task: {} } as vscode.TaskExecution;

    sm.setExecution('id-1', exec);
    assert.strictEqual(sm.getExecution('id-1'), exec);
    assert.strictEqual(sm.getIdByExecution(exec), 'id-1');
    assert.strictEqual(sm.getIdByExecution({ task: {} } as vscode.TaskExecution), undefined);

    sm.clearExecution('id-1');
    assert.strictEqual(sm.getExecution('id-1'), undefined);
  });

  test('terminated task markers can be set, checked, and cleared', () => {
    const sm = TaskStateManager.getInstance();

    sm.markTerminated('t1');
    assert.strictEqual(sm.isTerminated('t1'), true);

    sm.clearTerminated('t1');
    assert.strictEqual(sm.isTerminated('t1'), false);
  });

  test('terminal association can be set, read, and cleared', () => {
    const sm = TaskStateManager.getInstance();
    const term = { name: 'T' } as vscode.Terminal;

    sm.setTerminal('id', term);
    assert.strictEqual(sm.getTerminal('id'), term);

    sm.clearTerminal('id');
    assert.strictEqual(sm.getTerminal('id'), undefined);
  });

  test('setStopTimer replaces existing timer and clearStopTimer handles missing timer safely', () => {
    const sm = TaskStateManager.getInstance();
    const id = 'stop-id';

    const t1 = setTimeout(() => undefined, 1000);
    const t2 = setTimeout(() => undefined, 1000);

    const originalClearTimeout = global.clearTimeout;
    let clearedFirst = false;

    (global as any).clearTimeout = (timer: unknown) => {
      if (timer === t1) {
        clearedFirst = true;
      }
      return originalClearTimeout(timer as NodeJS.Timeout);
    };

    try {
      sm.setStopTimer(id, t1);
      assert.strictEqual(sm.getStopTimer(id), t1);

      sm.setStopTimer(id, t2);
      assert.strictEqual(sm.getStopTimer(id), t2);
      assert.strictEqual(clearedFirst, true, 'Expected first timer to be cleared when replacing');

      sm.clearStopTimer(id);
      assert.strictEqual(sm.getStopTimer(id), undefined);

      // No-op branch
      sm.clearStopTimer(id);
      assert.strictEqual(sm.getStopTimer(id), undefined);
    } finally {
      (global as any).clearTimeout = originalClearTimeout;
      clearTimeout(t1);
      clearTimeout(t2);
    }
  });

  test('status defaults to idle, setStatus updates value and fires event', () => {
    const sm = TaskStateManager.getInstance();

    assert.strictEqual(sm.getStatus('unknown'), 'idle');

    let fired: { id: string; status: string } | undefined;
    const disposable = sm.onDidStateChange((evt) => {
      fired = evt;
    });

    try {
      sm.setStatus('task-1', 'running');
      assert.strictEqual(sm.getStatus('task-1'), 'running');
      assert.deepStrictEqual(fired, { id: 'task-1', status: 'running' });
    } finally {
      disposable.dispose();
    }
  });

  test('block/unblock/clearAllBlocks manage blocked ids', () => {
    const sm = TaskStateManager.getInstance();

    assert.strictEqual(sm.isBlocked('a'), false);

    sm.blockTask('a');
    sm.blockTask('b');
    assert.strictEqual(sm.isBlocked('a'), true);
    assert.strictEqual(sm.isBlocked('b'), true);

    sm.unblockTask('a');
    assert.strictEqual(sm.isBlocked('a'), false);
    assert.strictEqual(sm.isBlocked('b'), true);

    sm.clearAllBlocks();
    assert.strictEqual(sm.isBlocked('b'), false);
  });
});
