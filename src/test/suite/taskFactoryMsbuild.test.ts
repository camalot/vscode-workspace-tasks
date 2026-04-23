import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory MSBuild Test Suite', () => {
  // ── Guard: no file URI ────────────────────────────────────────────────────

  test('returns undefined when neither taskFileUri nor resourceUri is set', async () => {
    // When no project file URI is available, the factory must not fall through using the
    // workspace-root fallback URI as the MSBuild project path (that would produce an
    // invalid invocation such as "msbuild /path/to/workspace -t:Build").
    const item = new TaskItem('ghost-task', vscode.TreeItemCollapsibleState.None, 'msbuild', undefined);
    // Leave both taskFileUri and resourceUri unset

    const created = await createTaskForItem(item);

    assert.strictEqual(created, undefined, 'Should return undefined when no file URI is set');
  });
});
