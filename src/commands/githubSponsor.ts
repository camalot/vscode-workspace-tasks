import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { ExtensionConfigurationService } from '../services/extensionConfigurationService';

export class GithubSponsorCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('githubSponsor', context);
  }

  async run(): Promise<void> {
    const url = ExtensionConfigurationService.getInstance().get('sponsor.github');
    if (url) {
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}
