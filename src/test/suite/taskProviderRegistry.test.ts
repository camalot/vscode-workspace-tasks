import * as assert from 'assert';
import { TaskProviderRegistry } from '../../taskProviderRegistry';
import { BaseTaskProvider } from '../../taskProvider';
import { TaskItem } from '../../taskItem';
import * as vscode from 'vscode';

// Minimal concrete provider for testing — satisfies the abstract contract.
class StubProvider extends BaseTaskProvider {
  constructor(type: string) {
    super(type);
  }
  async getTasks(): Promise<TaskItem[]> { return []; }
  async getSystemTasks(): Promise<TaskItem[]> { return []; }
  getFilePatterns(): string[] { return []; }
}

// Provider that overrides createTask() to return a non-undefined result.
class MigratedStubProvider extends StubProvider {
  readonly createdTaskCalled: boolean[] = [];

  async createTask(_item: TaskItem, _args?: string) {
    this.createdTaskCalled.push(true);
    const task = new vscode.Task(
      { type: this.type, script: 'test' },
      vscode.TaskScope.Workspace,
      'stub-task',
      this.type,
      new vscode.ShellExecution('echo hello'),
    );
    return { task, command: 'echo hello', cwd: '/tmp', native: false as const };
  }
}

suite('TaskProviderRegistry', () => {
  let registry: TaskProviderRegistry;
  let snap: Map<string, any>;

  setup(() => {
    registry = TaskProviderRegistry.getInstance();
    snap = registry.snapshot();
    registry.clear();
  });

  teardown(() => {
    registry.restore(snap);
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  test('getInstance() returns the same instance each call', () => {
    const a = TaskProviderRegistry.getInstance();
    const b = TaskProviderRegistry.getInstance();
    assert.strictEqual(a, b, 'Should be the same singleton instance');
  });

  // ── register / get ─────────────────────────────────────────────────────────

  test('get() returns undefined for an unregistered type', () => {
    assert.strictEqual(registry.get('unknown'), undefined);
  });

  test('register() and get() round-trip', () => {
    const provider = new StubProvider('npm');
    registry.register('npm', provider);
    assert.strictEqual(registry.get('npm'), provider);
  });

  test('register() overwrites a previous entry for the same type', () => {
    const first = new StubProvider('npm');
    const second = new StubProvider('npm');
    registry.register('npm', first);
    registry.register('npm', second);
    assert.strictEqual(registry.get('npm'), second, 'Second registration should overwrite first');
  });

  test('registering multiple distinct types keeps each independently', () => {
    const npmProv = new StubProvider('npm');
    const yarnProv = new StubProvider('yarn');
    registry.register('npm', npmProv);
    registry.register('yarn', yarnProv);
    assert.strictEqual(registry.get('npm'), npmProv);
    assert.strictEqual(registry.get('yarn'), yarnProv);
  });

  // ── getKnownTypes ──────────────────────────────────────────────────────────

  test('getKnownTypes() returns empty set when nothing is registered', () => {
    assert.strictEqual(registry.getKnownTypes().size, 0);
  });

  test('getKnownTypes() returns all registered type strings', () => {
    registry.register('npm', new StubProvider('npm'));
    registry.register('yarn', new StubProvider('yarn'));
    const types = registry.getKnownTypes();
    assert.ok(types.has('npm'), 'Should include npm');
    assert.ok(types.has('yarn'), 'Should include yarn');
    assert.strictEqual(types.size, 2);
  });

  // ── clear ──────────────────────────────────────────────────────────────────

  test('clear() removes all registrations', () => {
    registry.register('npm', new StubProvider('npm'));
    registry.register('yarn', new StubProvider('yarn'));
    registry.clear();
    assert.strictEqual(registry.getKnownTypes().size, 0);
    assert.strictEqual(registry.get('npm'), undefined);
  });

  // ── unregister ─────────────────────────────────────────────────────────────

  test('unregister() removes a single type', () => {
    registry.register('npm', new StubProvider('npm'));
    registry.register('yarn', new StubProvider('yarn'));
    registry.unregister('npm');
    assert.strictEqual(registry.get('npm'), undefined, 'npm should be removed');
    assert.notStrictEqual(registry.get('yarn'), undefined, 'yarn should remain');
  });

  test('unregister() is a no-op for unregistered types', () => {
    assert.doesNotThrow(() => registry.unregister('nonexistent'));
  });

  // ── createTask() dispatch integration ─────────────────────────────────────

  test('registered provider with createTask() override is called correctly', async () => {
    const provider = new MigratedStubProvider('test-type');
    registry.register('test-type', provider);

    const item = new TaskItem('task', vscode.TreeItemCollapsibleState.None, 'test-type', undefined);
    const result = await registry.get('test-type')?.createTask(item);

    assert.ok(result, 'createTask should return a CreatedTask');
    assert.strictEqual(result?.native, false);
    assert.strictEqual(result?.command, 'echo hello');
    assert.ok(provider.createdTaskCalled.length > 0, 'createTask should have been called');
  });

  test('base class createTask() returns undefined for non-migrated providers', async () => {
    const provider = new StubProvider('legacy-type');
    registry.register('legacy-type', provider);

    const item = new TaskItem('task', vscode.TreeItemCollapsibleState.None, 'legacy-type', undefined);
    const result = await registry.get('legacy-type')?.createTask(item);

    assert.strictEqual(result, undefined, 'Default createTask() should return undefined');
  });
});
