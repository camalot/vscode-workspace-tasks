import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RakeTaskProvider } from '../../providers/rakeTaskProvider';
import constants from '../../libs/constants';
import { TaskFilesService } from '../../services/taskFilesService';

suite('Rake Provider Test Suite', () => {
  const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'src', 'test', 'task-files', 'rake');

  let provider: RakeTaskProvider;
  let originalFindFiles: any;
  let originalFetchTasks: any;
  let originalGetWorkspaceFolder: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  const workspaceFolder: vscode.WorkspaceFolder = {
    uri: vscode.Uri.file('/workspace'),
    name: 'workspace',
    index: 0,
  };

  setup(() => {
    provider = new RakeTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    originalFetchTasks = vscode.tasks.fetchTasks;
    (vscode.tasks as any).fetchTasks = async () => [];

    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    (vscode.workspace as any).getWorkspaceFolder = (uri: vscode.Uri) => {
      if (uri.fsPath.startsWith('/workspace/')) {
        return workspaceFolder;
      }
      return undefined;
    };

    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    (vscode.tasks as any).fetchTasks = originalFetchTasks;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('uses correct type and file pattern', () => {
    assert.strictEqual(provider.type, 'rake');
    assert.strictEqual(provider.filePattern, constants.GLOB_RAKE);
  });

  test('getCommand returns default rake command', () => {
    const result = provider.getCommand();
    assert.strictEqual(result.command, 'rake');
    assert.ok(Array.isArray(result.args));
  });

  test('parseRakeOutput parses task names and descriptions', () => {
    const sampleOutput =
      'rake test                # Run all tests\n' +
      'rake db:migrate          # Migrate the database\n' +
      'rake deploy\n' +
      'ignored line\n';

    const tasks = (provider as any).parseRakeOutput(sampleOutput);
    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].name, 'test');
    assert.strictEqual(tasks[0].description, 'Run all tests');
    assert.strictEqual(tasks[1].name, 'db:migrate');
    assert.strictEqual(tasks[2].name, 'deploy');
    assert.strictEqual(tasks[2].description, undefined);
  });

  test('buildRakeTaskListInvocation appends rake listing flags after executable args', () => {
    const invocation = (provider as any).buildRakeTaskListInvocation(
      {
        command: 'bundle',
        args: ['exec', 'rake'],
        cwd: '/workspace',
      },
      '/workspace/Rakefile'
    );

    assert.strictEqual(invocation.command, 'bundle');
    assert.deepStrictEqual(invocation.args, ['exec', 'rake', '--tasks', '--file', '/workspace/Rakefile']);
  });

  test('buildRakeTaskListInvocation supports plain rake command', () => {
    const invocation = (provider as any).buildRakeTaskListInvocation(
      {
        command: 'rake',
        args: [],
        cwd: '/workspace',
      },
      '/workspace/Rakefile'
    );

    assert.strictEqual(invocation.command, 'rake');
    assert.deepStrictEqual(invocation.args, ['--tasks', '--file', '/workspace/Rakefile']);
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty array and skips CLI when workspace is not trusted', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [vscode.Uri.file('/workspace/Rakefile')];
    let cliCalled = false;
    (provider as any).getCommand = () => {
      cliCalled = true;
      return { command: 'rake', args: [] };
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

  test('getTasks returns empty array when no rake files are found', async () => {
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks handles command execution failures gracefully', async () => {
    const filesService = TaskFilesService.getInstance();
    const fixtureFile = vscode.Uri.file(path.join(FIXTURE_DIR, 'Rakefile'));
    filesService.findFiles = async () => [fixtureFile];

    (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command', args: [], cwd: '/workspace' });

    const tasks = await provider.getTasks();
    assert.ok(tasks.length > 0, 'Expected static parse fallback tasks when CLI fails');
    assert.ok(String(tasks[0].tooltip).includes('(static parse)'));
  });

  test('parseRakeFileFallback parses task symbol syntax with startLine', () => {
    const file = vscode.Uri.file('/workspace/Rakefile');
    const content = 'desc "Build app"\ntask :build do\nend\n';
    const tasks = (provider as any).parseRakeFileFallback(content, file);

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'build');
    assert.strictEqual(tasks[0].startLine, 1);
    assert.strictEqual(tasks[0].onOpenActionCommand?.arguments?.[1], 1);
  });

  test('parseRakeFileFallback parses quoted task syntax', () => {
    const file = vscode.Uri.file('/workspace/custom.rake');
    const content = 'task "release:prod" do\nend\n\ntask \'clean\' do\nend\n';
    const tasks = (provider as any).parseRakeFileFallback(content, file);

    assert.deepStrictEqual(tasks.map((t: vscode.TreeItem) => t.label), ['release:prod', 'clean']);
  });

  test('parseRakeFileFallback skips comments and clears pending desc on non-task content', () => {
    const file = vscode.Uri.file('/workspace/custom.rake');
    const content = [
      '# comment',
      'desc "Applies to next task only"',
      'puts "non-task line"',
      'task :actual do',
      'end',
    ].join('\n');
    const tasks = (provider as any).parseRakeFileFallback(content, file);

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'actual');
    assert.strictEqual(tasks[0].tooltip, 'actual (static parse)');
  });

  test('buildTaskLineMap returns 0-based mapping', () => {
    const content = [
      'desc "Build"',
      'task :build do',
      'end',
      'task "deploy" do',
      'end',
    ].join('\n');

    const map = (provider as any).buildTaskLineMap(content) as Map<string, number>;
    assert.strictEqual(map.get('build'), 1);
    assert.strictEqual(map.get('deploy'), 3);
  });

  test('getTasks applies CLI output with mapped startLine from static line map', async () => {
    const filesService = TaskFilesService.getInstance();
    const fixtureFile = vscode.Uri.file(path.join(FIXTURE_DIR, 'cli-line-map.rake'));
    filesService.findFiles = async () => [fixtureFile];

    (provider as any).getCommand = () => ({
      command: 'sh',
      args: ['-c', 'printf "rake build # Build project\\nrake test # Run test suite\\n"'],
      cwd: '/workspace',
    });

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    const build = tasks.find((t) => t.label === 'build');
    const testTask = tasks.find((t) => t.label === 'test');
    assert.ok(build);
    assert.ok(testTask);
    assert.strictEqual(build!.startLine, 1);
    assert.strictEqual(testTask!.startLine, 6);
    assert.strictEqual(build!.onOpenActionCommand?.arguments?.[1], 1);
    assert.strictEqual(testTask!.onOpenActionCommand?.arguments?.[1], 6);
  });

  test('getTasks warns once for ENOENT and still returns fallback tasks', async () => {
    const filesService = TaskFilesService.getInstance();
    const fixtureA = vscode.Uri.file(path.join(FIXTURE_DIR, 'Rakefile'));
    const fixtureB = vscode.Uri.file(path.join(FIXTURE_DIR, 'custom.rake'));
    filesService.findFiles = async () => [fixtureA, fixtureB];

    (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command', args: [], cwd: '/workspace' });

    const warnings: string[] = [];
    const originalWarn = (provider as any).logger.warn.bind((provider as any).logger);
    (provider as any).logger.warn = (message: string) => {
      warnings.push(message);
    };

    try {
      const first = await provider.getTasks();
      const second = await provider.getTasks();
      assert.ok(first.length > 0);
      assert.ok(second.length > 0);
      const notFoundWarnings = warnings.filter((w) => w.includes("'rake' executable not found"));
      assert.strictEqual(notFoundWarnings.length, 1);
    } finally {
      (provider as any).logger.warn = originalWarn;
    }
  });

  test('getTasks uses CLI output when command succeeds', async () => {
    const filesService = TaskFilesService.getInstance();
    const fixtureFile = vscode.Uri.file(path.join(FIXTURE_DIR, 'Rakefile'));
    filesService.findFiles = async () => [fixtureFile];

    (provider as any).getCommand = () => ({
      command: 'sh',
      args: ['-c', 'printf "rake lint # Lint tasks\\n"'],
      cwd: '/workspace',
    });

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'lint');
    assert.strictEqual(tasks[0].tooltip, 'Lint tasks');
    assert.ok(!String(tasks[0].tooltip).includes('(static parse)'));
  });

  test('getSystemTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when fetchTasks throws', async () => {
    (vscode.tasks as any).fetchTasks = async () => {
      throw new Error('fetch failed');
    };

    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks maps rake tasks to task items', async () => {
    const filesService = TaskFilesService.getInstance();
    const rakeFile = vscode.Uri.file('/workspace/project/Rakefile');
    filesService.findFiles = async () => [rakeFile];

    const mockTask = {
      name: 'db:migrate',
      source: 'Workspace',
      scope: workspaceFolder,
      definition: { type: 'rake' },
    } as unknown as vscode.Task;

    (vscode.tasks as any).fetchTasks = async () => [mockTask];

    const tasks = await provider.getSystemTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'db:migrate');
    assert.strictEqual(tasks[0].taskFileUri?.fsPath, rakeFile.fsPath);
    assert.strictEqual(tasks[0].onOpenActionCommand?.command, 'workspaceTasks.openFileAtLine');
  });
});
