import * as assert from 'assert';
import { injectArgs } from '../../taskFactory';

suite('injectArgs Test Suite', () => {
  test('replaces ${args} when args are provided', () => {
    const result = injectArgs('docker run ${args} image', '--rm');
    assert.strictEqual(result, 'docker run --rm image');
  });

  test('replaces all ${args} occurrences', () => {
    const result = injectArgs('echo ${args} && echo ${args}', 'x');
    assert.strictEqual(result, 'echo x && echo x');
  });

  test('appends args when placeholder is absent', () => {
    const result = injectArgs('npm run build', '--watch');
    assert.strictEqual(result, 'npm run build --watch');
  });

  test('returns unchanged command when args are undefined', () => {
    const input = 'npm run build';
    const result = injectArgs(input, undefined);
    assert.strictEqual(result, input);
  });

  test('returns unchanged command when args are empty string', () => {
    const input = 'npm run build';
    const result = injectArgs(input, '');
    assert.strictEqual(result, input);
  });

  test('preserves replacement strings with $ metacharacters', () => {
    const result = injectArgs('echo ${args}', '$& $$');
    assert.strictEqual(result, 'echo $& $$');
  });

  test('replaces ${args} at start, middle, and end', () => {
    assert.strictEqual(injectArgs('${args} cmd', 'a'), 'a cmd');
    assert.strictEqual(injectArgs('cmd ${args} tail', 'a'), 'cmd a tail');
    assert.strictEqual(injectArgs('cmd ${args}', 'a'), 'cmd a');
  });
});
