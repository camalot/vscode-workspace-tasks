import * as assert from 'assert';
import * as vscode from 'vscode';
import { configuration } from '../../libs/configuration';

suite('Configuration Test Suite', () => {
  const windowSettings = [
    { key: 'debug', type: 'boolean', default: false },
    { key: 'history.maxPersistedRecords', type: 'integer', default: 200, minimum: 10, maximum: 2000 },
    { key: 'history.retentionDays', type: 'integer', default: 0, minimum: 0 },
  ];

  for (const expected of windowSettings) {
    test(`${expected.key} is window-scoped with unchanged defaults and limits`, () => {
      const extension = vscode.extensions.getExtension('darthminos.workspace-tasks');
      assert.ok(extension, 'The development extension must be registered');
      const manifest = extension.packageJSON as {
        contributes: {
          configuration: Array<{
            properties: Record<string, {
              scope: string;
              type: string;
              default: boolean | number;
              minimum?: number;
              maximum?: number;
            }>;
          }>;
        };
      };
      const registrations = new Map(manifest.contributes.configuration.flatMap((group) =>
        Object.entries(group.properties)));
      const actual = registrations.get(`workspaceTasks.${expected.key}`);
      assert.ok(actual, 'The setting must be registered');
      assert.strictEqual(actual.scope, 'window');
      assert.strictEqual(actual.type, expected.type);
      assert.strictEqual(actual.default, expected.default);
      assert.strictEqual(actual.minimum, expected.minimum);
      assert.strictEqual(actual.maximum, expected.maximum);
    });
  }

  async function waitFor(predicate: () => boolean, timeout = 10000) {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  test('get returns default when key does not exist', () => {
    const val = configuration.get<string>('some.non.existent.key', 'def');
    assert.strictEqual(val, 'def');
  });

  test('onConfigurationChanged updates internal config', async () => {
    // use an existing, registered configuration key
    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const original = cfg.get<boolean>('groups.enabled');

    try {
      await cfg.update('groups.enabled', !original, vscode.ConfigurationTarget.Global);
      // wait for configuration.onDidChange handler to run and update internal cache
      await waitFor(() => configuration.get<boolean>('groups.enabled') === !original);
      assert.strictEqual(configuration.get<boolean>('groups.enabled'), !original);
    } finally {
      await cfg.update('groups.enabled', original, vscode.ConfigurationTarget.Global);
    }
  });

  test('update updates nested object property and persists (Global)', async function () {
    this.timeout(60000);
    // use a registered object property: shellEnabledTaskTypes
    const parent = 'shellEnabledTaskTypes';

    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const original = cfg.inspect<Record<string, boolean>>(parent)?.globalValue;

    try {
      // set initial parent object (registered object)
      await cfg.update(parent, { bash: false }, vscode.ConfigurationTarget.Global);
      await waitFor(() => cfg.inspect<Record<string, boolean>>(parent)?.globalValue?.bash === false);
      assert.strictEqual(cfg.inspect<Record<string, boolean>>(parent)?.globalValue?.bash, false);

      // use Configuration.update to set nested property
      await configuration.update(`${parent}.bash`, true);

      // Inspect the target scope: workspace settings can override the global value.
      const p = vscode.workspace.getConfiguration('workspaceTasks').inspect<Record<string, boolean>>(parent)?.globalValue;
      assert.strictEqual(p?.bash, true);
    } finally {
      await cfg.update(parent, original, vscode.ConfigurationTarget.Global);
    }
  });

  test('updateWs updates nested object property at Workspace target', async function () {
    this.timeout(60000);
    assert.ok(vscode.workspace.workspaceFolders?.length, 'The test runner must open a workspace');

    const parent = 'shellEnabledTaskTypes';
    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const original = cfg.inspect<Record<string, boolean>>(parent)?.workspaceValue;

    try {
      await cfg.update(parent, { bash: false }, vscode.ConfigurationTarget.Workspace);
      await waitFor(() => configuration.get<any>(parent)?.bash === false);

      await configuration.updateWs(`${parent}.bash`, true);

      const p = vscode.workspace.getConfiguration('workspaceTasks').get<any>(parent);
      assert.strictEqual(p?.bash, true);
    } finally {
      await cfg.update(parent, original, vscode.ConfigurationTarget.Workspace);
    }
  });

  test('updateVs and updateVsWs update root configuration keys', async function () {
    this.timeout(60000); // increase timeout for configuration updates
    // updateVs writes to the global configuration; use registered keys
    const key1 = 'workspaceTasks.groups.taskSeparator';

    const rootCfg = vscode.workspace.getConfiguration();
    assert.ok(vscode.workspace.workspaceFolders?.length, 'The test runner must open a workspace');
    const original = rootCfg.inspect<string>(key1);

    try {
      await configuration.updateVs(key1, '---');
      await waitFor(() => rootCfg.inspect<string>(key1)?.globalValue === '---');
      assert.strictEqual(rootCfg.inspect<string>(key1)?.globalValue, '---');

      const key2 = 'workspaceTasks.groups.taskSeparator';
      await configuration.updateVsWs(key2, '***');
      await waitFor(() => rootCfg.inspect<string>(key2)?.workspaceValue === '***');
      assert.strictEqual(rootCfg.inspect<string>(key2)?.workspaceValue, '***');
    } finally {
      await rootCfg.update(key1, original?.globalValue, vscode.ConfigurationTarget.Global);
      await rootCfg.update(key1, original?.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
  });
});
