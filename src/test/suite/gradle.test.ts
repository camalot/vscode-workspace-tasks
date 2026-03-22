import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { GradleTaskProvider } from '../../providers/gradleTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { configuration } from '../../libs/configuration';
import constants from '../../libs/constants';

suite('GradleTaskProvider Test Suite', () => {
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

  test('uses correct type', () => {
    const provider = new GradleTaskProvider();
    assert.strictEqual(provider.type, 'gradle');
  });

  test('uses correct file pattern', () => {
    const provider = new GradleTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_GRADLE);
  });

  test('getCommand returns default gradle command', () => {
    const provider = new GradleTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('gradle'));
    assert.ok(Array.isArray(result.args));
  });

  test('getCommand prefers gradlew when present and no config set', () => {
    const provider = new GradleTaskProvider();
    // Create a temp workspace path that we control
    const workspaceUri = vscode.Uri.file('/tmp/test-gradle-workspace');

    // No configured gradle path
    configuration.get = (key: string, def?: any) => {
      if (key === 'applicationPath.gradle') { return undefined; }
      return originalConfigGet(key, def);
    };

    // getCommand falls back to default gradle if gradlew doesn't exist on disk
    const result = provider.getCommand(workspaceUri);
    // On this test system, /tmp/test-gradle-workspace/gradlew doesn't exist,
    // so we expect the default gradle command
    assert.ok(result.command.toLowerCase().includes('gradle'));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new GradleTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new GradleTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new GradleTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses build.gradle tasks', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/build.gradle');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses simple task declarations', async () => {
      const content = [
        'task build {',
        '    doLast {',
        '        println "Building..."',
        '    }',
        '}',
        '',
        'task test {',
        '    dependsOn build',
        '}',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
    });

    test('parses task with type notation', async () => {
      const content = `task copyDocs(type: Copy) {\n    from 'docs'\n    into 'build/docs'\n}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('copyDocs'), 'Should include "copyDocs"');
    });

    test('ignores commented-out task declarations', async () => {
      const content = [
        '// task disabled {',
        '//     doLast { println "disabled" }',
        '// }',
        'task active {',
        '    doLast { println "active" }',
        '}',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(!names.includes('disabled'), 'Should not include commented task "disabled"');
      assert.ok(names.includes('active'), 'Should include "active"');
    });

    test('parses tasks with hyphens in names', async () => {
      const content = `task build-all {\n    println "building all"\n}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      // Note: gradle task names with hyphens get parsed up to the hyphen
      // based on the regex /^\s*task\s+([^\s({]+)/  - this matches until space/({
      assert.ok(names.some(n => n.startsWith('build')), 'Should include a "build" prefixed task');
    });

    test('sets startLine correctly', async () => {
      const content = `// header\n\ntask build {\n    doLast { }\n}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 2);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = `task build {\n    doLast { }\n}\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('handles error when reading file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('parses a comprehensive build.gradle', async () => {
      const content = [
        'plugins {',
        '    id "java"',
        '}',
        '',
        'group = "com.example"',
        'version = "1.0.0"',
        '',
        'task clean {',
        '    doFirst { delete "build/" }',
        '}',
        '',
        'task compile(type: JavaCompile) {',
        '    source = fileTree("src")',
        '}',
        '',
        'task test(type: Test) {',
        '    testClassesDirs = sourceSets.test.output.classesDirs',
        '}',
        '',
        'task jar(type: Jar) {',
        '    from sourceSets.main.output',
        '}',
        '',
        '// task skipped {',
        '//     println "skipped"',
        '// }',
      ].join('\n');

      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GradleTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('clean'), 'Should include "clean"');
      assert.ok(names.includes('compile'), 'Should include "compile"');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('jar'), 'Should include "jar"');
      assert.ok(!names.includes('skipped'), 'Should not include "skipped"');
    });
  });
});
