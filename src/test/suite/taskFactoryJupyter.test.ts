import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { TaskProviderRegistry } from '../../taskProviderRegistry';
import { JupyterTerm } from '../../providers/jupyterTaskProvider';
import { ensureTaskProviderRegistryPopulated } from '../../providers';

suite('Task Factory Jupyter Test Suite', () => {
  let originalRegistryGet: TaskProviderRegistry['get'];

  setup(() => {
    originalRegistryGet = TaskProviderRegistry.getInstance().get;
  });

  teardown(() => {
    TaskProviderRegistry.getInstance().get = originalRegistryGet;
  });

  test('fallback jupyter task creates CustomExecution that builds JupyterTerm', async () => {
    // Force taskFactory to fall through Track 1 by making the provider return undefined,
    // so this test exercises the legacy switch(jupyter) fallback path directly.
    const registry = TaskProviderRegistry.getInstance();
    ensureTaskProviderRegistryPopulated();
    const provider = registry.get('jupyter') as { createTask: (item: TaskItem, args?: string) => Promise<unknown> };
    assert.ok(provider, 'Expected jupyter provider to be registered');
    const originalCreateTask = provider.createTask;
    provider.createTask = async () => undefined;

    const notebookUri = vscode.Uri.file('/workspace/notebook.ipynb');
    const item = new TaskItem('Cell 3', vscode.TreeItemCollapsibleState.None, 'jupyter', notebookUri);
    item.taskFileUri = notebookUri;
    item.metadata = { cellIndex: 2 };

    try {
      const created = await createTaskForItem(item);
      assert.ok(created, 'Should create a jupyter task');
      assert.strictEqual(created!.native, false);
      assert.strictEqual(created!.command, 'jupyter.runcell');

      const executionAny = created!.task.execution as unknown as Record<string, unknown>;
      assert.ok(created!.task.execution instanceof vscode.CustomExecution, 'Execution should be CustomExecution');
      const callback = executionAny['callback'] as (() => Promise<unknown>) | undefined;
      assert.ok(typeof callback === 'function', 'CustomExecution callback should exist');

      const term = await callback!();
      assert.ok(term instanceof JupyterTerm, 'CustomExecution callback should create JupyterTerm');
    } finally {
      provider.createTask = originalCreateTask;
    }
  });
});
