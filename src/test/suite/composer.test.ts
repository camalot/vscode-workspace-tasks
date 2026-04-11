import * as assert from 'assert';
import * as vscode from 'vscode';
import { ComposerTaskProvider } from '../../providers/composerTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('ComposerTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

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
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('uses correct type', () => {
    const provider = new ComposerTaskProvider();
    assert.strictEqual(provider.type, 'composer');
  });

  test('uses correct file pattern', () => {
    const provider = new ComposerTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_COMPOSER);
  });

  test('getCommand returns default composer command', () => {
    const provider = new ComposerTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('composer'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new ComposerTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new ComposerTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new ComposerTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses composer.json scripts', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/composer.json');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses simple scripts', async () => {
      const content = JSON.stringify({
        name: 'vendor/package',
        scripts: {
          test: 'phpunit',
          'cs-fix': 'php-cs-fixer fix .',
          lint: 'phpstan analyse src/',
        },
      });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('cs-fix'), 'Should include "cs-fix"');
      assert.ok(names.includes('lint'), 'Should include "lint"');
      assert.strictEqual(tasks.length, 3);
    });

    test('returns empty when no scripts section', async () => {
      const content = JSON.stringify({ name: 'vendor/package', require: {} });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();

      assert.deepStrictEqual(tasks, []);
    });

    test('sets startLine from content parsing', async () => {
      const content = [
        '{',
        '  "name": "vendor/package",',
        '  "scripts": {',
        '    "test": "phpunit",',
        '    "build": "echo build"',
        '  }',
        '}',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 2);
      const testTask = tasks.find(t => t.label === 'test');
      assert.ok(testTask, 'Should have test task');
      assert.ok(typeof testTask!.startLine === 'number', 'Should have a startLine');
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = JSON.stringify({ scripts: { build: 'echo build' } });
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('handles JSON parse error gracefully', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => '{ invalid json }',
      });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('handles error when reading file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('parses a complete composer.json with multiple scripts', async () => {
      const composerJson = {
        name: 'myapp/backend',
        description: 'My PHP Application',
        require: { 'php': '^8.1', 'laravel/framework': '^10.0' },
        'require-dev': { 'phpunit/phpunit': '^10.0' },
        scripts: {
          'post-autoload-dump': ['Illuminate\\Foundation\\ComposerScripts::postAutoloadDump'],
          test: 'phpunit --coverage-text',
          'test-coverage': 'phpunit --coverage-html coverage/',
          lint: 'phpstan analyse',
          'cs-fix': 'php-cs-fixer fix .',
          serve: 'php artisan serve',
        },
      };
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => JSON.stringify(composerJson),
      });

      const provider = new ComposerTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('post-autoload-dump'), 'Should include post-autoload-dump');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('test-coverage'), 'Should include "test-coverage"');
      assert.ok(names.includes('lint'), 'Should include "lint"');
      assert.ok(names.includes('cs-fix'), 'Should include "cs-fix"');
      assert.ok(names.includes('serve'), 'Should include "serve"');
    });
  });
});
