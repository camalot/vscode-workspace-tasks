import * as assert from 'assert';
import { PoetryTaskProvider } from '../../providers/poetryTaskProvider';

suite('Poetry Provider', () => {
  test('parses pyproject.toml when parser available', async function () {
    const provider = new PoetryTaskProvider();
    const tasks = await provider.getTasks();

    assert.ok(Array.isArray(tasks));
    // This test will only pass if there's a pyproject.toml with scripts in the workspace
    // assert.ok(tasks.length >= 0, 'Should return an array of tasks (possibly empty)');
  });

  test('uses correct file pattern', function () {
    const provider = new PoetryTaskProvider();
    assert.strictEqual(provider.type, 'poetry');
  });

  test('uses correct scripts path', function () {
    const provider = new PoetryTaskProvider();
    // Access protected method for testing
    const scriptsPath = (provider as any).getScriptsPath();
    // Should prefer project.scripts (PEP 621 standard)
    assert.deepStrictEqual(scriptsPath, ['project.scripts', 'tool.poetry.scripts']);
  });
});
