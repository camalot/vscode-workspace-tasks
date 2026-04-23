import * as assert from 'assert';
import * as vscode from 'vscode';
import { BaseTaskProvider } from '../../../taskProvider';
import { TaskItem } from '../../../taskItem';

export async function assertProviderCreatesTask(
  provider: BaseTaskProvider,
  item: TaskItem,
  expectedCommand: string,
  expectedCwd: string,
  args?: string,
): Promise<void> {
  const result = await provider.createTask(item, args);
  assert.ok(result, 'Expected provider to return a CreatedTask');
  assert.strictEqual(result?.native, false, 'Expected provider-created task to be non-native');
  assert.ok(
    result?.command?.includes(expectedCommand),
    `Expected command to include "${expectedCommand}" but got: ${result?.command}`,
  );

  assert.strictEqual(
    result?.cwd?.toLowerCase(),
    expectedCwd.toLowerCase(),
    `Expected cwd ${expectedCwd} but got ${result?.cwd}`,
  );

  const exec = result?.task.execution as vscode.ShellExecution;
  assert.ok(exec, 'Expected ShellExecution');
  assert.strictEqual(
    (exec.options?.cwd || '').toLowerCase(),
    expectedCwd.toLowerCase(),
    `Expected ShellExecution cwd ${expectedCwd} but got ${exec.options?.cwd}`,
  );
}
