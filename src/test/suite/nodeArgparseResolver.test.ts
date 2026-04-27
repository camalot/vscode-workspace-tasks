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
