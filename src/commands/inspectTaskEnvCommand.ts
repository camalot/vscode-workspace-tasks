import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { TaskEnvService } from '../services/taskEnvService';
import { TaskSecretWarningService } from '../services/taskSecretWarningService';
import { TaskCacheService } from '../services/taskCacheService';
import { IResolvedEnvEntry } from '../services/taskEnvTypes';

/** Width allocations for the table columns. */
const COL_KEY = 28;
const COL_VALUE = 28;
const COL_SOURCE = 20;
const COL_FILE = 30;

/** Output channel shared across all invocations (created lazily). */
let outputChannel: vscode.OutputChannel | undefined;

/** Resets the cached output channel — used in tests to force re-creation. */
export function __resetOutputChannelForTest(): void {
  outputChannel = undefined;
}

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Workspace Tasks – Environment');
  }
  return outputChannel;
}

function pad(str: string, width: number): string {
  if (str.length >= width) {
    return str.substring(0, width - 1) + '…';
  }
  return str.padEnd(width);
}

function shortSourceLabel(source: IResolvedEnvEntry['source']): string {
  const labels: Record<IResolvedEnvEntry['source'], string> = {
    globalSetting: 'global.env',
    globalEnvFile: 'global.envFile',
    globalSecretFile: 'global.secretFile',
    blockEnvFile: 'block.envFile',
    blockEnv: 'block.env',
    blockSecretFile: 'block.secretFile',
    taskEnvFile: 'task.envFile',
    taskEnv: 'task.env',
    taskSecretFile: 'task.secretFile',
    taskSecretStorage: 'task.secretStorage',
    ruleEnvFile: 'rule.envFile',
    ruleEnv: 'rule.env',
    ruleSecretFile: 'rule.secretFile',
    ruleSecretStorage: 'rule.secretStorage',
  };
  return labels[source] ?? source;
}

function renderTable(
  envMap: Map<string, IResolvedEnvEntry>,
  secretPatterns: string[],
): string {
  const lines: string[] = [];

  const header =
    pad('KEY', COL_KEY) + '  ' +
    pad('VALUE', COL_VALUE) + '  ' +
    pad('SOURCE', COL_SOURCE) + '  ' +
    'FILE';

  const separator = '─'.repeat(COL_KEY) + '  ' +
    '─'.repeat(COL_VALUE) + '  ' +
    '─'.repeat(COL_SOURCE) + '  ' +
    '─'.repeat(COL_FILE);

  lines.push(header);
  lines.push(separator);

  for (const [key, entry] of envMap) {
    const displayValue = entry.isSecret ? '***' : entry.value;
    const fileDisplay = entry.sourceFilePath
      ? path.basename(entry.sourceFilePath)
      : (entry.source === 'taskSecretStorage' || entry.source === 'ruleSecretStorage'
        ? 'SecretStorage'
        : '—');

    lines.push(
      pad(key, COL_KEY) + '  ' +
      pad(displayValue, COL_VALUE) + '  ' +
      pad(shortSourceLabel(entry.source), COL_SOURCE) + '  ' +
      fileDisplay,
    );
  }

  // Warning section: non-secret keys matching secret patterns
  const warningService = TaskSecretWarningService.getInstance();
  const suspicious = [...envMap.entries()].filter(
    ([key, entry]) => !entry.isSecret && warningService.matchesAnyPattern(key, secretPatterns),
  );

  if (suspicious.length > 0) {
    lines.push('');
    lines.push('⚠  Warning — keys below match secret patterns but are not from a secure source:');
    for (const [key, entry] of suspicious) {
      lines.push(`   ${key}  (source: ${shortSourceLabel(entry.source)}, file: ${entry.sourceFilePath ? path.basename(entry.sourceFilePath) : '—'})`);
    }
    lines.push('   Consider moving them to a .secret file or use "Workspace Tasks: Store Secret".');
  }

  return lines.join('\n');
}

/**
 * Command: `workspaceTasks.env.inspect`
 *
 * Resolves and displays the fully-merged environment variable table for a task
 * in the "Workspace Tasks – Environment" Output Channel. Secret values are redacted.
 *
 * Can be triggered from the task context menu (receives a `TaskItem`) or from the
 * command palette (shows a QuickPick of all known tasks).
 */
export class InspectTaskEnvCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('env.inspect', context);
  }

  async run(item?: TaskItem): Promise<void> {
    let taskItem = item;

    if (!taskItem) {
      taskItem = await this.pickTask();
    }

    if (!taskItem) {
      return;
    }

    const envService = TaskEnvService.getInstance();
    const envMap = await envService.resolveTaskEnv(taskItem);
    const secretPatterns = envService.currentSecretPatterns;
    const taskLabel = (taskItem.originalLabel || taskItem.label) as string;

    const channel = getChannel();
    channel.clear();
    channel.show(true /* preserve focus */);

    channel.appendLine(`Environment variables for task: ${taskLabel}`);
    channel.appendLine(`Task type: ${taskItem.taskType}`);
    if (taskItem.taskFileUri) {
      channel.appendLine(`Source file: ${taskItem.taskFileUri.fsPath}`);
    }
    channel.appendLine('');

    if (envMap.size === 0) {
      channel.appendLine('No environment variables resolved for this task.');
      return;
    }

    channel.appendLine(renderTable(envMap, secretPatterns));
    channel.appendLine('');
    channel.appendLine(`Total: ${envMap.size} variable(s)`);
  }

  private async pickTask(): Promise<TaskItem | undefined> {
    const allTasks = TaskCacheService.getInstance().getAllTasks().filter(
      (t) => t.collapsibleState === vscode.TreeItemCollapsibleState.None,
    );

    if (allTasks.length === 0) {
      void vscode.window.showInformationMessage('No tasks found. Refresh the task list first.');
      return undefined;
    }

    const items = allTasks.map((t) => ({
      label: (t.originalLabel || t.label) as string,
      description: t.taskType,
      detail: t.taskFileUri?.fsPath,
      task: t,
    }));

    items.sort((a, b) => a.label.localeCompare(b.label));

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Inspect Task Environment',
      placeHolder: 'Select a task to inspect its environment variables',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    return selected?.task;
  }
}
