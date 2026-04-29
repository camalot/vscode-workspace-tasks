import * as assert from 'assert';
import { NodeArgparseResolver } from '../../libs/scriptArgumentResolvers/nodeArgparseResolver';

const resolver = new NodeArgparseResolver();

suite('NodeArgparseResolver — canHandle', () => {
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

suite('NodeArgparseResolver — resolve', () => {
  test('returns unsupported when argparse is not imported', async () => {
    const content = `
const x = 1;
console.log(x);
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, false);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('parses common add_argument forms with flags and options object', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser({ description: 'demo' });

parser.add_argument('-n', '--name', { help: 'The user name', required: true, default: 'User' });
parser.add_argument('-v', '--verbose', { action: 'store_true', help: 'Show details' });
parser.add_argument(['-m', '--mode'], { choices: ['dev', 'prod'], default: 'dev' });
`;

    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);

    assert.deepStrictEqual(result.parameters[0], {
      name: 'name',
      type: 'string',
      required: true,
      defaultValue: 'User',
      choices: undefined,
      description: 'The user name',
      cliName: '--name',
    });

    assert.strictEqual(result.parameters[1].name, 'verbose');
    assert.strictEqual(result.parameters[1].type, 'switch');
    assert.strictEqual(result.parameters[1].action, 'store_true');
    assert.strictEqual(result.parameters[1].cliName, '--verbose');

    assert.strictEqual(result.parameters[2].name, 'mode');
    assert.deepStrictEqual(result.parameters[2].choices, ['dev', 'prod']);
    assert.strictEqual(result.parameters[2].defaultValue, 'dev');
  });

  test('supports import syntax and maps nargs/action/count', async () => {
    const content = `
import { ArgumentParser } from 'argparse';
const parser = new ArgumentParser({ description: 'demo' });

parser.add_argument('--files', { nargs: '+', required: true, action: 'extend' });
parser.add_argument('--verbosity', { action: 'count' });
parser.add_argument('--help-me', { action: 'help' });
`;

    const result = await resolver.resolve('/x/script.mjs', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 2, 'help action should be skipped');

    assert.strictEqual(result.parameters[0].name, 'files');
    assert.strictEqual(result.parameters[0].nargs, '+');
    assert.strictEqual(result.parameters[0].action, 'extend');
    assert.strictEqual(result.parameters[0].required, true);

    assert.strictEqual(result.parameters[1].name, 'verbosity');
    assert.strictEqual(result.parameters[1].action, 'count');
  });
});

suite('NodeArgparseResolver — parser helpers', () => {
  const anyResolver = resolver as any;

  test('skips invalid add_argument calls with no arguments', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument();
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('skips malformed add_argument calls when parentheses are unbalanced', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('-n', '--name', { help: 'oops'
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 0);
  });

  test('respects dest override and fallback cliName without long flag', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('-x', { dest: 'example', help: 'Example' });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 1);
    assert.deepStrictEqual(result.parameters[0], {
      name: 'example',
      type: 'string',
      required: false,
      defaultValue: undefined,
      choices: undefined,
      description: 'Example',
      cliName: '-x',
    });
  });

  test('parses flags without an options object', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('-n', '--name');
parser.add_argument(['-a', '--all']);
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 2);
    assert.deepStrictEqual(result.parameters[0], {
      name: 'name',
      type: 'string',
      required: false,
      defaultValue: undefined,
      choices: undefined,
      description: undefined,
      cliName: '--name',
    });
    assert.deepStrictEqual(result.parameters[1], {
      name: 'all',
      type: 'string',
      required: false,
      defaultValue: undefined,
      choices: undefined,
      description: undefined,
      cliName: '--all',
    });
  });

  test('parses explicit type constructors and unknown type names', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('--count', { type: 'int' });
parser.add_argument('--price', { type: Number });
parser.add_argument('--enabled', { type: 'boolean' });
parser.add_argument('--custom', { type: 'custom' });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 4);
    assert.strictEqual(result.parameters[0].type, 'int');
    assert.strictEqual(result.parameters[1].type, 'float');
    assert.strictEqual(result.parameters[2].type, 'bool');
    assert.strictEqual(result.parameters[3].type, 'unknown');
  });

  test('parses default boolean and numeric values', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('--flag', { default: true });
parser.add_argument('--count', { default: 42 });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    const [flagParam, countParam] = result.parameters;
    assert.strictEqual(flagParam.defaultValue, 'true');
    assert.strictEqual(countParam.defaultValue, '42');
  });

  test('parses mixed choices including booleans and numbers', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('--choice', { choices: [true, false, 3, 'x'] });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.deepStrictEqual(result.parameters[0].choices, ['true', 'false', '3', 'x']);
  });

  test('parses numeric nargs values', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('--items', { nargs: 3 });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].nargs, 3);
  });

  test('normalizes camelCase and hyphenated actions', async () => {
    const content = `
const { ArgumentParser } = require('argparse');
const parser = new ArgumentParser();

parser.add_argument('--custom', { action: 'fooBar' });
parser.add_argument('--hyphen', { action: 'append-const' });
`;
    const result = await resolver.resolve('/x/script.js', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].action, 'foo_bar');
    assert.strictEqual(result.parameters[1].action, 'append_const');
  });

  test('extractBalanced handles mismatched open char and quoted content', () => {
    assert.strictEqual(anyResolver.extractBalanced('(one)', 0, '(', ')'), 'one');
    assert.strictEqual(anyResolver.extractBalanced('x(one)', 0, '(', ')'), undefined);
    assert.strictEqual(anyResolver.extractBalanced('("hey, there")', 0, '(', ')'), '"hey, there"');
  });

  test('splitTopLevel ignores separators inside nested structures and quoted strings', () => {
    const parts = anyResolver.splitTopLevel("a, [b, c], {d, e}, (f, g), 'h, i'", ',');
    assert.deepStrictEqual(parts, [
      'a',
      ' [b, c]',
      ' {d, e}',
      ' (f, g)',
      " 'h, i'",
    ]);
  });
});
