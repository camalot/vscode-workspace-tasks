import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskEnvFileResolver } from '../../services/taskEnvFileResolver';

/**
 * Tests for TaskEnvFileResolver — resolveFileReferences and parseEnvFile.
 */
suite('TaskEnvFileResolver Test Suite', () => {
  let workspaceRoot: vscode.Uri;
  let testFolder: vscode.Uri;
  let originalFindFiles: typeof vscode.workspace.findFiles;

  /**
   * Write a UTF-8 file under `testFolder`.
   */
  async function writeFile(relativePath: string, content: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(testFolder, relativePath);
    const parentDir = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.createDirectory(parentDir);
    } catch { /* already exists */ }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return uri;
  }

  setup(async function (this: Mocha.Context) {
    this.timeout(30000);

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
    } else {
      workspaceRoot = vscode.Uri.file(process.cwd());
    }

    testFolder = vscode.Uri.joinPath(workspaceRoot, '.test-task-env-file-resolver');
    try {
      await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
    } catch { /* not present */ }
    await vscode.workspace.fs.createDirectory(testFolder);

    originalFindFiles = vscode.workspace.findFiles;
  });

  teardown(async function (this: Mocha.Context) {
    this.timeout(30000);
    try {
      await vscode.workspace.fs.delete(testFolder, { recursive: true, useTrash: false });
    } catch { /* ignore */ }
    (vscode.workspace as any).findFiles = originalFindFiles;
  });

  // -------------------------------------------------------------------------
  // resolveFileReferences — single string form
  // -------------------------------------------------------------------------

  test('resolveFileReferences: single string — existing plain path', async () => {
    await writeFile('.env', 'HELLO=world\n');
    const results = await TaskEnvFileResolver.resolveFileReferences('.env', testFolder);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(path.basename(results[0]), '.env');
  });

  test('resolveFileReferences: single string — non-existent plain path returns []', async () => {
    const results = await TaskEnvFileResolver.resolveFileReferences('.env.does-not-exist', testFolder);
    assert.deepStrictEqual(results, []);
  });

  test('resolveFileReferences: single glob string — expands to all matching files sorted', async () => {
    await writeFile('.env.dev', 'A=1\n');
    await writeFile('.env.local', 'B=2\n');
    await writeFile('.env.prod', 'C=3\n');

    const relativeTestDir = path.relative(workspaceRoot.fsPath, testFolder.fsPath);
    const results = await TaskEnvFileResolver.resolveFileReferences(
      `${relativeTestDir}/.env.*`,
      workspaceRoot,
    );

    assert.ok(results.length >= 3, `Expected at least 3 results, got ${results.length}`);
    // Results must be sorted alphabetically
    const basenames = results.map((r) => path.basename(r));
    const sorted = [...basenames].sort();
    assert.deepStrictEqual(basenames, sorted, 'Results must be sorted alphabetically');
  });

  // -------------------------------------------------------------------------
  // resolveFileReferences — array form
  // -------------------------------------------------------------------------

  test('resolveFileReferences: array form — processes in order, skips missing', async () => {
    await writeFile('.env.first', 'FIRST=1\n');
    await writeFile('.env.third', 'THIRD=3\n');

    const results = await TaskEnvFileResolver.resolveFileReferences(
      ['.env.first', '.env.missing', '.env.third'],
      testFolder,
    );
    assert.strictEqual(results.length, 2);
    assert.ok(results[0].endsWith('.env.first'), 'First result should be .env.first');
    assert.ok(results[1].endsWith('.env.third'), 'Second result should be .env.third');
  });

  test('resolveFileReferences: array form — preserves explicit order (not alpha-sorted)', async () => {
    await writeFile('.env.z', 'Z=26\n');
    await writeFile('.env.a', 'A=1\n');

    const results = await TaskEnvFileResolver.resolveFileReferences(
      ['.env.z', '.env.a'],
      testFolder,
    );
    assert.strictEqual(results.length, 2);
    assert.ok(results[0].endsWith('.env.z'), 'First item should be .env.z (array order preserved)');
    assert.ok(results[1].endsWith('.env.a'), 'Second item should be .env.a');
  });

  // -------------------------------------------------------------------------
  // resolveFileReferences — include/exclude object form
  // -------------------------------------------------------------------------

  test('resolveFileReferences: include/exclude object — includes and excludes correctly', async () => {
    await writeFile('.env', 'BASE=1\n');
    await writeFile('.env.local', 'LOCAL=2\n');
    await writeFile('.env.secret', 'SECRET=3\n');

    const relativeTestDir = path.relative(workspaceRoot.fsPath, testFolder.fsPath);
    const results = await TaskEnvFileResolver.resolveFileReferences(
      {
        include: [`${relativeTestDir}/.env`, `${relativeTestDir}/.env.*`],
        exclude: [`${relativeTestDir}/.env.secret`],
      },
      workspaceRoot,
    );

    const basenames = results.map((r) => path.basename(r));
    assert.ok(basenames.includes('.env'), 'Should include .env');
    assert.ok(basenames.includes('.env.local'), 'Should include .env.local');
    assert.ok(!basenames.includes('.env.secret'), 'Should exclude .env.secret');
  });

  test('resolveFileReferences: include/exclude object — results sorted alphabetically', async () => {
    await writeFile('.env.z', 'Z=1\n');
    await writeFile('.env.a', 'A=2\n');
    await writeFile('.env.m', 'M=3\n');

    const relativeTestDir = path.relative(workspaceRoot.fsPath, testFolder.fsPath);
    const results = await TaskEnvFileResolver.resolveFileReferences(
      { include: [`${relativeTestDir}/.env.*`] },
      workspaceRoot,
    );

    const basenames = results.map((r) => path.basename(r));
    const sorted = [...basenames].sort();
    assert.deepStrictEqual(basenames, sorted, 'include/exclude results must be sorted alphabetically');
  });

  test('resolveFileReferences: include/exclude object — deduplicates paths', async () => {
    await writeFile('.env.dup', 'DUP=1\n');

    const relativeTestDir = path.relative(workspaceRoot.fsPath, testFolder.fsPath);
    // Include the same pattern twice — should deduplicate
    const results = await TaskEnvFileResolver.resolveFileReferences(
      {
        include: [
          `${relativeTestDir}/.env.dup`,
          `${relativeTestDir}/.env.dup`,
        ],
      },
      workspaceRoot,
    );

    const basenames = results.map((r) => path.basename(r));
    const dupCount = basenames.filter((b) => b === '.env.dup').length;
    assert.strictEqual(dupCount, 1, 'Duplicate paths should be deduplicated');
  });

  // -------------------------------------------------------------------------
  // parseEnvFile
  // -------------------------------------------------------------------------

  test('parseEnvFile: parses simple KEY=VALUE entries', async () => {
    const fileUri = await writeFile('.env.simple', 'FOO=bar\nBAZ=qux\n');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['FOO'], 'bar');
    assert.strictEqual(result['BAZ'], 'qux');
  });

  test('parseEnvFile: handles quoted values', async () => {
    const fileUri = await writeFile('.env.quoted', 'TOKEN="my secret value"\nSIMPLE=plain\n');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['TOKEN'], 'my secret value');
    assert.strictEqual(result['SIMPLE'], 'plain');
  });

  test('parseEnvFile: handles export prefix', async () => {
    const fileUri = await writeFile('.env.export', 'export DB_HOST=localhost\nexport DB_PORT=5432\n');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['DB_HOST'], 'localhost');
    assert.strictEqual(result['DB_PORT'], '5432');
  });

  test('parseEnvFile: strips inline comments', async () => {
    const fileUri = await writeFile('.env.comments', 'NODE_ENV=development # this is a comment\n# full line comment\nDEBUG=true\n');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['NODE_ENV'], 'development');
    assert.strictEqual(result['DEBUG'], 'true');
    assert.ok(!('# full line comment' in result), 'Full-line comments must not produce keys');
  });

  test('parseEnvFile: returns {} for missing file', () => {
    const result = TaskEnvFileResolver.parseEnvFile('/this/path/does/not/exist/.env');
    assert.deepStrictEqual(result, {});
  });

  test('parseEnvFile: returns {} for empty file', async () => {
    const fileUri = await writeFile('.env.empty', '');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.deepStrictEqual(result, {});
  });

  test('parseEnvFile: handles single-quoted values', async () => {
    const fileUri = await writeFile('.env.singlequote', "PASSWORD='my p@ss!'\n");
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['PASSWORD'], 'my p@ss!');
  });

  test('parseEnvFile: works identically for .secret files', async () => {
    const fileUri = await writeFile('.secrets', 'DEPLOY_TOKEN=abc123\nDB_PASSWORD=hunter2\n');
    const result = TaskEnvFileResolver.parseEnvFile(fileUri.fsPath);
    assert.strictEqual(result['DEPLOY_TOKEN'], 'abc123');
    assert.strictEqual(result['DB_PASSWORD'], 'hunter2');
  });
});
