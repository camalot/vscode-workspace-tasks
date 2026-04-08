import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { CompoundTaskService } from '../services/compoundTaskService';

export class AddToCompoundTaskCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    super('addToCompoundTask', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item: TaskItem): Promise<void> {
    const compoundTaskService = CompoundTaskService.getInstance();
    const compoundTaskNames = compoundTaskService.getCompoundTaskNames();
    let targetCompoundTask: string | undefined;

    // TODO: localize these strings
    if (compoundTaskNames.length === 0) {
      targetCompoundTask = await vscode.window.showInputBox({
        prompt: 'Enter name for new compound task',
        placeHolder: 'Compound Task Name',
        value: 'Compound Task',
      });
    } else {
      const items = [...compoundTaskNames, 'New Compound Task...'];
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select Compound Task to add task to' });
      if (selected === 'New Compound Task...') {
        targetCompoundTask = await vscode.window.showInputBox({
          prompt: 'Enter name for new compound task',
          placeHolder: 'Compound Task Name',
          value: 'Compound Task',
        });
      } else {
        targetCompoundTask = selected;
      }
    }

    if (targetCompoundTask) {
      compoundTaskService.addToCompoundTask(item, targetCompoundTask);
      this.taskTreeDataProvider.refreshLocal();
    }
  }
}
