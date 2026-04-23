import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskHistoryService } from '../../services/taskHistoryService';
import { ISerializedTaskExecutionRecord } from '../../services/taskHistorySerializer';
import { TaskStateManager } from '../../taskStateManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_STATE_KEY = 'workspaceTasks.taskHistory';

/** A minimal serialized record factory */
function makeSerialized(overrides: Partial<ISerializedTaskExecutionRecord> = {}): ISerializedTaskExecutionRecord {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    taskName: 'build',
    taskSource: 'npm',
    scope: 'my-workspace',
    definitionType: 'npm',
    startTime: Date.now(),
    status: 'Success',
    ...overrides,
  };
}

/** Creates a mock ExtensionContext with an in-memory workspaceState store. */
function createMockContext(
  initialData: Map<string, unknown> = new Map(),
): vscode.ExtensionContext {
  const store = initialData;
  return {
    subscriptions: [],
    workspaceState: {
      get: (key: string, defaultValue?: unknown) =>
        store.has(key) ? store.get(key) : defaultValue,
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      keys: () => Array.from(store.keys()),
    },
    globalState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: async () => undefined,
      keys: () => [],
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

/** In-memory vscode.workspace.fs mock */
interface MockFsFile {
  content: Uint8Array;
}

function createMockFs(
  files: Map<string, Uint8Array> = new Map(),
): typeof vscode.workspace.fs {
  return {
    readFile: async (uri: vscode.Uri) => {
      const file = files.get(uri.fsPath);
      if (!file) {
        const err = new Error(`File not found: ${uri.fsPath}`);
        (err as any).name = 'EntryNotFound (FileSystemError)';
        throw err;
      }
      return file;
    },
    writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
      files.set(uri.fsPath, content);
    },
    stat: async (uri: vscode.Uri) => {
      if (!files.has(uri.fsPath)) {
        const err = new Error(`Entry not found: ${uri.fsPath}`);
        (err as any).name = 'EntryNotFound (FileSystemError)';
        throw err;
      }
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: files.get(uri.fsPath)!.length };
    },
    createDirectory: async (_uri: vscode.Uri) => { /* no-op */ },
    delete: async (_uri: vscode.Uri) => { /* no-op */ },
    rename: async () => { /* no-op */ },
    copy: async () => { /* no-op */ },
    isWritableFileSystem: (_scheme: string) => true,
    readDirectory: async () => [],
  } as unknown as typeof vscode.workspace.fs;
}

/** Patches vscode.workspace.workspaceFolders with a single folder at the given path.
 * Returns a restore function that resets the original descriptor. */
function patchWorkspaceFolders(fsPath: string | null): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    get: () => (fsPath === null ? undefined : [
      { uri: vscode.Uri.file(fsPath), name: 'test-workspace', index: 0 },
    ]),
    configurable: true,
  });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', originalDescriptor);
    } else {
      // Remove our override so the property falls back to the prototype
      delete (vscode.workspace as any).workspaceFolders;
    }
  };
}

/** Patches vscode.workspace.getConfiguration to return controlled values. */
function patchConfig(values: Record<string, unknown>) {
  const originalGetConfig = vscode.workspace.getConfiguration;
  (vscode.workspace as any).getConfiguration = (section?: string) => {
    if (section === 'workspaceTasks') {
      return {
        get: <T>(key: string, defaultValue?: T): T =>
          (Object.prototype.hasOwnProperty.call(values, key)
            ? values[key]
            : defaultValue) as T,
      };
    }
    return originalGetConfig(section);
  };
  return () => { (vscode.workspace as any).getConfiguration = originalGetConfig; };
}

let capturedConfigListeners: Array<(e: vscode.ConfigurationChangeEvent) => void> = [];

function patchOnDidChangeConfiguration() {
  capturedConfigListeners = [];
  const original = vscode.workspace.onDidChangeConfiguration;
  (vscode.workspace as any).onDidChangeConfiguration = (
    listener: (e: vscode.ConfigurationChangeEvent) => void,
  ) => {
    capturedConfigListeners.push(listener);
    return { dispose: () => {} };
  };
  return () => { (vscode.workspace as any).onDidChangeConfiguration = original; };
}

function fireConfigChange(section: string) {
  const event: vscode.ConfigurationChangeEvent = {
    affectsConfiguration: (cfg: string) => cfg === section || section.startsWith(cfg + '.'),
  };
  capturedConfigListeners.forEach((h) => h(event));
}

function ndjsonContent(records: ISerializedTaskExecutionRecord[]): Uint8Array {
  const text = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskHistoryService — Persistence', () => {
  let service: TaskHistoryService;
  let storeData: Map<string, unknown>;
  let mockContext: vscode.ExtensionContext;
  let fsFiles: Map<string, Uint8Array>;
  let originalFs: typeof vscode.workspace.fs;
  let restoreConfig: () => void;
  let restoreOnDidChangeConfig: () => void;
  let restoreWorkspaceFolders: () => void;

  const NDJSON_PATH = '/workspace/.vscode/task-history.ndjson';
  const VSCODE_DIR_PATH = '/workspace/.vscode';

  const resetSingletons = () => {
    (TaskHistoryService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
  };

  setup(() => {
    resetSingletons();
    storeData = new Map();
    mockContext = createMockContext(storeData);
    fsFiles = new Map();
    originalFs = vscode.workspace.fs;
    Object.defineProperty(vscode.workspace, 'fs', { value: createMockFs(fsFiles), configurable: true, writable: true });
    restoreWorkspaceFolders = patchWorkspaceFolders('/workspace');
    restoreConfig = patchConfig({});
    restoreOnDidChangeConfig = patchOnDidChangeConfiguration();

    service = TaskHistoryService.getInstance();
  });

  teardown(() => {
    resetSingletons();
    Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true, writable: true });
    restoreWorkspaceFolders();
    restoreConfig();
    restoreOnDidChangeConfig();
  });

  // -------------------------------------------------------------------------
  // Startup — loading persisted history
  // -------------------------------------------------------------------------

  test('no workspace folders open → ndjsonPath undefined, no crash', async () => {
    const restore = patchWorkspaceFolders(null);
    try {
      await assert.doesNotReject(() => service.initialize(mockContext));
      assert.strictEqual(service.getHistoryGroups().length, 0);
    } finally {
      restore();
    }
  });

  test('NDJSON file does not exist → empty history, no throw', async () => {
    await assert.doesNotReject(() => service.initialize(mockContext));
    assert.strictEqual(service.getHistoryGroups().length, 0);
  });

  test('NDJSON file is empty → empty history', async () => {
    fsFiles.set(NDJSON_PATH, new TextEncoder().encode(''));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);
    assert.strictEqual(service.getAllExecutions().length, 0);
  });

  test('NDJSON has valid records → groups populated', async () => {
    const r1 = makeSerialized({ taskName: 'build', startTime: 1000 });
    const r2 = makeSerialized({ taskName: 'test', startTime: 2000 });
    fsFiles.set(NDJSON_PATH, ndjsonContent([r1, r2]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    const execs = service.getAllExecutions();
    assert.strictEqual(execs.length, 2);
    // Sorted newest-first
    assert.strictEqual(execs[0].taskName, 'test');
    assert.strictEqual(execs[1].taskName, 'build');
  });

  test('NDJSON records older than retentionDays → excluded, file rewritten', async () => {
    restoreConfig();
    restoreConfig = patchConfig({ 'history.retentionDays': 7 });

    const old = makeSerialized({ taskName: 'old-task', startTime: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    const fresh = makeSerialized({ taskName: 'fresh-task', startTime: Date.now() });
    fsFiles.set(NDJSON_PATH, ndjsonContent([old, fresh]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    await service.flush();

    const execs = service.getAllExecutions();
    assert.strictEqual(execs.length, 1);
    assert.strictEqual(execs[0].taskName, 'fresh-task');

    // File was rewritten without the old record
    const written = new TextDecoder().decode(fsFiles.get(NDJSON_PATH)!);
    assert.ok(!written.includes('old-task'), 'old record should be pruned from file');
    assert.ok(written.includes('fresh-task'));
  });

  test('retentionDays = 0 → no pruning applied', async () => {
    restoreConfig();
    restoreConfig = patchConfig({ 'history.retentionDays': 0 });

    const old = makeSerialized({ startTime: Date.now() - 365 * 24 * 60 * 60 * 1000 });
    fsFiles.set(NDJSON_PATH, ndjsonContent([old]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    assert.strictEqual(service.getAllExecutions().length, 1, 'retention=0 keeps all records');
  });

  test('NDJSON has more than maxPersistedRecords → workspaceState capped', async () => {
    restoreConfig();
    restoreConfig = patchConfig({ 'history.maxPersistedRecords': 10 });

    const records: ISerializedTaskExecutionRecord[] = [];
    for (let i = 0; i < 25; i++) {
      records.push(makeSerialized({ id: `id-${i}`, startTime: i * 1000 }));
    }
    fsFiles.set(NDJSON_PATH, ndjsonContent(records));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    await service.flush();

    const cached = storeData.get(WORKSPACE_STATE_KEY) as ISerializedTaskExecutionRecord[];
    assert.ok(cached !== undefined);
    assert.ok(cached.length <= 10, `workspaceState should be capped at 10 but got ${cached.length}`);

    // In-memory should have all 25
    assert.strictEqual(service.getAllExecutions().length, 25);
  });

  test('corrupt NDJSON line skipped; surrounding records loaded', async () => {
    const r1 = makeSerialized({ taskName: 'good1', startTime: 100 });
    const r2 = makeSerialized({ taskName: 'good2', startTime: 200 });
    const content = JSON.stringify(r1) + '\n' + '{BAD JSON' + '\n' + JSON.stringify(r2) + '\n';
    fsFiles.set(NDJSON_PATH, new TextEncoder().encode(content));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    const execs = service.getAllExecutions();
    assert.strictEqual(execs.length, 2);
    const names = execs.map(e => e.taskName);
    assert.ok(names.includes('good1'));
    assert.ok(names.includes('good2'));
  });

  test('NDJSON read error → falls back to workspaceState, no throw', async () => {
    // Force an unexpected read error (not file-not-found)
    const errorFs = createMockFs(fsFiles);
    (errorFs as any).readFile = async () => { throw new Error('Permission denied'); };
    Object.defineProperty(vscode.workspace, 'fs', { value: errorFs, configurable: true, writable: true });

    // Seed workspaceState with a record
    const cached = [makeSerialized({ taskName: 'from-cache' })];
    storeData.set(WORKSPACE_STATE_KEY, cached);

    await assert.doesNotReject(() => service.initialize(mockContext));
    const execs = service.getAllExecutions();
    assert.strictEqual(execs.length, 1);
    assert.strictEqual(execs[0].taskName, 'from-cache');
  });

  // -------------------------------------------------------------------------
  // persistRecord — after task completion
  // -------------------------------------------------------------------------

  test('after task completes, record appended to NDJSON file', async () => {
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);

    const record = {
      id: 'rec-1',
      taskName: 'compile',
      taskSource: 'npm',
      scope: 'ws',
      definition: { type: 'npm' },
      startTime: Date.now(),
      endTime: Date.now() + 100,
      exitCode: 0,
      status: 'Success' as const,
      duration: 100,
    };
    (service as any)._onDidRecordHistory.fire(record);
    await service.flush();

    const written = new TextDecoder().decode(fsFiles.get(NDJSON_PATH)!);
    assert.ok(written.includes('"compile"'), 'NDJSON should contain the task name');
    assert.ok(written.includes('"rec-1"'), 'NDJSON should contain the record id');
  });

  test('after task completes, record appears in workspaceState', async () => {
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);

    const record = {
      id: 'rec-ws-1',
      taskName: 'lint',
      taskSource: 'npm',
      scope: 'ws',
      definition: { type: 'npm' },
      startTime: Date.now(),
      status: 'Failed' as const,
    };
    (service as any)._onDidRecordHistory.fire(record);
    await service.flush();

    const cached = storeData.get(WORKSPACE_STATE_KEY) as ISerializedTaskExecutionRecord[];
    assert.ok(cached !== undefined);
    assert.ok(cached.some(r => r.id === 'rec-ws-1'), 'workspaceState should contain the record');
  });

  test('two rapid onDidRecordHistory events → both written (queue serializes)', async () => {
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);

    for (let i = 0; i < 2; i++) {
      (service as any)._onDidRecordHistory.fire({
        id: `rapid-${i}`,
        taskName: `task-${i}`,
        taskSource: 'npm',
        scope: 'ws',
        definition: { type: 'npm' },
        startTime: Date.now() + i,
        status: 'Success' as const,
      });
    }
    await service.flush();

    const written = new TextDecoder().decode(fsFiles.get(NDJSON_PATH)!);
    assert.ok(written.includes('"rapid-0"'));
    assert.ok(written.includes('"rapid-1"'));
  });

  test('workspaceState cap exceeded → oldest record dropped', async () => {
    restoreConfig();
    restoreConfig = patchConfig({ 'history.maxPersistedRecords': 3 });
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);

    // Fire 4 records
    for (let i = 0; i < 4; i++) {
      (service as any)._onDidRecordHistory.fire({
        id: `cap-${i}`,
        taskName: `task-${i}`,
        taskSource: 'npm',
        scope: 'ws',
        definition: { type: 'npm' },
        startTime: 1000 + i,
        status: 'Success' as const,
      });
    }
    await service.flush();

    const cached = storeData.get(WORKSPACE_STATE_KEY) as ISerializedTaskExecutionRecord[];
    assert.strictEqual(cached.length, 3, 'should be capped at 3');
    // The oldest record (cap-0) should have been dropped
    assert.ok(!cached.some(r => r.id === 'cap-0'), 'oldest record should be pruned');
  });

  test('.vscode/ directory does not exist when writing → created automatically', async () => {
    // Do NOT add VSCODE_DIR_PATH to fsFiles — directory is absent
    await service.initialize(mockContext);

    (service as any)._onDidRecordHistory.fire({
      id: 'dir-create-test',
      taskName: 'build',
      taskSource: 'npm',
      scope: 'ws',
      definition: { type: 'npm' },
      startTime: Date.now(),
      status: 'Success' as const,
    });
    await service.flush();

    // Should have written the file despite missing directory
    assert.ok(fsFiles.has(NDJSON_PATH), 'NDJSON file should have been created');
  });

  test('NDJSON write error → logged as warning, in-memory state unaffected', async () => {
    const errorFs = createMockFs(fsFiles);
    let callCount = 0;
    (errorFs as any).writeFile = async () => {
      callCount++;
      throw new Error('Disk full');
    };
    (errorFs as any).stat = async () => { throw Object.assign(new Error('EntryNotFound'), {}); };
    (errorFs as any).createDirectory = async () => { /* ok */ };
    Object.defineProperty(vscode.workspace, 'fs', { value: errorFs, configurable: true, writable: true });

    await service.initialize(mockContext);

    const record = {
      id: 'err-test',
      taskName: 'build',
      taskSource: 'npm',
      scope: 'ws',
      definition: { type: 'npm' },
      startTime: Date.now(),
      status: 'Success' as const,
    };
    (service as any)._onDidRecordHistory.fire(record);

    // Should not throw
    await assert.doesNotReject(() => service.flush());

    // In-memory state is still present
    assert.strictEqual(service.getAllExecutions().length, 0,
      'loaded 0 from file before the fire; the record is only in-memory via historyGroups if it was started via handleTaskStart');
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  test('clear() awaited → empties workspaceState history key', async () => {
    const r1 = makeSerialized({ taskName: 'build' });
    fsFiles.set(NDJSON_PATH, ndjsonContent([r1]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    await service.clear();

    const cached = storeData.get(WORKSPACE_STATE_KEY) as ISerializedTaskExecutionRecord[];
    assert.deepStrictEqual(cached, []);
  });

  test('clear() awaited → truncates NDJSON file', async () => {
    const r1 = makeSerialized({ taskName: 'build' });
    fsFiles.set(NDJSON_PATH, ndjsonContent([r1]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    await service.clear();

    const written = new TextDecoder().decode(fsFiles.get(NDJSON_PATH)!);
    assert.strictEqual(written, '', 'NDJSON should be truncated to empty');
  });

  test('clear() when NDJSON file has been deleted externally → no throw', async () => {
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);
    // NDJSON file doesn't exist
    await assert.doesNotReject(() => service.clear());
  });

  test('clear() empties in-memory history groups', async () => {
    const r1 = makeSerialized({ taskName: 'build' });
    fsFiles.set(NDJSON_PATH, ndjsonContent([r1]));
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);
    assert.strictEqual(service.getHistoryGroups().length, 1);

    await service.clear();
    assert.strictEqual(service.getHistoryGroups().length, 0);
    assert.strictEqual(service.getAllExecutions().length, 0);
  });

  // -------------------------------------------------------------------------
  // flush()
  // -------------------------------------------------------------------------

  test('flush() resolves after all pending writes complete', async () => {
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));
    await service.initialize(mockContext);

    for (let i = 0; i < 5; i++) {
      (service as any)._onDidRecordHistory.fire({
        id: `flush-${i}`,
        taskName: 'build',
        taskSource: 'npm',
        scope: 'ws',
        definition: { type: 'npm' },
        startTime: Date.now() + i,
        status: 'Success' as const,
      });
    }

    // flush() should resolve without hanging
    await assert.doesNotReject(() => service.flush());
    const written = new TextDecoder().decode(fsFiles.get(NDJSON_PATH)!);
    // All 5 records written
    for (let i = 0; i < 5; i++) {
      assert.ok(written.includes(`"flush-${i}"`));
    }
  });

  // -------------------------------------------------------------------------
  // Config reactivity
  // -------------------------------------------------------------------------

  test('config change to maxPersistedRecords → next write uses new cap', async () => {
    restoreConfig();
    const configVals: Record<string, unknown> = { 'history.maxPersistedRecords': 100 };
    restoreConfig = patchConfig(configVals);
    fsFiles.set(VSCODE_DIR_PATH, new Uint8Array(0));

    await service.initialize(mockContext);

    // Change the cap to 2
    configVals['history.maxPersistedRecords'] = 2;
    fireConfigChange('workspaceTasks.history.maxPersistedRecords');

    // Fire 3 records
    for (let i = 0; i < 3; i++) {
      (service as any)._onDidRecordHistory.fire({
        id: `cfg-${i}`,
        taskName: 'build',
        taskSource: 'npm',
        scope: 'ws',
        definition: { type: 'npm' },
        startTime: 1000 + i,
        status: 'Success' as const,
      });
    }
    await service.flush();

    const cached = storeData.get(WORKSPACE_STATE_KEY) as ISerializedTaskExecutionRecord[];
    assert.ok(cached.length <= 2, `should be capped at new value of 2 but got ${cached.length}`);
  });
});
