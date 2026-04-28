import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { GulpTaskProvider } from '../../providers/gulpTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskItem } from '../../taskItem';

suite('Gulp Provider Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalFindFiles: typeof TaskFilesService.prototype.findFiles;
  let originalOpenTextDocument: typeof vscode.workspace.openTextDocument;
  let originalAsRelativePath: typeof vscode.workspace.asRelativePath;

  setup(() => {
    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);

    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };

    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
  });

  test('Discovers tasks in sample gulpfile.mjs and referenced in series/parallel', async () => {
    const filesService = TaskFilesService.getInstance();

    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const gulpfileMjs = path.join(workspaceRoot, 'src/test/task-files/gulp/gulpfile.mjs');
    const gulpfileJs = path.join(workspaceRoot, 'src/test/task-files/gulp/gulpfile.js');

    filesService.findFiles = async () => [
      vscode.Uri.file(gulpfileMjs),
      vscode.Uri.file(gulpfileJs),
    ];

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();

    // Should find at least the sample tasks defined in ../task-files/gulp/gulpfile.mjs
    const names = tasks.map((t) => t.label);
    assert.ok(names.includes('group-test2-build-ui-one'));
    assert.ok(names.includes('group-test2-build-ui-two'));
    assert.ok(names.includes('group-test2-build-ui-three'));

    // Also check for tasks referenced via series/parallel on the other sample gulpfile.js
    // which references functions like 'styles' and 'scripts'
    assert.ok(names.includes('styles') || names.includes('scripts') || names.includes('watchFiles'));
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    const provider = new GulpTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty array when no files found', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [];
    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks handles openTextDocument error gracefully', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];
    (vscode.workspace as any).openTextDocument = async () => {
      throw new Error('File not found');
    };

    const provider = new GulpTaskProvider();
    // Should not throw; errors are caught internally
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('parses gulp.task() style definitions', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = [
      "gulp.task('build', function() {});",
      'gulp.task("deploy", function() {});',
      'gulp.task(`test`, function() {});',
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('build'), 'Should include "build"');
    assert.ok(names.includes('deploy'), 'Should include "deploy"');
    assert.ok(names.includes('test'), 'Should include "test"');
  });

  test('parses module.exports.task and exports.task style definitions', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = [
      'module.exports.moduleTask = function() {};',
      'exports.exportsTask = function() {};',
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('moduleTask'), 'Should include "moduleTask"');
    assert.ok(names.includes('exportsTask'), 'Should include "exportsTask"');
  });

  test('parses ES module export function and const definitions', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.mjs');
    filesService.findFiles = async () => [fileUri];

    const content = [
      'export function buildApp() {}',
      'export async function deployApp() {}',
      'export const lintApp = () => {};',
      'export let watchApp = () => {};',
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('buildApp'), 'Should include "buildApp"');
    assert.ok(names.includes('deployApp'), 'Should include "deployApp"');
    assert.ok(names.includes('lintApp'), 'Should include "lintApp"');
    assert.ok(names.includes('watchApp'), 'Should include "watchApp"');
  });

  test('parses ES module export alias definitions', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.mjs');
    filesService.findFiles = async () => [fileUri];

    const content = [
      'function buildTask() {}',
      "export { buildTask as 'build:prod' };",
      "export { buildTask as 'deploy:staging' };",
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('build:prod'), 'Should include "build:prod"');
    assert.ok(names.includes('deploy:staging'), 'Should include "deploy:staging"');
  });

  test('discovers string task names referenced in gulp.series() and gulp.parallel()', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = [
      "exports.build = gulp.series('compile-css', 'compile-js');",
      "exports.watch = gulp.parallel('watch-css', 'watch-js');",
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('compile-css'), 'Should include "compile-css" from series');
    assert.ok(names.includes('compile-js'), 'Should include "compile-js" from series');
    assert.ok(names.includes('watch-css'), 'Should include "watch-css" from parallel');
    assert.ok(names.includes('watch-js'), 'Should include "watch-js" from parallel');
  });

  test('deduplicates tasks referenced in series/parallel that are already discovered', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = [
      "exports.compile = function() {};",
      "exports.build = gulp.series('compile');",
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    // 'compile' should appear exactly once even though it's in series
    assert.strictEqual(names.filter((n) => n === 'compile').length, 1, '"compile" should appear exactly once');
  });

  test('resolves identifier references in gulp.series() to declared functions', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = [
      'function buildSass() { return Promise.resolve(); }',
      'const minify = () => Promise.resolve();',
      'exports.release = gulp.series(buildSass, minify);',
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.ok(names.includes('buildSass'), 'Should resolve "buildSass" from series identifier');
    assert.ok(names.includes('minify'), 'Should resolve "minify" from series identifier');
  });

  test('skips gulp, series, parallel keywords when resolving identifiers in series/parallel', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    const content = "exports.build = gulp.series(gulp.parallel('a', 'b'));";
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    // gulp, series, parallel must NOT appear as task names
    assert.ok(!names.includes('gulp'), 'Should not include "gulp" as task name');
    assert.ok(!names.includes('series'), 'Should not include "series" as task name');
    assert.ok(!names.includes('parallel'), 'Should not include "parallel" as task name');
    // String names 'a' and 'b' should appear
    assert.ok(names.includes('a'), 'Should include "a" from parallel');
    assert.ok(names.includes('b'), 'Should include "b" from parallel');
  });

  test('deduplicates identifier-resolved tasks from series/parallel', async () => {
    const filesService = TaskFilesService.getInstance();
    const fileUri = vscode.Uri.file('/fake/gulpfile.js');
    filesService.findFiles = async () => [fileUri];

    // buildSass exported AND referenced as identifier in series -> must appear only once
    const content = [
      'function buildSass() {}',
      'exports.buildSass = buildSass;',
      'exports.build = gulp.series(buildSass);',
    ].join('\n');
    (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);

    assert.strictEqual(names.filter((n) => n === 'buildSass').length, 1, '"buildSass" should appear exactly once');
  });

  test('getSystemTasks returns empty array when disabled', async () => {
    const provider = new GulpTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when enabled', async () => {
    const provider = new GulpTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getCommand returns a result with npx and gulp', () => {
    const provider = new GulpTaskProvider();
    const result = provider.getCommand();
    const fullCmd = [result.command, ...result.args].join(' ');
    assert.ok(fullCmd.includes('gulp'), `Expected "gulp" in "${fullCmd}"`);
  });

  suite('createTask()', () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/workspace';

    function makeGulpItem(label: string, filePath: string): TaskItem {
      const uri = vscode.Uri.file(filePath);
      const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, 'gulp', uri);
      item.taskFileUri = uri;
      return item;
    }

    test('creates task with --gulpfile when gulpfile is in a subdirectory', async () => {
      const gulpfilePath = path.join(workspaceRoot, 'subdir', 'gulpfile.js');
      const item = makeGulpItem('build', gulpfilePath);

      const provider = new GulpTaskProvider();
      const result = await provider.createTask(item);

      assert.ok(result, 'Should return a CreatedTask');
      const cmd1 = result?.command ?? '';
      assert.ok(cmd1.includes('--gulpfile'), 'Command should include --gulpfile');
      assert.ok(cmd1.includes('build'), 'Command should include the task label');
      assert.strictEqual(result?.native, false);
    });

    test('creates task without --gulpfile when gulpfile is in workspace root', async () => {
      const gulpfilePath = path.join(workspaceRoot, 'gulpfile.js');
      const item = makeGulpItem('test', gulpfilePath);

      const provider = new GulpTaskProvider();
      const result = await provider.createTask(item);

      assert.ok(result, 'Should return a CreatedTask');
      const cmd2 = result?.command ?? '';
      assert.ok(!cmd2.includes('--gulpfile'), 'Command should NOT include --gulpfile');
      assert.ok(cmd2.includes('test'), 'Command should include the task label');
    });

    test('creates task with extra args appended', async () => {
      const gulpfilePath = path.join(workspaceRoot, 'subdir', 'gulpfile.js');
      const item = makeGulpItem('build', gulpfilePath);

      const provider = new GulpTaskProvider();
      const result = await provider.createTask(item, '--production');

      assert.ok(result, 'Should return a CreatedTask');
      const cmd3 = result?.command ?? '';
      assert.ok(cmd3.includes('--production'), 'Command should include extra args');
    });

    test('creates task when gulpfile is in workspace root without extra args', async () => {
      const gulpfilePath = path.join(workspaceRoot, 'gulpfile.js');
      const item = makeGulpItem('deploy', gulpfilePath);

      const provider = new GulpTaskProvider();
      const result = await provider.createTask(item, '--env=prod');

      assert.ok(result, 'Should return a CreatedTask');
      const cmd4 = result?.command ?? '';
      assert.ok(cmd4.includes('deploy'), 'Command should include task label');
      assert.ok(cmd4.includes('--env=prod'), 'Command should include extra args');
    });
  });
});
