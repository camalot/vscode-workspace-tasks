import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { ExtensionConfigurationService } from '../services/extensionConfigurationService';

export class BuyMeACoffeeCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('buyMeACoffee', context);
  }

  async run(): Promise<void> {
    const url = ExtensionConfigurationService.getInstance().get<string>('sponsor.buymeacoffee');
    if (url) {
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}
