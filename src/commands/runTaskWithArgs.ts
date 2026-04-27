import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { TaskCacheService } from '../services/taskCacheService';
import { configuration } from '../libs/configuration';
import { collectAdditionalArgs, tryGuidedInputWithStatus } from '../libs/guidedArgInput';

export class RunTaskWithArgsCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('runTaskWithArgs', context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (!item) {
      return;
    }
    // VS Code serializes command arguments via TaskItem.toJSON() when invoking commands
    // from action bar buttons, which strips properties like guardedByDefinition.
    // Resolve the real cached instance so all properties are intact.
    if (item.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }
    // Confirm guard BEFORE prompting for arguments
    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) { return; }

    if (configuration.get<boolean>('task.guidedArgInput', true)) {
      const guidedResult = await tryGuidedInputWithStatus(item);
      if (guidedResult.status === 'cancelled') {
        return;
      }

      if (guidedResult.status === 'collected') {
        const extraArgs = await collectAdditionalArgs(item.label as string);
        if (extraArgs === undefined) {
          return;
        }

        const mergedArgs = [...guidedResult.args, ...extraArgs];
        await TaskRunner.getInstance().runTask(item, mergedArgs.join(' '), true);
        return;
      }
      // Fall through to free-form if guided input was unavailable.
    }

    const extraArgs = await collectAdditionalArgs(item.label as string);
    if (extraArgs !== undefined) {
      await TaskRunner.getInstance().runTask(item, extraArgs.join(' '), true);
    }
  }
}
