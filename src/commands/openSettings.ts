import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';

export class OpenSettingsCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('openSettings', context);

  }

  async run(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:darthminos.workspace-tasks');
  }
}
