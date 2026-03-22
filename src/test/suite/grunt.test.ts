import * as assert from 'assert';
import * as vscode from 'vscode';
import { GruntTaskProvider } from '../../providers/gruntTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('GruntTaskProvider Test Suite', () => {
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
    const provider = new GruntTaskProvider();
    assert.strictEqual(provider.type, 'grunt');
  });

  test('uses correct file pattern', () => {
    const provider = new GruntTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_GRUNT);
  });

  test('getCommand returns default grunt command', () => {
    const provider = new GruntTaskProvider();
    const result = provider.getCommand();
    // Default is "npx grunt" which gets parsed into command="npx" args=["grunt"]
    // So check that either the command or args contains "grunt"
    const fullCommand = [result.command, ...result.args].join(' ').toLowerCase();
    assert.ok(fullCommand.includes('grunt'), `Expected "grunt" in "${fullCommand}"`);
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new GruntTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new GruntTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new GruntTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parses Gruntfile.js tasks', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const fileUri = vscode.Uri.file('/test/Gruntfile.js');
      filesService.findFiles = async () => [fileUri];
    });

    test('parses grunt.registerTask calls', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.registerTask("default", ["jshint", "concat", "uglify"]);',
        '  grunt.registerTask("build", ["concat", "uglify"]);',
        '  grunt.registerTask("test", ["jshint", "qunit"]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('default'), 'Should include "default"');
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
    });

    test('parses grunt.registerMultiTask calls', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.registerMultiTask("uglify", "Minify files", function() {',
        '    // implementation',
        '  });',
        '  grunt.registerMultiTask("concat", "Concatenate files", function() {',
        '    // implementation',
        '  });',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('uglify'), 'Should include "uglify"');
      assert.ok(names.includes('concat'), 'Should include "concat"');
    });

    test('parses task names with colons and dots', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.registerTask("deploy:prod", ["build", "upload"]);',
        '  grunt.registerTask("assets.compile", ["less", "uglify"]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('deploy:prod'), 'Should include "deploy:prod"');
      assert.ok(names.includes('assets.compile'), 'Should include "assets.compile"');
    });

    test('parses task names with hyphens and underscores', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.registerTask("build-all", ["concat", "minify"]);',
        '  grunt.registerTask("run_tests", ["mocha"]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build-all'), 'Should include "build-all"');
      assert.ok(names.includes('run_tests'), 'Should include "run_tests"');
    });

    test('handles single-quoted task names', async () => {
      const content = [
        'module.exports = function(grunt) {',
        "  grunt.registerTask('build', ['concat']);",
        "  grunt.registerTask('test', ['mocha']);",
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build" (single quotes)');
      assert.ok(names.includes('test'), 'Should include "test" (single quotes)');
    });

    test('handles backtick-quoted task names', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.registerTask(`build`, [`concat`]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build" (backtick quotes)');
    });

    test('sets startLine correctly', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  // setup',
        '  grunt.registerTask("build", ["concat"]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 2);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const content = `module.exports = function(grunt) {\n  grunt.registerTask("build", []);\n};\n`;
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('handles error when reading file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('ignores non-task lines', async () => {
      const content = [
        'module.exports = function(grunt) {',
        '  grunt.loadNpmTasks("grunt-contrib-uglify");',
        '  grunt.loadNpmTasks("grunt-contrib-jshint");',
        '  grunt.initConfig({',
        '    uglify: { options: {} }',
        '  });',
        '  grunt.registerTask("default", ["jshint", "uglify"]);',
        '};',
      ].join('\n');
      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].label, 'default');
    });

    test('parses a full Gruntfile.js', async () => {
      const content = [
        '"use strict";',
        'module.exports = function(grunt) {',
        '  grunt.initConfig({',
        '    pkg: grunt.file.readJSON("package.json"),',
        '    uglify: {',
        '      options: { banner: "/*! <%= pkg.name %> */" },',
        '      build: { src: "src/*.js", dest: "dist/built.min.js" }',
        '    },',
        '    jshint: {',
        '      files: ["Gruntfile.js", "src/**/*.js", "test/**/*.js"]',
        '    },',
        '    watch: {',
        '      files: ["src/**/*.js"],',
        '      tasks: ["jshint"]',
        '    }',
        '  });',
        '',
        '  grunt.loadNpmTasks("grunt-contrib-uglify");',
        '  grunt.loadNpmTasks("grunt-contrib-jshint");',
        '  grunt.loadNpmTasks("grunt-contrib-watch");',
        '',
        '  grunt.registerMultiTask("compile", "Compile sources", function() {});',
        '  grunt.registerTask("test", ["jshint"]);',
        '  grunt.registerTask("build", ["jshint", "uglify"]);',
        '  grunt.registerTask("default", ["jshint", "uglify"]);',
        '};',
      ].join('\n');

      (vscode.workspace as any).openTextDocument = async () => ({ getText: () => content });

      const provider = new GruntTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('compile'), 'Should include "compile"');
      assert.ok(names.includes('test'), 'Should include "test"');
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('default'), 'Should include "default"');
    });
  });
});
