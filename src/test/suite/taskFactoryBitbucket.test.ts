import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory Bitbucket Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : path.join(__dirname, 'test-workspace');

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;

    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
    (vscode.workspace as any).getWorkspaceFolder = (_uri: vscode.Uri) => ({
      uri: vscode.Uri.file(rootPath),
      name: 'workspace',
      index: 0,
    });
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
  });

  // ── returns undefined for non-runnable item types ────────────

  test('returns undefined for file metadata type', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('bitbucket-pipelines.yml', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'file' };

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
  });

  test('returns undefined when taskFileUri is missing', async () => {
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.None, 'bitbucket', undefined);
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
  });

  // ── pipeline item ─────────────────────────────────────────────

  test('creates task for pipeline item', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.definition.type, 'bitbucket');
    assert.strictEqual(created!.task.definition.pipeline, 'default');
  });

  test('pipeline task command includes run and pipeline path', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.ok(created!.command?.includes('run'), `Command should include 'run': ${created!.command}`);
    assert.ok(created!.command?.includes('default'), `Command should include pipeline path: ${created!.command}`);
  });

  test('pipeline task command does not include --step or --stage', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.ok(!created!.command?.includes('--step'), 'Pipeline command should not include --step');
    assert.ok(!created!.command?.includes('--stage'), 'Pipeline command should not include --stage');
  });

  test('pipeline task definition has no step or stage field', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.strictEqual(created!.task.definition.step, undefined);
    assert.strictEqual(created!.task.definition.stage, undefined);
  });

  // ── stage item ────────────────────────────────────────────────

  test('creates task for stage item', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('Build Stage', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'stage', pipelinePath: 'branches.master', stageName: 'Build Stage' };

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should create a task for stage');
    assert.strictEqual(created!.task.definition.type, 'bitbucket');
    assert.strictEqual(created!.task.definition.pipeline, 'branches.master');
    assert.strictEqual(created!.task.definition.stage, 'Build Stage');
  });

  test('stage task command includes --stage and stage name', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('Build Stage', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'stage', pipelinePath: 'branches.master', stageName: 'Build Stage' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.ok(created!.command?.includes('--stage'), `Command should include --stage: ${created!.command}`);
    assert.ok(created!.command?.includes('"Build Stage"') || created!.command?.includes('Build Stage'), `Command should include stage name: ${created!.command}`);
  });

  test('returns undefined for stage with missing stageName', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('[unnamed stage]', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'stage', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined, 'Should return undefined for stage without stageName');
  });

  // ── step item ─────────────────────────────────────────────────

  test('creates task for step item', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'step', pipelinePath: 'default', stepName: 'Build' };

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should create a task for step');
    assert.strictEqual(created!.task.definition.type, 'bitbucket');
    assert.strictEqual(created!.task.definition.pipeline, 'default');
    assert.strictEqual(created!.task.definition.step, 'Build');
  });

  test('step task command includes --step and step name', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'step', pipelinePath: 'default', stepName: 'Build' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.ok(created!.command?.includes('--step'), `Command should include --step: ${created!.command}`);
    assert.ok(created!.command?.includes('Build'), `Command should include step name: ${created!.command}`);
  });

  test('returns undefined for step with missing stepName', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('[unnamed step]', vscode.TreeItemCollapsibleState.None, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'step', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined, 'Should return undefined for step without stepName');
  });

  // ── env-file injection ────────────────────────────────────────

  test('env files are added to command when configured', async () => {
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            if (key === 'bitbucketPipelineRunner.environmentFiles') {
              return ['.env', '.env.local'] as unknown as T;
            }
            return def as T;
          },
        };
      }
      return originalGetConfiguration(section);
    };

    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    const cmd = created!.command ?? '';
    assert.ok(cmd.includes('--env-file'), `Command should include --env-file: ${cmd}`);
    assert.ok(cmd.includes('.env'), `Command should include .env: ${cmd}`);
  });

  // ── extra args ────────────────────────────────────────────────

  test('extra args are appended to command', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item, '--dry-run');
    assert.ok(created);
    assert.ok(created!.command?.includes('--dry-run'), `Extra args should be in command: ${created!.command}`);
  });

  // ── cwd resolution ────────────────────────────────────────────

  test('cwd is set to workspace folder', async () => {
    const fileUri = vscode.Uri.file(path.join(rootPath, 'bitbucket-pipelines.yml'));
    const item = new TaskItem('default', vscode.TreeItemCollapsibleState.Collapsed, 'bitbucket', fileUri);
    item.taskFileUri = fileUri;
    item.metadata = { type: 'pipeline', pipelinePath: 'default' };

    const created = await createTaskForItem(item);
    assert.ok(created);
    assert.strictEqual(created!.cwd?.toLowerCase(), rootPath.toLowerCase());

    const execution = created!.task.execution as vscode.ShellExecution;
    assert.ok(execution instanceof vscode.ShellExecution);
    assert.strictEqual(execution.options?.cwd?.toLowerCase(), rootPath.toLowerCase());
  });
});
