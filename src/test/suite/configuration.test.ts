import * as assert from 'assert';
import * as vscode from 'vscode';
import { configuration } from '../../libs/configuration';

suite('Configuration Test Suite', () => {
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

  test.skip('update updates nested object property and persists (Global)', async function () {
    this.timeout(60000);
    // use a registered object property: shellEnabledTaskTypes
    const parent = 'shellEnabledTaskTypes';

    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const original = cfg.get<any>(parent);

    try {
      // set initial parent object (registered object)
      await cfg.update(parent, { bash: false }, vscode.ConfigurationTarget.Global);
      await waitFor(() => configuration.get<any>(parent)?.bash === false);

      // use Configuration.update to set nested property
      await configuration.update(`${parent}.bash`, true);

      // ensure the underlying workspace settings have been written
      const p = vscode.workspace.getConfiguration('workspaceTasks').get<any>(parent);
      assert.strictEqual(p?.bash, true);
    } finally {
      await cfg.update(parent, original, vscode.ConfigurationTarget.Global);
    }
  });

  test('updateWs updates nested object property at Workspace target', async function () {
    this.timeout(60000);
    // workspace-level updates require an open workspace; skip if none
    if (!vscode.workspace.workspaceFolders) {
      this.skip();
      return;
    }

    const parent = 'shellEnabledTaskTypes';
    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const original = cfg.get<any>(parent);

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

  test.skip('updateVs and updateVsWs update root configuration keys', async function () {
    this.timeout(60000); // increase timeout for configuration updates
    // updateVs writes to the global configuration; use registered keys
    const key1 = 'workspaceTasks.groups.taskSeparator';

    const rootCfg = vscode.workspace.getConfiguration();
    const originalKey1 = rootCfg.get<string>('workspaceTasks.groups.taskSeparator');

    try {
      await configuration.updateVs(key1, '---');
      await waitFor(() => vscode.workspace.getConfiguration().get(key1) === '---');
      assert.strictEqual(vscode.workspace.getConfiguration().get(key1), '---');

      // updateVsWs requires a workspace; skip if none available
      if (!vscode.workspace.workspaceFolders) {
        this.skip();
        return;
      }

      const key2 = 'workspaceTasks.groups.taskSeparator';
      await configuration.updateVsWs(key2, '***');
      await waitFor(() => vscode.workspace.getConfiguration().get(key2) === '***');
      assert.strictEqual(vscode.workspace.getConfiguration().get(key2), '***');
    } finally {
      await rootCfg.update('workspaceTasks.groups.taskSeparator', originalKey1, vscode.ConfigurationTarget.Global);
      if (vscode.workspace.workspaceFolders) {
        await rootCfg.update('workspaceTasks.groups.taskSeparator', originalKey1, vscode.ConfigurationTarget.Workspace);
      }
    }
  });
});
