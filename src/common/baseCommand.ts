'use strict';

import * as vscode from 'vscode';
import constants from '../libs/constants';

export default abstract class BaseCommand {

  constructor(
    public readonly commandName: string,
    public readonly context: vscode.ExtensionContext
  ) {
    // remove 'Command' suffix from class name to get command name
    // let commandName = this.constructor.name.replace(/Command$/, '');
    const fullCommandName = `${constants.configurationSection}.${commandName}`;
    let disposable = vscode.commands.registerCommand(fullCommandName, this.run, this);
    context.subscriptions.push(disposable);
  }

  abstract run(...args: any[]): void;
}
