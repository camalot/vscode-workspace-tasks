import * as vscode from 'vscode';
import { PackageJsonTaskProvider } from './packageJsonTaskProvider';
import * as yaml from 'yaml';

export abstract class PackageYamlTaskProvider extends PackageJsonTaskProvider {
  protected async parseContent(content: string, uri?: vscode.Uri): Promise<any> {
    if (uri && (uri.fsPath.endsWith('.yaml') || uri.fsPath.endsWith('.yml'))) {
      try {
        return yaml.parse(content);
      } catch (e) {
        this.logger.error(`[PackageYamlTaskProvider] Error parsing yaml: ${uri.fsPath}`, e);
        return {};
      }
    }
    return super.parseContent(content, uri);
  }
}
