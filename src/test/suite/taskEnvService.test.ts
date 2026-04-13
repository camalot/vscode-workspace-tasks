import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { TaskEnvService } from '../../services/taskEnvService';
import { TaskEnvFileResolver } from '../../services/taskEnvFileResolver';
import { FileTaskDefinition } from '../../services/workspaceTasksService';
import { ILanguageEnvConfig, ITaskEnvRule } from '../../services/taskEnvTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(label: string, taskType: string, fileUri?: vscode.Uri): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.originalLabel = label;
  if (fileUri) {
    item.taskFileUri = fileUri;
  }
  return item;
}

function makeTaskDef(
  label: string,
  overrides?: Partial<FileTaskDefinition>,
): FileTaskDefinition {
  return {
    label,
    type: 'workspace',
    command: 'echo test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskEnvService Test Suite', () => {
  let service: TaskEnvService;

  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;
  let originalResolveFileRefs: typeof TaskEnvFileResolver.resolveFileReferences;
  let originalParseEnvFile: typeof TaskEnvFileResolver.parseEnvFile;
  let originalCreateFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher;

  // Mutable per-test state
  let mockConfigValues: Record<string, unknown>;
  /** filePathKey → parsed key-value map returned by parseEnvFile */
  let mockFileContents: Record<string, Record<string, string>>;
  /** Call resolveFileReferences(ref, folder) → return this list */
  let mockResolvedPaths: string[];
  /** SecretStorage mock */
  let mockSecretMap: Map<string, string>;
  let mockContext: vscode.ExtensionContext;

  setup(() => {
    service = TaskEnvService.getInstance();

    // Reset singleton state without calling initialize()
    (service as any).context = undefined;
    (service as any).globalEnv = {};
    (service as any).globalEnvFiles = [];
    (service as any).globalSecretFiles = [];
    (service as any).secretPatterns = [];
    (service as any).taskEnvRules = [];
    (service as any).fileWatchers = [];

    mockConfigValues = {};
    mockFileContents = {};
    mockResolvedPaths = [];
    mockSecretMap = new Map();

    // Mock vscode.workspace.getConfiguration
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks.envVars') {
        return {
          get: <T>(key: string, defaultValue?: T): T =>
            (Object.prototype.hasOwnProperty.call(mockConfigValues, key)
              ? mockConfigValues[key]
              : defaultValue) as T,
        };
      }
      return originalGetConfiguration(section);
    };

    // Mock workspace folder resolution
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    (vscode.workspace as any).getWorkspaceFolder = () => undefined;

    // Mock TaskEnvFileResolver statics
    originalResolveFileRefs = (TaskEnvFileResolver as any).resolveFileReferences;
    // Return paths only when the ref is non-empty, so that empty default fields
    // (e.g. globalSecretFiles = []) don't leak the same paths into another layer.
    (TaskEnvFileResolver as any).resolveFileReferences = async (ref: unknown) => {
      if (!ref) return [];
      if (Array.isArray(ref) && ref.length === 0) return [];
      if (typeof ref === 'string' && !ref) return [];
      return [...mockResolvedPaths];
    };

    originalParseEnvFile = TaskEnvFileResolver.parseEnvFile;
    (TaskEnvFileResolver as any).parseEnvFile = (filePath: string) =>
      mockFileContents[filePath] ?? {};

    // Mock createFileSystemWatcher to avoid real watchers in tests
    originalCreateFileSystemWatcher = vscode.workspace.createFileSystemWatcher;
    (vscode.workspace as any).createFileSystemWatcher = () => ({
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    });

    // Mock context with SecretStorage
    mockContext = {
      secrets: {
        get: async (key: string) => mockSecretMap.get(key),
        store: async (key: string, value: string) => { mockSecretMap.set(key, value); },
        delete: async (key: string) => { mockSecretMap.delete(key); },
        keys: async () => [...mockSecretMap.keys()],
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
      } as unknown as vscode.SecretStorage,
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    (TaskEnvFileResolver as any).resolveFileReferences = originalResolveFileRefs;
    (TaskEnvFileResolver as any).parseEnvFile = originalParseEnvFile;
    (vscode.workspace as any).createFileSystemWatcher = originalCreateFileSystemWatcher;
  });

  // ── Layer 1: global env setting ──────────────────────────────────────────

  test('Layer 1: global workspaceTasks.envVars.env injects keys', async () => {
    (service as any).globalEnv = { NODE_ENV: 'development', DEBUG: 'true' };

    const item = makeItem('build', 'npm');
    const result = await service.resolveTaskEnv(item);

    assert.strictEqual(result.get('NODE_ENV')?.value, 'development');
    assert.strictEqual(result.get('NODE_ENV')?.source, 'globalSetting');
    assert.strictEqual(result.get('NODE_ENV')?.isSecret, false);
    assert.strictEqual(result.get('DEBUG')?.value, 'true');
  });

  // ── Layer 2: global envFiles ─────────────────────────────────────────────

  test('Layer 2: global envFiles entries are tagged globalEnvFile, isSecret=false', async () => {
    (service as any).globalEnvFiles = '.env';
    (service as any).globalSecretFiles = []; // ensure secretFiles is empty to prevent overwrite
    mockResolvedPaths = ['/workspace/.env'];
    mockFileContents['/workspace/.env'] = { APP_ENV: 'local' };

    const item = makeItem('build', 'npm');
    const result = await service.resolveTaskEnv(item);

    const entry = result.get('APP_ENV');
    assert.ok(entry, 'APP_ENV should be present');
    assert.strictEqual(entry.value, 'local');
    assert.strictEqual(entry.source, 'globalEnvFile');
    assert.strictEqual(entry.isSecret, false);
  });

  // ── Layer 3: global secretFiles ──────────────────────────────────────────

  test('Layer 3: global secretFiles entries are tagged globalSecretFile, isSecret=true', async () => {
    (service as any).globalSecretFiles = '.secrets';
    mockResolvedPaths = ['/workspace/.secrets'];
    mockFileContents['/workspace/.secrets'] = { API_TOKEN: 'abc' };

    const item = makeItem('build', 'npm');
    const result = await service.resolveTaskEnv(item);

    const entry = result.get('API_TOKEN');
    assert.ok(entry, 'API_TOKEN should be present');
    assert.strictEqual(entry.source, 'globalSecretFile');
    assert.strictEqual(entry.isSecret, true);
  });

  // ── Layer 5: language-block env ──────────────────────────────────────────

  test('Layer 5: languageDef.env overrides layer 1 for the same key', async () => {
    (service as any).globalEnv = { APP_ENV: 'global' };

    const item = makeItem('start', 'workspace');
    const langDef: ILanguageEnvConfig = { env: { APP_ENV: 'block' } };
    const taskDef = makeTaskDef('start');
    const result = await service.resolveTaskEnv(item, taskDef, langDef);

    assert.strictEqual(result.get('APP_ENV')?.value, 'block');
    assert.strictEqual(result.get('APP_ENV')?.source, 'blockEnv');
  });

  // ── Layer 8: per-task env ────────────────────────────────────────────────

  test('Layer 8: taskDef.env overrides languageDef.env for same key', async () => {
    const item = makeItem('start', 'workspace');
    const langDef: ILanguageEnvConfig = { env: { PORT: '3000' } };
    const taskDef = makeTaskDef('start', { env: { PORT: '4000' } });
    const result = await service.resolveTaskEnv(item, taskDef, langDef);

    assert.strictEqual(result.get('PORT')?.value, '4000');
    assert.strictEqual(result.get('PORT')?.source, 'taskEnv');
  });

  // ── Layer 4 and 7: envFiles ───────────────────────────────────────────────

  test('Layer 4/7: block envFiles then task envFiles, task wins for duplicate keys', async () => {
    const item = makeItem('start', 'workspace');

    let callCount = 0;
    (TaskEnvFileResolver as any).resolveFileReferences = async () => {
      callCount++;
      if (callCount === 1) return []; // global envFiles → no files
      if (callCount === 2) return []; // global secretFiles → no files
      if (callCount === 3) return ['/ws/.env.block']; // layer 4 block envFiles
      if (callCount === 4) return ['/ws/.env.task'];  // layer 7 task envFiles
      return [];
    };

    mockFileContents['/ws/.env.block'] = { SHARED: 'from-block', BLOCK_ONLY: 'yes' };
    mockFileContents['/ws/.env.task'] = { SHARED: 'from-task' };

    const langDef: ILanguageEnvConfig = { envFiles: '.env.block' };
    const taskDef = makeTaskDef('start', { envFiles: '.env.task' });
    const result = await service.resolveTaskEnv(item, taskDef, langDef);

    // task envFiles (layer 7) overrides block envFiles (layer 4)
    assert.strictEqual(result.get('SHARED')?.value, 'from-task');
    assert.strictEqual(result.get('SHARED')?.source, 'taskEnvFile');
    assert.strictEqual(result.get('BLOCK_ONLY')?.value, 'yes');
    assert.strictEqual(result.get('BLOCK_ONLY')?.source, 'blockEnvFile');
  });

  // ── Layer 10: per-task secrets → SecretStorage ───────────────────────────

  test('Layer 10: taskDef.secrets reads from SecretStorage, isSecret=true', async () => {
    (service as any).context = mockContext;
    mockSecretMap.set('myapp.token', 'supersecret');

    const item = makeItem('deploy', 'workspace');
    const taskDef = makeTaskDef('deploy', { secrets: { DEPLOY_TOKEN: 'myapp.token' } });
    const result = await service.resolveTaskEnv(item, taskDef);

    const entry = result.get('DEPLOY_TOKEN');
    assert.ok(entry, 'DEPLOY_TOKEN should be present');
    assert.strictEqual(entry.value, 'supersecret');
    assert.strictEqual(entry.source, 'taskSecretStorage');
    assert.strictEqual(entry.isSecret, true);
  });

  test('Layer 10: missing SecretStorage key produces no entry', async () => {
    (service as any).context = mockContext;
    // mockSecretMap has no 'missing.key'

    const item = makeItem('deploy', 'workspace');
    const taskDef = makeTaskDef('deploy', { secrets: { MISSING_VAR: 'missing.key' } });
    const result = await service.resolveTaskEnv(item, taskDef);

    assert.strictEqual(result.has('MISSING_VAR'), false);
  });

  // ── Layers 4–10 skipped when no taskDef/languageDef ──────────────────────

  test('Layers 4–10 not applied for a native discovered task (no taskDef/languageDef)', async () => {
    (service as any).globalEnv = { GLOBAL: '1' };

    const item = makeItem('build', 'npm'); // typical npm task, no workspace-tasks.json
    const result = await service.resolveTaskEnv(item);

    assert.strictEqual(result.get('GLOBAL')?.value, '1');
    assert.strictEqual(result.size, 1); // only the global layer
  });

  // ── Layer 12: rule env ───────────────────────────────────────────────────

  test('Layer 12: matching rule env is applied, ruleEnv source', async () => {
    const rule: ITaskEnvRule = {
      match: { taskType: 'npm' },
      env: { NPM_TOKEN: 'from-rule' },
    };
    (service as any).taskEnvRules = [rule];

    const item = makeItem('publish', 'npm');
    const result = await service.resolveTaskEnv(item);

    const entry = result.get('NPM_TOKEN');
    assert.ok(entry);
    assert.strictEqual(entry.value, 'from-rule');
    assert.strictEqual(entry.source, 'ruleEnv');
    assert.strictEqual(entry.isSecret, false);
  });

  test('Layer 12: rule that does not match is not applied', async () => {
    const rule: ITaskEnvRule = {
      match: { taskType: 'npm' },
      env: { NPM_TOKEN: 'from-rule' },
    };
    (service as any).taskEnvRules = [rule];

    const item = makeItem('build', 'shell'); // not npm
    const result = await service.resolveTaskEnv(item);

    assert.strictEqual(result.has('NPM_TOKEN'), false);
  });

  // ── Layer 14: rule secrets → SecretStorage ───────────────────────────────

  test('Layer 14: rule secrets reads from SecretStorage, isSecret=true', async () => {
    (service as any).context = mockContext;
    mockSecretMap.set('app.deploy-key', 'key-value');

    const rule: ITaskEnvRule = {
      match: { taskName: 'deploy*' },
      secrets: { DEPLOY_KEY: 'app.deploy-key' },
    };
    (service as any).taskEnvRules = [rule];

    const item = makeItem('deployProd', 'shell');
    const result = await service.resolveTaskEnv(item);

    const entry = result.get('DEPLOY_KEY');
    assert.ok(entry);
    assert.strictEqual(entry.value, 'key-value');
    assert.strictEqual(entry.source, 'ruleSecretStorage');
    assert.strictEqual(entry.isSecret, true);
  });

  // ── Multiple matching rules — last rule wins per key ─────────────────────

  test('Multiple matching rules — later rule overrides earlier for duplicate key', async () => {
    const rule1: ITaskEnvRule = {
      match: { taskType: 'npm' },
      env: { SHARED: 'from-rule-1', RULE1_ONLY: 'yes' },
    };
    const rule2: ITaskEnvRule = {
      match: { taskName: 'publish' },
      env: { SHARED: 'from-rule-2', RULE2_ONLY: 'yes' },
    };
    (service as any).taskEnvRules = [rule1, rule2];

    const item = makeItem('publish', 'npm'); // matches both rules
    const result = await service.resolveTaskEnv(item);

    // rule2 (later) wins for SHARED
    assert.strictEqual(result.get('SHARED')?.value, 'from-rule-2');
    // exclusive keys preserved
    assert.strictEqual(result.get('RULE1_ONLY')?.value, 'yes');
    assert.strictEqual(result.get('RULE2_ONLY')?.value, 'yes');
  });

  // ── Precedence: global < block < task < rule ─────────────────────────────

  test('Full precedence: rule env (layer 12) overrides task env (layer 8)', async () => {
    const rule: ITaskEnvRule = {
      match: { taskType: 'workspace' },
      env: { PORT: '5000' },
    };
    (service as any).taskEnvRules = [rule];

    const item = makeItem('start', 'workspace');
    const taskDef = makeTaskDef('start', { env: { PORT: '3000' } });
    const result = await service.resolveTaskEnv(item, taskDef);

    assert.strictEqual(result.get('PORT')?.value, '5000');
    assert.strictEqual(result.get('PORT')?.source, 'ruleEnv');
  });

  test('Full precedence: task env (layer 8) overrides global setting (layer 1)', async () => {
    (service as any).globalEnv = { NODE_ENV: 'development' };

    const item = makeItem('start', 'workspace');
    const taskDef = makeTaskDef('start', { env: { NODE_ENV: 'production' } });
    const result = await service.resolveTaskEnv(item, taskDef);

    assert.strictEqual(result.get('NODE_ENV')?.value, 'production');
    assert.strictEqual(result.get('NODE_ENV')?.source, 'taskEnv');
  });

  // ── isSecret flag correctness ─────────────────────────────────────────────

  test('isSecret=false for globalSetting, blockEnv, taskEnv, ruleEnv sources', async () => {
    (service as any).globalEnv = { A: '1' };

    const item = makeItem('start', 'workspace');
    const langDef: ILanguageEnvConfig = { env: { B: '2' } };
    const taskDef = makeTaskDef('start', { env: { C: '3' } });

    const rule: ITaskEnvRule = {
      match: {},
      env: { D: '4' },
    };
    (service as any).taskEnvRules = [rule];

    const result = await service.resolveTaskEnv(item, taskDef, langDef);

    assert.strictEqual(result.get('A')?.isSecret, false);
    assert.strictEqual(result.get('B')?.isSecret, false);
    assert.strictEqual(result.get('C')?.isSecret, false);
    assert.strictEqual(result.get('D')?.isSecret, false);
  });

  test('isSecret=true for globalSecretFile, blockSecretFile, taskSecretFile sources', async () => {
    let callCount = 0;
    (TaskEnvFileResolver as any).resolveFileReferences = async () => {
      callCount++;
      if (callCount === 1) return []; // layer 2 global envFiles
      if (callCount === 2) return ['/ws/.global.secrets']; // layer 3 global secretFiles
      if (callCount === 3) return ['/ws/.block.secrets']; // layer 6 block secretFiles
      if (callCount === 4) return ['/ws/.task.secrets'];  // layer 9 task secretFiles
      return [];
    };
    mockFileContents['/ws/.global.secrets'] = { GLOBAL_SECRET: '1' };
    mockFileContents['/ws/.block.secrets'] = { BLOCK_SECRET: '2' };
    mockFileContents['/ws/.task.secrets'] = { TASK_SECRET: '3' };

    const item = makeItem('start', 'workspace');
    const langDef: ILanguageEnvConfig = { secretFiles: '.block.secrets' };
    const taskDef = makeTaskDef('start', { secretFiles: '.task.secrets' });
    const result = await service.resolveTaskEnv(item, taskDef, langDef);

    assert.strictEqual(result.get('GLOBAL_SECRET')?.isSecret, true);
    assert.strictEqual(result.get('BLOCK_SECRET')?.isSecret, true);
    assert.strictEqual(result.get('TASK_SECRET')?.isSecret, true);
  });

  // ── SecretStorage unavailable (no context) ────────────────────────────────

  test('SecretStorage returns undefined when context is not set', async () => {
    // context intentionally not set
    const item = makeItem('deploy', 'workspace');
    const taskDef = makeTaskDef('deploy', { secrets: { TOKEN: 'some.key' } });
    const result = await service.resolveTaskEnv(item, taskDef);

    assert.strictEqual(result.has('TOKEN'), false);
  });

  // ── initialize and onDidChangeEnvSources ─────────────────────────────────

  test('initialize: loadConfig reads global env from configuration', async () => {
    mockConfigValues['env'] = { INIT_KEY: 'init-value' };
    mockConfigValues['envFiles'] = [];
    mockConfigValues['secretFiles'] = [];
    mockConfigValues['secretPatterns'] = [];
    mockConfigValues['taskEnv'] = [];

    await service.initialize(mockContext);

    assert.deepStrictEqual((service as any).globalEnv, { INIT_KEY: 'init-value' });
  });

  test('onDidChangeEnvSources fires when configuration changes', async () => {
    let capturedListener: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    const originalOnDidChange = vscode.workspace.onDidChangeConfiguration;
    (vscode.workspace as any).onDidChangeConfiguration = (
      listener: (e: vscode.ConfigurationChangeEvent) => void,
    ) => {
      capturedListener = listener;
      return { dispose: () => {} };
    };

    mockConfigValues['env'] = {};
    mockConfigValues['envFiles'] = [];
    mockConfigValues['secretFiles'] = [];
    mockConfigValues['secretPatterns'] = [];
    mockConfigValues['taskEnv'] = [];

    await service.initialize(mockContext);

    let fired = false;
    const disposable = service.onDidChangeEnvSources(() => { fired = true; });

    // Simulate a configuration change event affecting workspaceTasks.envVars
    capturedListener?.({
      affectsConfiguration: (section: string) => section.startsWith('workspaceTasks.envVars'),
    });

    assert.strictEqual(fired, true);
    disposable.dispose();
    (vscode.workspace as any).onDidChangeConfiguration = originalOnDidChange;
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  test('dispose clears fileWatchers array', async () => {
    const mockWatcher = {
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    };
    (service as any).fileWatchers = [mockWatcher, mockWatcher];

    service.dispose();

    assert.strictEqual((service as any).fileWatchers.length, 0);
  });
});
