import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskEnvService } from '../services/taskEnvService';

/**
 * Command: `workspaceTasks.env.deleteSecret`
 *
 * Shows a QuickPick of all secret keys currently stored by this extension.
 * On selection, asks the user to confirm, then deletes the key from
 * VS Code SecretStorage and fires `TaskEnvService.onDidChangeEnvSources`.
 */
export class DeleteSecretCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('env.deleteSecret', context);
  }

  async run(): Promise<void> {
    const keys = await this.context.secrets.keys();

    if (keys.length === 0) {
      void vscode.window.showInformationMessage('No secrets are currently stored by Workspace Tasks.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      keys.slice().sort(),
      {
        title: 'Delete Secret',
        placeHolder: 'Select a secret key to delete',
        ignoreFocusOut: true,
      },
    );

    if (!selected) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete secret "${selected}"? This cannot be undone.`,
      { modal: true },
      'Delete',
    );

    if (confirmation !== 'Delete') {
      return;
    }

    await this.context.secrets.delete(selected);
    TaskEnvService.getInstance().fireEnvSourcesChanged();

    void vscode.window.showInformationMessage(`Secret "${selected}" deleted.`);
  }
}
