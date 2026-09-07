import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { MakefileTaskProvider } from '../../providers/makefileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskItem } from '../../taskItem';
import constants from '../../libs/constants';

suite('MakefileTaskProvider Test Suite', () => {
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

  suite('include directives', () => {
    let originalFs: typeof vscode.workspace.fs;

    const setFiles = (files: Record<string, string>) => {
      (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
        const content = files[uri.fsPath];
        if (content === undefined) {
          throw new Error(`File not found: ${uri.fsPath}`);
        }
        return { getText: () => content };
      };
      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (files[uri.fsPath] === undefined) {
            throw new Error('File not found');
          }
          return { type: 1, ctime: 0, mtime: 0, size: 0 } as vscode.FileStat;
        },
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });
    };

    setup(() => {
      originalFs = vscode.workspace.fs;
    });

    teardown(() => {
      Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, writable: true, configurable: true });
    });

    test('surfaces targets from included makefiles under the including makefile', async () => {
      const root = vscode.Uri.file('/test/Makefile');
      const included = vscode.Uri.file('/test/makefiles/windows.mk');
      TaskFilesService.getInstance().findFiles = async () => [root];
      setFiles({
        [root.fsPath]: 'include ./makefiles/windows.mk\n\nall:\n\techo all\n',
        [included.fsPath]: 'build-windows:\n\techo windows\n',
      });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      const buildWindows = tasks.find(t => t.label === 'build-windows');
      assert.ok(buildWindows, 'Should include target from included makefile');
      assert.strictEqual(buildWindows!.taskFileUri!.fsPath, included.fsPath);
      assert.strictEqual(buildWindows!.startLine, 0);
      assert.strictEqual(buildWindows!.metadata.makefileRoot, root.fsPath);
    });

    test('resolves transitive includes and skips cycles', async () => {
      const root = vscode.Uri.file('/test/Makefile');
      const first = vscode.Uri.file('/test/first.mk');
      const second = vscode.Uri.file('/test/second.mk');
      TaskFilesService.getInstance().findFiles = async () => [root];
      setFiles({
        [root.fsPath]: 'include first.mk\n',
        [first.fsPath]: 'include second.mk\nfirst-target:\n\techo first\n',
        [second.fsPath]: 'include Makefile\nsecond-target:\n\techo second\n',
      });

      const provider = new MakefileTaskProvider();
      const names = (await provider.getTasks()).map(t => t.label);

      assert.ok(names.includes('first-target'));
      assert.ok(names.includes('second-target'));
    });

    test('does not list an included makefile as its own root', async () => {
      const root = vscode.Uri.file('/test/Makefile');
      const included = vscode.Uri.file('/test/included.mk');
      TaskFilesService.getInstance().findFiles = async () => [root, included];
      setFiles({
        [root.fsPath]: '-include included.mk\n',
        [included.fsPath]: 'shared:\n\techo shared\n',
      });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.filter(t => t.label === 'shared').length, 1);
      assert.strictEqual(tasks[0].metadata.makefileRoot, root.fsPath);
    });

    test('ignores includes that are missing, globbed, variable based or inside recipes', async () => {
      const root = vscode.Uri.file('/test/Makefile');
      TaskFilesService.getInstance().findFiles = async () => [root];
      setFiles({
        [root.fsPath]: [
          'include missing.mk',
          'include $(DIR)/generated.mk',
          'include makefiles/*.mk',
          'include real.mk # trailing comment',
          'all:',
          '\tinclude nope.mk',
        ].join('\n'),
      });

      const provider = new MakefileTaskProvider();
      const tasks = await provider.getTasks();

      assert.deepStrictEqual(tasks.map(t => t.label), ['all']);
    });

    test('createTask runs included targets from the including makefile directory', async () => {
      const provider = new MakefileTaskProvider();
      const item = new TaskItem('build-windows', vscode.TreeItemCollapsibleState.None, 'makefile');
      item.taskFileUri = vscode.Uri.file('/test/makefiles/windows.mk');
      item.metadata = { makefileRoot: '/test/Makefile' };

      const created = await provider.createTask(item);

      assert.ok(created);
      assert.strictEqual(created!.cwd, path.dirname('/test/Makefile'));
      assert.ok(created!.command!.endsWith('build-windows'));
      assert.ok(!created!.command!.includes('-f'), 'Default makefile name should not need -f');
    });

    test('createTask passes -f for non-default makefile names', async () => {
      const provider = new MakefileTaskProvider();
      const item = new TaskItem('dev', vscode.TreeItemCollapsibleState.None, 'makefile');
      item.taskFileUri = vscode.Uri.file('/test/makefile.project.mk');

      const created = await provider.createTask(item);

      assert.ok(created);
      assert.ok(created!.command!.includes('-f makefile.project.mk'));
    });
  });
});
