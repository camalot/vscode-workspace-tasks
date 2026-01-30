import * as assert from 'assert';
import { PipenvTaskProvider } from '../../providers/pipenvTaskProvider';

suite('TOML Provider', () => {
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
});
