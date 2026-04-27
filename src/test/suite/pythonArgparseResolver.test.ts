import * as assert from 'assert';
import { PythonArgparseResolver } from '../../libs/scriptArgumentResolvers/pythonArgparseResolver';

const resolver = new PythonArgparseResolver();

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------
suite('PythonArgparseResolver — canHandle', () => {
  test('T19 — returns true for .py files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.py'), true);
  });

  test('T19 — returns true for .py files (uppercase)', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.PY'), true);
  });

  test('T19 — returns false for .ps1 files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.ps1'), false);
  });

  test('returns false for .sh files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.sh'), false);
  });
});

// ---------------------------------------------------------------------------
// resolve — argparse detection
// ---------------------------------------------------------------------------
suite('PythonArgparseResolver — argparse detection', () => {
  test('T17 — import argparse → supported: true', async () => {
    const content = `import argparse\nparser = argparse.ArgumentParser()\n`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, true);
  });

  test('T18 — from argparse import ArgumentParser → supported: true', async () => {
    const content = `from argparse import ArgumentParser\nparser = ArgumentParser()\n`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, true);
  });

  test('T24 — script without argparse → supported: false', async () => {
    const content = `import sys\nprint(sys.argv)\n`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, false);
    assert.strictEqual(result.parameters.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resolve — individual kwarg parsing
// ---------------------------------------------------------------------------
suite('PythonArgparseResolver — add_argument parsing', () => {
  test('T20 — type=int → type: int', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--count', type=int)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 1);
    assert.strictEqual(result.parameters[0].type, 'int');
    assert.strictEqual(result.parameters[0].name, 'count');
    assert.strictEqual(result.parameters[0].cliName, '--count');
  });

  test('type=float → type: float', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--ratio', type=float)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].type, 'float');
  });

  test('type=str → type: string', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--name', type=str)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].type, 'string');
  });

  test('T21 — required=True → required: true', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--env', required=True)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].required, true);
  });

  test('required=False → required: false', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--verbose', required=False)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].required, false);
  });

  test('T22 — action=store_true → type: switch', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].type, 'switch');
    assert.strictEqual(result.parameters[0].name, 'dry_run');
    assert.strictEqual(result.parameters[0].cliName, '--dry-run');
    assert.strictEqual(result.parameters[0].action, 'store_true');
  });

  test('action=store_false → type: switch', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--no-cache', action='store_false')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].type, 'switch');
    assert.strictEqual(result.parameters[0].action, 'store_false');
  });

  test('T23 — help string → description populated', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--env', help='The target environment')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].description, 'The target environment');
  });

  test('T19 (choices) — choices=[...] → choices populated', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['debug', 'release', 'profile'])
`;
    const result = await resolver.resolve('/script.py', content);
    assert.deepStrictEqual(result.parameters[0].choices, ['debug', 'release', 'profile']);
  });

  test('string default value', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--config', default='prod')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].defaultValue, 'prod');
  });

  test('numeric default value', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--retries', type=int, default=3)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].defaultValue, '3');
  });

  test('short and long form — long form used as canonical', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('-e', '--environment', required=True)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].name, 'environment');
    assert.strictEqual(result.parameters[0].cliName, '--environment');
  });

  test('T25 — dynamic add_argument in a loop does not crash', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
for name in ['a', 'b']:
    parser.add_argument(name)
`;
    // Should not throw; may or may not discover the args (acceptable).
    const result = await resolver.resolve('/script.py', content);
    assert.ok(result, 'Should return a result without throwing');
  });

  test('multiple add_argument calls all parsed', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--env', required=True, help='Target environment')
parser.add_argument('--config', default='Release', choices=['Debug', 'Release'])
parser.add_argument('--dry-run', action='store_true')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);
    assert.strictEqual(result.parameters[0].name, 'env');
    assert.strictEqual(result.parameters[1].name, 'config');
    assert.strictEqual(result.parameters[2].name, 'dry_run');
    assert.strictEqual(result.parameters[2].type, 'switch');
  });
});

// ---------------------------------------------------------------------------
// resolve — nargs parsing
// ---------------------------------------------------------------------------
suite('PythonArgparseResolver — nargs parsing', () => {
  test('nargs=* stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--hobbies', nargs='*', type=str, help='List of hobbies')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].nargs, '*');
    assert.strictEqual(result.parameters[0].name, 'hobbies');
  });

  test('nargs=+ stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--files', nargs='+', required=True)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].nargs, '+');
    assert.strictEqual(result.parameters[0].required, true);
  });

  test('nargs=? stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--output', nargs='?')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].nargs, '?');
  });

  test('nargs=2 (integer) stored as number', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--range', nargs=2, type=int)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].nargs, 2);
    assert.strictEqual(typeof result.parameters[0].nargs, 'number');
  });

  test('parameter without nargs has nargs undefined', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--env')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].nargs, undefined);
  });
});

// ---------------------------------------------------------------------------
// resolve — action parsing
// ---------------------------------------------------------------------------
suite('PythonArgparseResolver — action parsing', () => {
  test('action=count stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--verbose', action='count', help='Increase verbosity')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].action, 'count');
    assert.strictEqual(result.parameters[0].name, 'verbose');
  });

  test('action=append stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--tag', action='append')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].action, 'append');
  });

  test('action=extend stored on parameter', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--items', action='extend', nargs='+')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].action, 'extend');
    assert.strictEqual(result.parameters[0].nargs, '+');
  });

  test('action=help — parameter is skipped entirely', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--help-me', action='help')
parser.add_argument('--env', required=True)
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters.length, 1);
    assert.strictEqual(result.parameters[0].name, 'env');
  });

  test('action=version — parameter is skipped entirely', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--version', action='version')
parser.add_argument('--output', default='out')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters.length, 1);
    assert.strictEqual(result.parameters[0].name, 'output');
  });

  test('parameter without action has action undefined', async () => {
    const content = `import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--env')
`;
    const result = await resolver.resolve('/script.py', content);
    assert.strictEqual(result.parameters[0].action, undefined);
  });
});
