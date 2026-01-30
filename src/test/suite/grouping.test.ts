import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../../taskTreeDataProvider';
import { TaskItem } from '../../taskItem';

suite('Task Grouping Test Suite', () => {
  vscode.window.showInformationMessage('Start Grouping tests.');

  test('Groups tasks by separator', () => {
    const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
    const tasks = [
      new TaskItem('dev-test-clean', vscode.TreeItemCollapsibleState.None, 'npm'),
      new TaskItem('dev-build-all', vscode.TreeItemCollapsibleState.None, 'npm'),
      new TaskItem('dev-build-publish', vscode.TreeItemCollapsibleState.None, 'npm'),
      new TaskItem('simple', vscode.TreeItemCollapsibleState.None, 'npm'),
    ];

    // Ensure originalLabel is set correctly (simulation of TaskCacheService)
    tasks.forEach((t) => (t.originalLabel = t.label));

    const grouped = provider.groupTasksByName(tasks, '-');

    // Structure should be:
    // dev/
    //   test/
    //     clean
    //   build/
    //     all
    //     publish
    // simple

    assert.strictEqual(grouped.length, 2, 'Should have 2 root items (dev, simple)');

    // Check "simple"
    const simple = grouped.find((t) => t.label === 'simple');
    assert.ok(simple, 'Should find simple task');
    assert.strictEqual(simple?.contextValue, 'task', 'Simple should be a task'); // Verify contextual value if mocked correctly, simplified here

    // Check "dev"
    const dev = grouped.find((t) => t.label === 'dev');
    assert.ok(dev, 'Should find dev group');
    assert.strictEqual(dev?.contextValue, 'folder', 'Dev should be a folder');
    assert.strictEqual(dev?.children.length, 2, 'Dev should have 2 children (test, build)');

    // Check dev/build
    const build = dev?.children.find((t) => t.label === 'build');
    assert.ok(build, 'Should find build group');
    assert.strictEqual(build?.children.length, 2, 'Build should have 2 children (all, publish)');

    // Check dev/build/publish
    const publish = build?.children.find((t) => t.label === 'publish');
    assert.ok(publish, 'Should find publish task');
    assert.strictEqual(publish?.originalLabel, 'dev-build-publish', 'Original label should be preserved');
  });

  test('Trims whitespace in grouped tasks', () => {
    const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
    const tasks = [new TaskItem('Group : Task', vscode.TreeItemCollapsibleState.None, 'npm')];
    tasks[0].description = 'test description';

    const grouped = provider.groupTasksByName(tasks, ':');

    // Should have "Group" (folder) -> "Task" (task)
    assert.strictEqual(grouped.length, 1);
    const group = grouped[0];
    assert.strictEqual(group.label, 'Group', 'Group name should be trimmed');

    assert.strictEqual(group.children.length, 1);
    const task = group.children[0];
    assert.strictEqual(task.label, 'Task', 'Task name should be trimmed');
    assert.strictEqual(task.description, 'test description', 'Description should be preserved in child');
  });

  test('Handles mixed depth', () => {
    const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
    const tasks = [
      new TaskItem('a-b', vscode.TreeItemCollapsibleState.None, 'npm'),
      new TaskItem('a', vscode.TreeItemCollapsibleState.None, 'npm'),
    ];

    const grouped = provider.groupTasksByName(tasks, '-');
    // Expected:
    // a (folder) -> b
    // a (task)

    // Note: Sort order puts folder first usually
    assert.strictEqual(grouped.length, 2);

    const folderA = grouped.find((t) => t.label === 'a' && t.contextValue === 'folder');
    const taskA = grouped.find((t) => t.label === 'a' && t.contextValue !== 'folder'); // task context value varies depending on execution status

    assert.ok(folderA, 'Should have folder a');
    assert.ok(taskA, 'Should have task a');

    assert.strictEqual(folderA?.children.length, 1);
    assert.strictEqual(folderA?.children[0].label, 'b');
  });

  test('Avoids ID collisions for split tasks', () => {
    const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
    // Create two tasks that would result in potential collision if ID is just based on visible label and type
    // 1. Task "watch" (Leaf)
    const t1 = new TaskItem('watch', vscode.TreeItemCollapsibleState.None, 'npm');
    t1.id = 'npm:watch:uri1'; // Explicit ID

    // 2. Task "npm:watch" (Grouped)
    const t2 = new TaskItem('npm:watch', vscode.TreeItemCollapsibleState.None, 'npm');
    t2.id = 'npm:npm:watch:uri1'; // Explicit ID

    // Group by ":"
    const grouped = provider.groupTasksByName([t1, t2], ':');

    // Expected:
    // npm (Group) -> watch (Leaf, representing t2)
    // watch (Leaf, representing t1)

    const groupNpm = grouped.find((t) => t.label === 'npm' && t.contextValue === 'folder');
    const leafWatch = grouped.find((t) => t.label === 'watch' && t.contextValue !== 'folder');

    assert.ok(groupNpm, 'Should have npm group');
    assert.ok(leafWatch, 'Should have separate watch leaf');

    // The leaf inside groupNpm should correspond to t2
    const groupedWatch = groupNpm.children.find((t) => t.label === 'watch');
    assert.ok(groupedWatch, 'Group should have child watch');

    // IDs must be distinct
    assert.notStrictEqual(leafWatch.id, groupedWatch?.id, 'IDs should be distinct');
    assert.strictEqual(groupedWatch?.id, t2.id, 'Grouped task should retain original task ID');
    assert.strictEqual(leafWatch.id, t1.id, 'Ungrouped task should retain original task ID');
  });

  test('Inherits iconPath in grouped tasks', () => {
    const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
    const tasks = [new TaskItem('Group:Task', vscode.TreeItemCollapsibleState.None, 'npm')];

    // Mock a specific icon path
    const expectedIcon = { light: vscode.Uri.file('/light/icon.svg'), dark: vscode.Uri.file('/dark/icon.svg') };
    tasks[0].iconPath = expectedIcon;

    const grouped = provider.groupTasksByName(tasks, ':');

    assert.strictEqual(grouped.length, 1);
    const group = grouped[0];

    assert.strictEqual(group.children.length, 1);
    const task = group.children[0];

    // Use loose equality or check properties since object references might differ if strictly cloned?
    // Actually code passes reference: newTask.iconPath = task.iconPath (in direct copy via constructor args I added)
    // Wait, I passed it to constructor.
    assert.strictEqual(task.iconPath, expectedIcon, 'Child task should inherit iconPath from parent assignment');
  });
});
