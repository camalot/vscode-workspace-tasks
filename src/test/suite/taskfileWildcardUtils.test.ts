import * as assert from 'assert';
import * as vscode from 'vscode';
import { promptAndResolveWildcards } from '../../libs/taskfileWildcardUtils';

suite('taskfileWildcardUtils Test Suite', () => {
  let originalShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    originalShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = originalShowInputBox;
  });

  // ── T-P1 ──────────────────────────────────────────────────────────────────
  test('T-P1: single wildcard resolved correctly', async () => {
    (vscode.window as any).showInputBox = async () => 'foo';
    const result = await promptAndResolveWildcards('start:*', 1);
    assert.strictEqual(result, 'start:foo');
  });

  // ── T-P2 ──────────────────────────────────────────────────────────────────
  test('T-P2: two wildcards resolved in order', async () => {
    const responses = ['web', '3'];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await promptAndResolveWildcards('start:*:*', 2);
    assert.strictEqual(result, 'start:web:3');
  });

  // ── T-P3 ──────────────────────────────────────────────────────────────────
  test('T-P3: user cancels first prompt returns undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await promptAndResolveWildcards('start:*', 1);
    assert.strictEqual(result, undefined);
  });

  // ── T-P4 ──────────────────────────────────────────────────────────────────
  test('T-P4: user cancels second prompt of two returns undefined', async () => {
    const responses: Array<string | undefined> = ['web', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await promptAndResolveWildcards('start:*:*', 2);
    assert.strictEqual(result, undefined);
  });

  // ── T-P5 ──────────────────────────────────────────────────────────────────
  test('T-P5: value containing * does not corrupt subsequent wildcard substitution', async () => {
    const responses = ['a*b', 'c'];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    // Template: 'deploy:*:*'  → 'deploy:a*b:c'
    const result = await promptAndResolveWildcards('deploy:*:*', 2);
    assert.strictEqual(result, 'deploy:a*b:c');
  });

  // ── T-P6 ──────────────────────────────────────────────────────────────────
  test('T-P6: validateInput rejects empty/whitespace-only string', async () => {
    let capturedValidate: ((v: string) => string | undefined) | undefined;
    (vscode.window as any).showInputBox = async (opts: vscode.InputBoxOptions) => {
      capturedValidate = opts.validateInput as (v: string) => string | undefined;
      return 'valid';
    };
    await promptAndResolveWildcards('start:*', 1);
    assert.ok(capturedValidate, 'validateInput should be provided');
    assert.strictEqual(capturedValidate!(''), 'Value cannot be empty');
    assert.strictEqual(capturedValidate!('   '), 'Value cannot be empty');
    assert.strictEqual(capturedValidate!('foo'), undefined);
  });

  // ── Additional: no wildcards ───────────────────────────────────────────────
  test('zero wildcards returns template unchanged without prompting', async () => {
    let prompted = false;
    (vscode.window as any).showInputBox = async () => {
      prompted = true;
      return 'x';
    };
    const result = await promptAndResolveWildcards('build', 0);
    assert.strictEqual(result, 'build');
    assert.strictEqual(prompted, false);
  });
});
