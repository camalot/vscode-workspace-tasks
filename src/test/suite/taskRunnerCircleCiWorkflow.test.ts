import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskRunner } from '../../taskRunner';
import { TaskItem } from '../../taskItem';
import { TaskStateManager, TaskStatus } from '../../taskStateManager';
import { CompoundTaskService } from '../../services/compoundTaskService';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { RecentTasksService } from '../../services/recentTasksService';
import { TaskRunGuardService } from '../../services/taskRunGuardService';

suite('TaskRunner CircleCI Workflow Test Suite', () => {
  let runner: TaskRunner;
  let originalShowWarning: typeof vscode.window.showWarningMessage;

  let warnings: string[];
  let states: Map<string, TaskStatus>;
  let recentAdds: string[];

  function makeWorkflowItem(): TaskItem {
    const fileUri = vscode.Uri.file('/tmp/.circleci/config.yml');
    const workflow = new TaskItem('workflow: ci', vscode.TreeItemCollapsibleState.Collapsed, 'circleci', fileUri);
    workflow.taskFileUri = fileUri;
    workflow.metadata = {
      type: 'workflow',
      workflowName: 'ci',
      workflowJobs: ['lint', 'test'],
    };

    const lint = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'circleci', fileUri);
    lint.taskFileUri = fileUri;
    lint.metadata = { type: 'job', jobName: 'lint', workflowName: 'ci' };

    const test = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'circleci', fileUri);
    test.taskFileUri = fileUri;
    test.metadata = { type: 'job', jobName: 'test', workflowName: 'ci' };

    workflow.children = [lint, test];
    lint.parent = workflow;
    test.parent = workflow;

    return workflow;
  }

  setup(() => {
    (TaskRunner as any).instance = undefined;
    runner = TaskRunner.getInstance();

    warnings = [];
    states = new Map();
    recentAdds = [];

    originalShowWarning = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };

    (TaskRunGuardService as any)._instance = {
      confirmIfNeeded: async () => true,
    };

    (TaskStateManager as any).instance = {
      getTaskId: (item: TaskItem) => item.originalLabel || item.label,
      getStatus: (id: string) => states.get(id) ?? 'idle',
      setStatus: (id: string, status: TaskStatus) => states.set(id, status),
      clearAllBlocks: () => {},
      normalizeTaskId: (id: string) => id,
    };

    (FavoritesService as any).instance = { isFavorite: () => false };
    (FilteredTaskService as any).instance = {
      isFiltered: () => false,
      isFilteredOrHasFilteredParent: () => false,
    };
    (RecentTasksService as any).instance = {
      addRecentTask: (id: string) => recentAdds.push(id),
    };
  });

  teardown(() => {
    (vscode.window as any).showWarningMessage = originalShowWarning;
    (TaskRunner as any).instance = undefined;
    (TaskStateManager as any).instance = undefined;
    (CompoundTaskService as any).instance = undefined;
    (TaskRunGuardService as any)._instance = undefined;
    (FavoritesService as any).instance = undefined;
    (FilteredTaskService as any).instance = undefined;
    (RecentTasksService as any).instance = undefined;
  });

  test('runTask on workflow delegates to sequential compound-style run', async () => {
    const workflow = makeWorkflowItem();

    let createdName = '';
    let createdCount = 0;
    let clearedName = '';
    (CompoundTaskService as any).instance = {
      createTransientCompoundTask: (name: string, items: TaskItem[], executionType: string) => {
        createdName = name;
        createdCount = items.length;
        assert.strictEqual(executionType, 'sequential');
      },
      clearTransientCompoundTask: (name: string) => {
        clearedName = name;
      },
    };

    let runName = '';
    (runner as any).runCompoundTask = async (name: string) => {
      runName = name;
    };

    const result = await runner.runTask(workflow);

    assert.strictEqual(result, true);
    assert.ok(createdName.startsWith('circleci@'));
    assert.strictEqual(createdCount, 2);
    assert.strictEqual(runName, createdName);
    assert.strictEqual(clearedName, createdName);
    assert.ok(recentAdds.length > 0);
    assert.strictEqual(states.get(workflow.originalLabel || workflow.label), 'idle');
  });

  test('runTask on workflow warns when no jobs are available', async () => {
    const fileUri = vscode.Uri.file('/tmp/.circleci/config.yml');
    const workflow = new TaskItem('workflow: empty', vscode.TreeItemCollapsibleState.Collapsed, 'circleci', fileUri);
    workflow.taskFileUri = fileUri;
    workflow.metadata = { type: 'workflow', workflowName: 'empty', workflowJobs: [] };

    (CompoundTaskService as any).instance = {
      createTransientCompoundTask: () => {
        throw new Error('should not be called');
      },
      clearTransientCompoundTask: () => {},
    };

    const result = await runner.runTask(workflow);

    assert.strictEqual(result, false);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('no runnable jobs'));
  });
});
