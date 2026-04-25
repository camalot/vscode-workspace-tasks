import * as vscode from 'vscode';
import { GetTasksTool } from './getTasksTool';
import { RunTaskTool } from './runTaskTool';

/**
 * Registers all workspace-tasks language model tools and adds their disposables
 * to the extension context's subscriptions for automatic cleanup on deactivation.
 */
export function registerLmTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('workspaceTasks_getTasks', new GetTasksTool()),
    vscode.lm.registerTool('workspaceTasks_runTask', new RunTaskTool()),
  );
}
