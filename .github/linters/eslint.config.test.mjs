import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import n from 'eslint-plugin-n';

const eslint = new ESLint({
  overrideConfigFile: fileURLToPath(new URL('./eslint.config.mjs', import.meta.url)),
});

for (const [extension, source] of [
  ['json', '{"value": true}'],
  ['jsonc', '{/* comment */ "value": true,}'],
  ['json5', "{value: 'text',}"],
]) {
  test(`accepts valid ${extension}`, async () => {
    const [result] = await eslint.lintText(source, { filePath: `fixture.${extension}` });
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
    assert.equal(result.warningCount, 0, JSON.stringify(result.messages));
  });

  test(`rejects invalid ${extension}`, async () => {
    const [result] = await eslint.lintText('{"value": }', { filePath: `fixture.${extension}` });
    assert.ok(result.errorCount > 0);
  });
}

test('keeps JSON strict', async () => {
  const [result] = await eslint.lintText('{/* comment */ "value": true,}', { filePath: 'fixture.json' });
  assert.ok(result.errorCount > 0);
});

for (const extension of ['js', 'ts', 'vue']) {
  test(`loads the ${extension} configuration alongside JSON presets`, async () => {
    const config = await eslint.calculateConfigForFile(`fixture.${extension}`);
    assert.ok(config);
    assert.equal(config.plugins.jsonc, undefined);
  });
}

for (const extension of ['ts', 'cts', 'mts', 'tsx']) {
  test(`applies the native Node recommended rules to ${extension}`, async () => {
    const config = await eslint.calculateConfigForFile(`fixture.${extension}`);
    assert.equal(config.plugins.n, n);
    assert.deepEqual(config.rules['n/no-process-exit'], [2]);
    assert.deepEqual(config.rules['n/no-deprecated-api'], [2]);
  });
}

test('does not apply Node recommended rules to JavaScript', async () => {
  const config = await eslint.calculateConfigForFile('fixture.js');
  assert.equal(config.rules['n/no-process-exit'], undefined);
});
