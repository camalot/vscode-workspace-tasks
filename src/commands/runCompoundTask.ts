import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { CompoundTaskService } from '../services/compoundTaskService';
import { TaskRunner } from '../taskRunner';

export class RunCompoundTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('runCompoundTask', context);
  }

  async run(item?: TaskItem): Promise<void> {
    const taskRunner = TaskRunner.getInstance();

    if (item && (item.contextValue === 'compoundTask' || item.contextValue === 'favoriteCompoundTask')) {
      taskRunner.runCompoundTask(item.label as string);
      return;
    }

    const compoundTaskService = CompoundTaskService.getInstance();

    const compoundTasks = compoundTaskService.getCompoundTaskNames();
    if (compoundTasks.length === 0) {
      vscode.window.showInformationMessage('No compound tasks to run.');
      return;
    }

    let compoundTaskName: string | undefined;
    if (compoundTasks.length === 1) {
      compoundTaskName = compoundTasks[0];
    } else {
      compoundTaskName = await vscode.window.showQuickPick(compoundTasks, { placeHolder: 'Select compound task to run' });
    }

    if (compoundTaskName) {
      taskRunner.runCompoundTask(compoundTaskName);
    }
  }
}
