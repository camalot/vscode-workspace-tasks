import * as assert from 'assert';
import * as vscode from 'vscode';
import { CakeTaskProvider } from '../../providers/cakeTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('CakeTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;

    filesService.findFiles = async () => [];
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') {
        return uri;
      }
      return uri.fsPath;
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  });

  // ── Identity ────────────────────────────────────────────────────────────────

  test('uses correct type', () => {
    const provider = new CakeTaskProvider();
    assert.strictEqual(provider.type, 'cake');
  });

  test('uses correct file pattern glob', () => {
    const provider = new CakeTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_CAKE);
    assert.strictEqual(provider.filePattern, '**/*.cake');
  });

  test('getFilePatterns returns array with cake glob', () => {
    const provider = new CakeTaskProvider();
    const patterns = provider.getFilePatterns();
    assert.deepStrictEqual(patterns, ['**/*.cake']);
  });

  // ── getCommand ───────────────────────────────────────────────────────────────

  test('getCommand returns dotnet as the command', () => {
    const provider = new CakeTaskProvider();
    const result = provider.getCommand();
    assert.strictEqual(result.command, 'dotnet');
  });

  test('getCommand returns cake as the first arg', () => {
    const provider = new CakeTaskProvider();
    const result = provider.getCommand();
    assert.deepStrictEqual(result.args, ['cake']);
  });

  test('getCommand returns a non-empty cwd string', () => {
    const provider = new CakeTaskProvider();
    const result = provider.getCommand();
    assert.ok(typeof result.cwd === 'string');
    assert.ok(result.cwd.length > 0);
  });

  test('getCommand accepts optional workspaceUri and uses its fsPath as cwd', () => {
    const provider = new CakeTaskProvider();
    const uri = vscode.Uri.file('/some/workspace');
    const result = provider.getCommand(uri);
    assert.strictEqual(result.command, 'dotnet');
    assert.deepStrictEqual(result.args, ['cake']);
    assert.strictEqual(result.cwd, '/some/workspace');
  });

  // ── getSystemTasks ───────────────────────────────────────────────────────────

  test('getSystemTasks returns empty array when enabled', async () => {
    const provider = new CakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when disabled', async () => {
    const provider = new CakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── getTasks — disabled / no files ──────────────────────────────────────────

  test('getTasks returns empty when disabled', async () => {
    const provider = new CakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no cake files found', async () => {
    const provider = new CakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── getTasks — task parsing ──────────────────────────────────────────────────

  suite('parses cake files', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/build.cake');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses Task declarations with double quotes', async () => {
      const content = [
        'Task("Clean")',
        '    .Does(() => {});',
        '',
        'Task("Build")',
        '    .IsDependentOn("Clean")',
        '    .Does(() => {});',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('Clean'), 'Should include "Clean"');
      assert.ok(names.includes('Build'), 'Should include "Build"');
      assert.strictEqual(tasks.length, 2);
    });

    test('parses Task declarations with single quotes', async () => {
      const content = [
        "Task('Restore')",
        "    .Does(() => {});",
        "",
        "Task('Test')",
        "    .Does(() => {});",
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('Restore'), 'Should include "Restore"');
      assert.ok(names.includes('Test'), 'Should include "Test"');
    });

    test('parses Task declarations with mixed single and double quotes', async () => {
      const content = [
        'Task("Compile")',
        "Task('Check')",
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('Compile'), 'Should include "Compile"');
      assert.ok(names.includes('Check'), 'Should include "Check"');
    });

    test('parses Task declarations with leading whitespace (indented)', async () => {
      const content = [
        '    Task("IndentedTask")',
        '        .Does(() => {});',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('IndentedTask'), 'Should include "IndentedTask"');
    });

    test('parses Task names with hyphens, underscores and dots', async () => {
      const content = [
        'Task("My-Task")',
        'Task("my_task")',
        'Task("my.task")',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('My-Task'), 'Should include "My-Task"');
      assert.ok(names.includes('my_task'), 'Should include "my_task"');
      assert.ok(names.includes('my.task'), 'Should include "my.task"');
    });

    test('parses Task names with spaces in the name', async () => {
      const content = 'Task("My Cool Task")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'My Cool Task');
    });

    test('parses Task with extra whitespace inside parentheses', async () => {
      const content = 'Task( "Spaced" )';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('Spaced'), 'Should include "Spaced"');
    });

    test('does not match .Does(() => ...) lines as tasks', async () => {
      const content = [
        'Task("Real")',
        '    .Does(() => {',
        '        Information("Not a task");',
        '    });',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'Real');
    });

    test('does not match IsDependentOn references as tasks', async () => {
      const content = [
        'Task("Build")',
        '    .IsDependentOn("Clean")',
        '    .Does(() => {});',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'Build');
    });

    test('returns empty array for empty cake file', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => '' });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns empty array when file has no tasks', async () => {
      const content = [
        '// This is a comment',
        'var target = Argument("target", "Default");',
        'RunTarget(target);',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    // ── Task item properties ────────────────────────────────────────────────

    test('sets taskFileUri on task items', async () => {
      const fileUri = vscode.Uri.file('/test/build.cake');
      const content = 'Task("Setup")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].taskFileUri, 'Should have taskFileUri');
      assert.strictEqual(tasks[0].taskFileUri!.fsPath, fileUri.fsPath);
    });

    test('sets description to relative path of the cake file', async () => {
      const content = 'Task("Package")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].description, 'Should have description');
    });

    test('sets startLine to the correct line index', async () => {
      const content = [
        '// Cake build script',
        'var target = Argument("target", "Default");',
        '',
        'Task("Deploy")',
        '    .Does(() => {});',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 3);
    });

    test('sets startLine to 0 for first-line task', async () => {
      const content = 'Task("First")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 0);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = 'Task("Lint")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
      assert.ok(Array.isArray(tasks[0].onOpenActionCommand!.arguments));
      assert.strictEqual(tasks[0].onOpenActionCommand!.arguments!.length, 2);
      assert.strictEqual(tasks[0].onOpenActionCommand!.arguments![1], 0);
    });

    test('sets task type to cake', async () => {
      const content = 'Task("MyTask")';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].taskType, 'cake');
    });

    test('handles file read error gracefully and returns empty', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('parses a comprehensive build.cake file', async () => {
      const content = [
        'var target = Argument("target", "Default");',
        '',
        'Task("Clean")',
        '    .Does(() => { CleanDirectory("./output"); });',
        '',
        'Task("Restore")',
        '    .IsDependentOn("Clean")',
        '    .Does(() => { DotNetRestore("./src"); });',
        '',
        'Task("Build")',
        '    .IsDependentOn("Restore")',
        '    .Does(() => { DotNetBuild("./src"); });',
        '',
        'Task("Test")',
        '    .IsDependentOn("Build")',
        '    .Does(() => { DotNetTest("./src"); });',
        '',
        'Task("Publish")',
        '    .IsDependentOn("Test")',
        '    .Does(() => { DotNetPublish("./src"); });',
        '',
        'Task("Default")',
        '    .IsDependentOn("Publish");',
        '',
        'RunTarget(target);',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map((t) => t.label);
      assert.ok(names.includes('Clean'), 'Should include "Clean"');
      assert.ok(names.includes('Restore'), 'Should include "Restore"');
      assert.ok(names.includes('Build'), 'Should include "Build"');
      assert.ok(names.includes('Test'), 'Should include "Test"');
      assert.ok(names.includes('Publish'), 'Should include "Publish"');
      assert.ok(names.includes('Default'), 'Should include "Default"');
      assert.strictEqual(tasks.length, 6);
    });
  });
});
