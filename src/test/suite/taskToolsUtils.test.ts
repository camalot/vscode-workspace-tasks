import * as assert from 'assert';
import * as vscode from 'vscode';
import { isLeafTask, collectLeafTasks, toSummary } from '../../tools/taskToolsUtils';
import { TaskItem } from '../../taskItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(label: string, taskType = 'npm', fileUri?: vscode.Uri): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.id = `${taskType}:${label}`;
  item.originalLabel = label;
  item.task = {} as vscode.Task; // mark as having a vscode.Task
  if (fileUri) {
    item.taskFileUri = fileUri;
  }
  return item;
}

function makeGroup(label: string, children: TaskItem[], taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.Expanded, taskType);
  item.id = `${taskType}:${label}`;
  item.originalLabel = label;
  item.children = children;
  // Groups do NOT have a .task assigned
  return item;
}

/** Make a leaf that also has children (simulates a compound task with dependencies). */
function makeCompoundLeaf(label: string, children: TaskItem[], taskType = 'npm'): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.Expanded, taskType);
  item.id = `${taskType}:${label}`;
  item.originalLabel = label;
  item.task = {} as vscode.Task; // has a task → leaf
  item.children = children;
  return item;
}

// ---------------------------------------------------------------------------
// isLeafTask
// ---------------------------------------------------------------------------

suite('taskToolsUtils — isLeafTask', () => {
  test('returns true for None collapsible state', () => {
    const item = makeLeaf('build');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.strictEqual(isLeafTask(item), true);
  });

  test('returns true for Expanded item with task set', () => {
    const item = makeCompoundLeaf('compound', []);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.ok(item.task);
    assert.strictEqual(isLeafTask(item), true);
  });

  test('returns false for Expanded item without task', () => {
    const group = makeGroup('npm group', []);
    assert.strictEqual(isLeafTask(group), false);
  });

  test('returns false for Collapsed item without task', () => {
    const item = new TaskItem('group', vscode.TreeItemCollapsibleState.Collapsed, 'npm');
    // no .task assigned
    assert.strictEqual(isLeafTask(item), false);
  });
});

// ---------------------------------------------------------------------------
// collectLeafTasks
// ---------------------------------------------------------------------------

suite('taskToolsUtils — collectLeafTasks', () => {
  test('flat list of leaves — all items collected', () => {
    const items = [makeLeaf('a'), makeLeaf('b'), makeLeaf('c')];
    const result = collectLeafTasks(items);
    assert.strictEqual(result.length, 3);
  });

  test('nested — group with children collects children recursively', () => {
    const children = [makeLeaf('child-a'), makeLeaf('child-b')];
    const group = makeGroup('group', children);
    const result = collectLeafTasks([group]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].originalLabel, 'child-a');
    assert.strictEqual(result[1].originalLabel, 'child-b');
  });

  test('mixed — only leaf items collected', () => {
    const leaf = makeLeaf('leaf');
    const group = makeGroup('group', [makeLeaf('nested')]);
    const result = collectLeafTasks([leaf, group]);
    assert.strictEqual(result.length, 2);
  });

  test('empty array — returns empty array', () => {
    const result = collectLeafTasks([]);
    assert.deepStrictEqual(result, []);
  });

  test('compound leaf with children — item added, children NOT recursed (else branch)', () => {
    const dep = makeLeaf('dep-task');
    const compound = makeCompoundLeaf('compound', [dep]);
    const result = collectLeafTasks([compound]);
    // compound is a leaf (has .task) so it should be added but NOT recursed
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].originalLabel, 'compound');
  });

  test('deeply nested groups — all leaves collected', () => {
    const deepLeaf = makeLeaf('deep');
    const level2 = makeGroup('level2', [deepLeaf]);
    const level1 = makeGroup('level1', [level2]);
    const result = collectLeafTasks([level1]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].originalLabel, 'deep');
  });
});

// ---------------------------------------------------------------------------
// toSummary
// ---------------------------------------------------------------------------

function setWorkspaceFolders(folders: readonly vscode.WorkspaceFolder[] | undefined): void {
  Object.defineProperty(vscode.workspace, 'workspaceFolders', { get: () => folders, configurable: true });
}

suite('taskToolsUtils — toSummary', () => {
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;
  let originalAsRelativePath: typeof vscode.workspace.asRelativePath;
  let originalWorkspaceFoldersProp: PropertyDescriptor | undefined;

  setup(() => {
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder.bind(vscode.workspace);
    originalAsRelativePath = vscode.workspace.asRelativePath.bind(vscode.workspace);
    originalWorkspaceFoldersProp = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
  });

  teardown(() => {
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    if (originalWorkspaceFoldersProp) {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', originalWorkspaceFoldersProp);
    }
  });

  test('item with taskFileUri inside workspace — source is relative path', () => {
    const fileUri = vscode.Uri.file('/workspace/package.json');
    const item = makeLeaf('build', 'npm', fileUri);

    const fakeFolder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/workspace'),
      name: 'workspace',
      index: 0,
    };
    (vscode.workspace as any).getWorkspaceFolder = () => fakeFolder;
    (vscode.workspace as any).asRelativePath = () => 'package.json';
    setWorkspaceFolders([fakeFolder]);

    const summary = toSummary(item);
    assert.strictEqual(summary.source, 'package.json');
    assert.strictEqual(summary.id, item.id);
    assert.strictEqual(summary.label, 'build');
    assert.strictEqual(summary.type, 'npm');
  });

  test('item with taskFileUri outside workspace — source is absolute path', () => {
    const fileUri = vscode.Uri.file('/external/Taskfile.yml');
    const item = makeLeaf('task', 'taskfile', fileUri);

    (vscode.workspace as any).getWorkspaceFolder = () => undefined;
    setWorkspaceFolders([]);

    const summary = toSummary(item);
    assert.strictEqual(summary.source, '/external/Taskfile.yml');
  });

  test('item with no file URI — source is null', () => {
    const item = makeLeaf('global-task', 'shell');
    const summary = toSummary(item);
    assert.strictEqual(summary.source, null);
  });

  test('item with no id — id is null', () => {
    const item = makeLeaf('no-id');
    item.id = undefined;
    const summary = toSummary(item);
    assert.strictEqual(summary.id, null);
  });

  test('multi-root workspace — workspaceFolder is present', () => {
    const fileUri = vscode.Uri.file('/workspace/project-a/package.json');
    const item = makeLeaf('build', 'npm', fileUri);

    const folderA: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/workspace/project-a'), name: 'project-a', index: 0 };
    const folderB: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/workspace/project-b'), name: 'project-b', index: 1 };
    setWorkspaceFolders([folderA, folderB]);
    (vscode.workspace as any).getWorkspaceFolder = () => folderA;
    (vscode.workspace as any).asRelativePath = () => 'project-a/package.json';

    const summary = toSummary(item);
    assert.strictEqual(summary.workspaceFolder, 'project-a');
  });

  test('single-root workspace — workspaceFolder is absent', () => {
    const fileUri = vscode.Uri.file('/workspace/package.json');
    const item = makeLeaf('build', 'npm', fileUri);

    const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 };
    setWorkspaceFolders([folder]);
    (vscode.workspace as any).getWorkspaceFolder = () => folder;
    (vscode.workspace as any).asRelativePath = () => 'package.json';

    const summary = toSummary(item);
    assert.strictEqual(summary.workspaceFolder, undefined);
  });
});
