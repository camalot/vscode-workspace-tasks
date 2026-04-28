import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { resolveTaskContext, splitArgs, buildShellTask, injectArgs, TaskContext } from '../../libs/taskCreationUtils';
import { TaskItem } from '../../taskItem';

suite('taskCreationUtils', () => {
  // ── resolveTaskContext ─────────────────────────────────────────────────────

  suite('resolveTaskContext()', () => {
    test('effectiveResourceUri is taskFileUri when set', () => {
      const fileUri = vscode.Uri.file('/workspace/package.json');
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
      item.taskFileUri = fileUri;

      const ctx = resolveTaskContext(item);
      assert.strictEqual(ctx.effectiveResourceUri, fileUri);
    });

    test('effectiveResourceUri is undefined when taskFileUri is not set', () => {
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', undefined);
      // taskFileUri is intentionally not set

      const ctx = resolveTaskContext(item);
      assert.strictEqual(ctx.effectiveResourceUri, undefined);
    });

    test('cwd is dirname of taskFileUri when set', () => {
      const fileUri = vscode.Uri.file('/workspace/packages/core/package.json');
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
      item.taskFileUri = fileUri;

      const ctx = resolveTaskContext(item);
      assert.strictEqual(ctx.cwd, path.dirname(fileUri.fsPath));
    });

    test('cwd falls back to first workspace folder when taskFileUri is not set', () => {
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', undefined);

      const ctx = resolveTaskContext(item);
      // In the test VS Code instance there is at least one workspace folder
      const expectedCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      assert.strictEqual(ctx.cwd, expectedCwd);
    });

    test('resourceUri is taskFileUri when set (a real file:// URI)', () => {
      const fileUri = vscode.Uri.file('/workspace/package.json');
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
      item.taskFileUri = fileUri;

      const ctx = resolveTaskContext(item);
      assert.strictEqual(ctx.resourceUri.scheme, 'file');
      assert.strictEqual(ctx.resourceUri.fsPath, fileUri.fsPath);
    });

    test('resourceUri is workspace root (file://) when taskFileUri is not set', () => {
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', undefined);

      const ctx = resolveTaskContext(item);
      assert.strictEqual(ctx.resourceUri.scheme, 'file', 'resourceUri must always be a file:// URI');
    });

    test('workspaceFolder is resolved from taskFileUri when available', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return; // skip when no workspace folders
      }
      const fileUri = vscode.Uri.joinPath(root, 'package.json');
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', fileUri);
      item.taskFileUri = fileUri;

      const ctx = resolveTaskContext(item);
      // The test workspace is the workspace folder containing the file
      assert.ok(ctx.workspaceFolder, 'workspaceFolder should be resolved');
      assert.strictEqual(
        ctx.workspaceFolder?.uri.toString(),
        root.toString(),
      );
    });

    test('item.resourceUri (synthetic workspace-tasks:// URI) does NOT affect effectiveResourceUri', () => {
      // item.resourceUri is always a synthetic workspace-tasks:// URI set by updateContextValue().
      // It must not be used as the effectiveResourceUri.
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', undefined);
      // item.resourceUri is now a workspace-tasks:// URI (set by constructor/updateContextValue)
      assert.strictEqual(item.resourceUri?.scheme, 'workspace-tasks');

      const ctx = resolveTaskContext(item);
      // effectiveResourceUri must still be undefined, not the synthetic URI
      assert.strictEqual(ctx.effectiveResourceUri, undefined);
    });
  });

  // ── splitArgs ──────────────────────────────────────────────────────────────

  suite('splitArgs()', () => {
    test('returns empty array for undefined', () => {
      assert.deepStrictEqual(splitArgs(undefined), []);
    });

    test('returns empty array for empty string', () => {
      assert.deepStrictEqual(splitArgs(''), []);
    });

    test('returns empty array for whitespace-only string', () => {
      assert.deepStrictEqual(splitArgs('   '), []);
    });

    test('splits simple space-separated tokens', () => {
      assert.deepStrictEqual(splitArgs('--flag value'), ['--flag', 'value']);
    });

    test('handles multiple spaces between tokens', () => {
      assert.deepStrictEqual(splitArgs('a  b'), ['a', 'b']);
    });

    test('preserves single-quoted tokens with spaces as one element', () => {
      assert.deepStrictEqual(splitArgs("--name 'John Doe'"), ['--name', 'John Doe']);
    });

    test('preserves double-quoted tokens with spaces as one element', () => {
      assert.deepStrictEqual(splitArgs('--name "John Doe"'), ['--name', 'John Doe']);
    });

    test('handles mixed quoted and unquoted tokens', () => {
      assert.deepStrictEqual(
        splitArgs('--env production --name "My App"'),
        ['--env', 'production', '--name', 'My App'],
      );
    });

    test('handles --key="value with spaces" style', () => {
      assert.deepStrictEqual(splitArgs('--key="spaced value"'), ['--key=spaced value']);
    });

    test('handles single token without spaces', () => {
      assert.deepStrictEqual(splitArgs('--verbose'), ['--verbose']);
    });

    test('does not include quotes in resulting tokens', () => {
      const result = splitArgs("'hello world'");
      assert.deepStrictEqual(result, ['hello world']);
    });
  });

  // ── buildShellTask ─────────────────────────────────────────────────────────

  suite('buildShellTask()', () => {
    function makeUri(p: string): vscode.Uri {
      return vscode.Uri.file(p);
    }

    test('builds a CreatedTask with correct command, args, and cwd', () => {
      const resourceUri = makeUri('/workspace/package.json');
      const result = buildShellTask({
        type: 'npm',
        label: 'build',
        command: 'npm',
        args: ['run', 'build'],
        cwd: '/workspace',
        resourceUri,
      });

      assert.ok(result.task, 'Task should be created');
      assert.strictEqual(result.native, false);
      assert.strictEqual(result.cwd, '/workspace');
      assert.strictEqual(result.command, 'npm run build');

      const exec = result.task.execution as vscode.ShellExecution;
      assert.ok(exec, 'ShellExecution should be set');
      assert.strictEqual(exec.command, 'npm');
      assert.deepStrictEqual(exec.args, ['run', 'build']);
      assert.strictEqual(exec.options?.cwd, '/workspace');
    });

    test('uses default task definition (type, script, path)', () => {
      const resourceUri = makeUri('/workspace/package.json');
      const result = buildShellTask({
        type: 'npm',
        label: 'test',
        command: 'npm',
        args: ['run', 'test'],
        cwd: '/workspace',
        resourceUri,
      });

      const def = result.task.definition;
      assert.strictEqual(def.type, 'npm');
      assert.strictEqual((def as any).script, 'test');
      assert.strictEqual((def as any).path, resourceUri.fsPath);
    });

    test('accepts definitionOverride to replace default definition', () => {
      const resourceUri = makeUri('/workspace/project.csproj');
      const customDef = { type: 'msbuild', target: 'Build', path: resourceUri.fsPath };
      const result = buildShellTask({
        type: 'msbuild',
        label: 'Build',
        command: 'msbuild',
        args: ['project.csproj', '-t:Build'],
        cwd: '/workspace',
        resourceUri,
        definitionOverride: customDef,
      });

      assert.strictEqual(result.task.definition.type, 'msbuild');
      assert.strictEqual((result.task.definition as any).target, 'Build');
    });

    test('command string is just the command when args is empty', () => {
      const resourceUri = makeUri('/workspace/Makefile');
      const result = buildShellTask({
        type: 'make',
        label: 'all',
        command: 'make',
        args: [],
        cwd: '/workspace',
        resourceUri,
      });

      assert.strictEqual(result.command, 'make');
    });

    test('task label and source are set correctly', () => {
      const resourceUri = makeUri('/workspace/package.json');
      const result = buildShellTask({
        type: 'npm',
        label: 'deploy',
        command: 'npm',
        args: ['run', 'deploy'],
        cwd: '/workspace',
        resourceUri,
      });

      assert.strictEqual(result.task.name, 'deploy');
      assert.strictEqual(result.task.source, 'npm');
    });
  });

  // ── injectArgs ────────────────────────────────────────────────────────

  suite('injectArgs()', () => {
    test('no user args — parses command into command+args', () => {
      assert.deepStrictEqual(injectArgs('npm run build'), {
        command: 'npm',
        args: ['run', 'build'],
      });
    });

    test('appends user args when no placeholder', () => {
      assert.deepStrictEqual(injectArgs('npm run build', '--watch'), {
        command: 'npm',
        args: ['run', 'build', '--watch'],
      });
    });

    test('exact ${args} replacement — single placeholder', () => {
      assert.deepStrictEqual(injectArgs('docker run ${args} alpine', '--rm'), {
        command: 'docker',
        args: ['run', '--rm', 'alpine'],
      });
    });

    test('multiple exact ${args} tokens all replaced', () => {
      assert.deepStrictEqual(injectArgs('echo ${args} && echo ${args}', 'x'), {
        command: 'echo',
        args: ['x', '&&', 'echo', 'x'],
      });
    });

    test('no user args with ${args} placeholder — placeholder stripped', () => {
      assert.deepStrictEqual(injectArgs('docker run ${args} alpine', undefined), {
        command: 'docker',
        args: ['run', 'alpine'],
      });
    });

    test('partial ${args} in token — replaced with joined user args', () => {
      assert.deepStrictEqual(injectArgs('tool --name=${args} end', 'myval'), {
        command: 'tool',
        args: ['--name=myval', 'end'],
      });
    });

    test('partial ${args} in token — multi-token user args joined into single token', () => {
      assert.deepStrictEqual(injectArgs('tool --name=${args}', 'val1 val2'), {
        command: 'tool',
        args: ['--name=val1 val2'],
      });
    });

    test('injection via partial match — semicolon embedded inside token, not standalone', () => {
      assert.deepStrictEqual(injectArgs('tool --cmd=${args}', '; rm -rf /'), {
        command: 'tool',
        args: ['--cmd=; rm -rf /'],
      });
    });

    test('quoted path as command is unquoted into executable', () => {
      assert.deepStrictEqual(injectArgs('"My Tool" run', '--flag'), {
        command: 'My Tool',
        args: ['run', '--flag'],
      });
    });

    test('quoted user arg kept as single element', () => {
      assert.deepStrictEqual(injectArgs('npm run build', "--name 'John Doe'"), {
        command: 'npm',
        args: ['run', 'build', '--name', 'John Doe'],
      });
    });

    test('injection: shell operator in args becomes literal tokens', () => {
      const result = injectArgs('npm install', '; rm -rf /');
      assert.strictEqual(result.command, 'npm');
      // The semicolon must be a discrete literal array element, not concatenated into the command
      assert.ok(result.args.includes(';'), 'Semicolon must appear as a literal array element');
      assert.ok(result.args.includes('rm'), 'rm must appear as a literal array element');
    });

    test('injection: pipe in args becomes literal tokens', () => {
      const result = injectArgs('cat file', '| tee /tmp/out');
      assert.strictEqual(result.command, 'cat');
      assert.ok(result.args.includes('|'), 'Pipe must appear as a literal array element');
      assert.ok(result.args.includes('tee'), 'tee must appear as a literal array element');
    });

    test('injection: subshell tokens in args are literal array elements', () => {
      const result = injectArgs('echo', '$(cat /etc/passwd)');
      assert.strictEqual(result.command, 'echo');
      // splitArgs splits on the space inside $(cat /etc/passwd), so we get two tokens
      // both are literal strings, not executed as shell code
      const allArgs = result.args.join(' ');
      assert.ok(allArgs.includes('$(cat'), 'Subshell prefix must appear as a literal token');
    });

    test('injection: shell operator in ${args} placeholder becomes literal tokens', () => {
      const result = injectArgs('docker run ${args} alpine', '; rm -rf /');
      assert.strictEqual(result.command, 'docker');
      assert.ok(result.args.includes(';'), 'Semicolon must appear as a literal array element');
      assert.ok(result.args.includes('alpine'), 'alpine must appear after injection');
    });

    test('empty command string returns empty command and no args', () => {
      assert.deepStrictEqual(injectArgs(''), { command: '', args: [] });
    });

    test('whitespace-only command string returns empty command and no args', () => {
      assert.deepStrictEqual(injectArgs('   '), { command: '', args: [] });
    });

    test('single command with no args and no user args', () => {
      assert.deepStrictEqual(injectArgs('echo hello'), {
        command: 'echo',
        args: ['hello'],
      });
    });
  });
});
