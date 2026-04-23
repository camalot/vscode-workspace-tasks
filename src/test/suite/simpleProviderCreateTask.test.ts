import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { BunTaskProvider, NpmTaskProvider, PnpmTaskProvider, YarnTaskProvider } from '../../providers/npmTaskProvider';
import { DenoTaskProvider } from '../../providers/denoTaskProvider';
import { MiseTaskProvider } from '../../providers/miseTaskProvider';
import { MavenTaskProvider } from '../../providers/mavenTaskProvider';
import { GradleTaskProvider } from '../../providers/gradleTaskProvider';
import { ComposerTaskProvider } from '../../providers/composerTaskProvider';
import { PipenvTaskProvider } from '../../providers/pipenvTaskProvider';
import { PoeTaskProvider } from '../../providers/poeTaskProvider';
import { PoetryTaskProvider } from '../../providers/poetryTaskProvider';
import { CargoMakeTaskProvider } from '../../providers/cargoMakeTaskProvider';
import { assertProviderCreatesTask } from './helpers/providerTestHelper';

suite('Simple Provider createTask()', () => {
  let originalIsTrusted: boolean;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/workspace';

  setup(() => {
    originalIsTrusted = (vscode.workspace as any).isTrusted;
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => true,
      configurable: true,
    });
  });

  teardown(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });
  });

  function makeItem(taskType: string, taskLabel: string, filePath: string): TaskItem {
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem(taskLabel, vscode.TreeItemCollapsibleState.None, taskType, uri);
    item.taskFileUri = uri;
    return item;
  }

  test('npm/yarn/bun/pnpm use package directory as cwd', async () => {
    const pkgDir = path.join(workspaceRoot, 'packages', 'phase1');
    const pkgPath = path.join(pkgDir, 'package.json');

    await assertProviderCreatesTask(new NpmTaskProvider(), makeItem('npm', 'build', pkgPath), 'npm', pkgDir);
    await assertProviderCreatesTask(new YarnTaskProvider(), makeItem('yarn', 'build', pkgPath), 'yarn', pkgDir);
    await assertProviderCreatesTask(new BunTaskProvider(), makeItem('bun', 'build', pkgPath), 'bun', pkgDir);
    await assertProviderCreatesTask(new PnpmTaskProvider(), makeItem('pnpm', 'build', pkgPath), 'pnpm', pkgDir);
  });

  test('deno adds task and config arguments', async () => {
    const filePath = path.join(workspaceRoot, 'deno.json');
    const provider = new DenoTaskProvider();
    const result = await provider.createTask(makeItem('deno', 'lint', filePath), '--watch');

    assert.ok(result);
    const command = result?.command || '';
    assert.ok(command.includes('deno'), `Expected deno command but got ${command}`);
    assert.ok(command.includes('task'), `Expected task subcommand but got ${command}`);
    assert.ok(command.includes('--config'), `Expected --config argument but got ${command}`);
    assert.ok(command.includes('lint'), `Expected task label but got ${command}`);
  });

  test('mise uses config root cwd', async () => {
    const taskFile = path.join(workspaceRoot, 'apps', 'api', '.config', 'mise', 'config.toml');
    const expectedCwd = path.join(workspaceRoot, 'apps', 'api');
    await assertProviderCreatesTask(new MiseTaskProvider(), makeItem('mise', 'check', taskFile), 'mise', expectedCwd);
  });

  test('maven/gradle/composer/pipenv/poe/poetry/cargo-make create tasks', async () => {
    await assertProviderCreatesTask(
      new MavenTaskProvider(),
      makeItem('maven', 'test', path.join(workspaceRoot, 'pom.xml')),
      'mvn',
      workspaceRoot,
    );
    await assertProviderCreatesTask(
      new GradleTaskProvider(),
      makeItem('gradle', 'build', path.join(workspaceRoot, 'build.gradle')),
      'gradle',
      workspaceRoot,
    );
    await assertProviderCreatesTask(
      new ComposerTaskProvider(),
      makeItem('composer', 'lint', path.join(workspaceRoot, 'composer.json')),
      'composer',
      workspaceRoot,
      '--verbose',
    );
    await assertProviderCreatesTask(
      new PipenvTaskProvider(),
      makeItem('pipenv', 'test', path.join(workspaceRoot, 'Pipfile')),
      'pipenv',
      workspaceRoot,
    );
    await assertProviderCreatesTask(
      new PoeTaskProvider(),
      makeItem('poe', 'fmt', path.join(workspaceRoot, 'pyproject.toml')),
      'poe',
      workspaceRoot,
    );
    await assertProviderCreatesTask(
      new PoetryTaskProvider(),
      makeItem('poetry', 'start', path.join(workspaceRoot, 'pyproject.toml')),
      'poetry',
      workspaceRoot,
    );
    await assertProviderCreatesTask(
      new CargoMakeTaskProvider(),
      makeItem('cargo-make', 'build', path.join(workspaceRoot, 'Makefile.toml')),
      'cargo',
      workspaceRoot,
    );
  });

  test('all migrated simple providers still create tasks in untrusted workspaces', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => false,
      configurable: true,
    });

    const providers = [
      { provider: new NpmTaskProvider(), item: makeItem('npm', 'build', path.join(workspaceRoot, 'package.json')) },
      { provider: new YarnTaskProvider(), item: makeItem('yarn', 'build', path.join(workspaceRoot, 'package.json')) },
      { provider: new BunTaskProvider(), item: makeItem('bun', 'build', path.join(workspaceRoot, 'package.json')) },
      { provider: new PnpmTaskProvider(), item: makeItem('pnpm', 'build', path.join(workspaceRoot, 'package.json')) },
      { provider: new DenoTaskProvider(), item: makeItem('deno', 'build', path.join(workspaceRoot, 'deno.json')) },
      { provider: new MiseTaskProvider(), item: makeItem('mise', 'build', path.join(workspaceRoot, 'mise.toml')) },
      { provider: new MavenTaskProvider(), item: makeItem('maven', 'build', path.join(workspaceRoot, 'pom.xml')) },
      { provider: new GradleTaskProvider(), item: makeItem('gradle', 'build', path.join(workspaceRoot, 'build.gradle')) },
      { provider: new ComposerTaskProvider(), item: makeItem('composer', 'build', path.join(workspaceRoot, 'composer.json')) },
      { provider: new PipenvTaskProvider(), item: makeItem('pipenv', 'build', path.join(workspaceRoot, 'Pipfile')) },
      { provider: new PoeTaskProvider(), item: makeItem('poe', 'build', path.join(workspaceRoot, 'pyproject.toml')) },
      { provider: new PoetryTaskProvider(), item: makeItem('poetry', 'build', path.join(workspaceRoot, 'pyproject.toml')) },
      { provider: new CargoMakeTaskProvider(), item: makeItem('cargo-make', 'build', path.join(workspaceRoot, 'Makefile.toml')) },
    ];

    for (const { provider, item } of providers) {
      const result = await provider.createTask(item);
      assert.ok(result, `${provider.type} should still create a task when untrusted`);
    }
  });
});
