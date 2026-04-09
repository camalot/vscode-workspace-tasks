import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { CompoundTaskService } from '../services/compoundTaskService';

export class PurgeInvalidCompoundTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    super('purgeInvalidCompoundTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(): Promise<void> {
    const service = CompoundTaskService.getInstance();

    // --- Phase 1: Auto-remove items with definitively unrunnable task types (no user prompt needed) ---
    const unrunnableRemoved = service.purgeUnrunnableItems();
    let autoRemovedCount = 0;
    for (const [taskName, labels] of unrunnableRemoved) {
      autoRemovedCount += labels.length;
      this.logger.debug(`[PurgeInvalidCompoundTasks] Auto-removed ${labels.length} unrunnable item(s) from '${taskName}': [${labels.join(', ')}]`);
    }

    // --- Phase 2: Identify ghost compound tasks (whole tasks with no valid workspace items) ---
    const rawTasks = service.getAllCompoundTasksRaw();
    const validTasks = service.getAllCompoundTasks();

    const ghostTaskNames: string[] = [];
    for (const [name] of rawTasks) {
      if (!validTasks.has(name)) {
        ghostTaskNames.push(name);
      }
    }

    // --- Phase 3: Identify items with URIs outside the current workspace ---
    const invalidItemsByTask = service.getInvalidItemsByCompoundTask();

    const hasGhosts = ghostTaskNames.length > 0;
    const hasInvalidItems = invalidItemsByTask.size > 0;

    if (!hasGhosts && !hasInvalidItems && autoRemovedCount === 0) {
      vscode.window.showInformationMessage('No invalid compound tasks or items found in storage.');
      return;
    }

    if (!hasGhosts && !hasInvalidItems) {
      // Only auto-removed items; nothing interactive needed
      this.taskTreeDataProvider.refreshLocal();
      vscode.window.showInformationMessage(
        `Automatically removed ${autoRemovedCount} unrunnable item(s) from compound task storage.`,
      );
      return;
    }

    // --- Phase 4: Build quick pick list for user to review and confirm removals ---
    interface QuickPickEntry extends vscode.QuickPickItem {
      entryKind: 'ghost-task' | 'invalid-item';
      taskName: string;
      itemLabel?: string;
    }

    const quickPickItems: (QuickPickEntry | vscode.QuickPickItem)[] = [];

    if (ghostTaskNames.length > 0) {
      quickPickItems.push({
        label: 'Ghost Compound Tasks',
        kind: vscode.QuickPickItemKind.Separator,
      });
      for (const name of ghostTaskNames) {
        const storedItems = rawTasks.get(name) ?? [];
        const entry: QuickPickEntry = {
          label: name,
          description: `${storedItems.length} stored item(s), none accessible in current workspace`,
          picked: true,
          entryKind: 'ghost-task',
          taskName: name,
        };
        quickPickItems.push(entry);
      }
    }

    if (invalidItemsByTask.size > 0) {
      quickPickItems.push({
        label: 'Items with URIs Outside Current Workspace',
        kind: vscode.QuickPickItemKind.Separator,
      });
      for (const [taskName, items] of invalidItemsByTask) {
        for (const item of items) {
          const itemLabel = item.originalLabel || (item.label as string);
          const uri = (item.taskFileUri || item.resourceUri)?.toString() ?? '(unknown)';
          const entry: QuickPickEntry = {
            label: `${taskName} → ${itemLabel}`,
            description: uri,
            detail: `Item '${itemLabel}' in compound task '${taskName}' references a file outside the current workspace.`,
            picked: true,
            entryKind: 'invalid-item',
            taskName,
            itemLabel,
          };
          quickPickItems.push(entry);
        }
      }
    }

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder: 'Select items to remove from storage',
      title: 'Purge Invalid Compound Task Storage',
    });

    if (!selected || selected.length === 0) {
      if (autoRemovedCount > 0) {
        this.taskTreeDataProvider.refreshLocal();
        vscode.window.showInformationMessage(
          `Automatically removed ${autoRemovedCount} unrunnable item(s). No additional items selected for removal.`,
        );
      }
      return;
    }

    let removedCount = 0;

    for (const raw of selected) {
      const entry = raw as QuickPickEntry;
      if (!entry.entryKind) { continue; }

      if (entry.entryKind === 'ghost-task') {
        service.clearCompoundTask(entry.taskName);
        this.logger.debug(`[PurgeInvalidCompoundTasks] Cleared ghost compound task '${entry.taskName}'.`);
        removedCount++;
      } else if (entry.entryKind === 'invalid-item' && entry.itemLabel) {
        // Find and remove this specific item from the compound task
        const compoundTaskItems = service.getCompoundTask(entry.taskName);
        if (compoundTaskItems) {
          const itemToRemove = compoundTaskItems.find(
            (t) => (t.originalLabel || t.label) === entry.itemLabel,
          );
          if (itemToRemove) {
            service.removeFromCompoundTask(itemToRemove, entry.taskName);
            this.logger.debug(`[PurgeInvalidCompoundTasks] Removed item '${entry.itemLabel}' from compound task '${entry.taskName}'.`);
            removedCount++;
          }
        }
      }
    }

    if (removedCount > 0 || autoRemovedCount > 0) {
      this.taskTreeDataProvider.refreshLocal();
    }

    const totalRemoved = removedCount + autoRemovedCount;
    vscode.window.showInformationMessage(
      `Purge complete: ${totalRemoved} item(s)/task(s) removed from compound task storage.`,
    );
  }
}
