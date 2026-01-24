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
            new TaskItem('simple', vscode.TreeItemCollapsibleState.None, 'npm')
        ];

        // Ensure originalLabel is set correctly (simulation of TaskCacheService)
        tasks.forEach(t => t.originalLabel = t.label);

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
        const simple = grouped.find(t => t.label === 'simple');
        assert.ok(simple, 'Should find simple task');
        assert.strictEqual(simple?.contextValue, 'task', 'Simple should be a task'); // Verify contextual value if mocked correctly, simplified here

        // Check "dev"
        const dev = grouped.find(t => t.label === 'dev');
        assert.ok(dev, 'Should find dev group');
        assert.strictEqual(dev?.contextValue, 'folder', 'Dev should be a folder');
        assert.strictEqual(dev?.children.length, 2, 'Dev should have 2 children (test, build)');

        // Check dev/build
        const build = dev?.children.find(t => t.label === 'build');
        assert.ok(build, 'Should find build group');
        assert.strictEqual(build?.children.length, 2, 'Build should have 2 children (all, publish)');

        // Check dev/build/publish
        const publish = build?.children.find(t => t.label === 'publish');
        assert.ok(publish, 'Should find publish task');
        assert.strictEqual(publish?.originalLabel, 'dev-build-publish', 'Original label should be preserved');
	});

    test('Handles mixed depth', () => {
        const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
        const tasks = [
            new TaskItem('a-b', vscode.TreeItemCollapsibleState.None, 'npm'),
            new TaskItem('a', vscode.TreeItemCollapsibleState.None, 'npm')
        ];

        const grouped = provider.groupTasksByName(tasks, '-');
        // Expected:
        // a (folder) -> b
        // a (task)

        // Note: Sort order puts folder first usually
        assert.strictEqual(grouped.length, 2);

        const folderA = grouped.find(t => t.label === 'a' && t.contextValue === 'folder');
        const taskA = grouped.find(t => t.label === 'a' && t.contextValue !== 'folder'); // task context value varies depending on execution status

        assert.ok(folderA, 'Should have folder a');
        assert.ok(taskA, 'Should have task a');

        assert.strictEqual(folderA?.children.length, 1);
        assert.strictEqual(folderA?.children[0].label, 'b');
    });
});
