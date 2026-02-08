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
import * as openSettings from './openSettings';
import * as restartTask from './restartTask';
import * as stopTask from './stopTask';
import * as addToFavorites from './addToFavorites';
import * as addToQueue from './addToQueue';
import * as removeFromQueue from './removeFromQueue';
import * as clearQueue from './clearQueue';
import * as runQueue from './runQueue';
import * as renameQueue from './renameQueue';
import * as removeFromFavorites from './removeFromFavorites';
import * as onTreeItemClick from './onTreeItemClick';
import * as hideTask from './hideTask';
import * as unhideTask from './unhideTask';
import * as hideGroup from './hideGroup';
import * as unhideGroup from './unhideGroup';
import * as showHiddenTasks from './showHiddenTasks';
import * as hideHiddenTasks from './hideHiddenTasks';
import * as toggleShowHidden from './toggleShowHidden';
import * as resetFilteredTasks from './resetFilteredTasks';
import * as copyTaskCommand from './copyTaskCommand';

import { LoggerService } from '../services/loggerService';


export function loadCommands(context: vscode.ExtensionContext) {
  const logger = LoggerService.getInstance();
  const modules = [
    addToFavorites,
    addToQueue,
    buyMeACoffee,
    clearQueue,
    clearRecentTasks,
    resetFilteredTasks,
    collapseAll,
    copyTaskCommand,
    githubIssues,
    githubSponsor,
    hideTask,
    hideGroup,
    hideHiddenTasks,
    onTreeItemClick,
    openFileAtLine,
    openSettings,
    runTask,
    refresh,
    refreshTree,
    restartTask,
    removeFromFavorites,
    removeFromRecentTasks,
    renameQueue,
    removeFromQueue,
    runQueue,
    runTaskWithArgs,
    showHiddenTasks,
    stopTask,
    toggleShowHidden,
    unhideTask,
    unhideGroup,
  ];

  for (const mod of modules) {
    for (const key of Object.keys(mod)) {
      if (key.endsWith('Command')) {
        const CommandClass = (mod as any)[key];
        if (typeof CommandClass === 'function') {
          try {
            // instantiate; constructor will register the command via BaseCommand
            new CommandClass(context);
          } catch (err) {
            logger.error(`[Commands] Failed to load command ${key}:`, err);
          }
        }
      }
    }
  }
}
