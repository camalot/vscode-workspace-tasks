import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitlabCiTaskProvider } from '../../providers/gitlabCiTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';
import constants from '../../libs/constants';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'src', 'test', 'task-files', 'gitlab-ci');

suite('GitlabCiTaskProvider Test Suite', () => {
  let provider: GitlabCiTaskProvider;
  let originalFindFiles: any;
  let originalGetTaskIcon: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let tempDir: string;

  const fakeIcon = new vscode.ThemeIcon('circuit-board');
  const makeFileUri = (dir: string, name = '.gitlab-ci.yml') => vscode.Uri.file(path.join(dir, name));

  setup(() => {
    provider = new GitlabCiTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    iconService.getTaskIcon = () => fakeIcon;

    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-gitlab-ci-'));
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;

    (vscode.workspace as any).getConfiguration = originalGetConfiguration;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────
  // Provider metadata
  // ──────────────────────────────────────────────────────────────

  test('has correct type', () => {
    assert.strictEqual(provider.type, 'gitlab-ci');
  });

  test('has correct filePattern', () => {
    assert.strictEqual(provider.filePattern, constants.GLOB_GITLAB_CI);
  });

  test('getCommand returns gitlab-ci-local as default command', () => {
    const result = provider.getCommand();
    assert.strictEqual(result.command, 'gitlab-ci-local');
  });

  test('getSystemTasks returns empty array', async () => {
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ──────────────────────────────────────────────────────────────
  // getTasks
  // ──────────────────────────────────────────────────────────────

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty array when no files found', async () => {
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty array and skips CLI when workspace is not trusted', async () => {
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [makeFileUri(tempDir)];
    let cliCalled = false;
    (provider as any).getCommand = () => {
      cliCalled = true;
      return { command: 'gitlab-ci-local', args: [] };
    };
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    try {
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
      assert.strictEqual(cliCalled, false, 'CLI must not be invoked for untrusted workspace');
    } finally {
      Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — invalid JSON
  // ──────────────────────────────────────────────────────────────

  test('parseOutput returns empty array for invalid JSON', () => {
    const fileUri = makeFileUri(tempDir);
    const result = provider.parseOutput('not json', fileUri);
    assert.deepStrictEqual(result, []);
  });

  test('parseOutput returns empty array when JSON is not an array', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'invalid.json'),
      'utf8',
    );
    const result = provider.parseOutput(stdout, fileUri);
    assert.deepStrictEqual(result, []);
  });

  test('parseOutput returns empty array for empty JSON array', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'empty-array.json'),
      'utf8',
    );
    const result = provider.parseOutput(stdout, fileUri);
    assert.deepStrictEqual(result, []);
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — valid jobs
  // ──────────────────────────────────────────────────────────────

  test('parseOutput returns parent TaskItem wrapping job children', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const result = provider.parseOutput(stdout, fileUri);
    assert.strictEqual(result.length, 1, 'Should return exactly one parent item');
    const parent = result[0];
    assert.strictEqual(parent.label, '.gitlab-ci.yml');
    assert.strictEqual(parent.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(parent.taskType, 'gitlab-ci');
  });

  test('parseOutput parent has taskFileUri set', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    assert.strictEqual(parent.taskFileUri?.fsPath, fileUri.fsPath);
  });

  test('parseOutput parent has onOpenActionCommand set', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    assert.ok(parent.onOpenActionCommand, 'Parent should have onOpenActionCommand');
    assert.strictEqual(parent.onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
  });

  test('parseOutput children have correct labels', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const childLabels = parent.children!.map((c) => c.label);
    assert.ok(childLabels.includes('npm-install'));
    assert.ok(childLabels.includes('npm-outdated'));
    assert.ok(childLabels.includes('docker-compose-up'));
    assert.ok(childLabels.includes('docker-compose-down'));
    assert.ok(childLabels.includes('always-cleanup'));
    assert.ok(childLabels.includes('notify-failure'));
  });

  test('parseOutput children have stage as description', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const npmInstall = parent.children!.find((c) => c.label === 'npm-install');
    assert.strictEqual(npmInstall?.description, 'build');
  });

  test('parseOutput children have correct type', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    for (const child of parent.children!) {
      assert.strictEqual(child.taskType, 'gitlab-ci');
    }
  });

  test('parseOutput children have taskFileUri set', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    for (const child of parent.children!) {
      assert.strictEqual(child.taskFileUri?.fsPath, fileUri.fsPath);
    }
  });

  test('parseOutput children have onOpenActionCommand set', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    for (const child of parent.children!) {
      assert.ok(child.onOpenActionCommand);
      assert.strictEqual(child.onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    }
  });

  test('parseOutput children have metadata set', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const npmInstall = parent.children!.find((c) => c.label === 'npm-install');
    assert.ok(npmInstall?.metadata);
    assert.strictEqual(npmInstall!.metadata!.stage, 'build');
    assert.strictEqual(npmInstall!.metadata!.when, 'on_success');
    assert.strictEqual(npmInstall!.metadata!.allowFailure, false);
  });

  test('parseOutput children with allow_failure have metadata.allowFailure=true', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const outdated = parent.children!.find((c) => c.label === 'npm-outdated');
    assert.ok(outdated?.metadata?.allowFailure);
  });

  test('parseOutput tooltip includes stage and when', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const npmInstall = parent.children!.find((c) => c.label === 'npm-install');
    const tooltip = npmInstall?.tooltip as string | undefined;
    assert.ok(tooltip?.includes('Stage: build'));
    assert.ok(tooltip?.includes('When: on_success'));
  });

  test('parseOutput tooltip includes needs when present', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const outdated = parent.children!.find((c) => c.label === 'npm-outdated');
    const tooltip = outdated?.tooltip as string | undefined;
    assert.ok(tooltip?.includes('Needs: npm-install'));
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — when: never filtering
  // ──────────────────────────────────────────────────────────────

  test('parseOutput filters out jobs with when: never', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'valid-jobs.json'),
      'utf8',
    );
    const [parent] = provider.parseOutput(stdout, fileUri);
    const childLabels = parent.children!.map((c) => c.label);
    assert.ok(!childLabels.includes('skip-me'), 'skip-me (when: never) should be filtered');
  });

  test('parseOutput returns empty array when all jobs are when: never', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'only-never-jobs.json'),
      'utf8',
    );
    const result = provider.parseOutput(stdout, fileUri);
    assert.deepStrictEqual(result, []);
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — special characters in job names
  // ──────────────────────────────────────────────────────────────

  test('parseOutput handles job names with colons', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = fs.readFileSync(
      path.join(FIXTURE_DIR, 'special-chars-job.json'),
      'utf8',
    );
    const result = provider.parseOutput(stdout, fileUri);
    assert.strictEqual(result.length, 1);
    const childLabels = result[0].children!.map((c) => c.label);
    assert.ok(childLabels.includes('test:unit'));
    assert.ok(childLabels.includes('build:staging'));
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — custom iconService
  // ──────────────────────────────────────────────────────────────

  test('parseOutput uses provided iconService', () => {
    const fileUri = makeFileUri(tempDir);
    const customIcon = new vscode.ThemeIcon('flame');
    const mockIconService = {
      getTaskIcon: (_type: string, _uri?: vscode.Uri) => customIcon,
    } as any;

    const stdout = JSON.stringify([
      { name: 'build', stage: 'build', when: 'on_success', allow_failure: false, needs: [] },
    ]);
    const result = provider.parseOutput(stdout, fileUri, mockIconService);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].iconPath, customIcon);
    assert.strictEqual(result[0].children![0].iconPath, customIcon);
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — description without explicit description field
  // ──────────────────────────────────────────────────────────────

  test('parseOutput uses job name as tooltip fallback when description is absent', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = JSON.stringify([
      { name: 'my-job', stage: 'build', when: 'on_success', allow_failure: false, needs: [] },
    ]);
    const result = provider.parseOutput(stdout, fileUri);
    const child = result[0].children![0];
    const tooltip = child.tooltip as string;
    assert.ok(tooltip.startsWith('my-job'));
  });

  // ──────────────────────────────────────────────────────────────
  // parseOutput — collapsibleState of children
  // ──────────────────────────────────────────────────────────────

  test('parseOutput children have None collapsibleState', () => {
    const fileUri = makeFileUri(tempDir);
    const stdout = JSON.stringify([
      { name: 'build', stage: 'build', when: 'on_success', allow_failure: false, needs: [] },
    ]);
    const [parent] = provider.parseOutput(stdout, fileUri);
    assert.strictEqual(parent.children![0].collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  // ──────────────────────────────────────────────────────────────
  // GL01-GL04: findJobLineNumber
  // ──────────────────────────────────────────────────────────────

  test('GL01 - findJobLineNumber returns correct 0-based line index', () => {
    const lines = [
      'image: alpine',
      '',
      'build-job:',
      '  stage: build',
      '  script: make',
    ];
    assert.strictEqual(provider.findJobLineNumber(lines, 'build-job'), 2);
  });

  test('GL02 - findJobLineNumber returns undefined when job is not present', () => {
    const lines = [
      'build-job:',
      '  stage: build',
    ];
    assert.strictEqual(provider.findJobLineNumber(lines, 'missing-job'), undefined);
  });

  test('GL03 - findJobLineNumber returns undefined for reserved keys', () => {
    const lines = [
      'image: alpine',
      'variables:',
      '  FOO: bar',
    ];
    // Reserved keys must not produce a line number even if they match the pattern
    for (const key of ['image', 'services', 'stages', 'types', 'before_script',
      'after_script', 'variables', 'cache', 'default', 'workflow', 'include']) {
      assert.strictEqual(
        provider.findJobLineNumber(lines, key),
        undefined,
        `Reserved key '${key}' should return undefined`,
      );
    }
  });

  test('GL04 - parseOutput children have startLine set when fileLines are provided', () => {
    const fileUri = makeFileUri(tempDir);
    const fileLines = [
      'stages:',
      '  - build',
      '',
      'npm-install:',
      '  stage: build',
    ];
    const stdout = JSON.stringify([
      { name: 'npm-install', stage: 'build', when: 'on_success', allow_failure: false, needs: [] },
    ]);
    const [parent] = provider.parseOutput(stdout, fileUri, undefined, fileLines);
    const child = parent.children!.find((c) => c.label === 'npm-install');
    assert.strictEqual(child?.startLine, 3);
  });
});
