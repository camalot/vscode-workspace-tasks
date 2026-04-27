import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';

/**
 * A lightweight summary of a task, safe for JSON serialisation and LLM consumption.
 * `id` is `null` when no stable portable ID has been assigned to the item.
 */
export interface TaskSummary {
  id: string | null;
  label: string;
  type: string;
  source: string | null;
  workspaceFolder?: string;
}

/**
 * Returns `true` when the item is a runnable leaf task rather than a display-only
 * group node. A node is considered a leaf when it either has no children (the most
 * common case) or when it has an associated `vscode.Task` (e.g. a compound task that
 * also exposes individual run targets).
 */
export function isLeafTask(item: TaskItem): boolean {
  return item.collapsibleState === vscode.TreeItemCollapsibleState.None || item.task !== undefined;
}

/**
 * Returns `true` when the task item exposes a run action.
 *
 * This intentionally includes runnable group nodes (for example, Bitbucket
 * pipelines and stages) in addition to traditional leaf tasks.
 */
export function isRunnableTask(item: TaskItem): boolean {
  return item.onRunActionCommand !== undefined || item.task !== undefined;
}

/**
 * Recursively collects all leaf `TaskItem`s from a hierarchical provider tree.
 *
 * Uses an exclusive `if / else if` branch so that a compound task node that is both
 * a leaf *and* has dependency children is added exactly once — not added AND recursed.
 */
export function collectLeafTasks(items: TaskItem[]): TaskItem[] {
  const result: TaskItem[] = [];
  for (const item of items) {
    if (isLeafTask(item)) {
      result.push(item);
    } else if (item.children && item.children.length > 0) {
      result.push(...collectLeafTasks(item.children));
    }
  }
  return result;
}

/**
 * Maps a `TaskItem` to a `TaskSummary` suitable for JSON serialisation.
 *
 * - `id` is `null` (not `''`) when no stable ID is available so callers can
 *   distinguish "no ID" from an empty-string ID.
 * - `source` is `null` when no file URI is available; a relative path when the
 *   file falls within the current workspace; an absolute path otherwise.
 * - `workspaceFolder` is omitted in single-root workspaces to reduce payload size.
 */
export function toSummary(item: TaskItem): TaskSummary {
  const label = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';

  let source: string | null = null;
  if (item.taskFileUri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(item.taskFileUri);
    if (wsFolder) {
      source = vscode.workspace.asRelativePath(item.taskFileUri, true);
    } else {
      source = item.taskFileUri.fsPath;
    }
  }

  const summary: TaskSummary = {
    id: item.id ?? null,
    label,
    type: item.taskType,
    source,
  };

  // Include workspaceFolder only in multi-root workspaces
  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
    const wsFolder = item.taskFileUri
      ? vscode.workspace.getWorkspaceFolder(item.taskFileUri)
      : undefined;
    if (wsFolder) {
      summary.workspaceFolder = wsFolder.name;
    }
  }

  return summary;
}
