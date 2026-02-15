import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { TaskIconService } from '../../services/taskIconService';

suite('TaskIconService Test Suite', () => {
  const tmpPrefix = path.join(os.tmpdir(), 'task-icon-service-test-');

  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  const setIconTypeConfig = (iconType: string, customPath = '') => {
    (vscode.workspace as any).getConfiguration = () => ({
      get: <T>(key: string, defaultValue?: T) => {
        if (key === 'task.iconType') {
          return iconType as unknown as T;
        }
        if (key === 'task.iconTypeCustom') {
          return customPath as unknown as T;
        }
        return defaultValue as T;
      },
    });
  };

  const writeIconPair = (baseDir: string, iconName: string) => {
    const lightDir = path.join(baseDir, 'res', 'icons', 'light');
    const darkDir = path.join(baseDir, 'res', 'icons', 'dark');
    fs.mkdirSync(lightDir, { recursive: true });
    fs.mkdirSync(darkDir, { recursive: true });
    fs.writeFileSync(path.join(lightDir, `${iconName}.svg`), '<svg/>', 'utf8');
    fs.writeFileSync(path.join(darkDir, `${iconName}.svg`), '<svg/>', 'utf8');
  };

  setup(() => {
    (TaskIconService as any).instance = undefined;
    originalGetConfiguration = vscode.workspace.getConfiguration;
    setIconTypeConfig('type');
  });

  teardown(() => {
    (TaskIconService as any).instance = undefined;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('getInstance returns singleton', () => {
    const first = TaskIconService.getInstance();
    const second = TaskIconService.getInstance();
    assert.strictEqual(first, second);
  });

  test('initialize stores context and returns same instance', () => {
    const service = TaskIconService.getInstance();
    const context = { extensionPath: 'c:/tmp/ext' } as unknown as vscode.ExtensionContext;

    const initialized = service.initialize(context);

    assert.strictEqual(initialized, service);
  });

  test('getTaskTypeIcon returns fallback display uri when not initialized', () => {
    const service = TaskIconService.getInstance();
    const fallback = vscode.Uri.file(path.join(os.tmpdir(), 'fallback.svg'));

    const result = service.getTaskTypeIcon('npm', fallback);

    assert.strictEqual(result?.TaskIcon, undefined);
    assert.strictEqual(result?.DisplayUri?.fsPath, fallback.fsPath);
  });

  test('getTaskTypeIcon maps node to npm and returns icon pair when both files exist', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      writeIconPair(tmpDir, 'npm');
      const service = TaskIconService.getInstance().initialize({
        extensionPath: tmpDir,
      } as unknown as vscode.ExtensionContext);

      const result = service.getTaskTypeIcon('node');

      assert.ok(result?.TaskIcon);
      assert.ok(result?.TaskIcon?.light.fsPath.endsWith(path.join('light', 'npm.svg')));
      assert.ok(result?.TaskIcon?.dark.fsPath.endsWith(path.join('dark', 'npm.svg')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getTaskTypeIcon returns undefined TaskIcon when icon files are missing', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      const service = TaskIconService.getInstance().initialize({
        extensionPath: tmpDir,
      } as unknown as vscode.ExtensionContext);

      const result = service.getTaskTypeIcon('missingType');

      assert.strictEqual(result?.TaskIcon, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getTaskIcon returns gear ThemeIcon when configured', () => {
    setIconTypeConfig('gear');
    const service = TaskIconService.getInstance();

    const result = service.getTaskIcon('npm');

    assert.ok(result instanceof vscode.ThemeIcon);
    assert.strictEqual((result as vscode.ThemeIcon).id, 'settings-gear');
  });

  test('getTaskIcon returns run ThemeIcon when configured', () => {
    setIconTypeConfig('run');
    const service = TaskIconService.getInstance();

    const result = service.getTaskIcon('npm');

    assert.ok(result instanceof vscode.ThemeIcon);
    assert.strictEqual((result as vscode.ThemeIcon).id, 'play');
  });

  test('getTaskIcon returns undefined for file icon mode', () => {
    setIconTypeConfig('file');
    const service = TaskIconService.getInstance();

    const result = service.getTaskIcon('npm');

    assert.strictEqual(result, undefined);
  });

  test('getTaskIcon returns ThemeIcon for custom codicon syntax', () => {
    setIconTypeConfig('custom', '$(rocket)');
    const service = TaskIconService.getInstance();

    const result = service.getTaskIcon('npm');

    assert.ok(result instanceof vscode.ThemeIcon);
    assert.strictEqual((result as vscode.ThemeIcon).id, 'rocket');
  });

  test('getTaskIcon returns Uri for custom absolute path when file exists', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      const iconPath = path.join(tmpDir, 'custom.svg');
      fs.writeFileSync(iconPath, '<svg/>', 'utf8');

      setIconTypeConfig('custom', iconPath);
      const service = TaskIconService.getInstance();

      const result = service.getTaskIcon('npm');

      assert.ok(result instanceof vscode.Uri);
      assert.strictEqual((result as vscode.Uri).fsPath.toLowerCase(), iconPath.toLowerCase());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getTaskIcon resolves custom relative path from workspace folder', () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }

    const workspaceRoot = folders[0].uri.fsPath;
    const relPath = '.task-icon-relative-test.svg';
    const fullPath = path.join(workspaceRoot, relPath);

    try {
      fs.writeFileSync(fullPath, '<svg/>', 'utf8');
      setIconTypeConfig('custom', relPath);

      const service = TaskIconService.getInstance();
      const result = service.getTaskIcon('npm');

      assert.ok(result instanceof vscode.Uri);
      assert.strictEqual((result as vscode.Uri).fsPath, fullPath);
    } finally {
      fs.rmSync(fullPath, { force: true });
    }
  });

  test('getTaskIcon custom path falls back to type icon when custom file does not exist', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      writeIconPair(tmpDir, 'npm');
      const service = TaskIconService.getInstance().initialize({
        extensionPath: tmpDir,
      } as unknown as vscode.ExtensionContext);

      setIconTypeConfig('custom', path.join(tmpDir, 'does-not-exist.svg'));

      const result = service.getTaskIcon('npm') as { light: vscode.Uri; dark: vscode.Uri } | undefined;

      assert.ok(result);
      assert.ok(result?.light.fsPath.endsWith(path.join('light', 'npm.svg')));
      assert.ok(result?.dark.fsPath.endsWith(path.join('dark', 'npm.svg')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getTaskIcon defaults to type behavior when icon type is unknown', () => {
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    try {
      writeIconPair(tmpDir, 'npm');
      const service = TaskIconService.getInstance().initialize({
        extensionPath: tmpDir,
      } as unknown as vscode.ExtensionContext);

      setIconTypeConfig('unexpected');
      const result = service.getTaskIcon('yarn') as { light: vscode.Uri; dark: vscode.Uri } | undefined;

      assert.ok(result);
      assert.ok(result?.light.fsPath.endsWith(path.join('light', 'npm.svg')));
      assert.ok(result?.dark.fsPath.endsWith(path.join('dark', 'npm.svg')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
