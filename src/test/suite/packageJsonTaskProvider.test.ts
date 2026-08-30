import * as assert from 'assert';
import * as vscode from 'vscode';
import { PackageJsonTaskProvider } from '../../providers/packageJsonTaskProvider';
import { NpmTaskProvider } from '../../providers/npmTaskProvider';
import { TaskItem } from '../../taskItem';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';
import constants from '../../libs/constants';

class TestPackageJsonProvider extends PackageJsonTaskProvider {
  public systemTasks: TaskItem[] = [];

  constructor() {
    super('test-package-json', '**/package.json');
  }

  public getCommand(): any {
    return { command: 'npm', args: [], cwd: '/workspace' };
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return this.systemTasks;
  }
}

suite('PackageJsonTaskProvider Test Suite', () => {
  let provider: TestPackageJsonProvider;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalFindFiles: any;
  let originalShouldIgnore: any;
  let originalGetTaskIcon: any;

  setup(() => {
    provider = new TestPackageJsonProvider();

    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalShouldIgnore = filesService.shouldIgnore.bind(filesService);

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);

    filesService.findFiles = async () => [];
    filesService.shouldIgnore = () => false;

    iconService.getTaskIcon = () => new vscode.ThemeIcon('wrench');

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => '{"scripts": {"build": "tsc"}}',
    });

    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') {
        return uri;
      }
      return uri.path;
    };
  });

  teardown(() => {
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    filesService.shouldIgnore = originalShouldIgnore;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;
  });

  test('parseContent returns parsed JSON for valid content', async () => {
    const json = await (provider as any).parseContent('{"name":"demo"}');
    assert.deepStrictEqual(json, { name: 'demo' });
  });

  test('parseContent returns empty object for invalid JSON', async () => {
    const json = await (provider as any).parseContent('{invalid');
    assert.deepStrictEqual(json, {});
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getFilePatterns merges the generic setting with the built-in package.json pattern', () => {
    const provider = new NpmTaskProvider();
    const previous = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            if (key === 'additionalFilePatterns') {
              return { npm: ['**/package.custom.json'] } as T;
            }
            return def as T;
          },
        };
      }
      return previous(section);
    };

    try {
      assert.deepStrictEqual(provider.getFilePatterns(), [constants.GLOB_NODEJS, '**/package.custom.json']);
    } finally {
      (vscode.workspace as any).getConfiguration = previous;
    }
  });

  test('getTasks returns scripts from package json and sets line/open command', async () => {
    const file = vscode.Uri.file('/workspace/app/package.json');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () =>
        '{\n' +
        '  "name": "demo",\n' +
        '  "scripts": {\n' +
        '    "build": "tsc",\n' +
        '    "test": "npm test"\n' +
        '  }\n' +
        '}',
    });

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 2);
    const build = tasks.find((t) => t.label === 'build');
    const test = tasks.find((t) => t.label === 'test');

    assert.ok(build);
    assert.ok(test);
    assert.strictEqual(build!.startLine, 3);
    assert.strictEqual(test!.startLine, 4);
    assert.strictEqual(build!.description, '/workspace/app/package.json');
    assert.strictEqual(build!.onOpenActionCommand?.command, 'workspaceTasks.openFileAtLine');
  });

  test('getTasks skips ignored files', async () => {
    const file = vscode.Uri.file('/workspace/ignored/package.json');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];
    filesService.shouldIgnore = () => true;

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  test('getTasks continues when a package file has invalid JSON', async () => {
    const badFile = vscode.Uri.file('/workspace/bad/package.json');
    const goodFile = vscode.Uri.file('/workspace/good/package.json');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [badFile, goodFile];

    (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
      if (uri.fsPath.includes('/bad/')) {
        return { getText: () => '{invalid json' };
      }
      return { getText: () => '{"scripts":{"lint":"eslint ."}}' };
    };

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'lint');
  });

  test('getTasks avoids duplicates when the same file is discovered twice', async () => {
    const file = vscode.Uri.file('/workspace/dup/package.json');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file, file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => '{"scripts":{"build":"tsc"}}',
    });

    const tasks = await provider.getTasks();
    const buildTasks = tasks.filter((t) => t.label === 'build');

    assert.strictEqual(buildTasks.length, 1);
  });

  test('getTasks returns empty array when file search throws', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => {
      throw new Error('findFiles failed');
    };

    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });
});
