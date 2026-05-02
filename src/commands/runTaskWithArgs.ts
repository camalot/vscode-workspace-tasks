import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { TaskCacheService } from '../services/taskCacheService';
import { configuration } from '../libs/configuration';
import { collectAdditionalArgs, tryGuidedInputWithStatus } from '../libs/guidedArgInput';
import { promptAndResolveWildcards } from '../libs/taskfileWildcardUtils';
import { promptAndResolveRequiredVars, TaskfileRequiredVar } from '../libs/taskfileVarPromptUtils';

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

    // Resolve wildcards BEFORE prompting for additional args
    let resolvedLabel: string | undefined;
    if (item.metadata?.isWildcardTask === true) {
      resolvedLabel = await promptAndResolveWildcards(
        item.label as string,
        item.metadata.wildcardCount as number,
      );
      if (resolvedLabel === undefined) {
        return; // user cancelled
      }
    }

    let varAssignments: string[] | undefined;
    const requiredVars = item.metadata?.requiredVars as TaskfileRequiredVar[] | undefined;
    if (Array.isArray(requiredVars) && requiredVars.length > 0) {
      varAssignments = await promptAndResolveRequiredVars(requiredVars, item.label as string, {
        mode: 'runWithArgs',
        defaultsByName: item.metadata?.predefinedVarValues as Record<string, string | undefined> | undefined,
      });
      if (varAssignments === undefined) {
        return;
      }
    }

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
        await TaskRunner.getInstance().runTask(item, mergedArgs.join(' '), true, resolvedLabel, varAssignments);
        return;
      }
      // Fall through to free-form if guided input was unavailable.
    }

    const extraArgs = await collectAdditionalArgs(item.label as string);
    if (extraArgs !== undefined) {
      await TaskRunner.getInstance().runTask(item, extraArgs.join(' '), true, resolvedLabel, varAssignments);
    }
  }
}
