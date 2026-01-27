import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';

export class OpenFileAtLineCommand extends BaseCommand {

  constructor(context: vscode.ExtensionContext) {
    super('openFileAtLine', context);
  }

  async run(uri: vscode.Uri, line: number): Promise<void> {
    vscode.workspace.openTextDocument(uri).then(doc => {
      vscode.window.showTextDocument(doc).then(editor => {
        const position = new vscode.Position(line, 0);
        const range = new vscode.Range(position, position);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(position, position);
      });
    });
  }
}
