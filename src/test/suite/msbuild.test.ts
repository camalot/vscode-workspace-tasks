import * as assert from 'assert';
import * as vscode from 'vscode';
import { MsBuildTaskProvider } from '../../providers/msbuildTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('MsBuildTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalFs: any;
  let originalAsRelativePath: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalAsRelativePath = vscode.workspace.asRelativePath;
    originalFs = vscode.workspace.fs;

    filesService.findFiles = async () => [];
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };

    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, writable: true, configurable: true });
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('uses correct type', () => {
    const provider = new MsBuildTaskProvider();
    assert.strictEqual(provider.type, 'msbuild');
  });

  test('uses correct file pattern', () => {
    const provider = new MsBuildTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_MSBUILD);
  });

  test('getCommand returns default MSBuild command', () => {
    const provider = new MsBuildTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('msbuild'));
    assert.ok(Array.isArray(result.args));
  });

  test('getCommandArgs returns correct args format', () => {
    const provider = new MsBuildTaskProvider();
    const args = provider.getCommandArgs('Build', 'MyProject.csproj');
    assert.deepStrictEqual(args, ['MyProject.csproj', '-t:Build']);
  });

  test('getCommandArgs with different target names', () => {
    const provider = new MsBuildTaskProvider();
    assert.deepStrictEqual(provider.getCommandArgs('Clean', 'test.csproj'), ['test.csproj', '-t:Clean']);
    assert.deepStrictEqual(provider.getCommandArgs('Publish', 'app.proj'), ['app.proj', '-t:Publish']);
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new MsBuildTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new MsBuildTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new MsBuildTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('extractTargets (private)', () => {
    const provider = new MsBuildTaskProvider();

    test('returns empty array for empty xmlData', () => {
      const result = (provider as any).extractTargets({});
      assert.deepStrictEqual(result, []);
    });

    test('returns empty array when Project has no Target', () => {
      const result = (provider as any).extractTargets({ Project: {} });
      assert.deepStrictEqual(result, []);
    });

    test('extracts single target', () => {
      const xmlData = {
        Project: {
          Target: [{ '@_Name': 'Build' }],
        },
      };
      const result = (provider as any).extractTargets(xmlData);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, 'Build');
    });

    test('extracts multiple targets', () => {
      const xmlData = {
        Project: {
          Target: [
            { '@_Name': 'Build', '@_Description': 'Builds the project' },
            { '@_Name': 'Clean' },
            { '@_Name': 'Test', '@_DependsOnTargets': 'Build' },
          ],
        },
      };
      const result = (provider as any).extractTargets(xmlData);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].name, 'Build');
      assert.strictEqual(result[0].description, 'Builds the project');
      assert.strictEqual(result[1].name, 'Clean');
      assert.strictEqual(result[1].description, undefined);
      assert.strictEqual(result[2].name, 'Test');
      assert.strictEqual(result[2].description, 'Build');
    });

    test('ignores private targets starting with underscore', () => {
      const xmlData = {
        Project: {
          Target: [
            { '@_Name': '_PrivateTarget' },
            { '@_Name': 'PublicTarget' },
          ],
        },
      };
      const result = (provider as any).extractTargets(xmlData);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, 'PublicTarget');
    });

    test('ignores targets without a name', () => {
      const xmlData = {
        Project: {
          Target: [
            { '@_Description': 'unnamed' },
            { '@_Name': 'Named' },
          ],
        },
      };
      const result = (provider as any).extractTargets(xmlData);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, 'Named');
    });
  });

  suite('findTargetStartLine (private)', () => {
    const provider = new MsBuildTaskProvider();

    test('returns correct line number', () => {
      const xml = [
        '<Project>',
        '  <Target Name="Build">',
        '  </Target>',
        '</Project>',
      ].join('\n');
      const line = (provider as any).findTargetStartLine(xml, 'Build');
      assert.strictEqual(line, 1);
    });

    test('returns 0 when target not found', () => {
      const xml = '<Project></Project>';
      const line = (provider as any).findTargetStartLine(xml, 'NonExistent');
      assert.strictEqual(line, 0);
    });

    test('handles target with quoted name (double quotes)', () => {
      const xml = '<Project>\n  <Target Name="Clean">\n  </Target>\n</Project>';
      const line = (provider as any).findTargetStartLine(xml, 'Clean');
      assert.strictEqual(line, 1);
    });

    test('handles special regex chars in target name', () => {
      const xml = '<Project>\n  <Target Name="My.Target">\n  </Target>\n</Project>';
      const line = (provider as any).findTargetStartLine(xml, 'My.Target');
      assert.strictEqual(line, 1);
    });
  });

  suite('getTasks integration', () => {
    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const goodUri = vscode.Uri.file('/test/MyProject.csproj');
      const largeUri = vscode.Uri.file('/test/large.csproj');
      const noProjectUri = vscode.Uri.file('/test/noproject.xml');
      const badUri = vscode.Uri.file('/test/bad.csproj');

      filesService.findFiles = async () => [goodUri, largeUri, noProjectUri, badUri];

      const goodXml = [
        '<?xml version="1.0"?>',
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <Target Name="Build" Description="Build the project">',
        '  </Target>',
        '  <Target Name="Clean">',
        '  </Target>',
        '  <Target Name="_Private">',
        '  </Target>',
        '</Project>',
      ].join('\n');

      const mockFs: any = {
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === largeUri.fsPath) {
            return { size: 1024 * 1024 + 1 };
          }
          return { size: 100 };
        },
        readFile: async (uri: vscode.Uri) => {
          if (uri.fsPath === goodUri.fsPath) {
            return Buffer.from(goodXml);
          }
          if (uri.fsPath === noProjectUri.fsPath) {
            return Buffer.from('<?xml version="1.0"?><NotAProject/>');
          }
          if (uri.fsPath === badUri.fsPath) {
            return Buffer.from('<invalid');
          }
          return new Uint8Array();
        },
      };

      Object.defineProperty(vscode.workspace, 'fs', {
        value: mockFs,
        writable: true,
        configurable: true,
      });
    });

    test('getTasks extracts targets from valid csproj, ignores private, large, and no-project files', async () => {
      const provider = new MsBuildTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      assert.ok(names.includes('Build'), 'Should include "Build" target');
      assert.ok(names.includes('Clean'), 'Should include "Clean" target');
      assert.ok(!names.includes('_Private'), 'Should ignore private target "_Private"');
    });

    test('getTasks sets tooltip from description', async () => {
      const provider = new MsBuildTaskProvider();
      const tasks = await provider.getTasks();

      const buildTask = tasks.find(t => t.label === 'Build');
      assert.ok(buildTask, 'Build task should exist');
      assert.strictEqual(buildTask!.tooltip as string, 'Build the project');
    });

    test('getTasks sets tooltip to name when no description', async () => {
      const provider = new MsBuildTaskProvider();
      const tasks = await provider.getTasks();

      const cleanTask = tasks.find(t => t.label === 'Clean');
      assert.ok(cleanTask, 'Clean task should exist');
      assert.strictEqual(cleanTask!.tooltip as string, 'Clean');
    });

    test('getTasks sets onOpenActionCommand', async () => {
      const provider = new MsBuildTaskProvider();
      const tasks = await provider.getTasks();

      for (const task of tasks) {
        assert.ok(task.onOpenActionCommand, 'Should have onOpenActionCommand');
        assert.strictEqual(task.onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
      }
    });
  });
});
