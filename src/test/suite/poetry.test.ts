import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PoetryTaskProvider } from '../../providers/poetryTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';

suite('Poetry Provider Test Suite', () => {
  let provider: PoetryTaskProvider;
  let originalFindFiles: any;
  let originalAsRelativePath: any;
  let originalGetTaskIcon: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let tempDir: string;

  setup(() => {
    provider = new PoetryTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    originalAsRelativePath = vscode.workspace.asRelativePath;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') {
        return uri;
      }
      return uri.path;
    };

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    iconService.getTaskIcon = () => new vscode.ThemeIcon('symbol-method');

    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-poetry-'));
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;

    (vscode.workspace as any).getConfiguration = originalGetConfiguration;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('uses correct provider type', () => {
    assert.strictEqual(provider.type, 'poetry');
  });

  test('uses expected scripts paths', () => {
    const scriptsPath = (provider as any).getScriptsPath();
    assert.deepStrictEqual(scriptsPath, ['project.scripts', 'tool.poetry.scripts']);
  });

  test('findScriptLineInContent finds script in requested section', () => {
    const content =
      '[project]\n' +
      'name = "demo"\n' +
      '\n' +
      '[project.scripts]\n' +
      'serve = "python -m app"\n';

    const line = (provider as any).findScriptLineInContent(content, 'serve', 'project.scripts');
    assert.strictEqual(line, 4);
  });

  test('findScriptLineInContent returns 0 when script is not present', () => {
    const content =
      '[project.scripts]\n' +
      'build = "python -m build"\n' +
      '\n' +
      '[tool.poetry]\n' +
      'name = "demo"\n';

    const line = (provider as any).findScriptLineInContent(content, 'test', 'project.scripts');
    assert.strictEqual(line, 0);
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks uses project.scripts when present', async () => {
    const filePath = path.join(tempDir, 'pyproject.toml');
    const file = vscode.Uri.file(filePath);
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [file];

    fs.writeFileSync(
      filePath,
      '[project]\n' +
        'name = "demo"\n' +
        '\n' +
        '[project.scripts]\n' +
        'build = "python -m build"\n' +
        'lint = "ruff check ."\n',
      'utf8',
    );

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    assert.ok(tasks.some((t) => t.label === 'build'));
    assert.ok(tasks.some((t) => t.label === 'lint'));
  });

  test('getTasks falls back to tool.poetry.scripts', async () => {
    const filePath = path.join(tempDir, 'legacy-pyproject.toml');
    const file = vscode.Uri.file(filePath);
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [file];

    fs.writeFileSync(
      filePath,
      '[tool.poetry]\n' +
        'name = "legacy"\n' +
        '\n' +
        '[tool.poetry.scripts]\n' +
        'serve = "legacy.main:run"\n',
      'utf8',
    );

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'serve');
    assert.strictEqual(tasks[0].startLine, 4);
  });

  test('getTasks merges project.scripts with tool.poetry.scripts when both are present', async () => {
    const filePath = path.join(tempDir, 'mixed-pyproject.toml');
    const file = vscode.Uri.file(filePath);
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [file];

    fs.writeFileSync(
      filePath,
      '[project]\n' +
        'name = "demo"\n' +
        '\n' +
        '[project.scripts]\n' +
        'build = "python -m build"\n' +
        '\n' +
        '[tool.poetry]\n' +
        'name = "demo"\n' +
        '\n' +
        '[tool.poetry.scripts]\n' +
        'serve = "legacy.main:run"\n' +
        'build = "legacy.build:run"\n',
      'utf8',
    );

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    assert.ok(
      tasks.some(
        (t) =>
          t.label === 'build' &&
          typeof t.tooltip === 'string' &&
          t.tooltip.includes('python -m build'),
      ),
    );
    assert.ok(tasks.some((t) => t.label === 'serve'));
  });

  test('getTasks skips invalid TOML files', async () => {
    const filePath = path.join(tempDir, 'bad-pyproject.toml');
    const file = vscode.Uri.file(filePath);
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [file];

    fs.writeFileSync(filePath, '[project\nname = "broken"', 'utf8');

    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks handles read errors and continues', async () => {
    const missingPath = path.join(tempDir, 'missing-pyproject.toml');
    const file = vscode.Uri.file(missingPath);
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [file];

    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array', async () => {
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getCommand returns poetry as default command', () => {
    const command = provider.getCommand();
    assert.strictEqual(command.command, 'poetry');
  });
});
