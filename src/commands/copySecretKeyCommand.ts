import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';

/**
 * Command: `workspaceTasks.env.copySecretKey`
 *
 * Copies a SecretStorage key name (not the secret value) to the clipboard.
 * Can be invoked from:
 *   - The tree view (inline action bar, right-click menu, or double-click on a secret item)
 *   - The Command Palette (shows a QuickPick of all stored keys)
 */
export class CopySecretKeyCommand extends BaseCommand {
  private readonly clipboardImpl: Pick<vscode.Clipboard, 'writeText'>;

  constructor(context: vscode.ExtensionContext, clipboard?: Pick<vscode.Clipboard, 'writeText'>) {
    super('env.copySecretKey', context);
    this.clipboardImpl = clipboard ?? vscode.env.clipboard;
  }

  async run(secretKeyOrItem?: string | TaskItem | unknown): Promise<void> {
    let key: string | undefined;

    if (typeof secretKeyOrItem === 'string') {
      key = secretKeyOrItem.trim() || undefined;
    } else if (secretKeyOrItem instanceof TaskItem) {
      key = (typeof secretKeyOrItem.label === 'string' ? secretKeyOrItem.label : secretKeyOrItem.originalLabel)?.trim() || undefined;
    }

    if (!key) {
      // Invoked from Command Palette — show a QuickPick
      const keys = await this.context.secrets.keys();
      if (keys.length === 0) {
        void vscode.window.showInformationMessage('No secrets are currently stored by Workspace Tasks.');
        return;
      }
      key = await vscode.window.showQuickPick(keys.slice().sort(), {
        title: 'Copy Secret Key — Select Key',
        placeHolder: 'Select a key name to copy to clipboard',
        ignoreFocusOut: true,
      });
    }

    if (!key) {
      return;
    }

    await this.clipboardImpl.writeText(key);
    void vscode.window.showInformationMessage(`Secret key "${key}" copied to clipboard.`);
  }
}
