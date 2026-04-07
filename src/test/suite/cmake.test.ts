import * as assert from 'assert';
import * as vscode from 'vscode';
import { CMakeTaskProvider } from '../../providers/cmakeTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { configuration } from '../../libs/configuration';
import constants from '../../libs/constants';

suite('CMakeTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalConfigGet: typeof configuration.get;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;
    originalConfigGet = configuration.get.bind(configuration);

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
    configuration.get = originalConfigGet;
  });

  // ── Identity ────────────────────────────────────────────────────────────────

  test('uses correct type', () => {
    const provider = new CMakeTaskProvider();
    assert.strictEqual(provider.type, 'cmake');
  });

  test('uses correct file pattern', () => {
    const provider = new CMakeTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_CMAKE);
  });

  // ── getCommand ───────────────────────────────────────────────────────────────

  test('getCommand returns command containing cmake', () => {
    const provider = new CMakeTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('cmake'));
    assert.ok(Array.isArray(result.args));
  });

  test('getCommand accepts optional workspaceUri', () => {
    const provider = new CMakeTaskProvider();
    const uri = vscode.Uri.file('/some/workspace');
    const result = provider.getCommand(uri);
    assert.ok(result.command.toLowerCase().includes('cmake'));
  });

  // ── Configuration getters ────────────────────────────────────────────────────

  test('getBuildDirectory returns default build', () => {
    const provider = new CMakeTaskProvider();
    const dir = provider.getBuildDirectory();
    assert.strictEqual(dir, 'build');
  });

  test('getBuildType returns default Debug', () => {
    const provider = new CMakeTaskProvider();
    const type = provider.getBuildType();
    assert.strictEqual(type, 'Debug');
  });

  test('getBuildType returns configured value', () => {
    configuration.get = (key: string, def?: any) => {
      if (key === 'cmake.buildType') { return 'Release'; }
      return originalConfigGet(key, def);
    };
    const provider = new CMakeTaskProvider();
    assert.strictEqual(provider.getBuildType(), 'Release');
  });

  test('getGenerator returns empty string by default', () => {
    const provider = new CMakeTaskProvider();
    const gen = provider.getGenerator();
    assert.strictEqual(gen, '');
  });

  // ── createTaskForItem — cmake args ───────────────────────────────────────────

  test('createTaskForItem passes --config <buildType> for cmake tasks', async () => {
    // Import lazily to avoid circular-dependency issues at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createTaskForItem } = require('../../taskFactory');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TaskItem } = require('../../taskItem');

    configuration.get = (key: string, def?: any) => {
      if (key === 'cmake.buildType') { return 'Release'; }
      if (key === 'cmake.buildDirectory') { return 'build'; }
      return originalConfigGet(key, def);
    };

    const fileUri = vscode.Uri.file('/project/CMakeLists.txt');
    const item = new TaskItem('myTarget', vscode.TreeItemCollapsibleState.None, 'cmake');
    item.originalLabel = 'myTarget';
    item.taskType = 'cmake';
    item.taskFileUri = fileUri;
    // Omit item.task and item.taskSource so createTaskForItem reaches the cmake switch arm.

    const result = await createTaskForItem(item);
    assert.ok(result, 'Expected a CreatedTask result');

    const exec = result.task.execution as vscode.ShellExecution;
    const args: string[] = exec.args as string[];
    const configIdx = args.indexOf('--config');
    assert.ok(configIdx !== -1, '--config flag should be present in cmake args');
    assert.strictEqual(args[configIdx + 1], 'Release', '--config should be followed by the configured build type');
  });

  test('createTaskForItem uses Debug as default --config for cmake tasks', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createTaskForItem } = require('../../taskFactory');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TaskItem } = require('../../taskItem');

    const fileUri = vscode.Uri.file('/project/CMakeLists.txt');
    const item = new TaskItem('myTarget', vscode.TreeItemCollapsibleState.None, 'cmake');
    item.originalLabel = 'myTarget';
    item.taskType = 'cmake';
    item.taskFileUri = fileUri;

    const result = await createTaskForItem(item);
    assert.ok(result, 'Expected a CreatedTask result');

    const exec = result.task.execution as vscode.ShellExecution;
    const args: string[] = exec.args as string[];
    const configIdx = args.indexOf('--config');
    assert.ok(configIdx !== -1, '--config flag should be present in cmake args');
    assert.strictEqual(args[configIdx + 1], 'Debug', '--config should default to Debug');
  });



  test('getSystemTasks returns empty array when enabled', async () => {
    const provider = new CMakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when disabled', async () => {
    const provider = new CMakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── getTasks — disabled / no files ──────────────────────────────────────────

  test('getTasks returns empty when disabled', async () => {
    const provider = new CMakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no CMakeLists.txt files found', async () => {
    const provider = new CMakeTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── getTasks — target parsing ────────────────────────────────────────────────

  suite('parses CMakeLists.txt targets', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/CMakeLists.txt');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses add_custom_target declarations', async () => {
      const content = [
        'cmake_minimum_required(VERSION 3.16)',
        'project(Test)',
        'add_custom_target(run COMMAND ./app)',
        'add_custom_target(clean_all COMMAND rm -rf build)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('run'), 'Should include "run"');
      assert.ok(names.includes('clean_all'), 'Should include "clean_all"');
    });

    test('parses add_executable declarations', async () => {
      const content = [
        'cmake_minimum_required(VERSION 3.16)',
        'project(Test)',
        'add_executable(myapp src/main.cpp)',
        'add_executable(helper src/helper.cpp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('myapp'), 'Should include "myapp"');
      assert.ok(names.includes('helper'), 'Should include "helper"');
    });

    test('parses mixed add_custom_target and add_executable', async () => {
      const content = [
        'add_executable(hello_world src/main.cpp)',
        'add_custom_target(run COMMAND hello_world)',
        'add_custom_target(format COMMAND clang-format)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('hello_world'), 'Should include "hello_world"');
      assert.ok(names.includes('run'), 'Should include "run"');
      assert.ok(names.includes('format'), 'Should include "format"');
      assert.strictEqual(tasks.length, 3);
    });

    test('does not parse add_library declarations', async () => {
      const content = [
        'add_library(mylib src/lib.cpp)',
        'add_executable(myapp src/main.cpp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('mylib'), 'Should not include "mylib"');
      assert.ok(names.includes('myapp'), 'Should include "myapp"');
    });

    test('does not parse add_test declarations', async () => {
      const content = [
        'add_executable(myapp src/main.cpp)',
        'add_test(NAME test_suite COMMAND myapp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('test_suite'), 'Should not include "test_suite"');
      assert.ok(names.includes('myapp'), 'Should include "myapp"');
    });

    test('strips inline # comments before parsing', async () => {
      const content = [
        'add_custom_target(real_target COMMAND echo hi) # this is kept',
        '# add_custom_target(commented_out COMMAND echo no)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('real_target'), 'Should include "real_target"');
      assert.ok(!names.includes('commented_out'), 'Should not include "commented_out"');
    });

    test('ignores fully commented-out lines', async () => {
      const content = [
        '# add_custom_target(ignored COMMAND echo no)',
        '# add_executable(also_ignored main.cpp)',
        'add_executable(visible src/main.cpp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('ignored'), 'Should not include "ignored"');
      assert.ok(!names.includes('also_ignored'), 'Should not include "also_ignored"');
      assert.ok(names.includes('visible'), 'Should include "visible"');
    });

    test('is case-insensitive for cmake keywords', async () => {
      const content = [
        'ADD_CUSTOM_TARGET(upper_target COMMAND echo upper)',
        'Add_Executable(MixedCase src/main.cpp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('upper_target'), 'Should include "upper_target"');
      assert.ok(names.includes('MixedCase'), 'Should include "MixedCase"');
    });

    test('parses target names with hyphens, underscores and dots', async () => {
      const content = [
        'add_custom_target(my-target COMMAND echo hi)',
        'add_custom_target(my_target COMMAND echo hi)',
        'add_custom_target(my.target COMMAND echo hi)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('my-target'), 'Should include "my-target"');
      assert.ok(names.includes('my_target'), 'Should include "my_target"');
      assert.ok(names.includes('my.target'), 'Should include "my.target"');
    });

    test('parses target names with numbers', async () => {
      const content = [
        'add_custom_target(stage1 COMMAND echo stage1)',
        'add_executable(app2 src/main.cpp)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('stage1'), 'Should include "stage1"');
      assert.ok(names.includes('app2'), 'Should include "app2"');
    });

    test('sets taskFileUri on task items', async () => {
      const fileUri = vscode.Uri.file('/test/CMakeLists.txt');
      const content = 'add_custom_target(build COMMAND cmake --build .)';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].taskFileUri, 'Should have taskFileUri');
      assert.strictEqual(tasks[0].taskFileUri!.fsPath, fileUri.fsPath);
    });

    test('sets description to relative path', async () => {
      const content = 'add_custom_target(build COMMAND cmake --build .)';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].description, 'Should have description');
    });

    test('sets startLine to the correct line index', async () => {
      const content = [
        '# first line',
        '',
        'cmake_minimum_required(VERSION 3.16)',
        'add_custom_target(mytarget COMMAND echo hi)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 3);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = 'add_custom_target(build COMMAND cmake --build .)';
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
      assert.ok(Array.isArray(tasks[0].onOpenActionCommand!.arguments));
      assert.strictEqual(tasks[0].onOpenActionCommand!.arguments!.length, 2);
    });

    test('handles error when reading file gracefully', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns empty for empty CMakeLists.txt', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => '' });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('parses a comprehensive CMakeLists.txt', async () => {
      const content = [
        'cmake_minimum_required(VERSION 3.16)',
        'project(HelloWorld)',
        '',
        '# Source files',
        'add_executable(hello_world src/hello.cpp)',
        'add_executable(greeter src/greeter.cpp)',
        '',
        '# Custom targets',
        'add_custom_target(run_hello',
        '  COMMAND hello_world',
        '  DEPENDS hello_world',
        '  COMMENT "Running hello_world"',
        ')',
        '',
        'add_custom_target(run_greeter',
        '  COMMAND greeter World',
        '  DEPENDS greeter',
        ')',
        '',
        'add_custom_target(clean_all',
        '  COMMAND ${CMAKE_COMMAND} -E remove_directory ${CMAKE_BINARY_DIR}',
        ')',
        '',
        'add_custom_target(format',
        '  COMMAND clang-format -i src/*.cpp',
        ')',
        '',
        'add_custom_target(lint',
        '  COMMAND clang-tidy src/*.cpp',
        ')',
        '',
        '# Libraries — should not be parsed',
        'add_library(mylib STATIC src/lib.cpp)',
        '',
        '# Tests — should not be parsed',
        'add_test(NAME hello_test COMMAND hello_world)',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new CMakeTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('hello_world'), 'Should include "hello_world"');
      assert.ok(names.includes('greeter'), 'Should include "greeter"');
      assert.ok(names.includes('run_hello'), 'Should include "run_hello"');
      assert.ok(names.includes('run_greeter'), 'Should include "run_greeter"');
      assert.ok(names.includes('clean_all'), 'Should include "clean_all"');
      assert.ok(names.includes('format'), 'Should include "format"');
      assert.ok(names.includes('lint'), 'Should include "lint"');
      assert.ok(!names.includes('mylib'), 'Should not include "mylib"');
      assert.ok(!names.includes('hello_test'), 'Should not include "hello_test"');
      assert.strictEqual(tasks.length, 7);
    });
  });
});
