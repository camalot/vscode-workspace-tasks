import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../../taskTreeDataProvider';
import { TaskItem } from '../../taskItem';

class TestableTaskTreeDataProvider extends TaskTreeDataProvider {
  constructor() {
    super({} as any);
  }

  // Override to mock context
  protected getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    // Windows path simulation if on windows?
    // vscode.Uri.file behaves platform specific.
    // Assuming posix for simple match or simple string check on fsPath
    const pathStr = uri.fsPath.replace(/\\/g, '/');
    if (pathStr.startsWith('/root')) {
      return {
        uri: vscode.Uri.file('/root'),
        name: 'root',
        index: 0
      };
    }
    // Simulate windows drive if needed?
    if (pathStr.toLowerCase().startsWith('c:/root')) {
      return {
        uri: vscode.Uri.file('c:/root'),
        name: 'root',
        index: 0
      };
    }
    return undefined;
  }
}

suite('Task Grouping Parent Folder Test Suite', () => {

  test('Groups tasks by parent folder with separator', () => {
    const provider = new TestableTaskTreeDataProvider();

    // Setup Mock Tasks
    const rootUri = vscode.Uri.file('/root/package.json');
    const appAUri = vscode.Uri.file('/root/appA/package.json');
    const appBUri = vscode.Uri.file('/root/appB/package.json');

    const tasks = [
      new TaskItem('root-build', vscode.TreeItemCollapsibleState.None, 'npm', rootUri),
      new TaskItem('appA-build', vscode.TreeItemCollapsibleState.None, 'npm', appAUri),
      new TaskItem('appB-build', vscode.TreeItemCollapsibleState.None, 'npm', appBUri),
      new TaskItem('appB-test', vscode.TreeItemCollapsibleState.None, 'npm', appBUri)
    ];

    tasks[0].taskFileUri = rootUri;
    tasks[1].taskFileUri = appAUri;
    tasks[2].taskFileUri = appBUri;
    tasks[3].taskFileUri = appBUri;

    // Use separator '-'
    // Note: groupTasksByName is called on children.
    // appA-build -> (split -) -> appA / build ?
    // If the label matches the folder, it might look weird but correct recursively.
    const grouped = provider.groupTasksByParentFolder(tasks, '-', 'npm', 'ws1', 'salt');

    // root-build -> devides to root / build?
    // root-build is at root folder. So it goes to rootTasks.
    // rootTasks are then groupedByName. 'root-build' -> 'root' (Folder/Group) -> 'build' (Task)

    // appA (Folder from parent grouping)
    //   -> tasks: ['appA-build']
    //   -> groupByName(['appA-build'], '-') -> 'appA' (Group) -> 'build'

    // So structure:
    // appA (Folder)
    //   appA (Group)
    //     build (Task)

    // appB (Folder)
    //   appB (Group)
    //     build
    //     test

    // root (Group)
    //   build

    // Let's verify appA folder existence
    const folderAppA = grouped.find(t => t.label === 'appA' && t.contextValue === 'folder');
    assert.ok(folderAppA, 'Should find appA folder');

    // Verify root grouping
    const groupRoot = grouped.find(t => t.label === 'root' && t.contextValue === 'folder'); // contextValue 'folder' is set by groupByName for groups too
    assert.ok(groupRoot, 'Should find root group from root tasks');

  });

  test('Groups tasks by parent folder without separator', () => {
    const provider = new TestableTaskTreeDataProvider();

    const rootUri = vscode.Uri.file('/root/package.json');
    const appAUri = vscode.Uri.file('/root/appA/package.json');

    const tasks = [
      new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', rootUri),
      new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'npm', appAUri),
    ];

    tasks[0].taskFileUri = rootUri;
    tasks[1].taskFileUri = appAUri;

    // Use empty separator
    const grouped = provider.groupTasksByParentFolder(tasks, '', 'npm', 'ws1', 'salt');

    // appA (Folder) -> test
    // build (Task)

    const appA = grouped.find(t => t.label === 'appA');
    assert.ok(appA, 'Should find appA folder');
    assert.strictEqual(appA?.children.length, 1);
    assert.strictEqual(appA?.children[0].label, 'test');

    const build = grouped.find(t => t.label === 'build');
    assert.ok(build, 'Should find build task');
    assert.notStrictEqual(build?.contextValue, 'folder');
  });
});
