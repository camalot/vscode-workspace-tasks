import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory GitLab CI Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : path.join(__dirname, 'test-workspace');

  /** Build a default config mock that returns defaults for workspaceTasks. */
  const makeConfigMock = (overrides: Record<string, unknown> = {}) => {
    return (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            if (key in overrides) {
              return overrides[key] as T;
            }
            return def as T;
          },
        };
      }
      return originalGetConfiguration(section);
    };
  };

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = makeConfigMock();
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  // ──────────────────────────────────────────────────────────────
  // Basic task creation
  // ──────────────────────────────────────────────────────────────

  test('creates task with definition type gitlab-ci', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.definition.type, 'gitlab-ci');
  });

  test('creates task with correct label', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.name, 'deploy');
  });

  test('task definition includes job name', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('npm-install', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.definition.job, 'npm-install');
  });

  // ──────────────────────────────────────────────────────────────
  // CWD resolution
  // ──────────────────────────────────────────────────────────────

  test('cwd is set to directory of .gitlab-ci.yml file', async () => {
    const subDir = path.join(rootPath, 'myproject');
    const ciPath = path.join(subDir, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.cwd?.toLowerCase(), subDir.toLowerCase());

    const execution = created!.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    assert.strictEqual(execution.options?.cwd?.toLowerCase(), subDir.toLowerCase());
  });

  // ──────────────────────────────────────────────────────────────
  // Command construction
  // ──────────────────────────────────────────────────────────────

  test('command includes --file flag with file path', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--file'), `Command should include --file but was: ${created!.command}`);
    assert.ok(created!.command?.includes(path.basename(ciPath)), `Command should include file basename but was: ${created!.command}`);
  });

  test('job name appears in command after --file flag', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    const cmd = created!.command ?? '';
    const fileIdx = cmd.indexOf('--file');
    const jobIdx = cmd.indexOf('deploy');
    assert.ok(fileIdx >= 0, `Command should contain --file but was: ${cmd}`);
    assert.ok(jobIdx >= 0, `Command should contain job name but was: ${cmd}`);
    assert.ok(jobIdx > fileIdx, `Job name should appear after --file but was: ${cmd}`);
  });

  test('extra args are appended after job name', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item, '--debug');

    assert.ok(created, 'Should create a task');
    const cmd = created!.command ?? '';
    const jobIdx = cmd.indexOf('build');
    const argIdx = cmd.indexOf('--debug');
    assert.ok(argIdx > jobIdx, `Extra args should follow the job name but was: ${cmd}`);
  });

  // ──────────────────────────────────────────────────────────────
  // Optional config flags
  // ──────────────────────────────────────────────────────────────

  test('variablesFile flag is added when configured', async () => {
    (vscode.workspace as any).getConfiguration = makeConfigMock({
      'gitlabCiLocal.variablesFile': '/path/to/vars.yml',
    });

    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(
      created!.command?.includes('--variables-file /path/to/vars.yml'),
      `Command should contain --variables-file but was: ${created!.command}`,
    );
  });

  test('variable flags are added when configured', async () => {
    (vscode.workspace as any).getConfiguration = makeConfigMock({
      'gitlabCiLocal.variable': ['FOO=bar', 'BAZ=qux'],
    });

    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--variable FOO=bar'), `Missing first --variable`);
    assert.ok(created!.command?.includes('--variable BAZ=qux'), `Missing second --variable`);
  });

  test('unsetVariable flags are added when configured', async () => {
    (vscode.workspace as any).getConfiguration = makeConfigMock({
      'gitlabCiLocal.unsetVariable': ['SECRET_KEY'],
    });

    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--unset-variable SECRET_KEY'), `Missing --unset-variable`);
  });

  test('remoteVariables flags are added when configured', async () => {
    (vscode.workspace as any).getConfiguration = makeConfigMock({
      'gitlabCiLocal.remoteVariables': ['group/project:main'],
    });

    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--remote-variables group/project:main'), `Missing --remote-variables`);
  });

  test('home flag is added when configured', async () => {
    (vscode.workspace as any).getConfiguration = makeConfigMock({
      'gitlabCiLocal.home': '/custom/home',
    });

    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--home /custom/home'), `Missing --home flag`);
  });

  test('no optional flags when all config values are empty/default', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    const cmd = created!.command ?? '';
    assert.ok(!cmd.includes('--variables-file'), `Should not include --variables-file when empty`);
    assert.ok(!cmd.includes('--variable '), `Should not include --variable when empty`);
    assert.ok(!cmd.includes('--unset-variable'), `Should not include --unset-variable when empty`);
    assert.ok(!cmd.includes('--remote-variables'), `Should not include --remote-variables when empty`);
    assert.ok(!cmd.includes('--home '), `Should not include --home when empty`);
  });

  // ──────────────────────────────────────────────────────────────
  // Guard: returns undefined when resourceUri is absent
  // ──────────────────────────────────────────────────────────────

  test('returns undefined when item has no resourceUri', async () => {
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', undefined);

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
  });

  // ──────────────────────────────────────────────────────────────
  // native flag
  // ──────────────────────────────────────────────────────────────

  test('native is false', async () => {
    const ciPath = path.join(rootPath, '.gitlab-ci.yml');
    const uri = vscode.Uri.file(ciPath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'gitlab-ci', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.native, false);
  });
});
