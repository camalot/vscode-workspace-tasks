import * as assert from 'assert';
import * as vscode from 'vscode';
import { GetTasksTool } from '../../tools/getTasksTool';
import { TaskCacheService } from '../../services/taskCacheService';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(label: string, taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = `${taskType}:${label}`;
  item.originalLabel = label;
  item.task = {} as vscode.Task;
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

async function invokeGetTasks(input: { query?: string; taskType?: string } = {}, cancelled = false) {
  const tool = new GetTasksTool();
  const result = await tool.invoke(
    { input, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ query?: string; taskType?: string }>,
    makeCancellationToken(cancelled),
  );
  const part = result.content[0] as vscode.LanguageModelTextPart;
  return JSON.parse(part.value);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('GetTasksTool Test Suite', () => {
  let originalIsTrusted: PropertyDescriptor | undefined;
  let originalGetAllTasks: typeof TaskCacheService.prototype.getAllTasks;
  let originalIsLoading: typeof TaskCacheService.prototype.isLoading;

  setup(() => {
    originalIsTrusted = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
    originalGetAllTasks = TaskCacheService.getInstance().getAllTasks.bind(TaskCacheService.getInstance());
    originalIsLoading = TaskCacheService.getInstance().isLoading.bind(TaskCacheService.getInstance());
  });

  teardown(() => {
    if (originalIsTrusted) {
      Object.defineProperty(vscode.workspace, 'isTrusted', originalIsTrusted);
    } else {
      // Re-apply default trusting behaviour if the descriptor was missing (shouldn't happen in tests)
      Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    }
    TaskCacheService.getInstance().getAllTasks = originalGetAllTasks;
    TaskCacheService.getInstance().isLoading = originalIsLoading;
  });

  // ── Workspace trust ──────────────────────────────────────────────────────

  test('untrusted workspace — returns isTrusted:false and empty tasks', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    const result = await invokeGetTasks();
    assert.strictEqual(result.isTrusted, false);
    assert.deepStrictEqual(result.tasks, []);
    assert.ok(result.explanation, 'explanation should be set');
  });

  // ── Cache loading ────────────────────────────────────────────────────────

  test('cache loading — returns isLoading:true and empty tasks', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => true;
    TaskCacheService.getInstance().getAllTasks = () => [];
    const result = await invokeGetTasks();
    assert.strictEqual(result.isLoading, true);
    assert.deepStrictEqual(result.tasks, []);
    assert.ok(result.explanation);
  });

  // ── No filter ────────────────────────────────────────────────────────────

  test('no filter — flat tasks — all leaf tasks returned', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('build'), makeLeaf('test')];
    const result = await invokeGetTasks();
    assert.strictEqual(result.tasks.length, 2);
    assert.strictEqual(result.isTrusted, true);
    assert.strictEqual(result.isLoading, false);
  });

  test('no filter — nested tasks — children collected recursively', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    const group = makeGroup('group', [makeLeaf('child-a'), makeLeaf('child-b')]);
    TaskCacheService.getInstance().getAllTasks = () => [group];
    const result = await invokeGetTasks();
    assert.strictEqual(result.tasks.length, 2);
    const labels = result.tasks.map((t: { label: string }) => t.label);
    assert.ok(labels.includes('child-a'));
    assert.ok(labels.includes('child-b'));
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  test('query filter (case-insensitive) — only matching labels', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('Build App'), makeLeaf('test'), makeLeaf('build-lib')];
    const result = await invokeGetTasks({ query: 'build' });
    assert.strictEqual(result.tasks.length, 2);
    const labels = result.tasks.map((t: { label: string }) => t.label);
    assert.ok(labels.includes('Build App'));
    assert.ok(labels.includes('build-lib'));
  });

  test('taskType filter (case-insensitive) — only matching types', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('build', 'npm'), makeLeaf('compile', 'shell')];
    const result = await invokeGetTasks({ taskType: 'NPM' });
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].label, 'build');
  });

  test('both filters — intersection applied', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [
      makeLeaf('build', 'npm'),
      makeLeaf('build', 'shell'),
      makeLeaf('test', 'npm'),
    ];
    const result = await invokeGetTasks({ query: 'build', taskType: 'npm' });
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].type, 'npm');
  });

  test('no matches — returns empty tasks array with explanation', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('build')];
    const result = await invokeGetTasks({ query: 'no-match-xyz' });
    assert.deepStrictEqual(result.tasks, []);
    assert.ok(result.explanation);
  });

  // ── Truncation ───────────────────────────────────────────────────────────

  test('truncation — >500 tasks — truncated:true and 500 results', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    const manyTasks = Array.from({ length: 600 }, (_, i) => makeLeaf(`task-${i}`));
    TaskCacheService.getInstance().getAllTasks = () => manyTasks;
    const result = await invokeGetTasks();
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.tasks.length, 500);
    assert.strictEqual(result.totalBeforeTruncation, 600);
    assert.ok(result.explanation);
  });

  test('truncation — <=500 tasks — truncated:false', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    const tasks = Array.from({ length: 5 }, (_, i) => makeLeaf(`task-${i}`));
    TaskCacheService.getInstance().getAllTasks = () => tasks;
    const result = await invokeGetTasks();
    assert.strictEqual(result.truncated, false);
  });

  // ── Sorting ───────────────────────────────────────────────────────────────

  test('sorting determinism — two invocations return identical order', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [
      makeLeaf('z-task', 'npm'),
      makeLeaf('a-task', 'shell'),
      makeLeaf('m-task', 'npm'),
    ];
    const result1 = await invokeGetTasks();
    const result2 = await invokeGetTasks();
    const labels1 = result1.tasks.map((t: { label: string }) => t.label);
    const labels2 = result2.tasks.map((t: { label: string }) => t.label);
    assert.deepStrictEqual(labels1, labels2);
    // npm comes before shell, then sorted by label within type
    assert.strictEqual(labels1[0], 'm-task'); // npm:m-task
    assert.strictEqual(labels1[1], 'z-task'); // npm:z-task
    assert.strictEqual(labels1[2], 'a-task'); // shell:a-task
  });

  // ── Cancellation ──────────────────────────────────────────────────────────

  test('cancellation token cancelled — returns explanation:Cancelled.', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    const result = await invokeGetTasks({}, true);
    assert.strictEqual(result.explanation, 'Cancelled.');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  test('internal error — returns result with explanation set', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => { throw new Error('boom'); };
    const result = await invokeGetTasks();
    assert.ok(result.explanation?.includes('boom'));
    assert.deepStrictEqual(result.tasks, []);
  });

  // ── prepareInvocation ────────────────────────────────────────────────────

  test('prepareInvocation — returns correct invocationMessage', () => {
    const tool = new GetTasksTool();
    const prepared = tool.prepareInvocation(
      { input: {} } as vscode.LanguageModelToolInvocationPrepareOptions<{ query?: string; taskType?: string }>,
      makeCancellationToken(),
    ) as vscode.PreparedToolInvocation;
    assert.ok(prepared);
    assert.strictEqual(prepared.invocationMessage, 'Fetching available workspace tasks...');
    assert.strictEqual((prepared as any).confirmationMessages, undefined);
  });

  // ── JSON validity ────────────────────────────────────────────────────────

  test('result JSON is valid', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    TaskCacheService.getInstance().isLoading = () => false;
    TaskCacheService.getInstance().getAllTasks = () => [makeLeaf('build')];
    const tool = new GetTasksTool();
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken } as vscode.LanguageModelToolInvocationOptions<{ query?: string; taskType?: string }>,
      makeCancellationToken(),
    );
    const text = (result.content[0] as vscode.LanguageModelTextPart).value;
    assert.doesNotThrow(() => JSON.parse(text));
  });
});
