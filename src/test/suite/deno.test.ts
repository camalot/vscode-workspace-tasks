import * as assert from 'assert';
import * as vscode from 'vscode';
import { DenoTaskProvider } from '../../providers/denoTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('DenoTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalShouldIgnore: any;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalShouldIgnore = filesService.shouldIgnore.bind(filesService);
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;

    filesService.findFiles = async () => [];
    filesService.shouldIgnore = () => false;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    filesService.shouldIgnore = originalShouldIgnore;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  });

  test('uses correct type', () => {
    const provider = new DenoTaskProvider();
    assert.strictEqual(provider.type, 'deno');
  });

  test('uses correct file pattern', () => {
    const provider = new DenoTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_DENO);
  });

  test('getCommand returns default deno command', () => {
    const provider = new DenoTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('deno'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new DenoTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new DenoTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new DenoTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses deno.json tasks', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/deno.json');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses simple deno.json tasks', async () => {
      const content = JSON.stringify({
        tasks: {
          start: 'deno run --allow-net mod.ts',
          test: 'deno test --allow-net tests/',
          build: 'deno build mod.ts',
        },
      });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('start'), 'Should include "start"');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.strictEqual(tasks.length, 3);
    });

    test('returns empty when deno.json has no tasks section', async () => {
      const content = JSON.stringify({ compilerOptions: { target: 'es2022' } });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();

      assert.deepStrictEqual(tasks, []);
    });

    test('sets startLine from content parsing', async () => {
      const content = [
        '{',
        '  "tasks": {',
        '    "start": "deno run mod.ts",',
        '    "test": "deno test"',
        '  }',
        '}',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 2);
      const startTask = tasks.find(t => t.label === 'start');
      assert.ok(startTask, 'Should have start task');
      assert.ok(typeof startTask!.startLine === 'number', 'Should have a startLine');
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = JSON.stringify({ tasks: { build: 'deno build' } });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('handles parse error gracefully', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => '{ invalid json }',
      });

      const provider = new DenoTaskProvider();
      // Should not throw; JSON.parse error is caught
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('skips ignored files', async () => {
      const filesService = TaskFilesService.getInstance();
      filesService.shouldIgnore = () => true;

      const content = JSON.stringify({ tasks: { build: 'deno build' } });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('handles deno.jsonc format (with comments stripped by JSON.parse)', async () => {
      // deno.jsonc is just accessed as text; the JSON.parse may fail for real JSONC
      // but we test a valid JSON string to ensure the path is exercised
      const content = JSON.stringify({
        tasks: {
          fmt: 'deno fmt',
          lint: 'deno lint',
        },
      });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new DenoTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('fmt'), 'Should include "fmt"');
      assert.ok(names.includes('lint'), 'Should include "lint"');
    });
  });
});
