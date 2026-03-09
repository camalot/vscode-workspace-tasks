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

  suite('resolveWorkspaceTaskTypeIcon', () => {
    test('returns built-in TaskIcon when SVG pair exists for the type', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        writeIconPair(tmpDir, 'npm');
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('node');

        assert.ok(result.TaskIcon, 'TaskIcon should be set for known type');
        assert.ok(result.TaskIcon!.light.fsPath.endsWith(path.join('light', 'npm.svg')));
        assert.ok(result.TaskIcon!.dark.fsPath.endsWith(path.join('dark', 'npm.svg')));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty when no SVG pair and no iconUri', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for { dark, light } object with valid absolute image paths', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const lightPath = path.join(tmpDir, 'light.svg');
        const darkPath = path.join(tmpDir, 'dark.svg');
        fs.writeFileSync(lightPath, '<svg/>', 'utf8');
        fs.writeFileSync(darkPath, '<svg/>', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', {
          dark: darkPath,
          light: lightPath,
        });

        assert.ok(result.TaskIcon, 'TaskIcon should be set');
        assert.strictEqual(
          result.TaskIcon!.dark.fsPath.toLowerCase(),
          vscode.Uri.file(darkPath).fsPath.toLowerCase(),
        );
        assert.strictEqual(
          result.TaskIcon!.light.fsPath.toLowerCase(),
          vscode.Uri.file(lightPath).fsPath.toLowerCase(),
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty when { dark, light } paths are invalid', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', {
          dark: '/nonexistent/dark.svg',
          light: '/nonexistent/light.svg',
        });

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for absolute image path string', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const iconPath = path.join(tmpDir, 'my-icon.svg');
        fs.writeFileSync(iconPath, '<svg/>', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', iconPath);

        assert.ok(result.TaskIcon, 'TaskIcon should be set for absolute image path');
        assert.strictEqual(
          result.TaskIcon!.light.fsPath.toLowerCase(),
          vscode.Uri.file(iconPath).fsPath.toLowerCase(),
        );
        assert.strictEqual(
          result.TaskIcon!.dark.fsPath.toLowerCase(),
          vscode.Uri.file(iconPath).fsPath.toLowerCase(),
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns DisplayUri with basename for filename iconUri (file-type icon fallback)', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'eslint.config.mjs');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.ok(result.DisplayUri, 'DisplayUri should be set');
        assert.ok(result.DisplayUri!.fsPath.endsWith('eslint.config.mjs'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty for filename with unrecognised extension (e.g. bad.file)', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'bad.file');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined, 'DisplayUri must not be set for unknown extension');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns DisplayUri for well-known basename without extension (e.g. Makefile)', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'Makefile');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.ok(result.DisplayUri, 'DisplayUri should be set for Makefile');
        assert.ok(result.DisplayUri!.fsPath.toLowerCase().endsWith('makefile'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns DisplayUri for dotfile with known basename (e.g. .gitignore)', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', '.gitignore');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.ok(result.DisplayUri, 'DisplayUri should be set for .gitignore');
        assert.ok(result.DisplayUri!.fsPath.endsWith('.gitignore'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for relative SVG filename found in res/icons sub-directories', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const lightDir = path.join(tmpDir, 'res', 'icons', 'light');
        const darkDir = path.join(tmpDir, 'res', 'icons', 'dark');
        fs.mkdirSync(lightDir, { recursive: true });
        fs.mkdirSync(darkDir, { recursive: true });
        fs.writeFileSync(path.join(lightDir, 'myicon.svg'), '<svg/>', 'utf8');
        fs.writeFileSync(path.join(darkDir, 'myicon.svg'), '<svg/>', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'myicon.svg');

        assert.ok(result.TaskIcon, 'TaskIcon should be set');
        assert.ok(result.TaskIcon!.light.fsPath.endsWith(path.join('light', 'myicon.svg')));
        assert.ok(result.TaskIcon!.dark.fsPath.endsWith(path.join('dark', 'myicon.svg')));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for iconUri in $(name) syntax when matching bundled SVGs exist', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        writeIconPair(tmpDir, 'python');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', '$(python)');

        assert.ok(result.TaskIcon, 'TaskIcon should be set for $(name) syntax');
        assert.ok(result.TaskIcon!.light.fsPath.endsWith(path.join('light', 'python.svg')));
        assert.ok(result.TaskIcon!.dark.fsPath.endsWith(path.join('dark', 'python.svg')));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty for iconUri in $(name) syntax when bundled SVGs do not exist', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', '$(missingicon)');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for relative image path resolved directly from extension root', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const imgDir = path.join(tmpDir, 'images');
        fs.mkdirSync(imgDir, { recursive: true });
        const iconFile = path.join(imgDir, 'myicon.png');
        fs.writeFileSync(iconFile, '', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'images/myicon.png');

        assert.ok(result.TaskIcon, 'TaskIcon should be set');
        assert.strictEqual(
          result.TaskIcon!.light.fsPath.toLowerCase(),
          vscode.Uri.file(iconFile).fsPath.toLowerCase(),
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty when iconUri is an image path that does not exist', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        // Neither absolute nor extension-relative — just a non-existent image name
        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', 'nonexistent-icon.svg');

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined, 'DisplayUri must not be set for missing image files');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty when { dark, light } contains empty string paths', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', { dark: '', light: '' });

        assert.strictEqual(result.TaskIcon, undefined);
        assert.strictEqual(result.DisplayUri, undefined);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns TaskIcon for { dark, light } object with extension-relative image paths', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const imgDir = path.join(tmpDir, 'icons');
        fs.mkdirSync(imgDir, { recursive: true });
        const darkRel = 'icons/dark.svg';
        const lightRel = 'icons/light.svg';
        fs.writeFileSync(path.join(tmpDir, darkRel), '<svg/>', 'utf8');
        fs.writeFileSync(path.join(tmpDir, lightRel), '<svg/>', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.resolveWorkspaceTaskTypeIcon('unknown-type-xyz', {
          dark: darkRel,
          light: lightRel,
        });

        assert.ok(result.TaskIcon, 'TaskIcon should be set');
        assert.ok(result.TaskIcon!.dark.fsPath.endsWith('dark.svg'));
        assert.ok(result.TaskIcon!.light.fsPath.endsWith('light.svg'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  suite('getDefaultGroupIcon', () => {
    test('returns task.png light/dark pair when files exist', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const lightDir = path.join(tmpDir, 'res', 'icons', 'light');
        const darkDir = path.join(tmpDir, 'res', 'icons', 'dark');
        fs.mkdirSync(lightDir, { recursive: true });
        fs.mkdirSync(darkDir, { recursive: true });
        fs.writeFileSync(path.join(lightDir, 'task.png'), '', 'utf8');
        fs.writeFileSync(path.join(darkDir, 'task.png'), '', 'utf8');

        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.getDefaultGroupIcon();

        assert.ok(result, 'should return an icon object');
        assert.ok(result!.light.fsPath.endsWith(path.join('light', 'task.png')));
        assert.ok(result!.dark.fsPath.endsWith(path.join('dark', 'task.png')));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns undefined when task.png files are missing', () => {
      const tmpDir = fs.mkdtempSync(tmpPrefix);
      try {
        const service = TaskIconService.getInstance().initialize({
          extensionPath: tmpDir,
        } as unknown as vscode.ExtensionContext);

        const result = service.getDefaultGroupIcon();

        assert.strictEqual(result, undefined);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns undefined when context is not initialized', () => {
      (TaskIconService as any).instance = new TaskIconService();
      const service = TaskIconService.getInstance();

      const result = service.getDefaultGroupIcon();

      assert.strictEqual(result, undefined);
    });
  });
});
