import * as assert from 'assert';
import * as vscode from 'vscode';
import { createJupyterExecutionCallback, createJupyterPseudoterminal, isMatchingVscodeTask } from '../../taskFactory';
import { JupyterTerm } from '../../providers/jupyterTaskProvider';

suite('TaskFactory Helper Tests', () => {
  test('createJupyterPseudoterminal returns JupyterTerm', () => {
    const uri = vscode.Uri.file('/workspace/notebook.ipynb');
    const term = createJupyterPseudoterminal(uri, 1, 'Cell 2');
    assert.ok(term instanceof JupyterTerm);
  });

  test('createJupyterExecutionCallback returns callback that resolves JupyterTerm', async () => {
    const uri = vscode.Uri.file('/workspace/notebook.ipynb');
    const callback = createJupyterExecutionCallback(uri, 2, 'Cell 3');
    const term = await callback();
    assert.ok(term instanceof JupyterTerm);
  });

  test('isMatchingVscodeTask returns false for name/source mismatch', () => {
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'Other Task',
      'Workspace',
      new vscode.ShellExecution('echo test'),
    );

    assert.strictEqual(isMatchingVscodeTask(task, 'Wanted Task'), false);
  });

  test('isMatchingVscodeTask checks workspace folder uri when scope is workspace folder object', () => {
    const targetWorkspaceFolder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/workspace/a'),
      name: 'a',
      index: 0,
    };

    const matchingTask = new vscode.Task(
      { type: 'shell' },
      targetWorkspaceFolder,
      'Wanted Task',
      'Workspace',
      new vscode.ShellExecution('echo matching'),
    );

    const nonMatchingTask = new vscode.Task(
      { type: 'shell' },
      { uri: vscode.Uri.file('/workspace/b'), name: 'b', index: 1 },
      'Wanted Task',
      'Workspace',
      new vscode.ShellExecution('echo non-matching'),
    );

    assert.strictEqual(isMatchingVscodeTask(matchingTask, 'Wanted Task', targetWorkspaceFolder), true);
    assert.strictEqual(isMatchingVscodeTask(nonMatchingTask, 'Wanted Task', targetWorkspaceFolder), false);
  });

  test('isMatchingVscodeTask allows fallback for user task and numeric scope', () => {
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Global,
      'Wanted Task',
      'User',
      new vscode.ShellExecution('echo user'),
    );

    assert.strictEqual(isMatchingVscodeTask(task, 'Wanted Task'), true);
  });
});
