import * as assert from 'assert';
const cp = require('child_process');
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { PwshStaticParamBlockResolver } from '../../libs/scriptArgumentResolvers/pwshStaticParamBlockResolver';
import { PwshGetHelpResolver } from '../../libs/scriptArgumentResolvers/pwshGetHelpResolver';

const resolver = new PwshStaticParamBlockResolver();

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------
suite('PwshStaticParamBlockResolver — canHandle', () => {
  test('returns true for .ps1 files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.ps1'), true);
  });

  test('returns true for .ps1 files (uppercase extension)', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.PS1'), true);
  });

  test('returns false for .py files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.py'), false);
  });

  test('returns false for .sh files', () => {
    assert.strictEqual(resolver.canHandle('/some/path/script.sh'), false);
  });
});

// ---------------------------------------------------------------------------
// resolve — no param() block
// ---------------------------------------------------------------------------
suite('PwshStaticParamBlockResolver — no param() block', () => {
  test('T12 — script without param() returns supported: false', async () => {
    const content = 'Write-Host "Hello World"';
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, false);
    assert.strictEqual(result.parameters.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resolve — basic parameter parsing
// ---------------------------------------------------------------------------
suite('PwshStaticParamBlockResolver — basic parsing', () => {
  test('T08 — parses mandatory string parameter', async () => {
    const content = `
param(
    [Parameter(Mandatory=$true)]
    [string]$Environment
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 1);
    const p = result.parameters[0];
    assert.strictEqual(p.name, 'Environment');
    assert.strictEqual(p.type, 'string');
    assert.strictEqual(p.required, true);
  });

  test('T09 — parses optional string with string default value', async () => {
    const content = `
param(
    [Parameter(Mandatory=$false)]
    [string]$Configuration = 'Release'
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 1);
    const p = result.parameters[0];
    assert.strictEqual(p.name, 'Configuration');
    assert.strictEqual(p.type, 'string');
    assert.strictEqual(p.required, false);
    assert.strictEqual(p.defaultValue, 'Release');
  });

  test('T10 — parses [ValidateSet] choices', async () => {
    const content = `
param(
    [ValidateSet('Debug','Release')]
    [string]$Configuration = 'Release'
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    const p = result.parameters[0];
    assert.deepStrictEqual(p.choices, ['Debug', 'Release']);
  });

  test('T11 — parses [switch] parameter', async () => {
    const content = `
param(
    [switch]$DryRun
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    const p = result.parameters[0];
    assert.strictEqual(p.name, 'DryRun');
    assert.strictEqual(p.type, 'switch');
    assert.strictEqual(p.required, false);
  });

  test('T13 — multi-line param() block across many lines', async () => {
    const content = `
param(
    [Parameter(Mandatory=$true)]
    [string]$Environment,

    [Parameter(Mandatory=$false)]
    [ValidateSet('Debug','Release')]
    [string]$Configuration = 'Release',

    [switch]$DryRun
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);
    assert.strictEqual(result.parameters[0].name, 'Environment');
    assert.strictEqual(result.parameters[1].name, 'Configuration');
    assert.strictEqual(result.parameters[2].name, 'DryRun');
  });

  test('T14 — comment inside param() block does not confuse parser', async () => {
    const content = `
param(
    # This is the environment to deploy to
    [Parameter(Mandatory=$true)]
    [string]$Environment,
    # Configuration type
    [string]$Configuration = 'Release'
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 2);
    assert.strictEqual(result.parameters[0].name, 'Environment');
    assert.strictEqual(result.parameters[1].name, 'Configuration');
  });

  test('T15 — parameter default with special characters', async () => {
    const content = `
param(
    [string]$Name = 'hello-world_123'
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].defaultValue, 'hello-world_123');
  });

  test('T16 — canHandle .ps1 true, .py false (re-verified in context)', () => {
    assert.strictEqual(resolver.canHandle('script.ps1'), true);
    assert.strictEqual(resolver.canHandle('script.py'), false);
  });

  test('Mandatory shorthand [Parameter(Mandatory)] (no = $true) is treated as required', async () => {
    const content = `
param(
    [Parameter(Mandatory)]
    [string]$Name
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters[0].required, true);
  });

  test('maps [int] type correctly', async () => {
    const content = `
param(
    [int]$Count
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.parameters[0].type, 'int');
  });

  test('maps [bool] type correctly', async () => {
    const content = `
param(
    [bool]$Flag
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.parameters[0].type, 'bool');
  });

  test('unknown type falls back to unknown', async () => {
    const content = `
param(
    [hashtable]$Data
)`;
    const result = await resolver.resolve('/script.ps1', content);
    assert.strictEqual(result.parameters[0].type, 'unknown');
  });

  test('real-world pwsh-params.ps1 fixture', async () => {
    const content = `
param(
    [Parameter(Mandatory=$true)]
    [string]$Environment,

    [Parameter(Mandatory=$false)]
    [ValidateSet('Debug','Release')]
    [string]$Configuration = 'Release',

    [switch]$DryRun
)

Write-Host "Running tests in $Environment environment with $Configuration configuration."
`;
    const result = await resolver.resolve('/pwsh-params.ps1', content);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 3);

    const [env, cfg, dry] = result.parameters;
    assert.strictEqual(env.name, 'Environment');
    assert.strictEqual(env.required, true);
    assert.strictEqual(env.type, 'string');

    assert.strictEqual(cfg.name, 'Configuration');
    assert.strictEqual(cfg.required, false);
    assert.deepStrictEqual(cfg.choices, ['Debug', 'Release']);
    assert.strictEqual(cfg.defaultValue, 'Release');

    assert.strictEqual(dry.name, 'DryRun');
    assert.strictEqual(dry.type, 'switch');
  });
});

// ---------------------------------------------------------------------------
// PwshGetHelpResolver — workspace trust gate (unit-testable without spawning)
// ---------------------------------------------------------------------------
suite('PwshGetHelpResolver — workspace trust gate', () => {
  test('T06 — returns supported: false when workspace is not trusted', async () => {
    const original = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    try {
      const r = new PwshGetHelpResolver();
      const result = await r.resolve('/script.ps1', '');
      assert.strictEqual(result.supported, false);
    } finally {
      if (original) {
        Object.defineProperty(vscode.workspace, 'isTrusted', original);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PwshGetHelpResolver — detailed unit testing
// ---------------------------------------------------------------------------
suite('PwshGetHelpResolver — detailed unit tests', () => {
  let originalSpawn: any;
  let originalIsTrusted: PropertyDescriptor | undefined;

  setup(() => {
    originalSpawn = cp.spawn;
    originalIsTrusted = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
  });

  teardown(() => {
    if (originalSpawn) {
      Object.defineProperty(cp, 'spawn', { value: originalSpawn, configurable: true });
    }
    if (originalIsTrusted) {
      Object.defineProperty(vscode.workspace, 'isTrusted', originalIsTrusted);
    }
  });

  test('canHandle returns true for .ps1 files and false otherwise', () => {
    const r = new PwshGetHelpResolver();
    assert.strictEqual(r.canHandle('/path/script.ps1'), true);
    assert.strictEqual(r.canHandle('/path/script.PS1'), true);
    assert.strictEqual(r.canHandle('/path/script.py'), false);
  });

  test('findPwsh returns undefined when pwsh is not found', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: () => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        process.nextTick(() => child.emit('close', 1));
        return child;
      },
      configurable: true,
    });

    const path = await (resolver as any).findPwsh();
    assert.strictEqual(path, undefined);
  });

  test('findPwsh resolves the first path returned by which pwsh', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: (_command: string, _args: string[], _options: any) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('/usr/bin/pwsh\n'));
          child.emit('close', 0);
        });
        return child;
      },
      configurable: true,
    });

    const path = await (resolver as any).findPwsh();
    assert.strictEqual(path, '/usr/bin/pwsh');
  });

  test('runGetHelp resolves stdout output when pwsh exits successfully', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: (_command: string, _args: string[], _options: any) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('Hello world'));
          child.emit('close', 0);
        });
        return child;
      },
      configurable: true,
    });

    const output = await (resolver as any).runGetHelp('/usr/bin/pwsh', '/script.ps1');
    assert.strictEqual(output, 'Hello world');
  });

  test('runGetHelp rejects when pwsh exits with a non-zero status', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: (_command: string, _args: string[], _options: any) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
          child.stderr.emit('data', Buffer.from('failure'));
          child.emit('close', 42);
        });
        return child;
      },
      configurable: true,
    });

    await assert.rejects(
      (resolver as any).runGetHelp('/usr/bin/pwsh', '/script.ps1'),
      /pwsh exited with code 42: failure/
    );
  });

  test('runGetHelp rejects when the spawned process emits an error', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: () => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
          child.emit('error', new Error('spawn failed'));
        });
        return child;
      },
      configurable: true,
    });

    await assert.rejects(
      (resolver as any).runGetHelp('/usr/bin/pwsh', '/script.ps1'),
      /spawn failed/
    );
  });

  test('findPwsh resolves undefined when the which command emits an error', async () => {
    const resolver = new PwshGetHelpResolver();
    Object.defineProperty(cp, 'spawn', {
      value: () => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.emit('error', new Error('which failed'));
        });
        return child;
      },
      configurable: true,
    });

    const path = await (resolver as any).findPwsh();
    assert.strictEqual(path, undefined);
  });

  test('resolve returns unsupported when Get-Help output contains no syntax section', async () => {
    const resolver = new PwshGetHelpResolver();
    (resolver as any).findPwsh = async () => '/usr/bin/pwsh';
    (resolver as any).runGetHelp = async () => 'HEADER\nNo syntax here';

    const result = await resolver.resolve('/script.ps1', '');
    assert.strictEqual(result.supported, false);
    assert.deepStrictEqual(result.parameters, []);
  });

  test('runGetHelp rejects on timeout and kills the child process', async () => {
    const resolver = new PwshGetHelpResolver();
    let killed = false;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed = true; };

    Object.defineProperty(cp, 'spawn', {
      value: () => child,
      configurable: true,
    });

    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers: Array<{ id: number; callback: () => void }> = [];
    let nextTimerId = 1;
    (global as any).setTimeout = (callback: (...args: any[]) => void) => {
      const id = nextTimerId++;
      timers.push({ id, callback });
      return id as unknown as NodeJS.Timeout;
    };
    (global as any).clearTimeout = (_id: NodeJS.Timeout) => {
      timers.length = 0;
    };

    try {
      const promise = (resolver as any).runGetHelp('/usr/bin/pwsh', '/script.ps1');
      assert.strictEqual(killed, false);
      assert.strictEqual(timers.length, 1);
      timers[0].callback();
      await assert.rejects(promise, /Get-Help timed out/);
      assert.strictEqual(killed, true);
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  test('parseSyntaxToken returns undefined for CommonParameters and parses flags correctly', () => {
    const resolver = new PwshGetHelpResolver();

    const named = (resolver as any).parseSyntaxToken('[[-Environment] <string>]');
    assert.deepStrictEqual(named, { name: 'Environment', type: 'string', required: false });

    const bare = (resolver as any).parseSyntaxToken('-Level <int>');
    assert.deepStrictEqual(bare, { name: 'Level', type: 'int', required: true });

    const toggle = (resolver as any).parseSyntaxToken('[-DryRun]');
    assert.deepStrictEqual(toggle, { name: 'DryRun', type: 'switch', required: false });

    const commonParameters = (resolver as any).parseSyntaxToken('[<CommonParameters>]');
    assert.strictEqual(commonParameters, undefined);
  });

  test('tokenizeSyntaxLine preserves typed optional parameter groups', () => {
    const resolver = new PwshGetHelpResolver();
    const tokens = (resolver as any).tokenizeSyntaxLine('[-Environment] <string> [[-Configuration] <string>] [-DryRun] [-Level] <int> [<CommonParameters>]');
    assert.deepStrictEqual(tokens, [
      '[-Environment] <string>',
      '[[-Configuration] <string>]',
      '[-DryRun]',
      '[-Level] <int>',
      '[<CommonParameters>]',
    ]);
  });

  test('parseGetHelpOutput returns empty when no SYNTAX section exists', () => {
    const resolver = new PwshGetHelpResolver();
    const result = (resolver as any).parseGetHelpOutput('This text has no syntax header');
    assert.deepStrictEqual(result, []);
  });

  test('parseGetHelpOutput extracts parameters and overlays metadata correctly', () => {
    const resolver = new PwshGetHelpResolver();
    const output = `SYNTAX
` +
      `    /path/script.ps1 [-Environment] <string> [[-Configuration] <string>] [-DryRun] [-Level] <int> [<CommonParameters>]

` +
      `PARAMETERS
` +
      `    -Environment <string>
` +
      `        The environment to deploy to.
` +
      `        Required? true
` +
      `        Accept pipeline input? true (ByValue)
` +
      `        Accepted values : Dev, Prod
` +
      `    -Configuration <string>
` +
      `        Required? false
` +
      `        The configuration to use.
` +
      `    -DryRun
` +
      `        Required? false
` +
      `        Switch parameter to dry run.
` +
      `    -Level <int>
` +
      `        Required? false
` +
      `        The numeric log level.
`;

    const params = (resolver as any).parseGetHelpOutput(output);
    assert.strictEqual(params.length, 4);
    assert.strictEqual(params[0].name, 'Environment');
    assert.strictEqual(params[0].type, 'string');
    assert.strictEqual(params[0].required, true);
    assert.deepStrictEqual(params[0].choices, ['Dev', 'Prod']);
    assert.strictEqual(params[0].description, 'The environment to deploy to.');

    assert.strictEqual(params[1].name, 'Configuration');
    assert.strictEqual(params[1].required, false);
    assert.strictEqual(params[2].name, 'DryRun');
    assert.strictEqual(params[2].type, 'switch');
    assert.strictEqual(params[3].type, 'int');
  });

  test('mapPwshType converts known types and falls back to unknown', () => {
    const resolver = new PwshGetHelpResolver();
    assert.strictEqual((resolver as any).mapPwshType('string'), 'string');
    assert.strictEqual((resolver as any).mapPwshType('int32'), 'int');
    assert.strictEqual((resolver as any).mapPwshType('int64'), 'int');
    assert.strictEqual((resolver as any).mapPwshType('double'), 'float');
    assert.strictEqual((resolver as any).mapPwshType('boolean'), 'bool');
    assert.strictEqual((resolver as any).mapPwshType('switchparameter'), 'switch');
    assert.strictEqual((resolver as any).mapPwshType('hashtable'), 'unknown');
    assert.strictEqual((resolver as any).mapPwshType('float'), 'float');
    assert.strictEqual((resolver as any).mapPwshType('bool'), 'bool');
  });

  test('parseSyntaxLine extracts parameters from a syntax block and ignores comments', () => {
    const resolver = new PwshGetHelpResolver();
    const syntax = `SYNTAX\n` +
      `    /path/script.ps1 [-Environment] <string> [-DryRun]\n` +
      `    # comment line that should be ignored\n` +
      `    [-Level] <int>\n`;

    const params = (resolver as any).parseSyntaxLine(syntax);
    assert.strictEqual(params.length, 3);
    assert.strictEqual(params[0].name, 'Environment');
    assert.strictEqual(params[0].type, 'string');
    assert.strictEqual(params[0].required, false);
    assert.strictEqual(params[1].name, 'DryRun');
    assert.strictEqual(params[2].name, 'Level');
    assert.strictEqual(params[2].type, 'int');
  });

  test('tokenizeSyntaxLine handles bare arguments and optional groups', () => {
    const resolver = new PwshGetHelpResolver();
    const tokens = (resolver as any).tokenizeSyntaxLine('-Name <string> [-Flag] [<CommonParameters>]');
    assert.deepStrictEqual(tokens, ['-Name', '<string>', '[-Flag]', '[<CommonParameters>]']);
  });

  test('parseSyntaxToken handles bare name-only tokens and optional types', () => {
    const resolver = new PwshGetHelpResolver();
    const bare = (resolver as any).parseSyntaxToken('-Force');
    assert.deepStrictEqual(bare, { name: 'Force', type: 'switch', required: false });

    const optional = (resolver as any).parseSyntaxToken('[-Verbose]');
    assert.deepStrictEqual(optional, { name: 'Verbose', type: 'switch', required: false });
  });

  test('parseGetHelpOutput keeps syntax parameters when no PARAMETERS section exists', () => {
    const resolver = new PwshGetHelpResolver();
    const output = `SYNTAX\n` +
      `    /path/script.ps1 [-Environment] <string>\n`;

    const params = (resolver as any).parseGetHelpOutput(output);
    assert.strictEqual(params.length, 1);
    assert.strictEqual(params[0].name, 'Environment');
    assert.strictEqual(params[0].type, 'string');
    assert.strictEqual(params[0].required, false);
  });

  test('parseGetHelpOutput preserves parameters when PARAMETERS section has no matching syntax entry', () => {
    const resolver = new PwshGetHelpResolver();
    const output = `SYNTAX\n` +
      `    /path/script.ps1 [-Environment] <string>\n` +
      `PARAMETERS\n` +
      `    -Unknown <string>\n` +
      `        Required? false\n`;

    const params = (resolver as any).parseGetHelpOutput(output);
    assert.strictEqual(params.length, 1);
    assert.strictEqual(params[0].name, 'Environment');
    assert.strictEqual(params[0].description, undefined);
    assert.strictEqual(params[0].required, false);
  });

  test('resolve returns unsupported when pwsh is not available', async () => {
    const resolver = new PwshGetHelpResolver();
    (resolver as any).findPwsh = async () => undefined;
    const result = await resolver.resolve('/script.ps1', '');
    assert.strictEqual(result.supported, false);
    assert.deepStrictEqual(result.parameters, []);
  });

  test('resolve returns unsupported when Get-Help throws', async () => {
    const resolver = new PwshGetHelpResolver();
    (resolver as any).findPwsh = async () => '/usr/bin/pwsh';
    (resolver as any).runGetHelp = async () => { throw new Error('boom'); };
    const result = await resolver.resolve('/script.ps1', '');
    assert.strictEqual(result.supported, false);
    assert.deepStrictEqual(result.parameters, []);
  });

  test('resolve returns parsed parameters when Get-Help succeeds', async () => {
    const resolver = new PwshGetHelpResolver();
    const output = `SYNTAX
` +
      `    /path/script.ps1 [-Environment] <string> [-DryRun]

` +
      `PARAMETERS
` +
      `    -Environment <string>
` +
      `        Required? true
` +
      `        The environment.
` +
      `    -DryRun
` +
      `        Required? false
`;

    (resolver as any).findPwsh = async () => '/usr/bin/pwsh';
    (resolver as any).runGetHelp = async () => output;

    const result = await resolver.resolve('/script.ps1', '');
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.parameters.length, 2);
    assert.strictEqual(result.parameters[0].name, 'Environment');
    assert.strictEqual(result.parameters[1].type, 'switch');
  });
});
