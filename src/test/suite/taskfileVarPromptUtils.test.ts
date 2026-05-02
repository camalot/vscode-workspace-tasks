import * as assert from 'assert';
import * as vscode from 'vscode';
import { promptAndResolveRequiredVars, TaskfileRequiredVar } from '../../libs/taskfileVarPromptUtils';

suite('taskfileVarPromptUtils Test Suite', () => {
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowInputBox: typeof vscode.window.showInputBox;

  setup(() => {
    originalShowQuickPick = vscode.window.showQuickPick;
    originalShowInputBox = vscode.window.showInputBox;
  });

  teardown(() => {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  });

  test('prompts enum vars with quick pick and returns quoted assignment', async () => {
    let quickPickIgnoreFocusOut: boolean | undefined;
    (vscode.window as any).showQuickPick = async (_items: string[], options: vscode.QuickPickOptions) => {
      quickPickIgnoreFocusOut = options.ignoreFocusOut;
      return 'prod';
    };

    const vars: TaskfileRequiredVar[] = [{ name: 'ENV', enum: ['dev', 'prod'] }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.deepStrictEqual(result, ["ENV='prod'"]);
    assert.strictEqual(quickPickIgnoreFocusOut, true);
  });

  test('prompts plain vars with input box and returns quoted assignment', async () => {
    let inputIgnoreFocusOut: boolean | undefined;
    (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
      inputIgnoreFocusOut = options.ignoreFocusOut;
      return '1.2.3';
    };

    const vars: TaskfileRequiredVar[] = [{ name: 'VERSION' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.deepStrictEqual(result, ["VERSION='1.2.3'"]);
    assert.strictEqual(inputIgnoreFocusOut, true);
  });

  test('escapes single quotes in values', async () => {
    (vscode.window as any).showInputBox = async () => `it's-ready`;

    const vars: TaskfileRequiredVar[] = [{ name: 'MESSAGE' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.deepStrictEqual(result, ["MESSAGE='it'\\''s-ready'"]);
  });

  test('returns undefined when quick pick is cancelled', async () => {
    (vscode.window as any).showQuickPick = async () => undefined;

    const vars: TaskfileRequiredVar[] = [{ name: 'ENV', enum: ['dev', 'prod'] }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.strictEqual(result, undefined);
  });

  test('returns undefined when input box is cancelled', async () => {
    (vscode.window as any).showInputBox = async () => undefined;

    const vars: TaskfileRequiredVar[] = [{ name: 'VERSION' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.strictEqual(result, undefined);
  });

  test('input validation rejects whitespace-only values', async () => {
    let validationMessage: string | undefined;
    (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
      const validation = options.validateInput?.('   ');
      validationMessage = typeof validation === 'string' ? validation : undefined;
      return 'ok';
    };

    const vars: TaskfileRequiredVar[] = [{ name: 'VERSION' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy');

    assert.strictEqual(validationMessage, 'Value cannot be empty');
    assert.deepStrictEqual(result, ["VERSION='ok'"]);
  });

  test('runTask mode skips prompting for vars with predefined defaults', async () => {
    let inputCalls = 0;
    (vscode.window as any).showInputBox = async () => {
      inputCalls += 1;
      return 'manual';
    };

    const vars: TaskfileRequiredVar[] = [{ name: 'APP_NAME' }, { name: 'ENV' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy', {
      mode: 'runTask',
      defaultsByName: { APP_NAME: 'my-app' },
    });

    assert.deepStrictEqual(result, ["ENV='manual'"]);
    assert.strictEqual(inputCalls, 1);
  });

  test('runWithArgs mode prompts with predefined default in input box', async () => {
    let defaultValueSeen: string | undefined;
    (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
      defaultValueSeen = options.value;
      return options.value;
    };

    const vars: TaskfileRequiredVar[] = [{ name: 'APP_NAME' }];
    const result = await promptAndResolveRequiredVars(vars, 'deploy', {
      mode: 'runWithArgs',
      defaultsByName: { APP_NAME: 'my-app' },
    });

    assert.strictEqual(defaultValueSeen, 'my-app');
    assert.deepStrictEqual(result, ["APP_NAME='my-app'"]);
  });
});
