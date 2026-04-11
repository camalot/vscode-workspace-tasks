import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkspaceTasksProvider } from '../../providers/workspaceTasksProvider';
import { WorkspaceTasksService } from '../../services/workspaceTasksService';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskConfigService } from '../../services/taskConfigService';

suite('WorkspaceTasksProvider Test Suite', () => {
  let provider: WorkspaceTasksProvider;
  let service: WorkspaceTasksService;
  let taskFilesService: TaskFilesService;
  let originalGetProviders: any;
  let originalGetLanguageConfig: any;
  let originalGetTasks: any;
  let originalTaskFilesFindFiles: any;
  let originalIsTaskTypeEnabled: any;
  let originalAsRelativePath: any;

  setup(() => {
    provider = new WorkspaceTasksProvider();
    service = WorkspaceTasksService.getInstance();
    taskFilesService = TaskFilesService.getInstance();

    originalGetProviders = service.getProviders.bind(service);
    originalGetLanguageConfig = service.getLanguageConfig.bind(service);
    originalGetTasks = service.getTasks.bind(service);
    originalTaskFilesFindFiles = taskFilesService.findFiles.bind(taskFilesService);
    originalIsTaskTypeEnabled = TaskConfigService.getInstance().isTaskTypeEnabled.bind(
      TaskConfigService.getInstance(),
    );
    originalAsRelativePath = vscode.workspace.asRelativePath;

    // Default mocks — overridden per test as needed
    service.getProviders = async () => [];
    service.getLanguageConfig = (_id: string) => undefined;
    service.getTasks = async (_id: string) => [];
    taskFilesService.findFiles = async () => [];
    TaskConfigService.getInstance().isTaskTypeEnabled = () => true;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) =>
      typeof uri === 'string' ? uri : uri.fsPath;
  });

  teardown(() => {
    service.getProviders = originalGetProviders;
    service.getLanguageConfig = originalGetLanguageConfig;
    service.getTasks = originalGetTasks;
    taskFilesService.findFiles = originalTaskFilesFindFiles;
    TaskConfigService.getInstance().isTaskTypeEnabled = originalIsTaskTypeEnabled;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  });

  // ─── Disabled provider ────────────────────────────────────────────────────

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    service.getProviders = async () => ['cargo'];

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  // ─── Config / task-type guards ─────────────────────────────────────────────

  test('getTasks skips provider with missing config', async () => {
    service.getProviders = async () => ['unknown-lang'];
    service.getLanguageConfig = (_id: string) => undefined;

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  test('getTasks skips disabled task types', async () => {
    service.getProviders = async () => ['cargo'];
    service.getLanguageConfig = (_id: string) =>
      ({ version: '1.0', globs: { include: ['**/Cargo.toml'] }, tasks: [], inputs: [] } as any);
    service.getTasks = async () => [{ label: 'build', type: 'workspace' as const, command: 'cargo build' }];
    TaskConfigService.getInstance().isTaskTypeEnabled = () => false;

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  // ─── No-file path (no globs) ───────────────────────────────────────────────

  test('getTasks adds tasks without file association when no globs defined', async () => {
    service.getProviders = async () => ['shell'];
    service.getLanguageConfig = (_id: string) =>
      ({ version: '1.0', globs: { include: [] }, tasks: [], inputs: [] } as any);
    service.getTasks = async () => [
      { label: 'Hello', type: 'workspace' as const, command: 'echo hello' },
      { label: 'World', type: 'workspace' as const, command: 'echo world' },
    ];

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].label, 'Hello');
    assert.strictEqual(tasks[1].label, 'World');
  });

  test('getTasks adds no tasks for no-globs provider with empty task list', async () => {
    service.getProviders = async () => ['shell'];
    service.getLanguageConfig = (_id: string) =>
      ({ version: '1.0', globs: { include: [] }, tasks: [], inputs: [] } as any);
    service.getTasks = async () => [];

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 0);
  });

  // ─── File-backed tasks ─────────────────────────────────────────────────────

  test('getTasks creates one item per (file × taskDef)', async () => {
    const file1 = vscode.Uri.file('/workspace/Cargo.toml');
    const file2 = vscode.Uri.file('/workspace/sub/Cargo.toml');

    service.getProviders = async () => ['cargo'];
    service.getLanguageConfig = (_id: string) =>
      ({
        version: '1.0',
        globs: { include: ['**/Cargo.toml'] },
        tasks: [],
        inputs: [],
      } as any);
    service.getTasks = async () => [
      { label: 'build', type: 'workspace' as const, command: 'cargo build' },
      { label: 'test', type: 'workspace' as const, command: 'cargo test' },
    ];
    taskFilesService.findFiles = async () => [file1, file2];

    const tasks = await provider.getTasks();
    // 2 files × 2 taskDefs = 4 items
    assert.strictEqual(tasks.length, 4);
    const labels = tasks.map((t) => t.label);
    assert.ok(labels.includes('build'));
    assert.ok(labels.includes('test'));
  });

  test('getTasks sets taskSource to provider key', async () => {
    const file = vscode.Uri.file('/workspace/Cargo.toml');
    service.getProviders = async () => ['cargo'];
    service.getLanguageConfig = (_id: string) =>
      ({ version: '1.0', globs: { include: ['**/Cargo.toml'] }, tasks: [], inputs: [] } as any);
    service.getTasks = async () => [{ label: 'build', type: 'workspace' as const, command: 'cargo build' }];
    taskFilesService.findFiles = async () => [file];

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks[0].taskSource, 'cargo');
  });

  // ─── Provider order preservation ──────────────────────────────────────────

  test('getTasks preserves provider order when file searches resolve out of order', async () => {
    const cargoFile = vscode.Uri.file('/workspace/Cargo.toml');
    const goFile = vscode.Uri.file('/workspace/go.mod');

    const providers = ['cargo', 'go'];
    service.getProviders = async () => providers;

    service.getLanguageConfig = (id: string) => {
      const include = id === 'cargo' ? ['**/Cargo.toml'] : ['**/go.mod'];
      return { version: '1.0', globs: { include }, tasks: [], inputs: [] } as any;
    };
    service.getTasks = async (id: string) => [
      { label: `${id}-task`, type: 'workspace' as const, command: `${id} build` },
    ];

    // 'cargo' search resolves slower than 'go' — order should still be cargo then go
    findFilesCallOrder = [];
    taskFilesService.findFiles = async (globs: string[]) => {
      if (globs.includes('**/Cargo.toml')) {
        findFilesCallOrder.push('cargo');
        await delay(20);
        return [cargoFile];
      }
      findFilesCallOrder.push('go');
      return [goFile];
    };

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].label, 'cargo-task', 'cargo task should be first');
    assert.strictEqual(tasks[1].label, 'go-task', 'go task should be second');

    // Verify that both findFiles calls were fired before either resolved (concurrency)
    assert.deepStrictEqual(findFilesCallOrder, ['cargo', 'go'], 'findFiles should be called for both providers before resolving');
  });

  // ─── Parallel findFiles invocation ────────────────────────────────────────

  test('getTasks fires all findFiles calls in parallel', async () => {
    const files: Record<string, vscode.Uri> = {
      cargo: vscode.Uri.file('/workspace/Cargo.toml'),
      go: vscode.Uri.file('/workspace/go.mod'),
      npm: vscode.Uri.file('/workspace/package.json'),
    };

    service.getProviders = async () => ['cargo', 'go', 'npm'];
    service.getLanguageConfig = (id: string) => ({
      version: '1.0',
      globs: { include: [`**/${id === 'npm' ? 'package.json' : id === 'cargo' ? 'Cargo.toml' : 'go.mod'}`] },
      tasks: [],
      inputs: [],
    } as any);
    service.getTasks = async (id: string) => [
      { label: `${id}-task`, type: 'workspace' as const, command: `${id} build` },
    ];

    // Track which calls are in-flight simultaneously
    let concurrentCount = 0;
    let maxConcurrency = 0;
    taskFilesService.findFiles = async (globs: string[]) => {
      concurrentCount++;
      if (concurrentCount > maxConcurrency) {
        maxConcurrency = concurrentCount;
      }
      await delay(5);
      concurrentCount--;
      const id = globs[0].includes('Cargo') ? 'cargo' : globs[0].includes('go') ? 'go' : 'npm';
      return [files[id]];
    };

    await provider.getTasks();
    assert.strictEqual(maxConcurrency, 3, 'All three findFiles calls should run concurrently');
  });

  // ─── Mixed providers (file + no-file) ─────────────────────────────────────

  test('getTasks handles mix of file-backed and no-file providers in order', async () => {
    const cargoFile = vscode.Uri.file('/workspace/Cargo.toml');

    service.getProviders = async () => ['shell', 'cargo'];
    service.getLanguageConfig = (id: string) => {
      if (id === 'shell') {
        return { version: '1.0', globs: { include: [] }, tasks: [], inputs: [] } as any;
      }
      return { version: '1.0', globs: { include: ['**/Cargo.toml'] }, tasks: [], inputs: [] } as any;
    };
    service.getTasks = async (id: string) => [
      { label: `${id}-task`, type: 'workspace' as const, command: `${id} run` },
    ];
    taskFilesService.findFiles = async () => [cargoFile];

    const tasks = await provider.getTasks();
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].label, 'shell-task');
    assert.strictEqual(tasks[1].label, 'cargo-task');
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

let findFilesCallOrder: string[] = [];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
