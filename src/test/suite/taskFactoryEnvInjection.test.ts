import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { TaskEnvService } from '../../services/taskEnvService';
import { IResolvedEnvEntry } from '../../services/taskEnvTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(label: string, taskType: string, fileUri?: vscode.Uri): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType, fileUri);
  item.originalLabel = label;
  if (fileUri) {
    item.taskFileUri = fileUri;
  }
  return item;
}

function makeEnvMap(entries: Record<string, string>): Map<string, IResolvedEnvEntry> {
  const map = new Map<string, IResolvedEnvEntry>();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, {
      value,
      source: 'globalSetting',
      sourceLabel: 'settings.json (workspaceTasks.envVars.env)',
      isSecret: false,
    });
  }
  return map;
}

function makeSecretEnvMap(entries: Record<string, { value: string; source: IResolvedEnvEntry['source'] }>): Map<string, IResolvedEnvEntry> {
  const map = new Map<string, IResolvedEnvEntry>();
  for (const [key, { value, source }] of Object.entries(entries)) {
    map.set(key, {
      value,
      source,
      sourceLabel: source,
      isSecret: true,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('Task Factory — Env Injection (Phase 3)', () => {
  let service: TaskEnvService;
  let originalResolveTaskEnv: TaskEnvService['resolveTaskEnv'];

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : path.join(__dirname, 'test-workspace');

  setup(() => {
    service = TaskEnvService.getInstance();
    originalResolveTaskEnv = service.resolveTaskEnv.bind(service);
  });

  teardown(() => {
    service.resolveTaskEnv = originalResolveTaskEnv;
  });

  test('injects env vars into ShellExecution options for npm task', async () => {
    service.resolveTaskEnv = async () => makeEnvMap({ MY_VAR: 'hello', ANOTHER: 'world' });

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('test', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    assert.strictEqual(created.native, false);
    const execution = created.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Should have ShellExecution');
    assert.deepStrictEqual(execution.options?.env, { MY_VAR: 'hello', ANOTHER: 'world' });
  });

  test('does not inject env when map is empty', async () => {
    service.resolveTaskEnv = async () => new Map<string, IResolvedEnvEntry>();

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('test', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    // options.env should be undefined (not set)
    const execution = created.task.execution as vscode.ShellExecution;
    assert.ok(execution.options?.env === undefined, 'env should not be set when map is empty');
  });

  test('preserves existing ShellExecution options when injecting env', async () => {
    service.resolveTaskEnv = async () => makeEnvMap({ INJECTED: 'yes' });

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('test', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    const execution = created.task.execution as vscode.ShellExecution;
    // The original options.cwd should still be present
    assert.ok(execution.options?.cwd !== undefined, 'cwd should be preserved');
    assert.deepStrictEqual(execution.options?.env, { INJECTED: 'yes' });
  });

  test('does not inject env for native (vscode) tasks', async () => {
    service.resolveTaskEnv = async () => makeEnvMap({ SHOULD_NOT: 'appear' });

    // Create a real vscode.Task to simulate a native task
    const nativeTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'Native Task',
      'shell',
      new vscode.ShellExecution('echo native'),
    );

    const item = new TaskItem('Native Task', vscode.TreeItemCollapsibleState.None, 'vscode');
    item.task = nativeTask;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    assert.strictEqual(created.native, true);
    // The native task execution should not have env injected
    const execution = created.task.execution as vscode.ShellExecution;
    assert.ok(execution.options?.env === undefined, 'native task env should not be modified');
  });

  test('injects env for shell task type', async () => {
    service.resolveTaskEnv = async () => makeEnvMap({ SHELL_VAR: 'shell_value' });

    const scriptPath = path.join(rootPath, 'script.sh');
    const uri = vscode.Uri.file(scriptPath);
    const item = makeItem('myscript', 'shell', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    assert.strictEqual(created.native, false);
    const execution = created.task.execution as vscode.ShellExecution;
    assert.deepStrictEqual(execution.options?.env, { SHELL_VAR: 'shell_value' });
  });

  test('injects secret values (isSecret=true, taskSecretFile source) into execution env', async () => {
    service.resolveTaskEnv = async () =>
      makeSecretEnvMap({ DB_PASSWORD: { value: 'hunter2', source: 'taskSecretFile' } });

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('deploy', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    assert.strictEqual(created.native, false);
    const execution = created.task.execution as vscode.ShellExecution;
    assert.deepStrictEqual(execution.options?.env, { DB_PASSWORD: 'hunter2' });
  });

  test('injects secret values (isSecret=true, ruleSecretStorage source) into execution env', async () => {
    service.resolveTaskEnv = async () =>
      makeSecretEnvMap({ DEPLOY_TOKEN: { value: 'tok-abc', source: 'ruleSecretStorage' } });

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('publish', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    assert.strictEqual(created.native, false);
    const execution = created.task.execution as vscode.ShellExecution;
    assert.deepStrictEqual(execution.options?.env, { DEPLOY_TOKEN: 'tok-abc' });
  });

  test('injects mixed secret and non-secret values into execution env', async () => {
    const mixedMap = new Map<string, IResolvedEnvEntry>([
      ['NODE_ENV', { value: 'production', source: 'globalSetting', sourceLabel: 'global.env', isSecret: false }],
      ['DB_PASSWORD', { value: 's3cr3t', source: 'taskSecretFile', sourceLabel: 'task.secretFile', isSecret: true }],
      ['API_TOKEN', { value: 'mytoken', source: 'ruleSecretStorage', sourceLabel: 'rule.secretStorage', isSecret: true }],
    ]);
    service.resolveTaskEnv = async () => mixedMap;

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);
    const item = makeItem('start', 'npm', uri);

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should return a CreatedTask');
    const execution = created.task.execution as vscode.ShellExecution;
    assert.deepStrictEqual(execution.options?.env, {
      NODE_ENV: 'production',
      DB_PASSWORD: 's3cr3t',
      API_TOKEN: 'mytoken',
    });
  });
});
