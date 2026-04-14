import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskEnvService } from '../services/taskEnvService';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';

/**
 * Command: `workspaceTasks.env.storeSecret`
 *
 * Prompts the user for a storage key name and a secret value, then persists the
 * value in VS Code SecretStorage (encrypted, per-machine, not synced).
 * Fires `TaskEnvService.onDidChangeEnvSources` so any resolved env maps are
 * invalidated.
 */
export class StoreSecretCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('env.storeSecret', context);
  }

  async run(_arg?: unknown): Promise<void> {
    const key = await vscode.window.showInputBox({
      title: 'Store Secret — Key Name',
      prompt: 'Enter the SecretStorage key (e.g. myapp.deploy-token)',
      placeHolder: 'myapp.deploy-token',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length === 0 ? 'Key name cannot be empty.' : undefined),
    });

    if (!key || key.trim().length === 0) {
      return;
    }

    const value = await vscode.window.showInputBox({
      title: 'Store Secret — Value',
      prompt: `Enter the secret value for "${key.trim()}"`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.length === 0 ? 'Secret value cannot be empty.' : undefined),
    });

    if (value === undefined) {
      // User cancelled
      return;
    }

    await this.context.secrets.store(key.trim(), value);
    TaskEnvService.getInstance().fireEnvSourcesChanged();
    TaskTreeDataProvider.tryRefreshLocal();

    void vscode.window.showInformationMessage(`Secret "${key.trim()}" stored successfully.`);
  }
}
