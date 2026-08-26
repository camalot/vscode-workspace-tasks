import * as assert from 'assert';
import * as vscode from 'vscode';
import { PipenvTaskProvider } from '../../providers/pipenvTaskProvider';
import constants from '../../libs/constants';

suite('TOML Provider', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  /*
  test('skips files when parser unavailable', async function () {
    // Temporarily stub dynamic import helper to simulate parser unavailable
    // Use require to mutate the exported function
    const di = require('../../utils/dynamicImport');
    const original = di.tryDynamicImport;
    di.tryDynamicImport = async () => undefined;

    const provider = new PipenvTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    assert.strictEqual(tasks.length, 0, 'No tasks should be returned when TOML parser is unavailable');

    // Restore original
    di.tryDynamicImport = original;
  });
  */

  test('parses Pipfile when parser available', async function () {
    // If parser is not available in the runtime, this test will fail at compile-time (legacy behavior)
    const provider = new PipenvTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length > 0, 'Should find tasks in sample Pipfile when parser is available');

    const labels = tasks.map((t) => t.label);
    // ../task-files/pipfile/Pipfile contains an "all" script
    assert.ok(labels.includes('all'));
  });

  test('getFilePatterns merges the generic setting with the built-in TOML pattern', () => {
    const previous = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            if (key === 'additionalFilePatterns') {
              return { pipenv: ['**/Pipfile.custom'] } as T;
            }
            return def as T;
          },
        };
      }
      return previous(section);
    };

    try {
      const provider = new PipenvTaskProvider();
      assert.deepStrictEqual(provider.getFilePatterns(), [constants.GLOB_PIPENV, '**/Pipfile.custom']);
    } finally {
      (vscode.workspace as any).getConfiguration = previous;
    }
  });
});
