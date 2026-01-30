import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { ExtensionConfigurationService } from '../services/extensionConfigurationService';

export class GithubIssuesCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('githubIssues', context);
  }

  async run(): Promise<void> {
    const url = ExtensionConfigurationService.getInstance().get('bugs.new');
    if (url) {
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}
