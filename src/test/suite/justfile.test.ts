import * as assert from 'assert';
import * as vscode from 'vscode';
import { JustfileTaskProvider } from '../../providers/justfileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('JustfileTaskProvider Test Suite', () => {
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
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  });

  test('uses correct type', () => {
    const provider = new JustfileTaskProvider();
    assert.strictEqual(provider.type, 'justfile');
  });

  test('uses correct file pattern', () => {
    const provider = new JustfileTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_JUST);
  });

  test('getCommand returns default just command', () => {
    const provider = new JustfileTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('just'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new JustfileTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new JustfileTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new JustfileTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses justfile recipes', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/justfile');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses simple recipe', async () => {
      const content = `build:\n    cargo build\n\ntest:\n    cargo test\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
    });

    test('parses recipe with parameters', async () => {
      const content = `deploy env='production':\n    echo deploying to {{env}}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('deploy'), 'Should include "deploy"');
    });

    test('parses recipe with @ prefix', async () => {
      const content = `@quiet-task:\n    echo quiet\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('quiet-task'), 'Should include "quiet-task"');
    });

    test('ignores comment lines', async () => {
      const content = `# This is a comment\nbuild:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'build');
    });

    test('ignores empty lines', async () => {
      const content = `\n\nbuild:\n    cargo build\n\n\ntest:\n    cargo test\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 2);
    });

    test('ignores assignment lines with :=', async () => {
      const content = `version := "1.0.0"\nbuild:\n    echo {{version}}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('version'), 'Should not include variable assignment');
      assert.ok(names.includes('build'), 'Should include "build"');
    });

    test('ignores reserved keywords: set', async () => {
      const content = `set shell := ["bash", "-c"]\nbuild:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('set'), 'Should not include "set" keyword');
      assert.ok(names.includes('build'), 'Should include "build"');
    });

    test('ignores reserved keywords: alias', async () => {
      const content = `alias b := build\nbuild:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('alias'), 'Should not include "alias" keyword');
      assert.ok(names.includes('build'), 'Should include "build"');
    });

    test('ignores reserved keywords: mod, import, export', async () => {
      const content = `mod submodule\nimport 'helpers.just'\nexport PATH\nbuild:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('mod'), 'Should not include "mod"');
      assert.ok(!names.includes('import'), 'Should not include "import"');
      assert.ok(!names.includes('export'), 'Should not include "export"');
      assert.ok(names.includes('build'), 'Should include "build"');
    });

    test('sets startLine correctly', async () => {
      const content = `# comment\nbuild:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 1);
    });

    test('handles error when parsing file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new JustfileTaskProvider();
      // Should not throw, just return empty
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = `build:\n    cargo build\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('parses recipe with hyphens and underscores in name', async () => {
      const content = `my-task:\n    echo hello\nmy_task_two:\n    echo world\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('my-task'), 'Should include "my-task"');
      assert.ok(names.includes('my_task_two'), 'Should include "my_task_two"');
    });

    test('parses multiple recipes from a complex justfile', async () => {
      const content = [
        '# Project justfile',
        '',
        'set shell := ["bash", "-c"]',
        '',
        'version := "1.0.0"',
        '',
        'build: test',
        '    cargo build --release',
        '',
        'test:',
        '    cargo test',
        '',
        'clean:',
        '    rm -rf target/',
        '',
        '@quiet:',
        '    echo quiet mode',
        '',
        'alias b := build',
      ].join('\n');

      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('clean'), 'Should include "clean"');
      assert.ok(names.includes('quiet'), 'Should include "quiet"');
      assert.ok(!names.includes('version'), 'Should not include variable');
      assert.ok(!names.includes('set'), 'Should not include "set"');
      assert.ok(!names.includes('alias'), 'Should not include "alias"');
    });
  });
});
