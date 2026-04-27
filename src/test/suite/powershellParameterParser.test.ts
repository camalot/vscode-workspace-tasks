import * as assert from 'assert';
import * as vscode from 'vscode';
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
