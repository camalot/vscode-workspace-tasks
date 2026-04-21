import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TaskTypeGroupItem,
  NpmTaskTypeItem,
  DenoTaskTypeItem,
  VscodeTaskTypeItem,
  ScriptTaskTypeItem,
  MakefileTaskTypeItem,
  DockerfileTaskTypeItem,
  DockerComposeTaskTypeItem,
  JustfileTaskTypeItem,
  MiseTaskTypeItem,
  CakeTaskTypeItem,
  AntTaskTypeItem,
  GruntTaskTypeItem,
  GulpTaskTypeItem,
  GradleTaskTypeItem,
  ComposerTaskTypeItem,
  GithubActionsTaskTypeItem,
  WorkspaceTaskTypeItem,
  MsBuildTaskTypeItem,
  GenericTaskTypeItem,
  TaskTypeFactory,
} from '../../taskTypeItems';
import { TaskStateManager } from '../../taskStateManager';
import { FavoritesService } from '../../services/favoritesService';
import { FilteredTaskService } from '../../services/filteredTaskService';
import { TaskIconService } from '../../services/taskIconService';
import { TaskItem } from '../../taskItem';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** A ThemeIcon-like value used as a fake icon returned by the fake icon service. */
const FAKE_ICON = new vscode.ThemeIcon('symbol-class');

/** Builds a fake TaskIconUri that carries a TaskIcon value. */
function makeFakeIconUri(icon: vscode.ThemeIcon | undefined) {
  return { TaskIcon: icon };
}

/**
 * Sets up the singleton fakes required by everything that touches TaskItem
 * (and its subclasses). Returns a cleanup function.
 */
function setupFakes(iconServiceReturns: vscode.ThemeIcon | undefined = FAKE_ICON) {
  // TaskStateManager
  (TaskStateManager as any).instance = {
    getTaskId: (item: TaskItem) => item.originalLabel || item.label,
    getStatus: (_id: string) => 'idle',
  } as unknown as TaskStateManager;

  // FavoritesService
  (FavoritesService as any).instance = {
    isFavorite: (_item: TaskItem | string) => false,
  } as unknown as FavoritesService;

  // FilteredTaskService
  (FilteredTaskService as any).instance = {
    isFiltered: (_id: string) => false,
    isFilteredOrHasFilteredParent: (_item: TaskItem) => false,
  } as unknown as FilteredTaskService;

  // TaskIconService
  (TaskIconService as any).instance = {
    getTaskTypeIcon: (_type: string, _fallback?: vscode.Uri) =>
      makeFakeIconUri(iconServiceReturns),
    resolveWorkspaceTaskTypeIcon: (_type: string, _iconUri?: any) =>
      makeFakeIconUri(iconServiceReturns),
    getDefaultGroupIcon: () =>
      iconServiceReturns ? undefined : undefined,
  } as unknown as TaskIconService;
}

function teardownFakes() {
  (TaskStateManager as any).instance = undefined;
  (FavoritesService as any).instance = undefined;
  (FilteredTaskService as any).instance = undefined;
  (TaskIconService as any).instance = undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Suite
// ──────────────────────────────────────────────────────────────────────────────

suite('TaskTypeItems Test Suite', () => {
  setup(() => setupFakes());
  teardown(() => teardownFakes());

  // ── TaskTypeGroupItem (abstract base) ──────────────────────────────────────

  suite('TaskTypeGroupItem (abstract base)', () => {
    // We use NpmTaskTypeItem as a concrete proxy for the base class tests.

    test('children is initialized as empty array', () => {
      const item = new NpmTaskTypeItem();
      assert.deepStrictEqual(item.children, []);
    });

    test('default collapsibleState is Collapsed', () => {
      const item = new NpmTaskTypeItem();
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('accepts a custom collapsibleState', () => {
      const item = new NpmTaskTypeItem(vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('iconPath is set when TaskIconService returns an icon', () => {
      const item = new NpmTaskTypeItem();
      assert.strictEqual(item.iconPath, FAKE_ICON);
    });

    test('iconPath is NOT overwritten when TaskIconService returns undefined', () => {
      // Override the fake to return undefined icon
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => makeFakeIconUri(undefined),
      } as unknown as TaskIconService;

      const item = new NpmTaskTypeItem();
      // The base class sets File icon; it should NOT be overwritten here
      assert.ok(item.iconPath !== FAKE_ICON, 'iconPath should not be the fake icon');
    });

    test('iconPath is NOT overwritten when TaskIconService returns undefined', () => {
      // Override the fake to return null (no TaskIconUri at all)
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => undefined,
      } as unknown as TaskIconService;

      const item = new NpmTaskTypeItem();
      // iconPath should still be set (from base class)
      assert.ok(item.iconPath !== undefined, 'iconPath should still be defined');
    });
  });

  // ── Individual item classes ────────────────────────────────────────────────

  const ITEMS: Array<{ name: string; label: string; ctor: () => TaskTypeGroupItem }> = [
    { name: 'NpmTaskTypeItem', label: 'npm', ctor: () => new NpmTaskTypeItem() },
    { name: 'DenoTaskTypeItem', label: 'deno', ctor: () => new DenoTaskTypeItem() },
    { name: 'VscodeTaskTypeItem', label: 'vscode', ctor: () => new VscodeTaskTypeItem() },
    { name: 'ScriptTaskTypeItem', label: 'script', ctor: () => new ScriptTaskTypeItem() },
    { name: 'MakefileTaskTypeItem', label: 'makefile', ctor: () => new MakefileTaskTypeItem() },
    { name: 'DockerfileTaskTypeItem', label: 'dockerfile', ctor: () => new DockerfileTaskTypeItem() },
    { name: 'DockerComposeTaskTypeItem', label: 'docker-compose', ctor: () => new DockerComposeTaskTypeItem() },
    { name: 'JustfileTaskTypeItem', label: 'justfile', ctor: () => new JustfileTaskTypeItem() },
    { name: 'MiseTaskTypeItem', label: 'mise', ctor: () => new MiseTaskTypeItem() },
    { name: 'CakeTaskTypeItem', label: 'cake', ctor: () => new CakeTaskTypeItem() },
    { name: 'AntTaskTypeItem', label: 'ant', ctor: () => new AntTaskTypeItem() },
    { name: 'GruntTaskTypeItem', label: 'grunt', ctor: () => new GruntTaskTypeItem() },
    { name: 'GulpTaskTypeItem', label: 'gulp', ctor: () => new GulpTaskTypeItem() },
    { name: 'GradleTaskTypeItem', label: 'gradle', ctor: () => new GradleTaskTypeItem() },
    { name: 'ComposerTaskTypeItem', label: 'composer', ctor: () => new ComposerTaskTypeItem() },
    { name: 'GithubActionsTaskTypeItem', label: 'github-actions', ctor: () => new GithubActionsTaskTypeItem() },
    { name: 'WorkspaceTaskTypeItem', label: 'workspace-task', ctor: () => new WorkspaceTaskTypeItem() },
    { name: 'MsBuildTaskTypeItem', label: 'msbuild', ctor: () => new MsBuildTaskTypeItem() },
  ];

  for (const { name, label, ctor } of ITEMS) {
    suite(name, () => {
      test(`label is "${label}"`, () => {
        const item = ctor();
        assert.strictEqual(item.label, label);
      });

      test('default collapsibleState is Collapsed', () => {
        const item = ctor();
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
      });

      test('taskType is "type"', () => {
        const item = ctor();
        assert.strictEqual(item.taskType, 'type');
      });

      test('iconPath is set from icon service', () => {
        const item = ctor();
        assert.strictEqual(item.iconPath, FAKE_ICON);
      });

      test('children is initialized as empty array', () => {
        const item = ctor();
        assert.deepStrictEqual(item.children, []);
      });
    });
  }

  // ── GenericTaskTypeItem ────────────────────────────────────────────────────

  suite('GenericTaskTypeItem', () => {
    test('label reflects the provided type string', () => {
      const item = new GenericTaskTypeItem('cargo');
      assert.strictEqual(item.label, 'cargo');
    });

    test('default collapsibleState is Collapsed', () => {
      const item = new GenericTaskTypeItem('cargo');
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('accepts a custom collapsibleState', () => {
      const item = new GenericTaskTypeItem('cargo', undefined, vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('iconPath is set from icon service', () => {
      const item = new GenericTaskTypeItem('cargo');
      assert.strictEqual(item.iconPath, FAKE_ICON);
    });

    test('taskType is "type"', () => {
      const item = new GenericTaskTypeItem('my-custom-type');
      assert.strictEqual(item.taskType, 'type');
    });

    test('uses DisplayUri from iconUri filename as resourceUri', () => {
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => ({ TaskIcon: undefined }),
        resolveWorkspaceTaskTypeIcon: (_type: string, _iconUri?: any) => ({
          TaskIcon: undefined,
          DisplayUri: vscode.Uri.file('/myconfig.json'),
        }),
      } as unknown as TaskIconService;

      const item = new GenericTaskTypeItem('cargo', 'myconfig.json');
      assert.ok(item.resourceUri, 'resourceUri should be set');
      // The resourceUri uses the workspace-tasks:// scheme so the decoration provider
      // still works; the path encodes the icon filename for file-theme matching.
      assert.strictEqual(item.resourceUri!.scheme, 'workspace-tasks');
      assert.ok(item.resourceUri!.path.endsWith('myconfig.json'), `path should end with myconfig.json, got: ${item.resourceUri!.path}`);
      assert.deepStrictEqual(item.iconPath, vscode.ThemeIcon.File);
    });

    test('uses TaskIcon from iconUri image as iconPath', () => {
      const fakeIcon = { dark: vscode.Uri.file('/dark.svg'), light: vscode.Uri.file('/light.svg') };
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => ({ TaskIcon: undefined }),
        resolveWorkspaceTaskTypeIcon: (_type: string, _iconUri?: any) => ({
          TaskIcon: fakeIcon,
          DisplayUri: vscode.Uri.file('/light.svg'),
        }),
        getDefaultGroupIcon: () => undefined,
      } as unknown as TaskIconService;

      const item = new GenericTaskTypeItem('cargo', { dark: '/dark.svg', light: '/light.svg' });
      assert.deepStrictEqual(item.iconPath, fakeIcon);
    });

    test('falls back to getDefaultGroupIcon() when no icon and no DisplayUri', () => {
      const defaultIcon = { dark: vscode.Uri.file('/dark/task.png'), light: vscode.Uri.file('/light/task.png') };
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => ({ TaskIcon: undefined }),
        resolveWorkspaceTaskTypeIcon: (_type: string, _iconUri?: any) => ({
          TaskIcon: undefined,
          DisplayUri: undefined,
        }),
        getDefaultGroupIcon: () => defaultIcon,
      } as unknown as TaskIconService;

      const item = new GenericTaskTypeItem('unknown-type');
      assert.deepStrictEqual(item.iconPath, defaultIcon, 'iconPath should be the default task.png icon');
    });

    test('uses ThemeIcon.File when getDefaultGroupIcon() returns undefined', () => {
      (TaskIconService as any).instance = {
        getTaskTypeIcon: () => ({ TaskIcon: undefined }),
        resolveWorkspaceTaskTypeIcon: (_type: string, _iconUri?: any) => ({
          TaskIcon: undefined,
          DisplayUri: undefined,
        }),
        getDefaultGroupIcon: () => undefined,
      } as unknown as TaskIconService;

      const item = new GenericTaskTypeItem('unknown-type');
      // Base class sets ThemeIcon.File — no override if default icon unavailable
      assert.deepStrictEqual(item.iconPath, vscode.ThemeIcon.File);
    });
  });

  // ── Custom collapsibleState overrides ─────────────────────────────────────

  suite('collapsibleState override', () => {
    const EXPANDED = vscode.TreeItemCollapsibleState.Expanded;
    const NONE = vscode.TreeItemCollapsibleState.None;

    const OVERRIDABLE: Array<{ name: string; ctor: (s: vscode.TreeItemCollapsibleState) => TaskTypeGroupItem }> = [
      { name: 'DenoTaskTypeItem', ctor: (s) => new DenoTaskTypeItem(s) },
      { name: 'VscodeTaskTypeItem', ctor: (s) => new VscodeTaskTypeItem(s) },
      { name: 'ScriptTaskTypeItem', ctor: (s) => new ScriptTaskTypeItem(s) },
      { name: 'MakefileTaskTypeItem', ctor: (s) => new MakefileTaskTypeItem(s) },
      { name: 'DockerfileTaskTypeItem', ctor: (s) => new DockerfileTaskTypeItem(s) },
      { name: 'DockerComposeTaskTypeItem', ctor: (s) => new DockerComposeTaskTypeItem(s) },
      { name: 'JustfileTaskTypeItem', ctor: (s) => new JustfileTaskTypeItem(s) },
      { name: 'MiseTaskTypeItem', ctor: (s) => new MiseTaskTypeItem(s) },
      { name: 'AntTaskTypeItem', ctor: (s) => new AntTaskTypeItem(s) },
      { name: 'GruntTaskTypeItem', ctor: (s) => new GruntTaskTypeItem(s) },
      { name: 'GulpTaskTypeItem', ctor: (s) => new GulpTaskTypeItem(s) },
      { name: 'GradleTaskTypeItem', ctor: (s) => new GradleTaskTypeItem(s) },
      { name: 'ComposerTaskTypeItem', ctor: (s) => new ComposerTaskTypeItem(s) },
      { name: 'GithubActionsTaskTypeItem', ctor: (s) => new GithubActionsTaskTypeItem(s) },
      { name: 'WorkspaceTaskTypeItem', ctor: (s) => new WorkspaceTaskTypeItem(s) },
      { name: 'MsBuildTaskTypeItem', ctor: (s) => new MsBuildTaskTypeItem(s) },
    ];

    for (const { name, ctor } of OVERRIDABLE) {
      test(`${name} respects Expanded state`, () => {
        assert.strictEqual(ctor(EXPANDED).collapsibleState, EXPANDED);
      });
      test(`${name} respects None state`, () => {
        assert.strictEqual(ctor(NONE).collapsibleState, NONE);
      });
    }
  });

  // ── TaskTypeFactory ────────────────────────────────────────────────────────

  suite('TaskTypeFactory.create', () => {
    const FACTORY_CASES: Array<{ type: string; expectedLabel: string; expectedClass: any }> = [
      { type: 'npm', expectedLabel: 'npm', expectedClass: NpmTaskTypeItem },
      { type: 'deno', expectedLabel: 'deno', expectedClass: DenoTaskTypeItem },
      { type: 'vscode', expectedLabel: 'vscode', expectedClass: VscodeTaskTypeItem },
      { type: 'github-actions', expectedLabel: 'github-actions', expectedClass: GithubActionsTaskTypeItem },
      { type: 'script', expectedLabel: 'script', expectedClass: ScriptTaskTypeItem },
      { type: 'makefile', expectedLabel: 'makefile', expectedClass: MakefileTaskTypeItem },
      { type: 'dockerfile', expectedLabel: 'dockerfile', expectedClass: DockerfileTaskTypeItem },
      { type: 'docker-compose', expectedLabel: 'docker-compose', expectedClass: DockerComposeTaskTypeItem },
      { type: 'justfile', expectedLabel: 'justfile', expectedClass: JustfileTaskTypeItem },
      { type: 'ant', expectedLabel: 'ant', expectedClass: AntTaskTypeItem },
      { type: 'grunt', expectedLabel: 'grunt', expectedClass: GruntTaskTypeItem },
      { type: 'gulp', expectedLabel: 'gulp', expectedClass: GulpTaskTypeItem },
      { type: 'gradle', expectedLabel: 'gradle', expectedClass: GradleTaskTypeItem },
      { type: 'msbuild', expectedLabel: 'msbuild', expectedClass: MsBuildTaskTypeItem },
      { type: 'workspace-task', expectedLabel: 'workspace-task', expectedClass: WorkspaceTaskTypeItem },
      { type: 'composer', expectedLabel: 'composer', expectedClass: ComposerTaskTypeItem },
      { type: 'mise', expectedLabel: 'mise', expectedClass: MiseTaskTypeItem },
    ];

    for (const { type, expectedLabel, expectedClass } of FACTORY_CASES) {
      test(`create("${type}") returns correct instance with label "${expectedLabel}"`, () => {
        const item = TaskTypeFactory.create(type);
        assert.ok(item instanceof expectedClass, `Expected instanceof ${expectedClass.name}`);
        assert.strictEqual(item.label, expectedLabel);
      });
    }

    test('create with unknown type returns GenericTaskTypeItem', () => {
      const item = TaskTypeFactory.create('unknown-type');
      assert.ok(item instanceof GenericTaskTypeItem, 'Expected instanceof GenericTaskTypeItem');
      assert.strictEqual(item.label, 'unknown-type');
    });

    test('create passes collapsibleState to item', () => {
      const item = TaskTypeFactory.create('npm', vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('create with unknown type and Expanded state sets state correctly', () => {
      const item = TaskTypeFactory.create('anything', vscode.TreeItemCollapsibleState.Expanded);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('create defaults to Collapsed when no state given', () => {
      const item = TaskTypeFactory.create('npm');
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });
  });
});
