import * as assert from 'assert';
import * as vscode from 'vscode';
import { PnpmTaskProvider } from '../../providers/npmTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';

suite('PackageYamlTaskProvider Test Suite', () => {
  let provider: PnpmTaskProvider;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalFindFiles: any;
  let originalShouldIgnore: any;
  let originalGetTaskIcon: any;

  setup(() => {
    provider = new PnpmTaskProvider();
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });

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

  // T01: package.yaml with a scripts section → provider returns the correct tasks
  test('getTasks returns tasks from package.yaml with scripts section', async () => {
    const file = vscode.Uri.file('/workspace/app/package.yaml');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => 'name: demo\nscripts:\n  build: tsc\n  test: jest\n',
    });

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 2);
    const build = tasks.find((t) => t.label === 'build');
    const test = tasks.find((t) => t.label === 'test');
    assert.ok(build, 'build task should exist');
    assert.ok(test, 'test task should exist');
  });

  // T02: package.yaml tasks have correct taskFileUri pointing to the YAML file
  test('getTasks sets taskFileUri to the yaml file', async () => {
    const file = vscode.Uri.file('/workspace/app/package.yaml');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => 'scripts:\n  build: tsc\n',
    });

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].taskFileUri?.fsPath, file.fsPath);
  });

  // T03: package.yaml tasks have correct startLine values
  test('getTasks sets startLine for tasks in package.yaml', async () => {
    const file = vscode.Uri.file('/workspace/app/package.yaml');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    // Use quoted keys so the line detection (which searches for "scriptName") can find them
    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => 'scripts:\n  "build": tsc\n  "test": jest\n',
    });

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 2);
    const build = tasks.find((t) => t.label === 'build');
    const test = tasks.find((t) => t.label === 'test');
    assert.ok(build, 'build task should exist');
    assert.ok(test, 'test task should exist');
    assert.strictEqual(build!.startLine, 1);
    assert.strictEqual(test!.startLine, 2);
  });

  // T04: malformed YAML → provider logs error and returns zero tasks (no crash)
  test('getTasks returns empty array when package.yaml has malformed YAML', async () => {
    const file = vscode.Uri.file('/workspace/app/package.yaml');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => 'scripts:\n  build: [\ninvalid yaml: {\n',
    });

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  // T05: package.json files are still parsed correctly via the base JSON path
  test('getTasks still parses package.json files correctly after the fix', async () => {
    const file = vscode.Uri.file('/workspace/app/package.json');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [file];

    (vscode.workspace as any).openTextDocument = async () => ({
      getText: () => JSON.stringify({ name: 'demo', scripts: { lint: 'eslint .' } }),
    });

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'lint');
  });

  // T06: workspace with both package.json and package.yaml → tasks from both files are discovered
  test('getTasks discovers tasks from both package.json and package.yaml independently', async () => {
    const jsonFile = vscode.Uri.file('/workspace/app/package.json');
    const yamlFile = vscode.Uri.file('/workspace/lib/package.yaml');
    const filesService = TaskFilesService.getInstance();

    filesService.findFiles = async () => [jsonFile, yamlFile];

    (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
      if (uri.fsPath.endsWith('.yaml')) {
        return { getText: () => 'scripts:\n  serve: node server.js\n' };
      }
      return { getText: () => JSON.stringify({ scripts: { build: 'tsc' } }) };
    };

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    const build = tasks.find((t) => t.label === 'build');
    const serve = tasks.find((t) => t.label === 'serve');
    assert.ok(build, 'build task from package.json should exist');
    assert.ok(serve, 'serve task from package.yaml should exist');
    assert.strictEqual(build!.taskFileUri?.fsPath, jsonFile.fsPath);
    assert.strictEqual(serve!.taskFileUri?.fsPath, yamlFile.fsPath);
  });
});
