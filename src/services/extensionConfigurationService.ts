import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LoggerService } from './loggerService';

export class ExtensionConfigurationService {
  private static instance: ExtensionConfigurationService;
  private packageJson: any;
  private logger = LoggerService.getInstance();

  private constructor() {}

  public static getInstance(): ExtensionConfigurationService {
    if (!ExtensionConfigurationService.instance) {
      ExtensionConfigurationService.instance = new ExtensionConfigurationService();
    }
    return ExtensionConfigurationService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    const packageJsonPath = path.join(context.extensionPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf8');
        this.packageJson = JSON.parse(content);
      } catch (e) {
        this.logger.error('[ExtensionConfigurationService] Failed to load package.json', e);
      }
    }
  }

  public get(key: string): any {
    if (!this.packageJson) {
      return undefined;
    }
    return key.split('.').reduce((o, i) => o?.[i], this.packageJson);
  }
}
