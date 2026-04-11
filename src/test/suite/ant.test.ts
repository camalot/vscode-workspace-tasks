import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { AntTaskProvider } from '../../providers/antTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { configuration } from '../../libs/configuration';

// helper to wait on asynchronous conditions (copied from other test suites)
async function waitFor(predicate: () => boolean, timeout = 10000) {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

suite('Ant Provider Test Suite', function () {
  // save original values to restore during teardown
  let originalPlatform: PropertyDescriptor | undefined;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    // capture original platform descriptor so we can reset
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

    // Mock getConfiguration to prevent .vscode/settings.json overrides from disabling task types
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(async () => {
    // restore platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    // note: we avoid changing configuration during tests so nothing else to reset
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('uses correct type', function () {
    const provider = new AntTaskProvider();
    assert.strictEqual(provider.type, 'ant');
  });

  test('uses correct file pattern', function () {
    const provider = new AntTaskProvider();
    // the provider is hardcoded to look for XML files
    assert.strictEqual(provider.filePattern, '**/*.xml');
  });

  test('getCommand returns default ant command', function () {
    const provider = new AntTaskProvider();
    const result = provider.getCommand();

    // On windows the command may be suffixed with .bat, so just check base string contains "ant"
    assert.ok(result.command.toLowerCase().includes('ant'));
    assert.ok(Array.isArray(result.args));
    assert.ok(result.cwd);
  });

  test('getAnsicon returns an ExecutableResult', function () {
    const provider = new AntTaskProvider();
    const result = provider.getAnsicon();

    assert.ok(result.command, 'should have a command property');
    assert.ok(Array.isArray(result.args));
  });

  test('getCommandArgs produces correct arguments', function () {
    const provider = new AntTaskProvider();

    const simple = provider.getCommandArgs('clean');
    assert.deepStrictEqual(simple, ['clean']);

    const withLogger = provider.getCommandArgs('build', true);
    assert.deepStrictEqual(withLogger, ['-logger', 'org.apache.tools.ant.listener.AnsiColorLogger', 'build']);

    const withFile = provider.getCommandArgs('compile', false, 'mybuild.xml');
    assert.deepStrictEqual(withFile, ['-buildfile', 'mybuild.xml', 'compile']);

    const allOpts = provider.getCommandArgs('test', true, 'somepath.xml');
    assert.deepStrictEqual(allOpts, [
      '-logger',
      'org.apache.tools.ant.listener.AnsiColorLogger',
      '-buildfile',
      'somepath.xml',
      'test',
    ]);
  });

  suite('platform/configuration dependent behaviour', () => {
    let originalGet: typeof configuration.get;

    setup(() => {
      originalGet = configuration.get.bind(configuration);
    });

    teardown(() => {
      configuration.get = originalGet;
    });

    test('shouldUseAnsicon returns false on non-windows regardless of config', function () {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      configuration.get = (key: string, def?: any) => {
        if (key === 'ant.ansicon.enabled') {
          return true;
        }
        return originalGet(key, def);
      };

      const provider = new AntTaskProvider();
      assert.strictEqual(provider.shouldUseAnsicon(), false);
    });

    test('shouldUseAnsicon returns false when config disabled (windows)', function () {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      configuration.get = (key: string, def?: any) => {
        if (key === 'ant.ansicon.enabled') {
          return false;
        }
        return originalGet(key, def);
      };

      const provider = new AntTaskProvider();
      let debugCalled = false;
      (provider as any).logger.debug = () => {
        debugCalled = true;
      };

      assert.strictEqual(provider.shouldUseAnsicon(), false);
      assert.strictEqual(debugCalled, true);
    });

    test('shouldUseAnsicon returns true when config enabled (windows)', function () {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      configuration.get = (key: string, def?: any) => {
        if (key === 'ant.ansicon.enabled') {
          return true;
        }
        return originalGet(key, def);
      };

      const provider = new AntTaskProvider();
      assert.strictEqual(provider.shouldUseAnsicon(), true);
    });
  });

  suite('utility helpers', () => {
    const provider = new AntTaskProvider();
    test('isAntBuildFile rejects non-project', function () {
      assert.strictEqual((provider as any).isAntBuildFile({}), false);
      assert.strictEqual((provider as any).isAntBuildFile({ project: {} }), false);
    });

    test('isAntBuildFile accepts project with attributes or targets', function () {
      assert.ok((provider as any).isAntBuildFile({ project: { '@_name': 'x' } }));
      assert.ok((provider as any).isAntBuildFile({ project: { target: {} } }));
      assert.ok((provider as any).isAntBuildFile({ project: { '@_default': 'build' } }));
    });

    test('extractTargets handles missing or empty data', function () {
      assert.deepStrictEqual((provider as any).extractTargets({}), []);
      assert.deepStrictEqual((provider as any).extractTargets({ project: {} }), []);
      assert.deepStrictEqual((provider as any).extractTargets({ project: { target: undefined } }), []);
    });

    test('extractTargets normalizes single target object', function () {
      const xmlData = { project: { target: { '@_name': 'a', '@_description': 'desc' } } };
      const tasks = (provider as any).extractTargets(xmlData);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, 'a');
      assert.strictEqual(tasks[0].description, 'desc');
    });

    test('extractTargets handles array of targets and description fallback', function () {
      const xmlData = {
        project: {
          target: [
            { '@_name': 'x' },
            { '@_name': 'y', '@_depends': 'foo' },
          ],
        },
      };
      const tasks = (provider as any).extractTargets(xmlData);
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[0].name, 'x');
      assert.strictEqual(tasks[0].description, undefined);
      assert.strictEqual(tasks[1].name, 'y');
      assert.strictEqual(tasks[1].description, 'foo');
    });
  });

  suite('getTasks integration', () => {
    let originalFs: any;
    let originalFind: any;

    setup(() => {
      // stub TaskFilesService
      const service = TaskFilesService.getInstance();
      originalFind = service.findFiles;

      // prepare two URIs: one normal xml and one large file and one invalid
      const goodUri = vscode.Uri.file('/test/good.xml');
      const largeUri = vscode.Uri.file('/test/large.xml');
      const badUri = vscode.Uri.file('/test/bad.xml');

      service.findFiles = async (_patterns: string[]) => [goodUri, largeUri, badUri];

      // stub workspace.fs
      originalFs = vscode.workspace.fs;
      const mockFs: any = {
        ...originalFs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === largeUri.fsPath) {
            return { size: 1024 * 1024 + 1 } as any;
          }
          return { size: 100 } as any;
        },
        readFile: async (uri: vscode.Uri) => {
          if (uri.fsPath === goodUri.fsPath) {
            const xml = `<?xml version="1.0"?>\n<project name="Test">\n  <target name="clean" description="Clean build"/>\n  <target name="compile"/>\n</project>`;
            return Buffer.from(xml);
          }
          if (uri.fsPath === badUri.fsPath) {
            return Buffer.from('<notxml');
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

    teardown(() => {
      // restore stubs
      const service = TaskFilesService.getInstance();
      service.findFiles = originalFind;
      Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, writable: true });
    });

    test('getTasks returns tasks from xml and ignores large/bad files', async function () {
      const provider = new AntTaskProvider();
      const tasks = await provider.getTasks();

      assert.ok(Array.isArray(tasks));
      // should only include targets from good.xml (2 targets)
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[0].label, 'clean');
      assert.strictEqual(tasks[1].label, 'compile');
    });

    test('getTasks returns [] when disabled', async function () {
      const provider = new AntTaskProvider();
      Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });
  });

  test('getSystemTasks returns empty array', async function () {
    const provider = new AntTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });
});
