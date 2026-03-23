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
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    (vscode.tasks as any).fetchTasks = originalFetchTasks;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
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
