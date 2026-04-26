import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskIconService } from '../services/taskIconService';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskConfigService } from '../services/taskConfigService';

interface JupyterCell {
  cell_type: string;
  source: string[];
  execution_count?: number | null;
}

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: any;
  nbformat: number;
  nbformat_minor: number;
}

export class JupyterTerm implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  constructor(
    private resourceUri: vscode.Uri,
    private cellIndex: number | undefined,
    private label: string,
  ) {}

  open(): void {
    this.doRun();
  }

  close(): void {}

  private async doRun(): Promise<void> {
    this.writeEmitter.fire(`Executing Jupyter Cell in ${this.label}...\r\n`);

    try {
      if (this.cellIndex !== undefined && this.cellIndex >= 0) {
        const doc = await vscode.workspace.openNotebookDocument(this.resourceUri);
        await vscode.window.showNotebookDocument(doc);

        if (this.cellIndex < doc.cellCount) {
          try {
            const execution = vscode.commands.executeCommand('notebook.cell.execute', {
              ranges: [{ start: this.cellIndex, end: this.cellIndex + 1 }],
              document: doc.uri,
            });
            await execution;
            this.writeEmitter.fire(`\r\nCell sent to execution.\r\n`);
          } catch (e) {
            this.writeEmitter.fire(`Error executing cell: ${e}\r\n`);
            this.closeEmitter.fire(1);
            return;
          }
        } else {
          this.writeEmitter.fire(`Cell index ${this.cellIndex} out of bounds.\r\n`);
          this.closeEmitter.fire(1);
          return;
        }
      } else {
        this.writeEmitter.fire(`No cell index provided. Cannot execute.\r\n`);
        this.closeEmitter.fire(1);
        return;
      }

      this.closeEmitter.fire(0);
    } catch (e) {
      this.writeEmitter.fire(`Error: ${e}\r\n`);
      this.closeEmitter.fire(1);
    }
  }
}

export class JupyterTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('jupyter', constants.GLOB_JUPYTER);
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!TaskConfigService.getInstance().isTaskTypeEnabled(this.type)) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_JUPYTER]);

    for (const file of files) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(content).toString('utf8');

        const fileTasks = this.parseNotebookFile(file, text);
        if (fileTasks) {
          tasks.push(fileTasks);
        }
      } catch (e) {
        this.logger.warn(`[JupyterTaskProvider] Error reading ${file.fsPath}:`, e);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  private parseNotebookFile(uri: vscode.Uri, text: string): TaskItem | undefined {
    let notebook: JupyterNotebook;
    try {
      notebook = JSON.parse(text) as JupyterNotebook;
    } catch (e) {
      return undefined;
    }

    const filename = path.basename(uri.fsPath);
    const iconService = TaskIconService.getInstance();
    const iconPath = iconService.getTaskIcon(this.type);

    const notebookItem = new TaskItem(
      filename,
      vscode.TreeItemCollapsibleState.Collapsed,
      this.type,
      uri,
      {
        command: 'vscode.open',
        title: 'Open Notebook',
        arguments: [uri],
      },
      iconPath,
    );

    notebookItem.children = [];

    // Metadata for the notebook
    notebookItem.metadata = { type: 'notebook' };

    if (notebook.cells && Array.isArray(notebook.cells)) {
      for (let index = 0; index < notebook.cells.length; index++) {
        const cell = notebook.cells[index];

        if (cell.cell_type !== 'code') {
          continue;
        }

        const sourceLines = Array.isArray(cell.source)
          ? cell.source
          : typeof cell.source === 'string'
            ? [cell.source]
            : [];

        const sourceText = sourceLines.join('').trim();
        const label = `Cell ${index + 1}`;

        const item = new TaskItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          this.type,
          uri,
          {
            command: 'vscode.open',
            title: 'Open Notebook',
            arguments: [uri],
          },
          new vscode.ThemeIcon('code'),
        );
        item.id = `${this.type}:${uri.toString()}:${index}`;
        item.startLine = 0;

        item.parent = notebookItem;
        item.metadata = {
          type: 'cell',
          cellIndex: index,
          source: sourceText,
        };

        notebookItem.children.push(item);
      }
    }

    return notebookItem;
  }
}
