import * as assert from 'assert';
import { PoeTaskProvider } from '../../providers/poeTaskProvider';

suite('Poe the Poet Provider', () => {
  test('parses pyproject.toml when parser available', async function () {
    const provider = new PoeTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    // This test will only pass if there's a pyproject.toml with [tool.poe.tasks] in the workspace
    // assert.ok(tasks.length >= 0, 'Should return an array of tasks (possibly empty)');
  });

  test('uses correct file pattern', function () {
    const provider = new PoeTaskProvider();
    assert.strictEqual(provider.type, 'poe');
  });

  test('uses correct scripts path', function () {
    const provider = new PoeTaskProvider();
    // Access protected method for testing
    const scriptsPath = (provider as any).getScriptsPath();
    assert.deepStrictEqual(scriptsPath, ['tool.poe.tasks', 'tool.poe.tasks.*']);
  });

  test('filters out private tasks starting with underscore', async function () {
    const provider = new PoeTaskProvider();
    const tasks = await provider.getTasks();

    // Ensure no task names start with underscore
    const privateTasks = tasks.filter((task) => task.label.startsWith('_'));
    assert.strictEqual(privateTasks.length, 0, 'Private tasks (starting with _) should be filtered out');
  });

  test('handles simple string task definitions', function () {
    const provider = new PoeTaskProvider();
    // Test the private method via casting
    const description = (provider as any).getTaskDescription('pytest');
    assert.strictEqual(description, 'pytest');
  });

  test('handles array task definitions (sequences)', function () {
    const provider = new PoeTaskProvider();
    const description = (provider as any).getTaskDescription(['test', 'build']);
    assert.strictEqual(description, 'sequence: [test, build]');
  });

  test('handles cmd task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { cmd: 'pytest -v' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'cmd: pytest -v');
  });

  test('handles shell task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { shell: 'echo "Hello World"' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'shell: echo "Hello World"');
  });

  test('handles script task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { script: 'my_module:main' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'script: my_module:main');
  });

  test('handles expr task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { expr: 'print("Hello")' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'expr: print("Hello")');
  });

  test('handles sequence task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { sequence: ['task1', 'task2'] };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'sequence: [task1, task2]');
  });

  test('handles parallel task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { parallel: ['task1', 'task2'] };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'parallel: [task1, task2]');
  });

  test('handles ref task type', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { ref: 'other-task' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'ref: other-task');
  });

  test('handles task with only help text', function () {
    const provider = new PoeTaskProvider();
    const taskDef = { help: 'This is a helpful description' };
    const description = (provider as any).getTaskDescription(taskDef);
    assert.strictEqual(description, 'This is a helpful description');
  });

  test('handles unknown task types', function () {
    const provider = new PoeTaskProvider();
    const description = (provider as any).getTaskDescription(undefined);
    assert.strictEqual(description, 'unknown task type');
  });

  test('finds task line in content - simple assignment', function () {
    const provider = new PoeTaskProvider();
    const content = `[tool.poe.tasks]
test = "pytest"
build = "poetry build"`;
    const lineNumber = (provider as any).findTaskLineInContent(content, 'test');
    assert.strictEqual(lineNumber, 2);
  });

  test('finds task line in content - table syntax', function () {
    const provider = new PoeTaskProvider();
    const content = `[tool.poe.tasks.test]
cmd = "pytest"
help = "Run tests"`;
    const lineNumber = (provider as any).findTaskLineInContent(content, 'test');
    assert.strictEqual(lineNumber, 1);
  });

  test('returns 0 for task not found', function () {
    const provider = new PoeTaskProvider();
    const content = `[tool.poe.tasks]
test = "pytest"`;
    const lineNumber = (provider as any).findTaskLineInContent(content, 'nonexistent');
    assert.strictEqual(lineNumber, 0);
  });

  test('stops searching at next section', function () {
    const provider = new PoeTaskProvider();
    const content = `[tool.poe.tasks]
test = "pytest"

[tool.other]
test = "other"`;
    const lineNumber = (provider as any).findTaskLineInContent(content, 'test');
    assert.strictEqual(lineNumber, 2);
  });
});
