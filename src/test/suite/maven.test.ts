import * as assert from 'assert';
import * as vscode from 'vscode';
import { MavenTaskProvider } from '../../providers/mavenTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

suite('MavenTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalFs: any;
  let originalAsRelativePath: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  const STANDARD_GOALS = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'deploy'];

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
    const provider = new MavenTaskProvider();
    assert.strictEqual(provider.type, 'maven');
  });

  test('uses correct file pattern', () => {
    const provider = new MavenTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_MAVEN);
  });

  test('getCommand returns default mvn command', () => {
    const provider = new MavenTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('mvn'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new MavenTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new MavenTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new MavenTaskProvider();
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('isMavenPom (private)', () => {
    const provider = new MavenTaskProvider();

    test('returns false for empty data', () => {
      assert.strictEqual((provider as any).isMavenPom({}), false);
    });

    test('returns false when no project key', () => {
      assert.strictEqual((provider as any).isMavenPom({ build: {} }), false);
    });

    test('returns true when project key present', () => {
      assert.strictEqual((provider as any).isMavenPom({ project: { modelVersion: '4.0.0' } }), true);
    });

    test('returns true for minimal pom structure', () => {
      assert.strictEqual((provider as any).isMavenPom({ project: {} }), true);
    });
  });

  suite('getTasks integration', () => {
    const validPomXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      '  <modelVersion>4.0.0</modelVersion>',
      '  <groupId>com.example</groupId>',
      '  <artifactId>my-app</artifactId>',
      '  <version>1.0.0</version>',
      '</project>',
    ].join('\n');

    const notPomXml = [
      '<?xml version="1.0"?>',
      '<configuration>',
      '  <property name="foo" value="bar"/>',
      '</configuration>',
    ].join('\n');

    setup(() => {
      const filesService = TaskFilesService.getInstance();
      const goodUri = vscode.Uri.file('/test/pom.xml');
      const largeUri = vscode.Uri.file('/test/large.pom.xml');
      const notPomUri = vscode.Uri.file('/test/settings.xml');
      const badUri = vscode.Uri.file('/test/bad.xml');

      filesService.findFiles = async () => [goodUri, largeUri, notPomUri, badUri];

      const mockFs: any = {
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === largeUri.fsPath) {
            return { size: 1024 * 1024 + 1 };
          }
          return { size: 500 };
        },
        readFile: async (uri: vscode.Uri) => {
          if (uri.fsPath === goodUri.fsPath) {
            return Buffer.from(validPomXml);
          }
          if (uri.fsPath === notPomUri.fsPath) {
            return Buffer.from(notPomXml);
          }
          if (uri.fsPath === badUri.fsPath) {
            return Buffer.from('<invalid xml');
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

    test('getTasks returns all standard maven goals for a valid pom.xml', async () => {
      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      const names = tasks.map(t => t.label);
      for (const goal of STANDARD_GOALS) {
        assert.ok(names.includes(goal), `Should include goal "${goal}"`);
      }
    });

    test('getTasks creates exactly 9 tasks (one per standard goal) for valid pom', async () => {
      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      assert.strictEqual(tasks.length, STANDARD_GOALS.length, `Should have ${STANDARD_GOALS.length} tasks`);
    });

    test('getTasks ignores large pom.xml files', async () => {
      const filesService = TaskFilesService.getInstance();
      const largeUri = vscode.Uri.file('/test/large.pom.xml');
      filesService.findFiles = async () => [largeUri];

      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      assert.deepStrictEqual(tasks, []);
    });

    test('getTasks ignores non-pom XML files', async () => {
      const filesService = TaskFilesService.getInstance();
      const notPomUri = vscode.Uri.file('/test/settings.xml');
      filesService.findFiles = async () => [notPomUri];

      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      assert.deepStrictEqual(tasks, []);
    });

    test('getTasks handles bad XML gracefully', async () => {
      const filesService = TaskFilesService.getInstance();
      const badUri = vscode.Uri.file('/test/bad.xml');
      filesService.findFiles = async () => [badUri];

      const provider = new MavenTaskProvider();
      // Should not throw
      const tasks = await provider.getTasks();
      assert.ok(Array.isArray(tasks));
    });

    test('getTasks sets onOpenActionCommand on task items', async () => {
      const filesService = TaskFilesService.getInstance();
      const goodUri = vscode.Uri.file('/test/pom.xml');
      filesService.findFiles = async () => [goodUri];

      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      for (const task of tasks) {
        assert.ok(task.onOpenActionCommand, 'Should have onOpenActionCommand');
        assert.strictEqual(task.onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
      }
    });

    test('getTasks sets tooltip to "Run mvn <goal>"', async () => {
      const filesService = TaskFilesService.getInstance();
      const goodUri = vscode.Uri.file('/test/pom.xml');
      filesService.findFiles = async () => [goodUri];

      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      const cleanTask = tasks.find(t => t.label === 'clean');
      assert.ok(cleanTask, 'Should have clean task');
      assert.strictEqual(cleanTask!.tooltip as string, 'Run mvn clean');
    });

    test('getTasks sets startLine = undefined for all lifecycle goal items', async () => {
      const filesService = TaskFilesService.getInstance();
      const goodUri = vscode.Uri.file('/test/pom.xml');
      filesService.findFiles = async () => [goodUri];

      const provider = new MavenTaskProvider();
      const tasks = await provider.getTasks();

      for (const task of tasks) {
        assert.strictEqual(task.startLine, undefined, `Expected startLine=undefined for goal ${task.label}`);
      }
    });
  });
});
