import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { TaskfileTaskProvider } from '../providers/taskfileTaskProvider';

export class WatchTaskfileCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('taskfile.watchTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    if (!item || item.taskType !== 'taskfile') {
      return;
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const enabled = config.get<boolean>('taskfile.enableWatchMode', true);
    if (!enabled) {
      return;
    }

    const taskName = (item.originalLabel ?? item.label) as string;
    const provider = new TaskfileTaskProvider();
    const { command, args } = provider.getCommand(item.taskFileUri);

    const terminalArgs = [...(args ?? []), '--watch', taskName];
    const cwd = item.taskFileUri ? path.dirname(item.taskFileUri.fsPath) : undefined;

    const terminal = vscode.window.createTerminal({
      name: `task watch: ${taskName}`,
      cwd,
    });
    terminal.show();
    terminal.sendText([command, ...terminalArgs].join(' '));
  }
}
