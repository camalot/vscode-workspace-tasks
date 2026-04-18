import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory CircleCI Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(_key: string, def?: T): T => def as T,
        };
      }
      return originalGetConfiguration(section);
    };
    (vscode.workspace as any).getWorkspaceFolder = (uri: vscode.Uri) => ({
      uri: vscode.Uri.file(path.join(path.dirname(path.dirname(uri.fsPath)))),
      name: 'workspace',
      index: 0,
    });
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
  });

  test('creates circleci local execute task for job items', async () => {
    const configPath = path.join('/tmp', '.circleci', 'config.yml');
    const uri = vscode.Uri.file(configPath);

    const item = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'circleci', uri);
    item.taskFileUri = uri;
    item.metadata = { type: 'job', jobName: 'lint' };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Expected task to be created');
    assert.strictEqual(created!.task.definition.type, 'circleci');
    assert.strictEqual(created!.task.definition.job, 'lint');
    assert.ok(created!.command?.includes('local execute'));
    assert.ok(created!.command?.includes('-c .circleci/config.yml'));
    assert.ok(created!.command?.includes(' lint'));
    assert.strictEqual(created!.cwd?.toLowerCase(), path.dirname(path.dirname(configPath)).toLowerCase());
  });

  test('returns undefined for non-job circleci metadata', async () => {
    const configPath = path.join('/tmp', '.circleci', 'config.yml');
    const uri = vscode.Uri.file(configPath);

    const item = new TaskItem('workflow: ci', vscode.TreeItemCollapsibleState.Collapsed, 'circleci', uri);
    item.taskFileUri = uri;
    item.metadata = { type: 'workflow', workflowName: 'ci' };

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
  });

  test('appends extra args after job name', async () => {
    const configPath = path.join('/tmp', '.circleci', 'config.yml');
    const uri = vscode.Uri.file(configPath);

    const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'circleci', uri);
    item.taskFileUri = uri;
    item.metadata = { type: 'job', jobName: 'test' };

    const created = await createTaskForItem(item, '--debug');

    assert.ok(created, 'Expected task to be created');
    const cmd = created!.command ?? '';
    const jobIdx = cmd.indexOf(' test');
    const argIdx = cmd.indexOf('--debug');
    assert.ok(jobIdx >= 0, `Command should include job name. Command: ${cmd}`);
    assert.ok(argIdx > jobIdx, `Extra args should appear after job name. Command: ${cmd}`);
  });

  test('adds --temp-dir for circleci local execution', async () => {
    const configPath = path.join('/tmp', '.circleci', 'config.yml');
    const uri = vscode.Uri.file(configPath);

    const item = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'circleci', uri);
    item.taskFileUri = uri;
    item.metadata = { type: 'job', jobName: 'lint' };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Expected task to be created');
    const cmd = created!.command ?? '';
    const expectedTempDir = path.join('/tmp', '.circleci', '.workspace-tasks-temp');

    assert.ok(cmd.includes('--temp-dir'), `Expected --temp-dir in command. Command: ${cmd}`);
    assert.ok(cmd.includes(expectedTempDir), `Expected temp dir path in command. Command: ${cmd}`);
    assert.ok(fs.existsSync(expectedTempDir), `Expected temp dir to exist: ${expectedTempDir}`);

    assert.ok(created!.task.execution instanceof vscode.ShellExecution);
    const exec = created!.task.execution as vscode.ShellExecution;
    assert.strictEqual(exec.options?.env?.TMPDIR, undefined, 'TMPDIR should not be set by the CircleCI task builder');
  });

  test('removes stale local_build_config.yml directory before run', async () => {
    const configPath = path.join('/tmp', '.circleci', 'config.yml');
    const tempDir = path.join('/tmp', '.circleci', '.workspace-tasks-temp');
    const stalePath = path.join(tempDir, 'local_build_config.yml');

    fs.mkdirSync(stalePath, { recursive: true });
    assert.ok(fs.existsSync(stalePath), 'Expected stale local_build_config.yml directory to exist before task creation');

    const uri = vscode.Uri.file(configPath);
    const item = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'circleci', uri);
    item.taskFileUri = uri;
    item.metadata = { type: 'job', jobName: 'lint' };

    const created = await createTaskForItem(item);
    assert.ok(created, 'Expected task to be created');

    assert.ok(!fs.existsSync(stalePath), 'Expected stale local_build_config.yml directory to be removed');
  });
});
