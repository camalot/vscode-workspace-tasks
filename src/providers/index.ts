import * as vscode from 'vscode';
import { BunTaskProvider, NpmTaskProvider, PnpmTaskProvider, YarnTaskProvider } from './npmTaskProvider';
import { ComposerTaskProvider } from './composerTaskProvider';
import { DenoTaskProvider } from './denoTaskProvider';
import { ShellTaskProvider } from './shellTaskProvider';
import { VscodeTaskProvider } from './vscodeTaskProvider';
import { VenvTaskProvider } from './venvTaskProvider';
import { MiseTaskProvider } from './miseTaskProvider';
import { MakefileTaskProvider } from './makefileTaskProvider';
import { CargoMakeTaskProvider } from './cargoMakeTaskProvider';
import { JustfileTaskProvider } from './justfileTaskProvider';
import { WorkspaceTasksProvider } from './workspaceTasksProvider';
import { AntTaskProvider } from './antTaskProvider';
import { MsBuildTaskProvider } from './msbuildTaskProvider';
import { GithubActionsTaskProvider } from './githubActionsTaskProvider';
import { GruntTaskProvider } from './gruntTaskProvider';
import { GulpTaskProvider } from './gulpTaskProvider';
import { GradleTaskProvider } from './gradleTaskProvider';
import { PipenvTaskProvider } from './pipenvTaskProvider';
import { PoeTaskProvider } from './poeTaskProvider';
import { PoetryTaskProvider } from './poetryTaskProvider';
import { RakeTaskProvider } from './rakeTaskProvider';
import { MavenTaskProvider } from './mavenTaskProvider';
import { JupyterTaskProvider } from './jupyterTaskProvider';
import { CMakeTaskProvider } from './cmakeTaskProvider';
import { CakeTaskProvider } from './cakeTaskProvider';
import { TaskfileTaskProvider } from './taskfileTaskProvider';
import { GitlabCiTaskProvider } from './gitlabCiTaskProvider';
import { CircleCiTaskProvider } from './circleCiTaskProvider';
import { BitbucketPipelinesTaskProvider } from './bitbucketPipelinesTaskProvider';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { LoggerService } from '../services/loggerService';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskCacheService } from '../services/taskCacheService';

type TaskProviderConstructor =
  | (new () => BunTaskProvider)
  | (new () => NpmTaskProvider)
  | (new () => PnpmTaskProvider)
  | (new () => YarnTaskProvider)
  | (new () => ComposerTaskProvider)
  | (new () => DenoTaskProvider)
  | (new () => ShellTaskProvider)
  | (new () => VscodeTaskProvider)
  | (new () => VenvTaskProvider)
  | (new () => MakefileTaskProvider)
  | (new () => CargoMakeTaskProvider)
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
  | (new () => PoeTaskProvider)
  | (new () => PoetryTaskProvider)
  | (new () => RakeTaskProvider)
  | (new () => JupyterTaskProvider)
  | (new () => CMakeTaskProvider)
  | (new () => CakeTaskProvider)
  | (new () => TaskfileTaskProvider)
  | (new () => GitlabCiTaskProvider)
  | (new () => CircleCiTaskProvider)
  | (new () => BitbucketPipelinesTaskProvider);

export function registerTaskProviders(context: vscode.ExtensionContext) {
  const logger = LoggerService.getInstance();
  const providers: TaskProviderConstructor[] = [
    BunTaskProvider,
    NpmTaskProvider,
    PnpmTaskProvider,
    YarnTaskProvider,
    ComposerTaskProvider,
    DenoTaskProvider,
    ShellTaskProvider,
    VscodeTaskProvider,
    VenvTaskProvider,
    MakefileTaskProvider,
    CargoMakeTaskProvider,
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
    PoeTaskProvider,
    PoetryTaskProvider,
    PipenvTaskProvider,
    RakeTaskProvider,
    JupyterTaskProvider,
    CMakeTaskProvider,
    CakeTaskProvider,
    TaskfileTaskProvider,
    GitlabCiTaskProvider,
    CircleCiTaskProvider,
    BitbucketPipelinesTaskProvider,
  ];
  const taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  const filesService = TaskFilesService.getInstance();
  for (const ProviderClass of providers) {
    try {
      const providerInstance = new ProviderClass();
      filesService.registerPatterns(providerInstance.getFilePatterns());
      // Assuming there's a global taskTreeDataProvider instance
      if (taskTreeDataProvider) {
        taskTreeDataProvider.registerProvider(providerInstance);
      } else {
        logger.error('[Providers] taskTreeDataProvider instance not found.');
      }

      // Subscribe to the extensionless-scan completion event emitted by ShellTaskProvider.
      // When a background scan finishes with a changed result set, refresh the shell
      // provider's cache and let TaskCacheService's onDidUpdate propagate to the tree.
      if (providerInstance instanceof ShellTaskProvider) {
        context.subscriptions.push(
          providerInstance.onDidChangeExtensionlessTasks(async () => {
            await TaskCacheService.getInstance().refreshProvider('shell');
          }),
        );
      }
    } catch (err) {
      logger.error(`[Providers] Failed to register task provider ${ProviderClass.name}:`, err);
    }
  }
}
