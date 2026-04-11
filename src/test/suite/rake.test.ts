import * as assert from 'assert';
import * as vscode from 'vscode';
import { RakeTaskProvider } from '../../providers/rakeTaskProvider';
import constants from '../../libs/constants';
import { TaskFilesService } from '../../services/taskFilesService';

suite('Rake Provider Test Suite', () => {
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

  test('getTasks returns empty array when no rake files are found', async () => {
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks handles command execution failures gracefully', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [vscode.Uri.file('/workspace/Rakefile')];

    (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command', args: [], cwd: '/workspace' });

    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
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
