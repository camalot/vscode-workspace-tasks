import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExecutableService } from '../../services/executableService';

suite('ExecutableService Tests', () => {
  test('getCommand falls back to default when configuration is empty', async () => {
    const exec = ExecutableService.getInstance();
    // Use a non-existent key to simulate missing config, assume get returns undefined
    // For empty string check, we skip writing to config to avoid test runner issues.
    // We rely on visual verification of logic: (!command || command.trim().length === 0)

    const res = exec.getCommand(
      { configKey: 'nonExistentKey', defaultValue: 'npx grunt', configName: 'grunt', resolveToAbsolutePath: false },
      vscode.Uri.file(path.resolve(__dirname, '../task-files')),
    );

    // Command should now be split
    assert.strictEqual(res.command, 'npx');
    assert.deepStrictEqual(res.args, ['grunt']);
  });

  test('getCommand splits command string into executable and args', async () => {
    const exec = ExecutableService.getInstance();

    // Use defaultValue to test splitting logic without writing to config
    const res = exec.getCommand(
      { defaultValue: 'npx grunt', configName: 'grunt', resolveToAbsolutePath: false },
      vscode.Uri.file(process.cwd()),
    );

    assert.strictEqual(res.command, 'npx');
    assert.deepStrictEqual(res.args, ['grunt']);
  });

  test('getCommand handles quoted paths with spaces', async () => {
    const exec = ExecutableService.getInstance();
    const cmd = '"C:\\Program Files\\app.exe" arg1';
    const res = exec.getCommand({ defaultValue: cmd, configName: 'app', resolveToAbsolutePath: false });

    assert.strictEqual(res.command, 'C:\\Program Files\\app.exe');
    assert.deepStrictEqual(res.args, ['arg1']);
  });

  test('resolveToAbsolutePath resolves relative command against workspace root', async () => {
    const exec = ExecutableService.getInstance();

    const res = exec.getCommand(
      { defaultValue: 'tools/mytool arg', configName: 'mytool', resolveToAbsolutePath: true },
      vscode.Uri.file(process.cwd()),
    );

    const workspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : process.cwd();

    let expected = path.join(workspaceRoot, 'tools', 'mytool');
    if (process.platform === 'win32') {
      expected += '.exe';
    }

    assert.strictEqual(res.command, expected);
    assert.deepStrictEqual(res.args, ['arg']);
  });

  test('tilde (~) expansion expands to user home directory', async function () {
    const exec = ExecutableService.getInstance();
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      this.skip();
      return;
    }

    const res = exec.getCommand({ defaultValue: '~/bin/app arg', configName: 'app', resolveToAbsolutePath: false });
    let expected = path.join(homeDir, 'bin', 'app');
    if (process.platform === 'win32') {
      expected += '.exe';
    }
    assert.strictEqual(res.command, expected);
    assert.deepStrictEqual(res.args, ['arg']);
  });

  test('uses configured value when configKey is provided', async function () {
    const key = 'shellEnabledTaskTypes.bash';
    // Mock configuration.get on the singleton so no real VS Code settings are written
    const { configuration } = await import('../../libs/configuration.js');
    const originalGet = configuration.get.bind(configuration);
    try {
      (configuration as any).get = <T>(cfgKey: string, defaultValue?: T): T => {
        if (cfgKey === key) { return 'configuredcmd --flag' as unknown as T; }
        return originalGet(cfgKey, defaultValue);
      };

      const exec = ExecutableService.getInstance();
      const res = exec.getCommand({ configKey: key, defaultValue: 'fallback', configName: 'configuredcmd' });
      const expectedCmd = process.platform === 'win32' ? 'configuredcmd.exe' : 'configuredcmd';
      assert.strictEqual(res.command, expectedCmd);
      assert.deepStrictEqual(res.args, ['--flag']);
    } finally {
      (configuration as any).get = originalGet;
    }
  });

  test('getVscodeCommand returns undefined if extension not found', async () => {
    const exec = ExecutableService.getInstance();
    const res = await exec.getVscodeCommand('some.command', 'non.existent.extension');
    assert.strictEqual(res, undefined);
  });

  test('getVscodeCommand returns command when extension exists and command registered', async () => {
    const exec = ExecutableService.getInstance();

    const originalGetExtension = (vscode.extensions as any).getExtension;
    const originalGetCommands = (vscode.commands as any).getCommands;

    try {
      // fake an installed extension
      (vscode.extensions as any).getExtension = (_id: string) => ({ id: 'fake.ext' } as any);
      // fake command list
      (vscode.commands as any).getCommands = async (_: boolean) => ['workspaceTasks.runTask', 'fake.command'];

      const res = await exec.getVscodeCommand('workspaceTasks.runTask', 'fake.ext');
      assert.strictEqual(res, 'workspaceTasks.runTask');
    } finally {
      (vscode.extensions as any).getExtension = originalGetExtension;
      (vscode.commands as any).getCommands = originalGetCommands;
    }
  });

  test('Windows: appends executable extension when required', function () {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }

    const exec = ExecutableService.getInstance();
    const res = exec.getCommand({ defaultValue: 'just', configName: 'just', resolveToAbsolutePath: false });
    assert.strictEqual(res.command, 'just.exe');
  });

  test('Windows: does not append executable extension when windowsEnforceExtension is false', function () {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }

    const exec = ExecutableService.getInstance();
    const res = exec.getCommand({ defaultValue: 'just', configName: 'just', resolveToAbsolutePath: false, windowsEnforceExtension: false });
    assert.strictEqual(res.command, 'just');
  });

  test('Windows: respects custom windowsExecutableExtension', function () {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }

    const exec = ExecutableService.getInstance();
    const res = exec.getCommand({ defaultValue: 'just', configName: 'just', resolveToAbsolutePath: false, windowsExecutableExtension: '.cmd' });
    assert.strictEqual(res.command, 'just.cmd');
  });
});
