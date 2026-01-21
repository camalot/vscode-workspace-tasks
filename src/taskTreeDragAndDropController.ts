import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';

export class TaskTreeDragAndDropController implements vscode.TreeDragAndDropController<TaskItem> {
    readonly dragMimeTypes = ['application/vnd.code.tree.workspaceTasksView'];
    readonly dropMimeTypes = ['application/vnd.code.tree.workspaceTasksView'];

    public handleDrag(source: readonly TaskItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (source.length === 0) { return; }

        // Only allow dragging queue tasks
        const draggedItem = source[0];
        if (draggedItem.contextValue !== 'queuedTask') {
            return;
        }

        const id = TaskStateManager.getInstance().getTaskId(draggedItem);
        dataTransfer.set('application/vnd.code.tree.workspaceTasksView', new vscode.DataTransferItem(JSON.stringify(id)));
    }

    public handleDrop(target: TaskItem | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        const transferItem = sources.get('application/vnd.code.tree.workspaceTasksView');
        if (!transferItem) { return; }

        if (!target) { return; } // Dropping on empty space not supported for now, or could imply end of list

        // Ensure we are dropping ONTO a queued task (reordering)
        if (target.contextValue !== 'queuedTask') {
             return;
        }

        const sourceId = JSON.parse(transferItem.value as string);

        // Perform the move in the state manager
        // We need the source Item object, but we only have ID.
        // But the queue in StateManager holds TaskItems.
        // We can look them up there.

        const queue = TaskStateManager.getInstance().getQueue();
        const sourceItem = queue.find(t => TaskStateManager.getInstance().getTaskId(t) === sourceId);

        if (sourceItem) {
             TaskStateManager.getInstance().moveQueueItem(sourceItem, target);
             vscode.commands.executeCommand('workspaceTasks.refresh');
        }
    }
}
