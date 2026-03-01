import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../../taskTreeDataProvider';
import { TaskItem } from '../../taskItem';

suite('Issue 120 Reproduction Suite', () => {
    test('Should handle duplicate group names at different levels in same file', () => {
        const provider = new TaskTreeDataProvider({ extensionPath: '/mock/path' } as vscode.ExtensionContext);
        const fileUri = vscode.Uri.file('/workspace/tasks.json');

        // Task 1: A/B/C/D
        const t1 = new TaskItem('A/B/C/D', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
        t1.originalLabel = 'A/B/C/D';

        // Task 2: X/Y/C/Z
        // Duplicate group name 'C' but under different parent
        const t2 = new TaskItem('X/Y/C/Z', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
        t2.originalLabel = 'X/Y/C/Z';

        const tasks = [t1, t2];
        const grouped = provider.groupTasksByName(tasks, '/');

        // Check structure
        // Root: A, X
        assert.strictEqual(grouped.length, 2);

        const groupA = grouped.find(g => g.label === 'A');
        const groupX = grouped.find(g => g.label === 'X');

        assert.ok(groupA);
        assert.ok(groupX);

        // A -> B -> C -> D
        const groupB = groupA!.children!.find(c => c.label === 'B');
        assert.ok(groupB);
        const groupC1 = groupB!.children!.find(c => c.label === 'C');
        assert.ok(groupC1);

        // X -> Y -> C -> Z
        const groupY = groupX!.children!.find(c => c.label === 'Y');
        assert.ok(groupY);
        const groupC2 = groupY!.children!.find(c => c.label === 'C');
        assert.ok(groupC2);

        // IDs MUST be unique
        // Currently problematic: `group:C:file...` for both
        assert.notStrictEqual(groupC1?.id, groupC2?.id, 'Group IDs must be unique even with same label name');
    });
});
