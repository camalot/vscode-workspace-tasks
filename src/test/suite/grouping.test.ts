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

  // ── Regex separator ────────────────────────────────────────────────────────

  suite('Regex separator', () => {
    test('splits on first match of single-char alternation pattern', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      // Use a label whose remainder contains no further delimiter match so the split is exactly one level.
      const t = new TaskItem('build:frontend', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build:frontend';

      const grouped = provider.groupTasksByName([t], /[:\-]/);

      assert.strictEqual(grouped.length, 1);
      const group = grouped[0];
      assert.strictEqual(group.label, 'build', 'Group name should be "build"');
      assert.strictEqual(group.contextValue, 'folder', 'Group should be a folder');
      assert.strictEqual(group.children.length, 1);
      assert.strictEqual(group.children[0].label, 'frontend', 'Child label should be "frontend"');
    });

    test('splits on first match of multi-char delimiter, recurses on remainder', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('ns::action::sub', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'ns::action::sub';

      const grouped = provider.groupTasksByName([t], /::/);

      // ns (folder) -> action (folder) -> sub (leaf)
      assert.strictEqual(grouped.length, 1);
      const groupNs = grouped[0];
      assert.strictEqual(groupNs.label, 'ns');
      assert.strictEqual(groupNs.contextValue, 'folder');
      assert.strictEqual(groupNs.children.length, 1);

      const groupAction = groupNs.children[0];
      assert.strictEqual(groupAction.label, 'action');
      assert.strictEqual(groupAction.contextValue, 'folder');
      assert.strictEqual(groupAction.children.length, 1);
      assert.strictEqual(groupAction.children[0].label, 'sub');
    });

    test('matches multiple delimiters across tasks, producing the same group', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const tasks = [
        new TaskItem('dev-build', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('dev_test', vscode.TreeItemCollapsibleState.None, 'npm'),
        new TaskItem('simple', vscode.TreeItemCollapsibleState.None, 'npm'),
      ];
      tasks.forEach((t) => (t.originalLabel = t.label));

      const grouped = provider.groupTasksByName(tasks, /[_\-]/);

      assert.strictEqual(grouped.length, 2, 'Should have 2 root items: dev group and simple leaf');

      const devGroup = grouped.find((t) => t.label === 'dev');
      assert.ok(devGroup, 'Should have dev group');
      assert.strictEqual(devGroup!.contextValue, 'folder');
      assert.strictEqual(devGroup!.children.length, 2, 'dev group should have 2 children');

      const childLabels = devGroup!.children.map((c) => c.label).sort();
      assert.deepStrictEqual(childLabels, ['build', 'test'], 'Children should be "build" and "test"');

      const simpleLeaf = grouped.find((t) => t.label === 'simple');
      assert.ok(simpleLeaf, 'Should have simple leaf');
    });

    test('nested grouping works across recursive levels', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('a:b:c', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'a:b:c';

      const grouped = provider.groupTasksByName([t], /:/);

      // a (folder) -> b (folder) -> c (leaf)
      assert.strictEqual(grouped.length, 1);
      const groupA = grouped[0];
      assert.strictEqual(groupA.label, 'a');
      assert.strictEqual(groupA.contextValue, 'folder');

      const groupB = groupA.children[0];
      assert.strictEqual(groupB.label, 'b');
      assert.strictEqual(groupB.contextValue, 'folder');

      const leafC = groupB.children[0];
      assert.strictEqual(leafC.label, 'c');
      assert.notStrictEqual(leafC.contextValue, 'folder');
    });

    test('remainder uses original label slice, not a rejoined string', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build--frontend--test', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build--frontend--test';

      const grouped = provider.groupTasksByName([t], /--/);

      // build (folder) -> frontend (folder) -> test (leaf)
      assert.strictEqual(grouped.length, 1);
      const buildGroup = grouped[0];
      assert.strictEqual(buildGroup.label, 'build');

      const frontendGroup = buildGroup.children[0];
      assert.strictEqual(frontendGroup.label, 'frontend', 'Should be "frontend", not a rejoined artefact');

      assert.strictEqual(frontendGroup.children[0].label, 'test');
    });

    test('zero-length match treated as leaf — no infinite recursion (quantifier)', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build';

      // /a*/ matches zero-length at position 0 of 'build'
      const grouped = provider.groupTasksByName([t], /a*/);

      assert.strictEqual(grouped.length, 1, 'Should be a single leaf (no infinite recursion)');
      assert.strictEqual(grouped[0].label, 'build');
      assert.notStrictEqual(grouped[0].contextValue, 'folder');
    });

    test('zero-length match treated as leaf — no infinite recursion (lookahead)', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build:test', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build:test';

      // /(?=:)/ matches zero-width before ':' — must not split
      const grouped = provider.groupTasksByName([t], /(?=:)/);

      assert.strictEqual(grouped.length, 1, 'Should be a single leaf (zero-width lookahead)');
      assert.strictEqual(grouped[0].label, 'build:test');
      assert.notStrictEqual(grouped[0].contextValue, 'folder');
    });

    test('separator matching entire label treated as leaf', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build';

      // /^build$/ matches the whole label — no groupName prefix available
      const grouped = provider.groupTasksByName([t], /^build$/);

      assert.strictEqual(grouped.length, 1, 'Should be a single leaf');
      assert.strictEqual(grouped[0].label, 'build');
      assert.notStrictEqual(grouped[0].contextValue, 'folder');
    });

    test('group item IDs are stable across repeated calls with the same inputs', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('ns::action', vscode.TreeItemCollapsibleState.None, 'npm');
      t.id = 'npm:ns::action:uri1';
      t.originalLabel = 'ns::action';
      t.taskFileUri = vscode.Uri.file('/project/package.json');

      const grouped1 = provider.groupTasksByName([t], /::/);
      const grouped2 = provider.groupTasksByName([t], /::/);

      assert.strictEqual(grouped1.length, 1);
      assert.strictEqual(grouped2.length, 1);
      assert.strictEqual(grouped1[0].id, grouped2[0].id, 'Group IDs must be identical across repeated calls');
    });

    test('originalLabel and ID are preserved on the leaf task after grouping', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build:frontend', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build:frontend';
      t.id = 'npm:build:frontend:uri1';

      const grouped = provider.groupTasksByName([t], /:/);

      const leaf = grouped[0].children[0];
      assert.strictEqual(leaf.originalLabel, 'build:frontend', 'originalLabel should be the full original task label');
      assert.strictEqual(leaf.id, 'npm:build:frontend:uri1', 'ID should be inherited from the original task');
    });
  });

  // ── String separator edge cases ────────────────────────────────────────────

  suite('String separator edge cases', () => {
    test('plain string dot is literal — does not match regex wildcard position', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);

      const matchingTask = new TaskItem('foo.bar', vscode.TreeItemCollapsibleState.None, 'npm');
      matchingTask.originalLabel = 'foo.bar';
      const nonMatchingTask = new TaskItem('fooXbar', vscode.TreeItemCollapsibleState.None, 'npm');
      nonMatchingTask.originalLabel = 'fooXbar';

      const grouped = provider.groupTasksByName([matchingTask, nonMatchingTask], '.');

      const fooGroup = grouped.find((t) => t.label === 'foo');
      assert.ok(fooGroup, 'Should have "foo" group from foo.bar');
      assert.strictEqual(fooGroup!.contextValue, 'folder');
      assert.strictEqual(fooGroup!.children[0].label, 'bar');

      const fooXbarLeaf = grouped.find((t) => t.label === 'fooXbar');
      assert.ok(fooXbarLeaf, 'fooXbar should remain a leaf (X does not match literal dot)');
      assert.notStrictEqual(fooXbarLeaf!.contextValue, 'folder');
    });

    test('label ending with separator produces leaf (no empty child node)', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem('build:', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = 'build:';

      const grouped = provider.groupTasksByName([t], ':');

      assert.strictEqual(grouped.length, 1, 'Should be a single leaf');
      assert.strictEqual(grouped[0].label, 'build:');
      assert.notStrictEqual(grouped[0].contextValue, 'folder');
    });

    test('separator at position 0 produces leaf (no empty group name)', () => {
      const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
      const t = new TaskItem(':task', vscode.TreeItemCollapsibleState.None, 'npm');
      t.originalLabel = ':task';

      const grouped = provider.groupTasksByName([t], ':');

      assert.strictEqual(grouped.length, 1, 'Should be a single leaf (separator at start)');
      assert.strictEqual(grouped[0].label, ':task');
      assert.notStrictEqual(grouped[0].contextValue, 'folder');
    });
  });
});
