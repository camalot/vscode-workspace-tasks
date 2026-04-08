import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { CompoundTaskService, CompoundTaskExecutionType} from '../services/compoundTaskService';

export class SetCompoundTaskExecutionTypeCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('setCompoundTaskExecutionType', context);
  }

  async run(item?: TaskItem): Promise<void> {
    const taskTreeDataProvider = TaskTreeDataProvider.getInstance();

    let compoundTaskName: string | undefined;

    if (item && item.contextValue === 'compoundTask') {
      compoundTaskName = item.label as string;
    } else {
      const compoundTaskService = CompoundTaskService.getInstance();
      const compoundTasks = compoundTaskService.getCompoundTaskNames();
      if (compoundTasks.length === 0) {
        vscode.window.showInformationMessage('No compound tasks available.');
        return;
      }
      if (compoundTasks.length === 1) {
        compoundTaskName = compoundTasks[0];
      } else {
        compoundTaskName = await vscode.window.showQuickPick(compoundTasks, { placeHolder: 'Select compound task' });
      }
    }

    if (!compoundTaskName) {
      return;
    }

    const compoundTaskService = CompoundTaskService.getInstance();
    const current = compoundTaskService.getCompoundTaskExecutionType(compoundTaskName);
    const next: CompoundTaskExecutionType = current === 'sequential' ? 'parallel' : 'sequential';
    compoundTaskService.setCompoundTaskExecutionType(compoundTaskName, next);
    taskTreeDataProvider.refreshLocal();
  }
}
