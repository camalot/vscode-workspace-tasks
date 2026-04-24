import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunTaskTool } from '../../tools/runTaskTool';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskRunner } from '../../taskRunner';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(label: string, id: string, taskType = 'npm', fileUri?: vscode.Uri): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = id;
  item.originalLabel = label;
  item.task = {} as vscode.Task;
  if (fileUri) {
    item.taskFileUri = fileUri;
  }
  return item;
}

function makeGroup(label: string, children: TaskItem[], taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.Expanded, taskType);
  item.id = `${taskType}:${label}`;
  item.originalLabel = label;
  item.children = children;
  return item;
}

function makeCancellationToken(cancelled = false): vscode.CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: new vscode.EventEmitter<void>().event,
  };
}

async function invokeRunTask(input: { id?: string; label?: string; taskType?: string }, cancelled = false) {
  const tool = new RunTaskTool();
  const result = await tool.invoke(
    { input, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ id?: string; label?: string; taskType?: string }>,
    makeCancellationToken(cancelled),
  );
  const part = result.content[0] as vscode.LanguageModelTextPart;
  return JSON.parse(part.value);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('RunTaskTool Test Suite', () => {
  let originalIsTrusted: PropertyDescriptor | undefined;
  let originalGetTask: typeof TaskCacheService.prototype.getTask;
  let originalGetAllTasks: typeof TaskCacheService.prototype.getAllTasks;
  let originalRunTask: typeof TaskRunner.prototype.runTask;
  let originalIsGuarded: typeof TaskRunGuardService.prototype.isGuarded;

  const buildItem = makeLeaf('build', 'npm:build');
  const testItem = makeLeaf('test', 'npm:test');
  const buildShellItem = makeLeaf('build', 'shell:build', 'shell');

  setup(() => {
    originalIsTrusted = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
    originalGetTask = TaskCacheService.getInstance().getTask.bind(TaskCacheService.getInstance());
    originalGetAllTasks = TaskCacheService.getInstance().getAllTasks.bind(TaskCacheService.getInstance());
    originalRunTask = TaskRunner.getInstance().runTask.bind(TaskRunner.getInstance());
    originalIsGuarded = TaskRunGuardService.getInstance().isGuarded.bind(TaskRunGuardService.getInstance());

    // Default: trusted workspace, runTask returns true, isGuarded returns false
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskRunner.getInstance().runTask = async () => true;
    TaskRunGuardService.getInstance().isGuarded = () => false;
  });

  teardown(() => {
    if (originalIsTrusted) {
      Object.defineProperty(vscode.workspace, 'isTrusted', originalIsTrusted);
    }
    TaskCacheService.getInstance().getTask = originalGetTask;
    TaskCacheService.getInstance().getAllTasks = originalGetAllTasks;
    TaskRunner.getInstance().runTask = originalRunTask;
    TaskRunGuardService.getInstance().isGuarded = originalIsGuarded;
  });

  // ── Workspace trust ──────────────────────────────────────────────────────

  test('untrusted workspace — started:false, message contains "not trusted"', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    const result = await invokeRunTask({ id: 'npm:build' });
    assert.strictEqual(result.started, false);
    assert.ok(result.message.toLowerCase().includes('not trusted'));
  });

  // ── id lookup ────────────────────────────────────────────────────────────

  test('task found by exact id — started:true', async () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    const result = await invokeRunTask({ id: 'npm:build' });
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.task.label, 'build');
  });

  test('id not found, no label — started:false, specific ID-not-found message', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [];
    const result = await invokeRunTask({ id: 'npm:nonexistent' });
    assert.strictEqual(result.started, false);
    assert.ok(result.message.includes('npm:nonexistent'), `expected ID in message, got: ${result.message}`);
  });

  test('id not found, falls through to label — resolved via label', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [buildItem];
    const result = await invokeRunTask({ id: 'wrong-id', label: 'build' });
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.task.label, 'build');
  });

  // ── label lookup ──────────────────────────────────────────────────────────

  test('task found by label exact match (single) — started:true', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [buildItem, testItem];
    const result = await invokeRunTask({ label: 'build' });
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.task.label, 'build');
  });

  test('label has no exact match, substring match exists — started:false, candidates returned', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('build-app', 'npm:build-app'), makeLeaf('build-lib', 'npm:build-lib')];
    const result = await invokeRunTask({ label: 'buil' });
    assert.strictEqual(result.started, false);
    assert.ok(Array.isArray(result.candidates));
    assert.ok(result.candidates.length >= 1);
    assert.ok(result.message.toLowerCase().includes('did you mean'));
  });

  test('task found by label + taskType — started:true', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [buildItem, buildShellItem];
    const result = await invokeRunTask({ label: 'build', taskType: 'npm' });
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.task.type, 'npm');
  });

  test('label matches multiple tasks — started:false, candidates list returned', async () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [buildItem, buildShellItem];
    const result = await invokeRunTask({ label: 'build' });
    assert.strictEqual(result.started, false);
    assert.ok(Array.isArray(result.candidates));
    assert.strictEqual(result.candidates.length, 2);
  });

  test('neither id nor label provided — started:false, not-found message', async () => {
    const result = await invokeRunTask({});
    assert.strictEqual(result.started, false);
    assert.ok(result.message);
  });

  // ── TaskRunner results ────────────────────────────────────────────────────

  test('TaskRunner.runTask() returns false — started:false, blocked message', async () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    TaskRunner.getInstance().runTask = async () => false;
    const result = await invokeRunTask({ id: 'npm:build' });
    assert.strictEqual(result.started, false);
    assert.ok(result.message);
  });

  test('TaskRunner.runTask() throws — error result with message', async () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    TaskRunner.getInstance().runTask = async () => { throw new Error('runner error'); };
    const result = await invokeRunTask({ id: 'npm:build' });
    assert.strictEqual(result.started, false);
    assert.ok(result.message.includes('runner error'));
  });

  // ── Cancellation ──────────────────────────────────────────────────────────

  test('cancellation token cancelled — fast return, started:false', async () => {
    const result = await invokeRunTask({ id: 'npm:build' }, true);
    assert.strictEqual(result.started, false);
    assert.strictEqual(result.message, 'Cancelled.');
  });

  // ── prepareInvocation ────────────────────────────────────────────────────

  test('prepareInvocation — task found, not guarded — confirmation with task details, _pendingTaskId stored', () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    TaskRunGuardService.getInstance().isGuarded = () => false;

    const tool = new RunTaskTool();
    const prepared = tool.prepareInvocation(
      { input: { id: 'npm:build' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    ) as vscode.PreparedToolInvocation;

    assert.ok(prepared.confirmationMessages);
    assert.ok((prepared.confirmationMessages as any).title.includes('build'));
    assert.strictEqual((tool as any)._pendingTaskId, 'npm:build');
  });

  test('prepareInvocation — task found, guarded — message includes guard warning, _pendingTaskId stored', () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    TaskRunGuardService.getInstance().isGuarded = () => true;

    const tool = new RunTaskTool();
    const prepared = tool.prepareInvocation(
      { input: { id: 'npm:build' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    ) as vscode.PreparedToolInvocation;

    assert.ok(prepared.confirmationMessages);
    const msg = (prepared.confirmationMessages as any).message as vscode.MarkdownString;
    assert.ok(msg.value.includes('guarded'));
    assert.strictEqual((tool as any)._pendingTaskId, 'npm:build');
  });

  test('prepareInvocation — task not found — generic fallback message, _pendingTaskId not set', () => {
    TaskCacheService.getInstance().getTask = () => undefined;
    TaskCacheService.getInstance().getAllTasks = () => [];

    const tool = new RunTaskTool();
    const prepared = tool.prepareInvocation(
      { input: { id: 'missing' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    ) as vscode.PreparedToolInvocation;

    assert.ok(prepared.invocationMessage);
    assert.strictEqual((tool as any)._pendingTaskId, undefined);
  });

  test('prepareInvocation not called (programmatic) + guarded task — isGuarded checked, skipGuard=false', async () => {
    // Simulate programmatic invocation: no prepareInvocation called, so _pendingTaskId is undefined.
    // The task is guarded, so TaskRunner.runTask should be called with skipGuard=false.
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    TaskRunGuardService.getInstance().isGuarded = () => true;

    let capturedSkipGuard: boolean | undefined;
    TaskRunner.getInstance().runTask = async (_item, _args, skipGuard) => {
      capturedSkipGuard = skipGuard;
      return true;
    };

    const tool = new RunTaskTool();
    // Do NOT call prepareInvocation — simulate programmatic call
    await tool.invoke(
      { input: { id: 'npm:build' }, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    );

    assert.strictEqual(capturedSkipGuard, false);
  });

  test('_pendingTaskId set but cache changed (TOCTOU) — skipGuard=false when id mismatch', async () => {
    // prepareInvocation resolves task-A, but cache changes and invoke resolves task-B
    const itemA = makeLeaf('task-a', 'npm:task-a');
    const itemB = makeLeaf('task-b', 'npm:task-b');

    TaskCacheService.getInstance().getTask = (id) => id === 'npm:task-a' ? itemA : undefined;

    const tool = new RunTaskTool();
    // prepareInvocation sets _pendingTaskId to 'npm:task-a'
    tool.prepareInvocation(
      { input: { id: 'npm:task-a' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    );
    assert.strictEqual((tool as any)._pendingTaskId, 'npm:task-a');

    // Cache changes — now id 'npm:task-a' resolves to task-b (simulating TOCTOU)
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:task-a' ? itemB : undefined;
    // itemB has id 'npm:task-b' which != 'npm:task-a' so skipGuard should be false

    let capturedSkipGuard: boolean | undefined;
    TaskRunner.getInstance().runTask = async (_item, _args, skipGuard) => {
      capturedSkipGuard = skipGuard;
      return true;
    };

    await tool.invoke(
      { input: { id: 'npm:task-a' }, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    );

    assert.strictEqual(capturedSkipGuard, false);
  });

  // ── JSON validity ────────────────────────────────────────────────────────

  test('result JSON is valid', async () => {
    TaskCacheService.getInstance().getTask = (id) => id === 'npm:build' ? buildItem : undefined;
    const tool = new RunTaskTool();
    const result = await tool.invoke(
      { input: { id: 'npm:build' }, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ id?: string; label?: string; taskType?: string }>,
      makeCancellationToken(),
    );
    const text = (result.content[0] as vscode.LanguageModelTextPart).value;
    assert.doesNotThrow(() => JSON.parse(text));
  });
});
