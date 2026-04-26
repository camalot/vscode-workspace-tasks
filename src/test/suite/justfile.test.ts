import * as assert from 'assert';
import * as vscode from 'vscode';
import { JustfileTaskProvider } from '../../providers/justfileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

// Minimal shape used by the mock helper — only fields the provider reads.
interface MockRecipe {
  name: string;
  doc?: string | null;
  attributes?: Array<{ name: string; value?: string }>;
}

function makeRecipe(r: MockRecipe): object {
  return {
    name: r.name,
    doc: r.doc ?? null,
    parameters: [],
    private: false,
    quiet: false,
    body: [],
    dependencies: [],
    attributes: r.attributes ?? [],
    shebang: false,
    priors: 0,
  };
}

function mockJustDump(provider: JustfileTaskProvider, recipes: MockRecipe[]): void {
  const recipesMap: Record<string, object> = {};
  for (const r of recipes) {
    recipesMap[r.name] = makeRecipe(r);
  }
  const output = {
    first: recipes[0]?.name ?? '',
    recipes: recipesMap,
    settings: {},
    variables: {},
  };
  (provider as any).execFileAsync = async () => ({ stdout: JSON.stringify(output), stderr: '' });
}

suite('JustfileTaskProvider Test Suite', () => {
  let originalFindFiles: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;

    filesService.findFiles = async () => [];
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };
    (vscode.workspace as any).getWorkspaceFolder = (_uri: vscode.Uri) => ({
      uri: vscode.Uri.file('/test'),
      name: 'test',
      index: 0,
    });

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
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  // ── Basic provider properties ──────────────────────────────────────────────

  test('uses correct type', () => {
    const provider = new JustfileTaskProvider();
    assert.strictEqual(provider.type, 'justfile');
  });

  test('uses correct file pattern', () => {
    const provider = new JustfileTaskProvider();
    assert.strictEqual(provider.filePattern, constants.GLOB_JUST);
  });

  test('getCommand returns default just command', () => {
    const provider = new JustfileTaskProvider();
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('just'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const provider = new JustfileTaskProvider();
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    const provider = new JustfileTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty and skips CLI when workspace is not trusted', async () => {
    const provider = new JustfileTaskProvider();
    let cliCalled = false;
    (provider as any).execFileAsync = async () => {
      cliCalled = true;
      return { stdout: '', stderr: '' };
    };
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    try {
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
      assert.strictEqual(cliCalled, false, 'CLI must not be invoked for untrusted workspace');
    } finally {
      Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    }
  });

  test('getTasks returns empty when no files found', async () => {
    const provider = new JustfileTaskProvider();
    (provider as any).execFileAsync = async () => { throw new Error('just not found'); };
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── JSON path: primary task discovery ─────────────────────────────────────

  suite('uses just --dump when available', () => {
    let fileUri: vscode.Uri;

    setup(() => {
      fileUri = vscode.Uri.file('/test/justfile');
      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [fileUri];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => 'build:\n    cargo build\ntest:\n    cargo test\n',
      });
    });

    test('parses recipes from JSON output', async () => {
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build' }, { name: 'test' }]);
      const tasks = await provider.getTasks();
      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'), 'Should include "build"');
      assert.ok(names.includes('test'), 'Should include "test"');
    });

    test('populates tooltip from doc comment', async () => {
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build', doc: 'Build the project' }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].tooltip, 'Build the project');
    });

    test('does not set tooltip when doc is null', async () => {
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build', doc: null }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      // Default tooltip set by TaskItem constructor differs from recipe doc
      assert.notStrictEqual(tasks[0].tooltip, null);
    });

    test('does not include variables — only recipes keys are used', async () => {
      const provider = new JustfileTaskProvider();
      // JSON output with extra top-level keys that are NOT recipes
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify({
          first: 'build',
          recipes: { build: makeRecipe({ name: 'build' }) },
          settings: {},
          variables: { version: '1.0.0' },
        }),
        stderr: '',
      });
      const tasks = await provider.getTasks();
      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'));
      assert.ok(!names.includes('version'));
    });

    test('returns no tasks when just --dump fails', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => { throw new Error('command not found: just'); };
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns no tasks when JSON is malformed', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({ stdout: 'not valid json{{', stderr: '' });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns no tasks when JSON shape is invalid (missing recipes key)', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify({ first: 'build', settings: {}, variables: {} }),
        stderr: '',
      });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns no tasks when recipes is null', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify({ first: 'build', recipes: null, settings: {}, variables: {} }),
        stderr: '',
      });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('skips file when workspace folder is not found', async () => {
      (vscode.workspace as any).getWorkspaceFolder = () => undefined;
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build' }]);
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('handles error when opening file', async () => {
      (vscode.workspace as any).openTextDocument = async () => {
        throw new Error('File not found');
      };
      const provider = new JustfileTaskProvider();
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('sets onOpenActionCommand on task items', async () => {
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build' }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].onOpenActionCommand, 'Should have onOpenActionCommand');
      assert.strictEqual(tasks[0].onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
    });

    test('resolves startLine from file content', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => '# comment\nbuild:\n    cargo build\n',
      });
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build' }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 1);
    });

    test('returns undefined for startLine when recipe line not found', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => '# no recipes here\n',
      });
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'build' }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, undefined);
    });

    test('handles recipes with @ prefix in file', async () => {
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => '@quiet-task:\n    echo quiet\n',
      });
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [{ name: 'quiet-task' }]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].startLine, 0);
    });

    test('handles empty recipes object', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify({ first: '', recipes: {}, settings: {}, variables: {} }),
        stderr: '',
      });
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
    });
  });

  // ── Groups support ─────────────────────────────────────────────────────────

  suite('justfile recipe groups', () => {
    let fileUri: vscode.Uri;

    setup(() => {
      fileUri = vscode.Uri.file('/test/justfile');
      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [fileUri];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => 'build:\n    cargo build\ntest:\n    cargo test\n',
      });
    });

    test('groups disabled: all recipes returned flat (even those with group attr)', async () => {
      // Default getConfiguration mock returns default value (false) for groups.justfile.enabled
      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'Build' }] },
        { name: 'test', attributes: [{ name: 'group', value: 'Test' }] },
      ]);
      const tasks = await provider.getTasks();
      const names = tasks.map(t => t.label);
      assert.ok(names.includes('build'));
      assert.ok(names.includes('test'));
      // No group items — all flat
      assert.strictEqual(tasks.length, 2);
    });

    test('groups enabled: grouped recipes placed under group items', async () => {
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'groups.justfile.enabled') { return true as unknown as T; }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'Build' }] },
        { name: 'test', attributes: [{ name: 'group', value: 'Test' }] },
      ]);
      const tasks = await provider.getTasks();

      // Should have two group items (no ungrouped recipes)
      assert.strictEqual(tasks.length, 2);
      const buildGroup = tasks.find(t => t.label === 'Build');
      const testGroup = tasks.find(t => t.label === 'Test');
      assert.ok(buildGroup, 'Should have Build group');
      assert.ok(testGroup, 'Should have Test group');
      assert.strictEqual(buildGroup!.children!.length, 1);
      assert.strictEqual(buildGroup!.children![0].label, 'build');
      assert.strictEqual(testGroup!.children!.length, 1);
      assert.strictEqual(testGroup!.children![0].label, 'test');
    });

    test('groups enabled: ungrouped recipes coexist with group items', async () => {
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'groups.justfile.enabled') { return true as unknown as T; }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'Build' }] },
        { name: 'ungrouped' }, // no group attribute
      ]);
      const tasks = await provider.getTasks();

      // ungrouped recipe at top level + one Build group
      assert.strictEqual(tasks.length, 2);
      const ungrouped = tasks.find(t => t.label === 'ungrouped');
      const buildGroup = tasks.find(t => t.label === 'Build');
      assert.ok(ungrouped, 'Should have ungrouped task');
      assert.ok(buildGroup, 'Should have Build group');
    });

    test('groups enabled: group item has no runnable command', async () => {
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'groups.justfile.enabled') { return true as unknown as T; }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'Build' }] },
      ]);
      const tasks = await provider.getTasks();
      const buildGroup = tasks.find(t => t.label === 'Build');
      assert.ok(buildGroup, 'Build group should exist');
      assert.ok(!buildGroup!.onRunActionCommand, 'Group should have no run command');
    });

    test('groups enabled: group item metadata is set correctly', async () => {
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'groups.justfile.enabled') { return true as unknown as T; }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'Build' }] },
      ]);
      const tasks = await provider.getTasks();
      const buildGroup = tasks.find(t => t.label === 'Build');
      assert.ok(buildGroup, 'Build group should exist');
      assert.deepStrictEqual(buildGroup!.metadata, { type: 'group', groupName: 'Build' });
    });

    test('groups enabled: multiple recipes in the same group', async () => {
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'groups.justfile.enabled') { return true as unknown as T; }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      const provider = new JustfileTaskProvider();
      mockJustDump(provider, [
        { name: 'build', attributes: [{ name: 'group', value: 'CI' }] },
        { name: 'test', attributes: [{ name: 'group', value: 'CI' }] },
        { name: 'lint', attributes: [{ name: 'group', value: 'CI' }] },
      ]);
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 1);
      const ciGroup = tasks[0];
      assert.strictEqual(ciGroup.label, 'CI');
      assert.strictEqual(ciGroup.children!.length, 3);
    });
  });

  // ── Helper method unit tests ───────────────────────────────────────────────

  suite('findRecipeLineNumber', () => {
    test('returns correct line index for a recipe', () => {
      const provider = new JustfileTaskProvider();
      const lines = ['# comment', 'build:', '    cargo build'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'build'), 1);
    });

    test('returns undefined when recipe not found', () => {
      const provider = new JustfileTaskProvider();
      const lines = ['# comment', 'test:', '    cargo test'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'build'), undefined);
    });

    test('matches recipe with @ prefix', () => {
      const provider = new JustfileTaskProvider();
      const lines = ['@quiet-task:', '    echo quiet'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'quiet-task'), 0);
    });

    test('does not match body lines with same word', () => {
      const provider = new JustfileTaskProvider();
      // The body line starts with indentation, so it won't match ^@?build
      // 'build' is line 0 (the recipe line itself) — confirmed match
      const lines = ['build:', '    build stuff'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'build'), 0);
    });

    test('returns undefined when recipe is only in body', () => {
      const provider = new JustfileTaskProvider();
      // body reference to another recipe name should not match
      const lines = ['deploy:', '    just build'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'build'), undefined);
    });

    test('handles recipe name with regex metacharacters', () => {
      const provider = new JustfileTaskProvider();
      // Recipe name containing a dot (shouldn't be valid just names but defensive)
      const lines = ['my.task:', '    echo ok'];
      // Since dot is escaped, it matches literally
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'my.task'), 0);
    });

    // ─── J01-J06: new tests for undefined sentinel behaviour ───────────────────

    test('J01 - returns undefined when lines array is empty', () => {
      const provider = new JustfileTaskProvider();
      assert.strictEqual((provider as any).findRecipeLineNumber([], 'build'), undefined);
    });

    test('J02 - returns correct 0-based index when recipe is at line 0', () => {
      const provider = new JustfileTaskProvider();
      const lines = ['build:', '    echo ok'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'build'), 0);
    });

    test('J03 - returns correct index for recipe with space before colon', () => {
      const provider = new JustfileTaskProvider();
      const lines = ['# header', 'deploy :', '    echo deploy'];
      assert.strictEqual((provider as any).findRecipeLineNumber(lines, 'deploy'), 1);
    });

    test('J04 - startLine is undefined on TaskItem when recipe not found in file', () => {
      const provider = new JustfileTaskProvider();
      const file = vscode.Uri.file('/path/to/justfile');
      const recipe = {
        name: 'from-import', doc: null, parameters: [], private: false,
        quiet: false, body: [], dependencies: [], attributes: [], shebang: false, priors: 0,
      };
      const iconPath = new vscode.ThemeIcon('terminal');
      // Recipe not in lines — should produce undefined startLine
      const lines: string[] = ['other-recipe:', '    echo other'];
      const lineNumber = (provider as any).findRecipeLineNumber(lines, recipe.name) as number | undefined;
      const item = (provider as any).createRecipeTaskItem(recipe, file, iconPath, lineNumber);
      assert.strictEqual(item.startLine, undefined, 'startLine should be undefined for imported recipe');
    });

    test('J05 - onOpenActionCommand arguments default to line 0 when startLine is undefined', () => {
      const provider = new JustfileTaskProvider();
      const file = vscode.Uri.file('/path/to/justfile');
      const recipe = {
        name: 'from-import', doc: null, parameters: [], private: false,
        quiet: false, body: [], dependencies: [], attributes: [], shebang: false, priors: 0,
      };
      const iconPath = new vscode.ThemeIcon('terminal');
      const item = (provider as any).createRecipeTaskItem(recipe, file, iconPath, undefined);
      assert.strictEqual(item.onOpenActionCommand?.arguments?.[1], 0, 'Open command line arg should be 0 when startLine is undefined');
    });

    test('J06 - onOpenActionCommand arguments use startLine when recipe is found', () => {
      const provider = new JustfileTaskProvider();
      const file = vscode.Uri.file('/path/to/justfile');
      const recipe = {
        name: 'build', doc: null, parameters: [], private: false,
        quiet: false, body: [], dependencies: [], attributes: [], shebang: false, priors: 0,
      };
      const iconPath = new vscode.ThemeIcon('terminal');
      const item = (provider as any).createRecipeTaskItem(recipe, file, iconPath, 5);
      assert.strictEqual(item.startLine, 5);
      assert.strictEqual(item.onOpenActionCommand?.arguments?.[1], 5);
    });
  });

  suite('getRecipeGroup', () => {
    test('returns null for empty attributes', () => {
      const provider = new JustfileTaskProvider();
      const recipe = makeRecipe({ name: 'build' });
      assert.strictEqual((provider as any).getRecipeGroup(recipe), null);
    });

    test('returns group name from group attribute', () => {
      const provider = new JustfileTaskProvider();
      const recipe = makeRecipe({
        name: 'build',
        attributes: [{ name: 'group', value: 'Build' }],
      });
      assert.strictEqual((provider as any).getRecipeGroup(recipe), 'Build');
    });

    test('returns null when attribute name is not group', () => {
      const provider = new JustfileTaskProvider();
      const recipe = makeRecipe({
        name: 'build',
        attributes: [{ name: 'private' }],
      });
      assert.strictEqual((provider as any).getRecipeGroup(recipe), null);
    });

    test('returns null when group attribute has no value', () => {
      const provider = new JustfileTaskProvider();
      const recipe = makeRecipe({
        name: 'build',
        attributes: [{ name: 'group' }], // value is undefined
      });
      assert.strictEqual((provider as any).getRecipeGroup(recipe), null);
    });

    test('ignores non-group attributes and returns group value', () => {
      const provider = new JustfileTaskProvider();
      const recipe = makeRecipe({
        name: 'build',
        attributes: [
          { name: 'private' },
          { name: 'group', value: 'MyGroup' },
        ],
      });
      assert.strictEqual((provider as any).getRecipeGroup(recipe), 'MyGroup');
    });
  });

  suite('getJustJsonOutput', () => {
    test('returns null and logs when execFile throws', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => { throw new Error('not found'); };
      const justCmd = { command: 'just', args: [], cwd: '/test' };
      const result = await (provider as any).getJustJsonOutput('/test/justfile', justCmd);
      assert.strictEqual(result, null);
    });

    test('returns null when JSON is unparseable', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({ stdout: '{{bad json', stderr: '' });
      const justCmd = { command: 'just', args: [], cwd: '/test' };
      const result = await (provider as any).getJustJsonOutput('/test/justfile', justCmd);
      assert.strictEqual(result, null);
    });

    test('returns null when recipes key is missing', async () => {
      const provider = new JustfileTaskProvider();
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify({ first: 'build', settings: {}, variables: {} }),
        stderr: '',
      });
      const justCmd = { command: 'just', args: [], cwd: '/test' };
      const result = await (provider as any).getJustJsonOutput('/test/justfile', justCmd);
      assert.strictEqual(result, null);
    });

    test('returns parsed output on success', async () => {
      const provider = new JustfileTaskProvider();
      const output = {
        first: 'build',
        recipes: { build: makeRecipe({ name: 'build' }) },
        settings: {},
        variables: {},
      };
      (provider as any).execFileAsync = async () => ({
        stdout: JSON.stringify(output),
        stderr: '',
      });
      const justCmd = { command: 'just', args: [], cwd: '/test' };
      const result = await (provider as any).getJustJsonOutput('/test/justfile', justCmd);
      assert.ok(result !== null);
      assert.ok('build' in result.recipes);
    });

    test('passes args from justCmd to execFileAsync', async () => {
      const provider = new JustfileTaskProvider();
      let capturedArgs: string[] = [];
      const output = { first: '', recipes: {}, settings: {}, variables: {} };
      (provider as any).execFileAsync = async (_cmd: string, args: string[]) => {
        capturedArgs = args;
        return { stdout: JSON.stringify(output), stderr: '' };
      };
      const justCmd = { command: 'just', args: ['--extra-arg'], cwd: '/test' };
      await (provider as any).getJustJsonOutput('/test/justfile', justCmd);
      assert.ok(capturedArgs.includes('--extra-arg'));
      assert.ok(capturedArgs.includes('--dump'));
      assert.ok(capturedArgs.includes('--dump-format'));
      assert.ok(capturedArgs.includes('json'));
    });
  });
});
