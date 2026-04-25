import * as assert from 'assert';
import * as vscode from 'vscode';
import { registerLmTools } from '../../tools/index';

suite('tools/index Test Suite', () => {
  let originalRegisterTool: unknown;
  let lmObject: any;

  setup(() => {
    lmObject = (vscode as any).lm;
    originalRegisterTool = lmObject?.registerTool;
  });

  teardown(() => {
    if (lmObject && originalRegisterTool !== undefined) {
      lmObject.registerTool = originalRegisterTool;
    }
  });

  test('registerLmTools registers workspaceTasks_getTasks and workspaceTasks_runTask', () => {
    const registered: string[] = [];
    if (!lmObject) {
      throw new Error('vscode.lm is not available in this test environment');
    }

    lmObject.registerTool = (name: string) => {
      registered.push(name);
      return { dispose: () => undefined };
    };

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerLmTools(context);

    assert.deepStrictEqual(registered.sort(), ['workspaceTasks_getTasks', 'workspaceTasks_runTask'].sort());
    assert.strictEqual(context.subscriptions.length, 2);
  });
});
