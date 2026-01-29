import * as vscode from 'vscode';
import { NpmTaskProvider, PnpmTaskProvider, YarnTaskProvider } from './npmTaskProvider';
import { ComposerTaskProvider } from './composerTaskProvider';
import { ShellTaskProvider } from './shellTaskProvider';
import { VscodeTaskProvider } from './vscodeTaskProvider';
import { VenvTaskProvider } from './venvTaskProvider';
import { MiseTaskProvider } from './miseTaskProvider';
import { MakefileTaskProvider } from './makefileTaskProvider';
import { JustfileTaskProvider } from './justfileTaskProvider';
import { WorkspaceTasksProvider } from './workspaceTasksProvider';
import { AntTaskProvider } from './antTaskProvider';
import { MsBuildTaskProvider } from './msbuildTaskProvider';
import { GithubActionsTaskProvider } from './githubActionsTaskProvider';
import { GruntTaskProvider } from './gruntTaskProvider';
import { GulpTaskProvider } from './gulpTaskProvider';
import { GradleTaskProvider } from './gradleTaskProvider';
import { PipenvTaskProvider } from './pipenvTaskProvider';
import { MavenTaskProvider } from './mavenTaskProvider';
import { JupyterTaskProvider } from './jupyterTaskProvider';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';


type TaskProviderConstructor =
  | (new () => NpmTaskProvider)
  | (new () => PnpmTaskProvider)
  | (new () => YarnTaskProvider)
  | (new () => ComposerTaskProvider)
  | (new () => ShellTaskProvider)
  | (new () => VscodeTaskProvider)
  | (new () => VenvTaskProvider)
  | (new () => MakefileTaskProvider)
  | (new () => MiseTaskProvider)
  | (new () => WorkspaceTasksProvider)
  | (new () => JustfileTaskProvider)
  | (new () => AntTaskProvider)
  | (new () => GulpTaskProvider)
  | (new () => GruntTaskProvider)
  | (new () => MsBuildTaskProvider)
  | (new () => MavenTaskProvider)
  | (new () => GithubActionsTaskProvider)
  | (new () => GradleTaskProvider)
  | (new () => PipenvTaskProvider)
  | (new () => JupyterTaskProvider);

export function registerTaskProviders(context: vscode.ExtensionContext) {
  const providers: TaskProviderConstructor[] = [
    NpmTaskProvider,
    PnpmTaskProvider,
    YarnTaskProvider,
    ComposerTaskProvider,
    ShellTaskProvider,
    VscodeTaskProvider,
    VenvTaskProvider,
    MakefileTaskProvider,
    MiseTaskProvider,
    WorkspaceTasksProvider,
    JustfileTaskProvider,
    AntTaskProvider,
    GulpTaskProvider,
    GruntTaskProvider,
    MsBuildTaskProvider,
    MavenTaskProvider,
    GithubActionsTaskProvider,
    GradleTaskProvider,
    PipenvTaskProvider,
    JupyterTaskProvider
  ];
  const taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  for (const ProviderClass of providers) {
    try {
      const providerInstance = new ProviderClass();
      // Assuming there's a global taskTreeDataProvider instance
      if (taskTreeDataProvider) {
        taskTreeDataProvider.registerProvider(providerInstance);
        // console.log(`Registered task provider: ${ProviderClass.name}`);
      } else {
        console.error('taskTreeDataProvider instance not found.');
      }
    } catch (err) {
      console.error(`Failed to register task provider ${ProviderClass.name}:`, err);
    }
  }
}
