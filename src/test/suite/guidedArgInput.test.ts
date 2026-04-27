import * as assert from 'assert';
import * as vscode from 'vscode';
import { collectGuidedArgs } from '../../libs/guidedArgInput';
import { ScriptParameter } from '../../libs/scriptArgumentResolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParam(overrides: Partial<ScriptParameter> & { name: string }): ScriptParameter {
  return { type: 'string', required: false, ...overrides };
}

// ---------------------------------------------------------------------------
// switch type (store_true / store_false)
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — switch type', () => {
  let origShowQuickPick: typeof vscode.window.showQuickPick;

  setup(() => {
    origShowQuickPick = vscode.window.showQuickPick;
  });

  teardown(() => {
    (vscode.window as any).showQuickPick = origShowQuickPick;
  });

  test('Yes → includes cliName flag', async () => {
    (vscode.window as any).showQuickPick = async (items: any[]) => items.find((i: any) => i.label === 'Yes');
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', type: 'switch', cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--verbose']);
  });

  test('No → empty array (flag omitted)', async () => {
    (vscode.window as any).showQuickPick = async (items: any[]) => items.find((i: any) => i.label === 'No');
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', type: 'switch', cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('escape + required → undefined (abort)', async () => {
    (vscode.window as any).showQuickPick = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', type: 'switch', required: true, cliName: '--verbose' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape + not required → empty array (continue)', async () => {
    (vscode.window as any).showQuickPick = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', type: 'switch', required: false, cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('PowerShell switch without cliName → -Name format', async () => {
    (vscode.window as any).showQuickPick = async (items: any[]) => items.find((i: any) => i.label === 'Yes');
    const result = await collectGuidedArgs(
      [makeParam({ name: 'Verbose', type: 'switch' })],
      'test',
    );
    assert.deepStrictEqual(result, ['-Verbose']);
  });

  test('store_false switch: Yes still includes the flag as-is', async () => {
    (vscode.window as any).showQuickPick = async (items: any[]) => items.find((i: any) => i.label === 'Yes');
    const result = await collectGuidedArgs(
      [makeParam({ name: 'no_cache', type: 'switch', action: 'store_false', cliName: '--no-cache' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--no-cache']);
  });
});

// ---------------------------------------------------------------------------
// action=count
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — action=count', () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('count=3 → flag repeated 3 times', async () => {
    (vscode.window as any).showInputBox = async () => '3';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', action: 'count', cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--verbose', '--verbose', '--verbose']);
  });

  test('empty input → empty array', async () => {
    (vscode.window as any).showInputBox = async () => '';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', action: 'count', cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('non-numeric input → empty array', async () => {
    (vscode.window as any).showInputBox = async () => 'abc';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', action: 'count', cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('escape + required → undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', action: 'count', required: true, cliName: '--verbose' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape + not required → empty array', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'verbose', action: 'count', required: false, cliName: '--verbose' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('uses PowerShell -Name format when no cliName', async () => {
    (vscode.window as any).showInputBox = async () => '2';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'Verbose', action: 'count' })],
      'test',
    );
    assert.deepStrictEqual(result, ['-Verbose', '-Verbose']);
  });
});

// ---------------------------------------------------------------------------
// nargs='*' (zero or more)
// ---------------------------------------------------------------------------

suite("collectGuidedArgs — nargs='*'", () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('collects values until empty string, assembles as flag v1 v2', async () => {
    const responses = ['reading', 'coding', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'hobbies', nargs: '*', cliName: '--hobbies' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--hobbies', 'reading', 'coding']);
  });

  test('escape on first value + not required → empty array (skip)', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'hobbies', nargs: '*', required: false, cliName: '--hobbies' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('escape on first value + required → undefined (abort)', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'hobbies', nargs: '*', required: true, cliName: '--hobbies' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape after providing values → uses collected values (stop loop)', async () => {
    const responses: Array<string | undefined> = ['reading', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'hobbies', nargs: '*', cliName: '--hobbies' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--hobbies', 'reading']);
  });

  test('first value empty string → empty array (no flag)', async () => {
    (vscode.window as any).showInputBox = async () => '';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'hobbies', nargs: '*', cliName: '--hobbies' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// nargs='+' (one or more)
// ---------------------------------------------------------------------------

suite("collectGuidedArgs — nargs='+'", () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('escape on first value + required → undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'files', nargs: '+', required: true, cliName: '--files' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape on first value + not required → empty array', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'files', nargs: '+', required: false, cliName: '--files' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('1 value then escape (required) → uses the 1 collected value', async () => {
    const responses: Array<string | undefined> = ['file.txt', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'files', nargs: '+', required: true, cliName: '--files' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--files', 'file.txt']);
  });

  test('multiple values then empty string → uses collected values', async () => {
    const responses = ['a.txt', 'b.txt', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'files', nargs: '+', cliName: '--files' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--files', 'a.txt', 'b.txt']);
  });
});

// ---------------------------------------------------------------------------
// nargs=N (exact count)
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — nargs=N (exact count)', () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('collects exactly N values → flag v1 v2', async () => {
    const responses = ['10', '20'];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'range', nargs: 2, type: 'int', cliName: '--range' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--range', '10', '20']);
  });

  test('escape + required → undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'range', nargs: 2, required: true, cliName: '--range' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape mid-collection + not required → empty array (discard partial)', async () => {
    const responses: Array<string | undefined> = ['10', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'range', nargs: 2, required: false, cliName: '--range' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// action='append'
// ---------------------------------------------------------------------------

suite("collectGuidedArgs — action='append'", () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('values until empty → repeated flag format (--flag v1 --flag v2)', async () => {
    const responses = ['tag1', 'tag2', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'tag', action: 'append', cliName: '--tag' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--tag', 'tag1', '--tag', 'tag2']);
  });

  test('escape on first value + not required → empty array', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'tag', action: 'append', required: false, cliName: '--tag' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('escape on first value + required → undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'tag', action: 'append', required: true, cliName: '--tag' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape after 1 value → uses collected value in repeated format', async () => {
    const responses: Array<string | undefined> = ['tag1', undefined];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'tag', action: 'append', cliName: '--tag' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--tag', 'tag1']);
  });
});

// ---------------------------------------------------------------------------
// action='extend' (inline values, not repeated flag)
// ---------------------------------------------------------------------------

suite("collectGuidedArgs — action='extend'", () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('values until empty → inline format (--flag v1 v2)', async () => {
    const responses = ['a', 'b', ''];
    let i = 0;
    (vscode.window as any).showInputBox = async () => responses[i++];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'items', action: 'extend', nargs: '*', cliName: '--items' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--items', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// choices
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — choices', () => {
  let origShowQuickPick: typeof vscode.window.showQuickPick;

  setup(() => {
    origShowQuickPick = vscode.window.showQuickPick;
  });

  teardown(() => {
    (vscode.window as any).showQuickPick = origShowQuickPick;
  });

  test('selected value → flag + value', async () => {
    (vscode.window as any).showQuickPick = async (items: string[]) => items[0];
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', choices: ['dev', 'prod'], cliName: '--env' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--env', 'dev']);
  });

  test('escape + required → undefined', async () => {
    (vscode.window as any).showQuickPick = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', choices: ['dev', 'prod'], required: true, cliName: '--env' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape + not required → empty array', async () => {
    (vscode.window as any).showQuickPick = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', choices: ['dev', 'prod'], required: false, cliName: '--env' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// single value
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — single value', () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('valid value → flag + value', async () => {
    (vscode.window as any).showInputBox = async () => 'production';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', cliName: '--env' })],
      'test',
    );
    assert.deepStrictEqual(result, ['--env', 'production']);
  });

  test('empty string → empty array (param skipped)', async () => {
    (vscode.window as any).showInputBox = async () => '';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', cliName: '--env' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('escape + required → undefined', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', required: true, cliName: '--env' })],
      'test',
    );
    assert.strictEqual(result, undefined);
  });

  test('escape + not required → empty array', async () => {
    (vscode.window as any).showInputBox = async () => undefined;
    const result = await collectGuidedArgs(
      [makeParam({ name: 'env', required: false, cliName: '--env' })],
      'test',
    );
    assert.deepStrictEqual(result, []);
  });

  test('PowerShell param without cliName → -Name value', async () => {
    (vscode.window as any).showInputBox = async () => 'Production';
    const result = await collectGuidedArgs(
      [makeParam({ name: 'Environment' })],
      'test',
    );
    assert.deepStrictEqual(result, ['-Environment', 'Production']);
  });
});

// ---------------------------------------------------------------------------
// multi-param abort propagation
// ---------------------------------------------------------------------------

suite('collectGuidedArgs — abort propagation', () => {
  let origShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    origShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showInputBox = origShowInputBox;
  });

  test('cancelling first required param aborts all remaining params', async () => {
    let callCount = 0;
    (vscode.window as any).showInputBox = async () => {
      callCount++;
      return undefined; // always escape
    };
    const params = [
      makeParam({ name: 'first', required: true, cliName: '--first' }),
      makeParam({ name: 'second', required: false, cliName: '--second' }),
    ];
    const result = await collectGuidedArgs(params, 'test');
    assert.strictEqual(result, undefined);
    assert.strictEqual(callCount, 1, 'Should stop after first required param is cancelled');
  });

  test('cancelling non-required param skips it and continues', async () => {
    let callCount = 0;
    const responses: Array<string | undefined> = [undefined, 'bar'];
    (vscode.window as any).showInputBox = async () => responses[callCount++];
    const params = [
      makeParam({ name: 'optional', required: false, cliName: '--optional' }),
      makeParam({ name: 'another', required: false, cliName: '--another' }),
    ];
    const result = await collectGuidedArgs(params, 'test');
    assert.deepStrictEqual(result, ['--another', 'bar']);
    assert.strictEqual(callCount, 2);
  });
});
