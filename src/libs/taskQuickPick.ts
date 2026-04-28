import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskCacheService } from '../services/taskCacheService';
import { FilteredTaskService } from '../services/filteredTaskService';
import { isRunnableTask } from '../tools/taskToolsUtils';

interface TaskQuickPickItem extends vscode.QuickPickItem {
  taskItem: TaskItem;
}

/**
 * Returns the runnable (non-hidden) tasks for a given file URI.
 *
 * A task is considered runnable when {@link isRunnableTask} returns `true` and it is
 * not filtered (hidden) by the user.
 *
 * `getTasksForFile()` may return both parent/group container nodes and leaf nodes.
 * This function includes any node that explicitly exposes a run action command,
 * including runnable group nodes.
 *
 * Returns `[]` when:
 *  - `uri` is `undefined` or its scheme is not `'file'`
 *  - the workspace is not trusted
 *  - no tasks are registered for the file
 *  - all registered tasks are hidden or are not runnable
 *
 * Note: For flat providers (npm, make, etc.) task items have no `.parent` set.
 * If the tree-level TYPE group is hidden, `isFilteredOrHasFilteredParent()` cannot
 * detect this because the task's `.parent` is `undefined`. Those tasks will still be
 * included. See the known-limitations documentation for details.
 */
export function getRunnableTasksForFile(uri: vscode.Uri | undefined): TaskItem[] {
  if (!uri || uri.scheme !== 'file') {
    return [];
  }
  if (!vscode.workspace.isTrusted) {
    return [];
  }
  const all = TaskCacheService.getInstance().getTasksForFile(uri);
  const filteredService = FilteredTaskService.getInstance();
  return all.filter(
    (t) => isRunnableTask(t) && !filteredService.isFilteredOrHasFilteredParent(t),
  );
}

/**
 * Shows a `vscode.window.showQuickPick` for selecting among multiple tasks.
 *
 * @param tasks   Non-empty list of candidate `TaskItem`s.
 * @param options Optional display options. `placeHolder` defaults to `'Select a task to run'`.
 * @returns       The selected `TaskItem`, or `undefined` if the user cancelled.
 */
export async function pickTaskFromList(
  tasks: TaskItem[],
  options?: { placeHolder?: string },
): Promise<TaskItem | undefined> {
  const picks: TaskQuickPickItem[] = tasks.map((t) => ({
    label: (t.originalLabel ?? t.label ?? '') as string,
    description: t.taskType,
    detail: t.taskFileUri?.fsPath,
    taskItem: t,
  }));
  const selection = await vscode.window.showQuickPick(picks, {
    placeHolder: options?.placeHolder ?? 'Select a task to run',
  });
  return selection?.taskItem;
}
