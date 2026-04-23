import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

// Helper to build a file URI from the task-files/shell directory.
// The compiled tests run from out/test/suite but task-files live in src/test/task-files,
// so we navigate up from the compiled directory to the source fixtures.
function shellUri(filename: string): vscode.Uri {
  return vscode.Uri.file(path.resolve(__dirname, '../../../src/test/task-files/shell', filename));
}

suite('TaskFactory Shell Tests', () => {
  // ── With interpreter ───────────────────────────────────────────────────────

  test('creates ShellExecution with interpreter when interpreter is set', async () => {
    const uri = shellUri('no-shebang.py');
    const item = new TaskItem('no-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: 'python', subType: 'python', useShebang: false };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created?.native, false);

    const exec = created?.task.execution as vscode.ShellExecution;
    assert.ok(exec, 'Task should have ShellExecution');
    assert.strictEqual(exec.command, 'python', 'Shell command should be the interpreter');
    assert.ok(
      Array.isArray(exec.args) && exec.args.some((a) => typeof a === 'string' && (a as string).includes('no-shebang.py')),
      'Args should include the script path',
    );

    assert.ok(created.command?.includes('python'), 'Command string should include interpreter');
    assert.ok(created.command?.includes('no-shebang.py'), 'Command string should include script path');
  });

  test('uses overridden interpreter (python3) from metadata', async () => {
    const uri = shellUri('no-shebang.py');
    const item = new TaskItem('no-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: 'python3', subType: 'python', useShebang: false };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    const exec = created?.task.execution as vscode.ShellExecution;
    assert.strictEqual(exec.command, 'python3', 'Shell command should be python3');
    assert.ok(created.command?.startsWith('python3 '), 'Command string should start with python3');
  });

  // ── Direct shebang execution ───────────────────────────────────────────────

  test('executes script directly (no interpreter prefix) when useShebang is true', async () => {
    const uri = shellUri('with-shebang.py');
    const item = new TaskItem('with-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: '', subType: 'python', useShebang: true };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    const exec = created?.task.execution as vscode.ShellExecution;
    assert.ok(exec, 'Task should have ShellExecution');

    // When no interpreter, the factory uses the commandLine form of ShellExecution.
    // exec.commandLine holds the quoted script path; exec.command is undefined in this form.
    const cmd = typeof exec.commandLine === 'string' ? exec.commandLine : '';
    assert.ok(cmd.includes('with-shebang.py'), 'Command should include the script path');
    // Interpreter should NOT appear as a separate prefix executable
    assert.ok(!cmd.includes('python'), 'Command should not contain an explicit interpreter');
  });

  test('command string for direct execution contains the script path', async () => {
    const uri = shellUri('with-shebang.sh');
    const item = new TaskItem('with-shebang.sh', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: '', subType: 'bash', useShebang: true };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created.command?.includes('with-shebang.sh'), 'Command string should include the script path');
  });

  // ── CWD ───────────────────────────────────────────────────────────────────

  test('cwd is the directory containing the script', async () => {
    const uri = shellUri('no-shebang.py');
    const item = new TaskItem('no-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: 'python', subType: 'python', useShebang: false };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    const expectedCwd = path.dirname(uri.fsPath).toLowerCase();
    assert.strictEqual(created.cwd?.toLowerCase(), expectedCwd, 'cwd should be the script directory');

    const exec = created.task.execution as vscode.ShellExecution;
    assert.strictEqual(exec.options?.cwd?.toLowerCase(), expectedCwd, 'ShellExecution cwd should match');
  });

  // ── Additional args ───────────────────────────────────────────────────────

  test('additional args are appended to the command when interpreter is set', async () => {
    const uri = shellUri('no-shebang.py');
    const item = new TaskItem('no-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: 'python', subType: 'python', useShebang: false };

    const created = await createTaskForItem(item, '--verbose');

    assert.ok(created, 'Should create a task');
    assert.ok(created.command?.includes('--verbose'), 'Command should include extra args');
  });

  // ── Task source field ─────────────────────────────────────────────────────

  test('task source is "shell"', async () => {
    const uri = shellUri('no-shebang.py');
    const item = new TaskItem('no-shebang.py', vscode.TreeItemCollapsibleState.None, 'shell', uri);
    item.resourceUri = uri;
    item.metadata = { interpreter: 'python', subType: 'python', useShebang: false };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created.task.source, 'shell', 'Task source should be "shell"');
  });

  // ── Guard: no file URI ────────────────────────────────────────────────────

  test('returns undefined when neither taskFileUri nor resourceUri is set', async () => {
    // When no file URI is available, the factory must not fall through using the
    // workspace-root fallback URI as a script path (that would cause a runtime error
    // of the form "bash: /path/to/workspace: is a directory").
    const item = new TaskItem('ghost-task', vscode.TreeItemCollapsibleState.None, 'shell', undefined);
    // Leave both taskFileUri and resourceUri unset
    item.metadata = { interpreter: 'bash', subType: 'bash', useShebang: false };

    const created = await createTaskForItem(item);

    assert.strictEqual(created, undefined, 'Should return undefined when no file URI is set');
  });
});
