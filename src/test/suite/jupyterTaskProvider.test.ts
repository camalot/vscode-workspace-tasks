import * as assert from 'assert';
import * as vscode from 'vscode';
import { JupyterTaskProvider, JupyterTerm } from '../../providers/jupyterTaskProvider';
import { TaskConfigService } from '../../services/taskConfigService';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';

suite('JupyterTaskProvider Test Suite', () => {
  let provider: JupyterTaskProvider;
  let originalFsDescriptor: PropertyDescriptor | undefined;
  let originalFindFiles: any;
  let originalIsTaskTypeEnabled: any;
  let originalGetTaskIcon: any;

  const validNotebook = JSON.stringify({
    cells: [
      { cell_type: 'code', source: ['print("Hello")'] },
      { cell_type: 'markdown', source: ['# Title'] },
      { cell_type: 'code', source: ['import os\n', 'print(os.getcwd())'] },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });

  setup(() => {
    provider = new JupyterTaskProvider();

    const filesService = TaskFilesService.getInstance();
    const configService = TaskConfigService.getInstance();
    const iconService = TaskIconService.getInstance();

    originalFindFiles = filesService.findFiles.bind(filesService);
    originalIsTaskTypeEnabled = configService.isTaskTypeEnabled.bind(configService);
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    originalFsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'fs');

    filesService.findFiles = async () => [];
    configService.isTaskTypeEnabled = () => true;
    iconService.getTaskIcon = () => new vscode.ThemeIcon('notebook');

    Object.defineProperty(vscode.workspace, 'fs', {
      value: {
        ...vscode.workspace.fs,
        readFile: async () => new Uint8Array(Buffer.from(validNotebook)),
      },
      configurable: true,
      writable: true,
    });
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    const configService = TaskConfigService.getInstance();
    const iconService = TaskIconService.getInstance();

    filesService.findFiles = originalFindFiles;
    configService.isTaskTypeEnabled = originalIsTaskTypeEnabled;
    iconService.getTaskIcon = originalGetTaskIcon;

    if (originalFsDescriptor) {
      Object.defineProperty(vscode.workspace, 'fs', originalFsDescriptor);
    }
  });

  test('getTasks returns empty when task type is disabled', async () => {
    TaskConfigService.getInstance().isTaskTypeEnabled = () => false;

    const tasks = await provider.getTasks();

    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks discovers notebooks even when jupyter command availability is unknown', async () => {
    const notebookUri = vscode.Uri.file('/workspace/command-unknown.ipynb');
    TaskFilesService.getInstance().findFiles = async () => [notebookUri];

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'command-unknown.ipynb');
    assert.strictEqual(tasks[0].children.length, 2);
  });

  test('getTasks parses notebooks into notebook and cell items', async () => {
    const notebookUri = vscode.Uri.file('/workspace/demo.ipynb');
    TaskFilesService.getInstance().findFiles = async () => [notebookUri];

    const tasks = await provider.getTasks();

    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'demo.ipynb');
    assert.strictEqual(tasks[0].taskType, 'jupyter');
    assert.strictEqual(tasks[0].taskFileUri?.fsPath, notebookUri.fsPath);
    assert.strictEqual(tasks[0].metadata?.type, 'notebook');
    assert.strictEqual(tasks[0].children.length, 2);
    assert.strictEqual(tasks[0].children[0].label, 'Cell 1');
    assert.strictEqual(tasks[0].children[1].label, 'Cell 3');
    assert.strictEqual(tasks[0].children[0].metadata?.source, 'print("Hello")');
    assert.strictEqual(tasks[0].children[1].metadata?.source, 'import os\nprint(os.getcwd())');
    assert.strictEqual(tasks[0].children[0].startLine, 0);
    assert.strictEqual(tasks[0].children[1].startLine, 0);
  });

  test('getTasks skips notebooks with invalid JSON', async () => {
    const notebookUri = vscode.Uri.file('/workspace/bad.ipynb');
    TaskFilesService.getInstance().findFiles = async () => [notebookUri];
    Object.defineProperty(vscode.workspace, 'fs', {
      value: {
        ...vscode.workspace.fs,
        readFile: async () => new Uint8Array(Buffer.from('{bad json')),
      },
      configurable: true,
      writable: true,
    });

    const tasks = await provider.getTasks();

    assert.deepStrictEqual(tasks, []);
  });

  test('parseNotebookFile handles string source and non-code cells', () => {
    const notebookUri = vscode.Uri.file('/workspace/string-source.ipynb');
    const result = (provider as any).parseNotebookFile(
      notebookUri,
      JSON.stringify({
        cells: [
          { cell_type: 'raw', source: ['ignored'] },
          { cell_type: 'code', source: 'print("from string")' },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );

    assert.ok(result);
    assert.strictEqual(result.label, 'string-source.ipynb');
    assert.strictEqual(result.taskType, 'jupyter');
    assert.strictEqual(result.children.length, 1);
    assert.strictEqual(result.children[0].metadata?.cellIndex, 1);
    assert.strictEqual(result.children[0].metadata?.source, 'print("from string")');
    assert.strictEqual(result.children[0].id, `jupyter:${notebookUri.toString()}:1`);
    assert.strictEqual(result.children[0].parent, result);
  });

  test('parseNotebookFile returns undefined for invalid JSON', () => {
    const result = (provider as any).parseNotebookFile(vscode.Uri.file('/workspace/invalid.ipynb'), '{ invalid');

    assert.strictEqual(result, undefined);
  });

  test('getSystemTasks returns empty regardless of enabled state', async () => {
    const enabledTasks = await provider.getSystemTasks();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const disabledTasks = await provider.getSystemTasks();

    assert.deepStrictEqual(enabledTasks, []);
    assert.deepStrictEqual(disabledTasks, []);
  });
});

suite('JupyterTerm Test Suite', () => {
  let originalOpenNotebookDocument: any;
  let originalShowNotebookDocument: any;
  let originalExecuteCommand: any;

  const runTerm = async (term: JupyterTerm): Promise<{ output: string; closeCode: number }> => {
    let output = '';

    return new Promise((resolve) => {
      term.onDidWrite((chunk) => {
        output += chunk;
      });
      term.onDidClose((closeCode) => {
        resolve({ output, closeCode });
      });
      term.open();
    });
  };

  setup(() => {
    originalOpenNotebookDocument = vscode.workspace.openNotebookDocument;
    originalShowNotebookDocument = vscode.window.showNotebookDocument;
    originalExecuteCommand = vscode.commands.executeCommand;

    (vscode.workspace as any).openNotebookDocument = async (uri: vscode.Uri) => ({
      uri,
      cellCount: 2,
    });
    (vscode.window as any).showNotebookDocument = async () => undefined;
    (vscode.commands as any).executeCommand = async () => undefined;
  });

  teardown(() => {
    (vscode.workspace as any).openNotebookDocument = originalOpenNotebookDocument;
    (vscode.window as any).showNotebookDocument = originalShowNotebookDocument;
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  });

  test('close is a no-op', () => {
    const term = new JupyterTerm(vscode.Uri.file('/workspace/demo.ipynb'), 0, 'Cell 1');
    term.close();
  });

  test('fails when no cell index is provided', async () => {
    const term = new JupyterTerm(vscode.Uri.file('/workspace/demo.ipynb'), undefined, 'Cell 1');

    const result = await runTerm(term);

    assert.ok(result.output.includes('Executing Jupyter Cell in Cell 1'));
    assert.ok(result.output.includes('No cell index provided. Cannot execute.'));
    assert.strictEqual(result.closeCode, 1);
  });

  test('fails when cell index is out of bounds', async () => {
    const term = new JupyterTerm(vscode.Uri.file('/workspace/demo.ipynb'), 5, 'Cell 6');

    const result = await runTerm(term);

    assert.ok(result.output.includes('Cell index 5 out of bounds.'));
    assert.strictEqual(result.closeCode, 1);
  });

  test('executes the selected notebook cell', async () => {
    let commandName = '';
    let commandArgs: any;
    (vscode.commands as any).executeCommand = async (name: string, args: any) => {
      commandName = name;
      commandArgs = args;
      return undefined;
    };
    const uri = vscode.Uri.file('/workspace/demo.ipynb');
    const term = new JupyterTerm(uri, 1, 'Cell 2');

    const result = await runTerm(term);

    assert.strictEqual(commandName, 'notebook.cell.execute');
    assert.deepStrictEqual(commandArgs, {
      ranges: [{ start: 1, end: 2 }],
      document: uri,
    });
    assert.ok(result.output.includes('Cell sent to execution.'));
    assert.strictEqual(result.closeCode, 0);
  });

  test('reports command execution errors', async () => {
    (vscode.commands as any).executeCommand = async () => {
      throw new Error('Execution failed');
    };
    const term = new JupyterTerm(vscode.Uri.file('/workspace/demo.ipynb'), 0, 'Cell 1');

    const result = await runTerm(term);

    assert.ok(result.output.includes('Error executing cell: Error: Execution failed'));
    assert.strictEqual(result.closeCode, 1);
  });

  test('reports notebook open errors', async () => {
    (vscode.workspace as any).openNotebookDocument = async () => {
      throw new Error('Open failed');
    };
    const term = new JupyterTerm(vscode.Uri.file('/workspace/demo.ipynb'), 0, 'Cell 1');

    const result = await runTerm(term);

    assert.ok(result.output.includes('Error: Error: Open failed'));
    assert.strictEqual(result.closeCode, 1);
  });
});
