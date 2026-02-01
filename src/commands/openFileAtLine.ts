import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';

export class OpenFileAtLineCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('openFileAtLine', context);
  }

  async run(uriOrItem: vscode.Uri | TaskItem, line?: number): Promise<void> {
    let uri: vscode.Uri | undefined;
    let lineToOpen: number = 0;

    if (uriOrItem instanceof TaskItem) {
      uri = uriOrItem.taskFileUri || uriOrItem.resourceUri;
      lineToOpen = uriOrItem.startLine || 0;
    } else if (uriOrItem instanceof vscode.Uri) {
      uri = uriOrItem;
      lineToOpen = line || 0;
    }

    if (uri && uri.scheme !== 'workspace-tasks') {
      vscode.workspace.openTextDocument(uri).then((doc) => {
        vscode.window.showTextDocument(doc).then((editor) => {
          const position = new vscode.Position(lineToOpen, 0);
          const range = new vscode.Range(position, position);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(position, position);
        });
      });
    }
  }
}
