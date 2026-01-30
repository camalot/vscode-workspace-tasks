import { ConfigurationChangeEvent, EventEmitter, workspace, WorkspaceConfiguration, ConfigurationTarget } from 'vscode';

const extensionName = 'workspaceTasks';

class Configuration {
  private configuration: WorkspaceConfiguration;
  private configurationWs: WorkspaceConfiguration;
  private onDidChange = new EventEmitter<ConfigurationChangeEvent>();

  constructor() {
    this.configuration = workspace.getConfiguration(extensionName);
    this.configurationWs = workspace.getConfiguration();
    workspace.onDidChangeConfiguration(this.onConfigurationChanged, this);
  }

  private onConfigurationChanged(event: ConfigurationChangeEvent) {
    if (event.affectsConfiguration(extensionName)) {
      this.configuration = workspace.getConfiguration(extensionName);
      this.onDidChange.fire(event);
    }
  }

  public get<T>(key: string, defaultValue?: T): T {
    return this.configuration.get<T>(key, defaultValue!);
  }

  public getVs<T>(key: string, defaultValue?: T): T {
    return this.configurationWs.get<T>(key, defaultValue!);
  }

  public updateVs(key: string, value: any): Thenable<void> {
    return this.configurationWs.update(key, value, ConfigurationTarget.Global);
  }

  public updateVsWs(key: string, value: any): Thenable<void> {
    return this.configurationWs.update(key, value, ConfigurationTarget.Workspace);
  }

  public update(key: string, value: any): Thenable<void> {
    if (key.includes('.')) {
      const keys = key.split('.');
      const parentKey = keys[0];
      const v = this.get<any>(parentKey);
      if (v && typeof v === 'object') {
        v[keys[1]] = value;
        return this.configuration.update(parentKey, v, ConfigurationTarget.Global);
      }
    }
    return this.configuration.update(key, value, ConfigurationTarget.Global);
  }

  public updateWs(key: string, value: any): Thenable<void> {
    if (key.includes('.')) {
      const keys = key.split('.');
      const parentKey = keys[0];
      const v = this.get<any>(parentKey);
      if (v && typeof v === 'object') {
        v[keys[1]] = value;
        return this.configuration.update(parentKey, v, ConfigurationTarget.Workspace);
      }
    }
    return this.configuration.update(key, value, ConfigurationTarget.Workspace);
  }
}

export const configuration = new Configuration();
