import * as assert from 'assert';
import { NodeParseArgsResolver } from '../../libs/scriptArgumentResolvers/nodeParseArgsResolver';

const resolver = new NodeParseArgsResolver();

suite('NodeParseArgsResolver — canHandle', () => {
  test('returns true for .js, .mjs, .cjs', () => {
    assert.strictEqual(resolver.canHandle('/x/script.js'), true);
    assert.strictEqual(resolver.canHandle('/x/script.mjs'), true);
    assert.strictEqual(resolver.canHandle('/x/script.cjs'), true);
  });

  test('returns false for non-node script extensions', () => {
    assert.strictEqual(resolver.canHandle('/x/script.py'), false);
    assert.strictEqual(resolver.canHandle('/x/script.ps1'), false);
  });
});

suite('NodeParseArgsResolver — resolve', () => {
  test('returns unsupported when parseArgs import is absent', async () => {
    const content = `
const options = { name: { type: 'string' } };
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, false);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('parses node:util parseArgs with options variable reference', async () => {
    const content = `
const { parseArgs } = require('node:util');

const options = {
  name: { type: 'string', short: 'n', default: 'User' },
  age: { type: 'string', short: 'a', default: '25' },
  verbose: { type: 'boolean', short: 'v' },
};

const { values, positionals } = parseArgs({ options, allowPositionals: true, strict: false });
console.log(values, positionals);
`;

    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);

    assert.strictEqual(result.parameters[0].name, 'name');
    assert.strictEqual(result.parameters[0].cliName, '--name');
    assert.strictEqual(result.parameters[0].type, 'string');
    assert.strictEqual(result.parameters[0].defaultValue, 'User');

    assert.strictEqual(result.parameters[1].name, 'age');
    assert.strictEqual(result.parameters[1].type, 'string');
    assert.strictEqual(result.parameters[1].defaultValue, '25');

    assert.strictEqual(result.parameters[2].name, 'verbose');
    assert.strictEqual(result.parameters[2].type, 'switch');
  });

  test('parses @pkgjs/parseargs polyfill and supports inline options object', async () => {
    const content = `
const { parseArgs } = require('@pkgjs/parseargs');

const result = parseArgs({
  options: {
    foo: { type: 'string', multiple: true },
    bar: { type: 'boolean' },
    'log-level': { type: 'string', default: 'info' },
  },
  allowPositionals: true,
});

console.log(result.values);
`;

    const result = await resolver.resolve('/x/script.cjs', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);

    const foo = result.parameters.find((p) => p.name === 'foo');
    assert.ok(foo);
    assert.strictEqual(foo?.action, 'append');
    assert.strictEqual(foo?.nargs, '*');

    const bar = result.parameters.find((p) => p.name === 'bar');
    assert.ok(bar);
    assert.strictEqual(bar?.type, 'switch');

    const logLevel = result.parameters.find((p) => p.name === 'log_level');
    assert.ok(logLevel);
    assert.strictEqual(logLevel?.cliName, '--log-level');
    assert.strictEqual(logLevel?.defaultValue, 'info');
  });
});

suite('NodeParseArgsResolver — private helpers and edge cases', () => {
  const anyResolver = resolver as any;

  test('resolve ignores parseArgs call when config object reference cannot be resolved', async () => {
    const content = `
const { parseArgs } = require('node:util');

parseArgs(unknownConfig);
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('resolve ignores parseArgs call when config object has no options', async () => {
    const content = `
const { parseArgs } = require('node:util');

parseArgs({ allowPositionals: true });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('resolve ignores parseArgs call when options refers to unknown identifier', async () => {
    const content = `
const { parseArgs } = require('@pkgjs/parseargs');

parseArgs({ options: missingOptions });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('collectNamedObjectLiterals skips invalid object literal definitions', () => {
    const content = `
const options = { foo: { type: 'string' };
`;
    const map = anyResolver.collectNamedObjectLiterals(content);
    assert.strictEqual(map.size, 0);
  });

  test('extractParseArgsCalls ignores unbalanced parseArgs calls', () => {
    const content = `
const { parseArgs } = require('node:util');
parseArgs({ options: {};
`;
    const calls = anyResolver.extractParseArgsCalls(content);
    assert.deepStrictEqual(calls, []);
  });

  test('extractOptionsExpression returns undefined for non-object config', () => {
    assert.strictEqual(anyResolver.extractOptionsExpression('options'), undefined);
    assert.strictEqual(anyResolver.extractOptionsExpression('foo'), undefined);
  });

  test('parseOptionsObject returns [] for invalid object values or entries', () => {
    assert.deepStrictEqual(anyResolver.parseOptionsObject('invalid'), []);
    assert.deepStrictEqual(anyResolver.parseOptionsObject('{ foo }'), []);
    assert.deepStrictEqual(anyResolver.parseOptionsObject(`{ foo: bar }`), []);
  });

  test('parseOptionsObject returns unknown type for unsupported type values', () => {
    const result = anyResolver.parseOptionsObject(`{ foo: { type: 'number' } }`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'unknown');
  });

  test('resolveObjectExpression returns undefined for non-identifier expressions', () => {
    assert.strictEqual(anyResolver.resolveObjectExpression('foo()', new Map()), undefined);
  });

  test('trimOuterBraces returns undefined for invalid object strings', () => {
    assert.strictEqual(anyResolver.trimOuterBraces('notAnObject'), undefined);
  });

  test('parseDefaultValue handles boolean and numeric defaults', () => {
    assert.strictEqual(anyResolver.parseDefaultValue(`{ default: true }`), 'true');
    assert.strictEqual(anyResolver.parseDefaultValue(`{ default: false }`), 'false');
    assert.strictEqual(anyResolver.parseDefaultValue(`{ default: -42 }`), '-42');
  });

  test('extractBalanced returns undefined when open position is invalid', () => {
    assert.strictEqual(anyResolver.extractBalanced('abc', 0, '(', ')'), undefined);
  });

  test('splitTopLevel preserves nested separators in parentheses, braces, and brackets', () => {
    const result = anyResolver.splitTopLevel(`a,(b,c),[d,e],{f,g},h`, ',');
    assert.deepStrictEqual(result, ['a', '(b,c)', '[d,e]', '{f,g}', 'h']);
  });
});
