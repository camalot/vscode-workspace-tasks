import * as assert from 'assert';
import * as vscode from 'vscode';
import { MakefileTaskProvider } from '../../providers/makefileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('MakefileTaskProvider Test Suite', () => {
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
    const provider = new MakefileTaskProvider();
    assert.strictEqual(provider.type, 'makefile');
  });

  test('uses correct file pattern', () => {
    const provider = new MakefileTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_MAKE);
  });

  test('getCommand returns default make command', () => {
    const provider = new MakefileTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('make'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new MakefileTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new MakefileTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new MakefileTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses Makefile targets', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/Makefile');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses simple targets', async () => {
      const content = `all:\n\techo all\n\nbuild:\n\tgcc main.c -o app\n\ntest:\n\trun_tests\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('all'), 'Should include "all"');
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
    });

    test('ignores .PHONY target', async () => {
      const content = `.PHONY: all build\n\nall:\n\techo all\n\nbuild:\n\tgcc main.c\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('.PHONY'), 'Should not include ".PHONY"');
      assert.ok(names.includes('all'), 'Should include "all"');
      assert.ok(names.includes('build'), 'Should include "build"');
    });

    test('parses targets with hyphens and underscores', async () => {
      const content = `build-all:\n\techo build\n\nrun_tests:\n\techo test\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build-all'), 'Should include "build-all"');
      assert.ok(names.includes('run_tests'), 'Should include "run_tests"');
    });

    test('parses targets with dots', async () => {
      const content = `build.debug:\n\techo debug\n\nbuild.release:\n\techo release\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build.debug'), 'Should include "build.debug"');
      assert.ok(names.includes('build.release'), 'Should include "build.release"');
    });

    test('parses targets with numbers', async () => {
      const content = `stage1:\n\techo stage 1\n\nstage2:\n\techo stage 2\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('stage1'), 'Should include "stage1"');
      assert.ok(names.includes('stage2'), 'Should include "stage2"');
    });

    test('ignores recipe lines (indented with tab)', async () => {
      const content = `build:\n\tgcc main.c\n\t# this is a comment\n\techo done\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'build');
    });

    test('sets startLine correctly', async () => {
      const content = `# header comment\n\nall:\n\techo all\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 2);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = `build:\n\tgcc main.c\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('handles error when reading file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('parses a comprehensive Makefile', async () => {
      const content = [
        '# Makefile for MyProject',
        '.PHONY: all clean build test',
        '',
        'CC=gcc',
        'CFLAGS=-Wall',
        '',
        'all: build',
        '',
        'build: main.c utils.c',
        '\t$(CC) $(CFLAGS) main.c utils.c -o app',
        '',
        'test:',
        '\t./run_tests.sh',
        '',
        'clean:',
        '\trm -rf *.o app',
        '',
        'install: build',
        '\tcp app /usr/local/bin/',
      ].join('\n');

      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('all'), 'Should include "all"');
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('clean'), 'Should include "clean"');
      assert.ok(names.includes('install'), 'Should include "install"');
      assert.ok(!names.includes('.PHONY'), 'Should not include ".PHONY"');
    });
  });
});
