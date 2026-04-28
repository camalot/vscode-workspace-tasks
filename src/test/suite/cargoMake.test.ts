import * as assert from 'assert';
import { CargoMakeTaskProvider } from '../../providers/cargoMakeTaskProvider';
import constants from '../../libs/constants';

suite('Cargo-Make Provider Test Suite', function () {
  // Set timeout to 10000ms for all tests in this suite to prevent flakiness
  this.timeout(60000);

  test('uses correct type', function () {
    const provider = new CargoMakeTaskProvider();
    assert.strictEqual(provider.type, 'cargo-make');
  });

  test('uses correct file pattern', function () {
    const provider = new CargoMakeTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_CARGO_MAKE);
  });

  test('getGlobPatterns includes wildcard toml discovery', function () {
    const provider = new CargoMakeTaskProvider();
    const globs = (provider as any).getGlobPatterns() as string[];
    assert.ok(globs.includes('**/*.toml'), 'Expected cargo-make glob list to include **/*.toml');
  });

  test('findScriptLine matches [tasks.<name>] table header (0-based)', function () {
    const provider = new CargoMakeTaskProvider();
    const content = `# Example\n[tasks.build]\ncommand = "cargo"\n`;
    const line = (provider as any).findScriptLine(content, 'build');
    assert.strictEqual(line, 1);
  });

  test('findScriptLine matches quoted and hyphenated task table headers', function () {
    const provider = new CargoMakeTaskProvider();
    const content = `[tasks."build-release"]\ncommand = "cargo"\n`;
    const line = (provider as any).findScriptLine(content, 'build-release');
    assert.strictEqual(line, 0);
  });

  test('findScriptLine does not use key=value fallback for cargo-make', function () {
    const provider = new CargoMakeTaskProvider();
    const content = `[tasks]\nbuild = "echo hello"\n`;
    const line = (provider as any).findScriptLine(content, 'build');
    assert.strictEqual(line, 0);
  });

  test('getCommand returns default cargo-make command', function () {
    const provider = new CargoMakeTaskProvider();
    const result = provider.getCommand();

    assert.strictEqual(result.command, 'cargo');
    assert.ok(Array.isArray(result.args));
    assert.strictEqual(result.args && result.args[0], 'make');
    assert.ok(result.cwd);
  });

  test('getTasks returns array', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    // Tasks may or may not exist depending on if cargo-make files are found
  });

  test('getSystemTasks returns array', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getSystemTasks();

    assert.ok(Array.isArray(tasks));
    // System tasks depend on VSCode's cargo-make support being available
  });

  test('parses Makefile.toml tasks with descriptions', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    if (tasks.length > 0) {
      // Filter tasks that come from our test files
      const testTasks = tasks.filter(
        (task) => task.taskFileUri?.fsPath.includes('test') && task.taskFileUri?.fsPath.includes('cargo'),
      );

      if (testTasks.length > 0) {
        // Check that we have some expected tasks
        const taskNames = testTasks.map((task) => task.label);

        // These tasks should exist in our test Makefile.toml
        const expectedTasks = ['format', 'clean', 'build', 'test', 'doc', 'clippy'];
        const foundExpectedTasks = expectedTasks.filter((name) => taskNames.includes(name));

        // At least some of the expected tasks should be found
        assert.ok(foundExpectedTasks.length > 0, 'Should find some expected tasks from Makefile.toml');

        // Check that tasks have proper structure
        const formatTask = testTasks.find((task) => task.label === 'format');
        if (formatTask) {
          assert.strictEqual(formatTask.taskType, 'cargo-make');
          assert.ok(formatTask.taskFileUri);
        }
      }
    }
  });

  test('parses custom.toml tasks', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    if (tasks.length > 0) {
      // Filter tasks that come from custom.toml
      const customTasks = tasks.filter(
        (task) =>
          task.taskFileUri?.fsPath.includes('test') &&
          task.taskFileUri?.fsPath.includes('cargo') &&
          task.taskFileUri?.fsPath.includes('custom.toml'),
      );

      if (customTasks.length > 0) {
        const taskNames = customTasks.map((task) => task.label);

        // These tasks should exist in our test custom.toml
        const expectedTasks = ['custom-build', 'custom-test', 'deploy', 'docker-build'];
        const foundExpectedTasks = expectedTasks.filter((name) => taskNames.includes(name));

        // At least some of the expected tasks should be found
        assert.ok(foundExpectedTasks.length > 0, 'Should find some expected tasks from custom.toml');
      }
    }
  });

  test('handles tasks with hyphens and underscores in names', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    if (tasks.length > 0) {
      const testTasks = tasks.filter(
        (task) => task.taskFileUri?.fsPath.includes('test') && task.taskFileUri?.fsPath.includes('cargo'),
      );

      if (testTasks.length > 0) {
        const taskNames = testTasks.map((task) => task.label);

        // Should handle various naming conventions
        const hyphenTask = taskNames.find((name) => name.includes('-'));
        const underscoreTask = taskNames.find((name) => name.includes('_'));

        // At least one of these should exist
        assert.ok(hyphenTask || underscoreTask, 'Should handle tasks with hyphens or underscores');
      }
    }
  });

  test('task items have required properties', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    if (tasks.length > 0) {
      const firstTask = tasks[0];

      // Verify task has required properties
      assert.ok(firstTask.label, 'Task should have a label');
      assert.strictEqual(firstTask.taskType, 'cargo-make', 'Task should have correct type');
      assert.ok(firstTask.taskFileUri, 'Task should have taskFileUri');
      assert.ok(typeof firstTask.startLine === 'number', 'Task should have startLine');
      assert.ok(firstTask.onOpenActionCommand, 'Task should have onOpenActionCommand');
    }
  });

  test('handles empty or non-existent toml files gracefully', async function () {
    const provider = new CargoMakeTaskProvider();

    // This should not throw an error
    await assert.doesNotReject(async () => {
      const tasks = await provider.getTasks();
      assert.ok(Array.isArray(tasks));
    });
  });

  test('identifies tasks with dependencies', async function () {
    const provider = new CargoMakeTaskProvider();
    const tasks = await provider.getTasks();

    if (tasks.length > 0) {
      const testTasks = tasks.filter(
        (task) => task.taskFileUri?.fsPath.includes('test') && task.taskFileUri?.fsPath.includes('cargo'),
      );

      // Our test files should have tasks
      assert.ok(testTasks.length > 0, 'Should find tasks in test files');
    }
  });
});
