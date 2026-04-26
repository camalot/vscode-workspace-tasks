import * as assert from 'assert';
import * as vscode from 'vscode';
import { getRunnableTasksForFile, pickTaskFromList } from '../../libs/taskQuickPick';
import { TaskItem } from '../../taskItem';
import { TaskCacheService } from '../../services/taskCacheService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { LoggerService } from '../../services/loggerService';
import { FavoritesService } from '../../services/favoritesService';
import { TaskStateManager } from '../../taskStateManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskItem(
  label: string,
  taskType: string,
  collapsibleState = vscode.TreeItemCollapsibleState.None,
  task?: vscode.Task,
): TaskItem {
  const item = new TaskItem(label, collapsibleState, taskType);
  item.id = label;
  item.originalLabel = label;
  item.taskFileUri = vscode.Uri.file(`/workspace/${label}.file`);
  if (task) {
    item.task = task;
  }
  return item;
}

function makeParentItem(label: string, taskType: string): TaskItem {
  return makeTaskItem(label, taskType, vscode.TreeItemCollapsibleState.Collapsed);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('taskQuickPick — getRunnableTasksForFile()', () => {
  let originalIsTrusted: boolean;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;

  setup(() => {
    // Reset singletons
    (TaskCacheService as any).instance = undefined;

    // Stub logger
    (LoggerService as any).instance = {
      error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    };

    // Stub TaskStateManager
    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.id ?? item.originalLabel ?? item.label,
      normalizeTaskId: (id: string) => id,
      getStatus: () => 'idle',
    };

    // Stub FavoritesService
    (FavoritesService as any).instance = { isFavorite: () => false };

    // Stub FilteredTaskService — all tasks visible by default
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };

    // Save isTrusted and default to trusted
    originalIsTrusted = vscode.workspace.isTrusted;
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });

    originalShowQuickPick = vscode.window.showQuickPick;
  });

  teardown(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (TaskCacheService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (LoggerService as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (FavoritesService as any).instance = undefined;
  });

  // ── URI guard ──────────────────────────────────────────────────────────────

  test('returns [] for undefined URI', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    assert.deepStrictEqual(getRunnableTasksForFile(undefined), []);
  });

  test('returns [] for non-file scheme (untitled)', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = vscode.Uri.parse('untitled:foo.sh');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  test('returns [] for non-file scheme (output)', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = vscode.Uri.parse('output:channel');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  // ── Workspace trust ────────────────────────────────────────────────────────

  test('returns [] when workspace is not trusted', () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('build', 'shell')],
    };
    const uri = vscode.Uri.file('/workspace/build.sh');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  // ── Empty cache ────────────────────────────────────────────────────────────

  test('returns [] when no tasks registered for the file', () => {
    (TaskCacheService as any).instance = { getTasksForFile: () => [] };
    const uri = vscode.Uri.file('/workspace/package.json');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  // ── Leaf filtering ─────────────────────────────────────────────────────────

  test('returns [] when all tasks are parent/group nodes', () => {
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [
        makeParentItem('ci-group', 'github-actions'),
        makeParentItem('scripts-group', 'npm'),
      ],
    };
    const uri = vscode.Uri.file('/workspace/.github/workflows/ci.yml');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  test('returns [] when all leaf tasks are hidden', () => {
    (FilteredTaskService as any).instance = {
      isFiltered: () => true,
      isFilteredOrHasFilteredParent: () => true,
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTaskItem('lint', 'npm'), makeTaskItem('test', 'npm')],
    };
    const uri = vscode.Uri.file('/workspace/package.json');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  test('returns only visible leaf tasks when mixed with parent nodes and hidden tasks', () => {
    const visibleLeaf = makeTaskItem('deploy', 'shell');
    const parentNode = makeParentItem('ci-group', 'github-actions');
    const hiddenLeaf = makeTaskItem('hidden', 'npm');

    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: (item: TaskItem) => item.id === 'hidden',
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [visibleLeaf, parentNode, hiddenLeaf],
    };
    const uri = vscode.Uri.file('/workspace/deploy.sh');
    const result = getRunnableTasksForFile(uri);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], visibleLeaf);
  });

  test('returns multiple visible leaf tasks', () => {
    const t1 = makeTaskItem('lint', 'npm');
    const t2 = makeTaskItem('test', 'npm');
    const t3 = makeTaskItem('build', 'npm');
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [t1, t2, t3],
    };
    const uri = vscode.Uri.file('/workspace/package.json');
    const result = getRunnableTasksForFile(uri);
    assert.deepStrictEqual(result, [t1, t2, t3]);
  });

  // ── Compound task (collapsible but has vscode.Task) ───────────────────────

  test('includes compound task node when collapsibleState is Collapsed but item.task is set', () => {
    const fakeTask = {} as vscode.Task;
    const compoundNode = makeParentItem('compound', 'shell');
    compoundNode.task = fakeTask;

    (TaskCacheService as any).instance = {
      getTasksForFile: () => [compoundNode],
    };
    const uri = vscode.Uri.file('/workspace/compound.sh');
    const result = getRunnableTasksForFile(uri);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], compoundNode);
  });

  // ── Hidden parent chain ────────────────────────────────────────────────────

  test('returns [] when child task has a hidden parent in the parent chain', () => {
    const parentItem = makeParentItem('scripts-group', 'npm');
    parentItem.id = 'scripts-group';
    const childItem = makeTaskItem('lint', 'npm');
    (childItem as any).parent = parentItem;

    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: (item: TaskItem) => {
        // Simulate parent chain detection
        let current: TaskItem | undefined = item;
        while (current) {
          if (current.id === 'scripts-group') {
            return true;
          }
          current = (current as any).parent;
        }
        return false;
      },
    };
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [childItem],
    };
    const uri = vscode.Uri.file('/workspace/package.json');
    assert.deepStrictEqual(getRunnableTasksForFile(uri), []);
  });

  // ── Non-shell types are now included ──────────────────────────────────────

  test('npm tasks are returned (not blocked by type filter)', () => {
    const npmTask = makeTaskItem('start', 'npm');
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [npmTask],
    };
    const uri = vscode.Uri.file('/workspace/package.json');
    const result = getRunnableTasksForFile(uri);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].taskType, 'npm');
  });

  test('make tasks are returned', () => {
    const makeTask = makeTaskItem('all', 'make');
    (TaskCacheService as any).instance = {
      getTasksForFile: () => [makeTask],
    };
    const uri = vscode.Uri.file('/workspace/Makefile');
    const result = getRunnableTasksForFile(uri);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].taskType, 'make');
  });
});

// ---------------------------------------------------------------------------

suite('taskQuickPick — pickTaskFromList()', () => {
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let showQuickPickArgs: [readonly vscode.QuickPickItem[], vscode.QuickPickOptions | undefined];
  let showQuickPickResult: any;

  setup(() => {
    originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (
      items: readonly vscode.QuickPickItem[],
      options?: vscode.QuickPickOptions,
    ) => {
      showQuickPickArgs = [items, options];
      return showQuickPickResult;
    };
    showQuickPickResult = undefined;
  });

  teardown(() => {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  });

  function makeItem(label: string, taskType = 'shell', originalLabel?: string): TaskItem {
    const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
    item.id = label;
    item.originalLabel = originalLabel ?? label;
    item.taskFileUri = vscode.Uri.file(`/workspace/${label}.sh`);
    return item;
  }

  // ── Cancellation ───────────────────────────────────────────────────────────

  test('returns undefined when user cancels (showQuickPick returns undefined)', async () => {
    showQuickPickResult = undefined;
    const tasks = [makeItem('deploy')];
    const result = await pickTaskFromList(tasks);
    assert.strictEqual(result, undefined);
  });

  // ── Selection ─────────────────────────────────────────────────────────────

  test('returns the TaskItem for the selected pick', async () => {
    const task1 = makeItem('build');
    const task2 = makeItem('deploy');
    // Simulate user picks the second item
    showQuickPickResult = { label: 'deploy', description: 'shell', taskItem: task2 };
    const result = await pickTaskFromList([task1, task2]);
    assert.strictEqual(result, task2);
  });

  // ── QuickPick item label ───────────────────────────────────────────────────

  test('uses originalLabel for pick label when set', async () => {
    const task = makeItem('my-task', 'shell', 'My Task');
    showQuickPickResult = undefined;
    await pickTaskFromList([task]);
    const picks = showQuickPickArgs[0] as Array<{ label: string; taskItem: TaskItem }>;
    assert.strictEqual(picks[0].label, 'My Task');
  });

  test('falls back to label when originalLabel matches label', async () => {
    const task = makeItem('build');
    // originalLabel == label == 'build'
    showQuickPickResult = undefined;
    await pickTaskFromList([task]);
    const picks = showQuickPickArgs[0] as Array<{ label: string }>;
    assert.strictEqual(picks[0].label, 'build');
  });

  // ── QuickPick item description & detail ───────────────────────────────────

  test('description is the task type', async () => {
    const task = makeItem('lint', 'npm');
    showQuickPickResult = undefined;
    await pickTaskFromList([task]);
    const picks = showQuickPickArgs[0] as unknown as Array<{ description: string }>;
    assert.strictEqual(picks[0].description, 'npm');
  });

  test('detail is taskFileUri.fsPath when taskFileUri is set', async () => {
    const task = makeItem('lint', 'npm');
    showQuickPickResult = undefined;
    await pickTaskFromList([task]);
    const picks = showQuickPickArgs[0] as unknown as Array<{ detail: string | undefined }>;
    assert.strictEqual(picks[0].detail, task.taskFileUri!.fsPath);
  });

  test('detail is undefined when taskFileUri is not set', async () => {
    const task = new TaskItem('no-uri-task', vscode.TreeItemCollapsibleState.None, 'shell');
    task.id = 'no-uri-task';
    task.originalLabel = 'no-uri-task';
    // taskFileUri intentionally not set
    showQuickPickResult = undefined;
    await pickTaskFromList([task]);
    const picks = showQuickPickArgs[0] as unknown as Array<{ detail: string | undefined }>;
    assert.strictEqual(picks[0].detail, undefined);
  });

  // ── placeHolder ───────────────────────────────────────────────────────────

  test('uses default placeHolder when no options provided', async () => {
    showQuickPickResult = undefined;
    await pickTaskFromList([makeItem('build')]);
    assert.strictEqual(showQuickPickArgs[1]?.placeHolder, 'Select a task to run');
  });

  test('forwards custom placeHolder from options', async () => {
    showQuickPickResult = undefined;
    await pickTaskFromList([makeItem('build')], { placeHolder: 'Pick one' });
    assert.strictEqual(showQuickPickArgs[1]?.placeHolder, 'Pick one');
  });
});
