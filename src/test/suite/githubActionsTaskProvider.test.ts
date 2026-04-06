import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GithubActionsTaskProvider } from '../../providers/githubActionsTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';

suite('GithubActionsTaskProvider Test Suite', () => {
  let provider: GithubActionsTaskProvider;
  let originalFindFiles: any;
  let originalGetTaskIcon: any;
  let tempDir: string;

  setup(() => {
    provider = new GithubActionsTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);

    filesService.findFiles = async () => [];
    iconService.getTaskIcon = () => new vscode.ThemeIcon('github');

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-gh-actions-'));
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('getCommand returns act as default command', () => {
    const command = provider.getCommand();
    assert.strictEqual(command.command, 'act');
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns parsed workflow tasks and skips invalid yaml files', async () => {
    const goodPath = path.join(tempDir, 'ci.yml');
    const badPath = path.join(tempDir, 'bad.yml');
    const goodFile = vscode.Uri.file(goodPath);
    const badFile = vscode.Uri.file(badPath);

    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [goodFile, badFile];

    fs.writeFileSync(
      goodPath,
      'name: CI\n' +
        'on:\n' +
        '  push:\n' +
        '  workflow_dispatch:\n' +
        '    inputs:\n' +
        '      env:\n' +
        '        description: Environment\n' +
        '        required: true\n' +
        'jobs:\n' +
        '  build:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - run: echo build\n',
      'utf8',
    );
    fs.writeFileSync(badPath, 'name: [broken', 'utf8');

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'CI');
    assert.ok(tasks[0].children);
    assert.ok(tasks[0].children!.some((c) => c.label === 'Run Workflow (push)'));
    assert.ok(tasks[0].children!.some((c) => c.label === 'Run Workflow (workflow_dispatch)'));
    assert.ok(tasks[0].children!.some((c) => c.label === 'Run Job: build'));

    const workflowDispatchTask = tasks[0].children!.find((c) => c.label === 'Run Workflow (workflow_dispatch)');
    assert.ok(workflowDispatchTask?.metadata?.inputs?.env);
    assert.ok(tasks[0].metadata?.inputs?.env);
  });

  test('parseWorkflowFile supports on as string', () => {
    const file = vscode.Uri.file('/workspace/.github/workflows/release.yml');
    const task = (provider as any).parseWorkflowFile(file, 'name: Release\non: push\n');

    assert.ok(task);
    assert.strictEqual(task.label, 'Release');
    assert.strictEqual(task.metadata.events.length, 1);
    assert.strictEqual(task.metadata.events[0], 'push');
    assert.strictEqual(task.children.length, 1);
  });

  test('parseWorkflowFile supports on as array and job line lookup fallback', () => {
    const file = vscode.Uri.file('/workspace/.github/workflows/manual.yml');
    const text =
      'name: Manual\n' +
      'on:\n' +
      '  - push\n' +
      '  - pull_request\n' +
      'jobs:\n' +
      '  test:\n' +
      '    runs-on: ubuntu-latest\n';

    const task = (provider as any).parseWorkflowFile(file, text);

    assert.ok(task);
    assert.deepStrictEqual(task.metadata.events, ['push', 'pull_request']);
    assert.ok(task.children.some((c: any) => c.label === 'Run Workflow (push)'));
    assert.ok(task.children.some((c: any) => c.label === 'Run Workflow (pull_request)'));

    const job = task.children.find((c: any) => c.label === 'Run Job: test');
    assert.ok(job);
    assert.strictEqual(job.onOpenActionCommand.arguments[1], 5);
  });

  test('parseWorkflowFile returns undefined for invalid yaml', () => {
    const file = vscode.Uri.file('/workspace/.github/workflows/invalid.yml');
    const task = (provider as any).parseWorkflowFile(file, 'name: [bad');
    assert.strictEqual(task, undefined);
  });

  test('getSystemTasks returns empty array', async () => {
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });
});
