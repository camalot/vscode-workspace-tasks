import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService } from '../services/executableService';
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

export class JupyterTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('jupyter', constants.GLOB_JUPYTER);
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!TaskConfigService.getInstance().isTaskTypeEnabled(this.type)) {
      return [];
    }

    // Check if extension (ms-toolsai.jupyter) is installed
    const extensionId = 'ms-toolsai.jupyter';
    const command = await ExecutableService.getInstance().getVscodeCommand('jupyter.runcell', extensionId);

    if (!command) {
        return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_JUPYTER]);

    for (const file of files) {
      const content = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(content).toString('utf8');

      const fileTasks = this.parseNotebookFile(file, text);
      if (fileTasks) {
        tasks.push(fileTasks);
      }
    }
    return tasks;
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
    const typeIcon = iconService.getTaskTypeIcon(this.type, uri);

    const notebookItem = new TaskItem(
      filename,
      vscode.TreeItemCollapsibleState.Collapsed,
      this.type,
      uri,
      {
        command: 'vscode.open',
        title: 'Open Notebook',
        arguments: [uri]
      },
      typeIcon?.TaskIcon
    );

    notebookItem.children = [];

    // Metadata for the notebook
    notebookItem.metadata = { type: 'notebook' };

    if (notebook.cells && Array.isArray(notebook.cells)) {
      notebook.cells.forEach((cell, index) => {
        if (cell.cell_type === 'code') {
          const sourceLines = Array.isArray(cell.source)
            ? cell.source
            : (typeof cell.source === 'string' ? [cell.source] : []);

          const sourceText = sourceLines.join('').trim();
          // Even empty cells are cells. But maybe skip empty ones?
          const label = `Cell ${index + 1}`;

          const item = new TaskItem(
            label,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            uri,
            {
                command: 'vscode.open',
                title: 'Open Notebook',
                arguments: [uri]
            },
            new vscode.ThemeIcon('code')
          );
          item.id = `${this.type}:${uri.toString()}:${index}`;


          item.parent = notebookItem;
          item.metadata = {
            type: 'cell',
            cellIndex: index,
            source: sourceText
          };

          notebookItem.children.push(item);
        }
      });
    }

    return notebookItem;
  }
}
