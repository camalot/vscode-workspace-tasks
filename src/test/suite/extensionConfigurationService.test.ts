import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { ExtensionConfigurationService } from '../../services/extensionConfigurationService';
import { LoggerService } from '../../services/loggerService';

suite('ExtensionConfigurationService Test Suite', () => {
  const tmpPrefix = path.join(os.tmpdir(), 'ecs-test-');
  let originalLoggerGetInstance: any;

  setup(() => {
    // reset singleton so each test gets a fresh instance
    (ExtensionConfigurationService as any).instance = undefined;
    originalLoggerGetInstance = LoggerService.getInstance;
  });

  teardown(() => {
    // restore logger factory
    (LoggerService as any).getInstance = originalLoggerGetInstance;
    (ExtensionConfigurationService as any).instance = undefined;
  });

  test('get returns undefined before initialize and when key missing', () => {
    const svc = ExtensionConfigurationService.getInstance();
    assert.strictEqual(svc.get('name'), undefined);
    assert.strictEqual(svc.get('non.existent.path'), undefined);
  });

  test('initialize loads package.json and `get` returns nested values', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      const pkg = {
        name: 'test-ext',
        contributes: { views: { a: 1 } },
        nested: { a: { b: 'value' } },
        numberVal: 42,
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');

      const svc = ExtensionConfigurationService.getInstance();
      const ctx = { extensionPath: tmpDir } as unknown as vscode.ExtensionContext;
      svc.initialize(ctx);

      assert.strictEqual(svc.get('name'), 'test-ext');
      assert.deepStrictEqual(svc.get('contributes.views'), { a: 1 });
      assert.strictEqual(svc.get('nested.a.b'), 'value');
      assert.strictEqual(svc.get('numberVal'), 42);
      assert.strictEqual(svc.get('missing.prop'), undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('initialize does nothing when package.json is absent', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      const svc = ExtensionConfigurationService.getInstance();
      const ctx = { extensionPath: tmpDir } as unknown as vscode.ExtensionContext;
      svc.initialize(ctx);
      // still undefined because no package.json present
      assert.strictEqual(svc.get('name'), undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('initialize logs error on invalid JSON (parse failure)', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      // create an invalid package.json
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ invalid-json: , }', 'utf8');

      // replace LoggerService.getInstance to capture error calls
      let logged: Array<any> = [];
      const fakeLogger = {
        error: (...args: any[]) => logged.push(args),
      };

      (LoggerService as any).getInstance = () => fakeLogger;

      // ensure new ExtensionConfigurationService instance picks up the fake logger
      (ExtensionConfigurationService as any).instance = undefined;
      const svc = ExtensionConfigurationService.getInstance();
      const ctx = { extensionPath: tmpDir } as unknown as vscode.ExtensionContext;

      svc.initialize(ctx);

      assert.strictEqual(logged.length, 1, 'logger.error should have been called once');
      const first = logged[0];
      assert.ok(
        String(first[0]).includes('Failed to load package.json'),
        'first logger arg should mention failure'
      );

      // packageJson should not be set after a parse error
      assert.strictEqual(svc.get('name'), undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('get returns undefined when intermediate property is a primitive', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      const pkg = { a: 'primitive' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');

      const svc = ExtensionConfigurationService.getInstance();
      svc.initialize({ extensionPath: tmpDir } as unknown as vscode.ExtensionContext);

      // 'a' exists but is a string; asking for 'a.b' should be undefined and not throw
      assert.strictEqual(svc.get('a'), 'primitive');
      assert.strictEqual(svc.get('a.b'), undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
