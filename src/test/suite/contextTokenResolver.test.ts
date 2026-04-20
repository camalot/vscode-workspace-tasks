import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildContextFromVscode, resolveContextTokens } from '../../libs/contextTokenResolver';

suite('contextTokenResolver Test Suite', () => {
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;
  let originalActiveTextEditorDescriptor: PropertyDescriptor | undefined;

  setup(() => {
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    originalActiveTextEditorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');

    (vscode.workspace as any).getWorkspaceFolder = () => undefined;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: undefined,
      configurable: true,
    });
  });

  teardown(() => {
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;

    if (originalActiveTextEditorDescriptor) {
      Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditorDescriptor);
    }
  });

  test('resolveContextTokens resolves workspaceFolder and workspaceFolderBasename', () => {
    const result = resolveContextTokens('cd ${workspaceFolder}/${workspaceFolderBasename}', {
      workspaceFolder: '/repo/app',
      workspaceFolderBasename: 'app',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, 'cd /repo/app/app');
  });

  test('resolveContextTokens resolves file token family', () => {
    const result = resolveContextTokens(
      '${file}|${fileBasename}|${fileDirname}|${fileExtname}|${fileBasenameNoExtension}',
      {
        workspaceFolder: '',
        workspaceFolderBasename: '',
        activeFile: '/repo/src/main.test.ts',
        processEnv: {},
      },
    );

    assert.strictEqual(result, '/repo/src/main.test.ts|main.test.ts|/repo/src|.ts|main.test');
  });

  test('resolveContextTokens resolves file token family to empty values without active file', () => {
    const result = resolveContextTokens('${file}|${fileBasename}|${fileDirname}|${fileExtname}|${fileBasenameNoExtension}', {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, '||||');
  });

  test('resolveContextTokens resolves pathSeparator', () => {
    const result = resolveContextTokens('a${pathSeparator}b', {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, `a${path.sep}b`);
  });

  test('resolveContextTokens resolves known env var', () => {
    const result = resolveContextTokens('echo ${env.KNOWN}', {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: { KNOWN: 'value' },
    });

    assert.strictEqual(result, 'echo value');
  });

  test('resolveContextTokens resolves unknown env var to empty string', () => {
    const result = resolveContextTokens('echo ${env.MISSING}', {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, 'echo ');
  });

  test('resolveContextTokens handles nested-looking env token without crashing', () => {
    const result = resolveContextTokens('echo ${env.${workspaceFolder}}', {
      workspaceFolder: '/repo',
      workspaceFolderBasename: 'repo',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, 'echo ');
  });

  test('resolveContextTokens preserves unknown ${...} token and shell $VAR syntax', () => {
    const result = resolveContextTokens('echo ${HOME_VAR} $PATH', {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, 'echo ${HOME_VAR} $PATH');
  });

  test('resolveContextTokens replaces multiple tokens in one string', () => {
    const result = resolveContextTokens('wf=${workspaceFolder};f=${file};env=${env.A}', {
      workspaceFolder: '/repo',
      workspaceFolderBasename: 'repo',
      activeFile: '/repo/src/a.ts',
      processEnv: { A: '1' },
    });

    assert.strictEqual(result, 'wf=/repo;f=/repo/src/a.ts;env=1');
  });

  test('resolveContextTokens returns unchanged string when no token exists', () => {
    const input = 'echo hello';
    const result = resolveContextTokens(input, {
      workspaceFolder: '',
      workspaceFolderBasename: '',
      activeFile: '',
      processEnv: {},
    });

    assert.strictEqual(result, input);
  });

  test('buildContextFromVscode reads workspace and active editor values', () => {
    const wsUri = vscode.Uri.file('/repo');
    (vscode.workspace as any).getWorkspaceFolder = () => ({
      uri: wsUri,
      name: 'repo',
      index: 0,
    });

    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: {
        document: {
          uri: vscode.Uri.file('/repo/src/index.ts'),
        },
      } as unknown as vscode.TextEditor,
      configurable: true,
    });

    const ctx = buildContextFromVscode(vscode.Uri.file('/repo/src/a.ts'));
    assert.strictEqual(ctx.workspaceFolder, '/repo');
    assert.strictEqual(ctx.workspaceFolderBasename, 'repo');
    assert.strictEqual(ctx.activeFile, '/repo/src/index.ts');
    assert.strictEqual(ctx.processEnv, process.env);
  });

  test('buildContextFromVscode handles missing workspace and active editor', () => {
    (vscode.workspace as any).getWorkspaceFolder = () => undefined;
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: undefined,
      configurable: true,
    });

    const ctx = buildContextFromVscode(vscode.Uri.file('/outside/file.txt'));
    assert.strictEqual(ctx.workspaceFolder, '');
    assert.strictEqual(ctx.workspaceFolderBasename, '');
    assert.strictEqual(ctx.activeFile, '');
  });
});
