import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskEnvService } from '../services/taskEnvService';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';

/**
 * Command: `workspaceTasks.env.updateSecret`
 *
 * Prompts the user for a new secret value for the given key (which comes from the tree
 * item when invoked via context menu, or from a QuickPick when invoked from the palette).
 * Implements update-by-replace: deletes the old value and stores the new one under the
 * same key, then fires `TaskEnvService.onDidChangeEnvSources`.
 */
export class UpdateSecretCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('env.updateSecret', context);
  }

  async run(secretName?: string | TaskItem | unknown): Promise<void> {
    let key: string | undefined;
    if (secretName instanceof TaskItem) {
      key = (typeof secretName.label === 'string' ? secretName.label : secretName.originalLabel)?.trim() || undefined;
    } else if (typeof secretName === 'string') {
      key = secretName.trim() || undefined;
    }

    if (!key) {
      // Invoked from command palette — let the user pick a key
      const keys = await this.context.secrets.keys();
      if (keys.length === 0) {
        void vscode.window.showInformationMessage('No secrets are currently stored by Workspace Tasks.');
        return;
      }

      key = await vscode.window.showQuickPick(
        keys.slice().sort(),
        {
          title: 'Update Secret — Select Key',
          placeHolder: 'Select the secret key to update',
          ignoreFocusOut: true,
        },
      );

      if (!key) {
        return;
      }
    }

    const newValue = await vscode.window.showInputBox({
      title: `Update Secret — "${key}"`,
      prompt: `Enter the new secret value for "${key}"`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.length === 0 ? 'Secret value cannot be empty.' : undefined),
    });

    if (newValue === undefined) {
      // User cancelled
      return;
    }

    // Delete then re-store to ensure a clean update
    await this.context.secrets.delete(key);
    await this.context.secrets.store(key, newValue);
    TaskEnvService.getInstance().fireEnvSourcesChanged();
    TaskTreeDataProvider.tryRefreshLocal();

    void vscode.window.showInformationMessage(`Secret "${key}" updated successfully.`);
  }
}
