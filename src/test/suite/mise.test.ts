import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MiseTaskProvider } from '../../providers/miseTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';
import constants from '../../libs/constants';

suite('Mise Provider Test Suite', () => {
  let provider: MiseTaskProvider;
  let originalFindFiles: any;
  let originalAsRelativePath: any;
  let originalGetTaskIcon: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let tempDir: string;

  setup(() => {
    provider = new MiseTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    originalAsRelativePath = vscode.workspace.asRelativePath;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') {
        return uri;
      }
      return uri.fsPath;
    };

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    iconService.getTaskIcon = () => new vscode.ThemeIcon('symbol-method');

    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-mise-'));
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;

    (vscode.workspace as any).getConfiguration = originalGetConfiguration;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('uses correct provider type and file pattern', () => {
    assert.strictEqual(provider.type, 'mise');
    assert.strictEqual(provider.filePattern, constants.GLOB_MISE);
  });

  suite('getConfigRoot', () => {
    function uri(p: string): vscode.Uri {
      return vscode.Uri.file(p);
    }

    const root = '/project';

    test('mise.toml at root → config_root is file directory', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/mise.toml`)),
        root,
      );
    });

    test('.mise.toml at root → config_root is file directory', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.mise.toml`)),
        root,
      );
    });

    test('mise.local.toml → config_root is file directory', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/mise.local.toml`)),
        root,
      );
    });

    test('mise/config.toml → config_root is grandparent', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/mise/config.toml`)),
        root,
      );
    });

    test('.mise/config.toml → config_root is grandparent', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.mise/config.toml`)),
        root,
      );
    });

    test('.config/mise.toml → config_root is grandparent', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.config/mise.toml`)),
        root,
      );
    });

    test('.config/mise/config.toml → config_root is great-grandparent', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.config/mise/config.toml`)),
        root,
      );
    });

    test('.config/mise/conf.d/dev.toml → config_root is 4 levels up', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.config/mise/conf.d/dev.toml`)),
        root,
      );
    });

    test('arbitrary .config/mise/conf.d filename → config_root is 4 levels up', () => {
      assert.strictEqual(
        MiseTaskProvider.getConfigRoot(uri(`${root}/.config/mise/conf.d/production.toml`)),
        root,
      );
    });
  });

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('detects tasks from supported mise config file patterns', async () => {
    const filesAndTasks: Array<{ relativePath: string; taskName: string }> = [
      { relativePath: 'mise.toml', taskName: 'rootTask' },
      { relativePath: 'mise.local.toml', taskName: 'localTask' },
      { relativePath: '.mise.toml', taskName: 'dotMiseTask' },
      { relativePath: 'mise/config.toml', taskName: 'miseConfigTask' },
      { relativePath: '.mise/config.toml', taskName: 'dotMiseConfigTask' },
      { relativePath: '.config/mise.toml', taskName: 'xdgSingleTask' },
      { relativePath: '.config/mise/config.toml', taskName: 'xdgConfigTask' },
      { relativePath: '.config/mise/conf.d/dev.toml', taskName: 'xdgConfDTask' },
    ];

    const uris: vscode.Uri[] = [];
    for (const entry of filesAndTasks) {
      const fullPath = path.join(tempDir, entry.relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, `[tasks.${entry.taskName}]\nrun = 'echo ${entry.taskName}'\n`, 'utf8');
      uris.push(vscode.Uri.file(fullPath));
    }

    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => uris;

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, filesAndTasks.length);
    const labels = tasks.map((t) => t.label);
    for (const entry of filesAndTasks) {
      assert.ok(labels.includes(entry.taskName), `Expected task label ${entry.taskName} to be detected`);
    }
  });
});
