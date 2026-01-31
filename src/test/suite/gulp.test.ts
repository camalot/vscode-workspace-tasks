import * as assert from 'assert';
import { GulpTaskProvider } from '../../providers/gulpTaskProvider';

suite('Gulp Provider Test Suite', () => {
  test('Discovers tasks in sample gulpfile.mjs and referenced in series/parallel', async () => {
    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();

    // Should find at least the sample tasks defined in ../task-files/gulp/gulpfile.mjs
    const names = tasks.map((t) => t.label);
    assert.ok(names.includes('group-test2-build-ui-one'));
    assert.ok(names.includes('group-test2-build-ui-two'));
    assert.ok(names.includes('group-test2-build-ui-three'));

    // Also check for tasks referenced via series/parallel on the other sample gulpfile.js
    // which references functions like 'styles' and 'scripts'
    assert.ok(names.includes('styles') || names.includes('scripts') || names.includes('watchFiles'));
  });
});
