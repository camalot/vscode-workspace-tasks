import * as vscode from 'vscode';
import * as runTask from './runTask';
import * as runTaskWithArgs from './runTaskWithArgs';
import * as refresh from './refresh';
import * as refreshTree from './refreshTree';
import * as collapseAll from './collapseAll';
import * as buyMeACoffee from './buyMeACoffee';
import * as githubSponsor from './githubSponsor';
import * as githubIssues from './githubIssues';
import * as clearRecentTasks from './clearRecentTasks';
import * as removeFromRecentTasks from './removeFromRecentTasks';
import * as openFileAtLine from './openFileAtLine';

export function loadCommands(context: vscode.ExtensionContext) {
  const modules = [
    buyMeACoffee,
    clearRecentTasks,
    collapseAll,
    githubIssues,
    githubSponsor,
    openFileAtLine,
    runTask,
    refresh,
    refreshTree,
    removeFromRecentTasks,
    runTaskWithArgs
  ];

  for (const mod of modules) {
    for (const key of Object.keys(mod)) {
      if (key.endsWith('Command')) {
        const CommandClass = (mod as any)[key];
        if (typeof CommandClass === 'function') {
          try {
            // instantiate; constructor will register the command via BaseCommand
            new CommandClass(context);
            console.log(`Loading command: ${key}`);
          } catch (err) {
            console.error(`Failed to load command ${key}:`, err);
          }
        }
      }
    }
  }
}
