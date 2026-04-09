import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { CompoundTaskService } from './services/compoundTaskService';

export class TaskTreeDragAndDropController implements vscode.TreeDragAndDropController<TaskItem> {
  readonly dragMimeTypes = ['application/vnd.code.tree.workspaceTasksView'];
  readonly dropMimeTypes = ['application/vnd.code.tree.workspaceTasksView'];

  public handleDrag(
    source: readonly TaskItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    if (source.length === 0) {
      return;
    }

    // Only allow dragging queue tasks
    const draggedItem = source[0];
    if (draggedItem.contextValue !== 'queuedTask') {
      return;
    }

    const id = TaskStateManager.getInstance().getTaskId(draggedItem);
    dataTransfer.set('application/vnd.code.tree.workspaceTasksView', new vscode.DataTransferItem(JSON.stringify(id)));
  }

  public async handleDrop(
    target: TaskItem | undefined,
    sources: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const transferItem = sources.get('application/vnd.code.tree.workspaceTasksView');
    if (!transferItem) {
      return;
    }

    if (!target) {
      return;
    } // Dropping on empty space not supported for now, or could imply end of list

    // Ensure we are dropping ONTO a queued task (reordering)
    if (target.contextValue !== 'queuedTask') {
      return;
    }

    let sourceId: any;
    try {
      sourceId = JSON.parse(await transferItem.asString());
    } catch {
      return;
    }

    // Perform the move in the state manager
    // Find source item across all compound tasks
    let sourceItem: TaskItem | undefined;
    const allCompoundTasks = CompoundTaskService.getInstance().getAllCompoundTasks();
    for (const [_, tasks] of allCompoundTasks) {
      const found = tasks.find((t) => TaskStateManager.getInstance().getTaskId(t) === sourceId);
      if (found) {
        sourceItem = found;
        break;
      }
    }

    if (sourceItem) {
      CompoundTaskService.getInstance().moveCompoundTaskItem(sourceItem, target);
      vscode.commands.executeCommand('workspaceTasks.refresh');
    }
  }
}
