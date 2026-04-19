import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BitbucketPipelinesTaskProvider } from '../../providers/bitbucketPipelinesTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';
import constants from '../../libs/constants';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'src', 'test', 'task-files', 'bitbucket');

suite('BitbucketPipelinesTaskProvider Test Suite', () => {
  let provider: BitbucketPipelinesTaskProvider;
  let originalFindFiles: any;
  let originalGetTaskIcon: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let tempDir: string;

  const fakeIcon = new vscode.ThemeIcon('circuit-board');
  const makeFileUri = (dir: string, name = 'bitbucket-pipelines.yml') =>
    vscode.Uri.file(path.join(dir, name));

  setup(() => {
    provider = new BitbucketPipelinesTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    iconService.getTaskIcon = () => fakeIcon;

    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-bitbucket-'));
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;

    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;

    (vscode.workspace as any).getConfiguration = originalGetConfiguration;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────
  // Provider metadata
  // ──────────────────────────────────────────────────────────────

  test('has correct type', () => {
    assert.strictEqual(provider.type, 'bitbucket');
  });

  test('has correct filePattern', () => {
    assert.strictEqual(provider.filePattern, constants.GLOB_BITBUCKET_PIPELINES);
  });

  test('getCommand returns pipeline-runner as default command', () => {
    const result = provider.getCommand();
    assert.strictEqual(result.command, 'pipeline-runner');
  });

  test('getSystemTasks returns empty array', async () => {
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ──────────────────────────────────────────────────────────────
  // getTasks
  // ──────────────────────────────────────────────────────────────

  test('getTasks returns empty array when provider is disabled', async () => {
    Object.defineProperty(provider, 'enabled', { value: false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty array when no files found', async () => {
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns parsed file items', async () => {
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });
    const fileUri = vscode.Uri.file(path.join(FIXTURE_DIR, 'simple-default.yml'));
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [fileUri];

    const tasks = await provider.getTasks();
    assert.ok(tasks.length > 0, 'Should return tasks');
    assert.strictEqual(tasks[0].taskType, 'bitbucket');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — invalid/missing YAML
  // ──────────────────────────────────────────────────────────────

  test('parseConfig returns undefined for invalid YAML', () => {
    const fileUri = makeFileUri(tempDir);
    const result = provider.parseConfig(fileUri, ': invalid yaml: [');
    assert.strictEqual(result, undefined);
  });

  test('parseConfig returns undefined when pipelines key is missing', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'no-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.strictEqual(result, undefined);
  });

  test('parseConfig returns undefined when pipelines is null', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'null-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.strictEqual(result, undefined);
  });

  test('parseConfig returns undefined when all pipeline sections are empty', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'empty-pipeline-section.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.strictEqual(result, undefined);
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — file item
  // ──────────────────────────────────────────────────────────────

  test('parseConfig returns file item with correct label', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    assert.strictEqual(result!.label, 'bitbucket-pipelines.yml');
  });

  test('parseConfig file item has taskType bitbucket', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    assert.strictEqual(result!.taskType, 'bitbucket');
  });

  test('parseConfig file item has no onRunActionCommand', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    assert.strictEqual(result!.onRunActionCommand, undefined);
  });

  test('parseConfig file item has onOpenActionCommand', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    assert.ok(result!.onOpenActionCommand);
    assert.strictEqual(result!.onOpenActionCommand!.command, 'workspaceTasks.openFileAtLine');
  });

  test('parseConfig file item has collapsed state', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    assert.strictEqual(result!.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — default pipeline
  // ──────────────────────────────────────────────────────────────

  test('parseConfig creates default pipeline item', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem, 'Should have default pipeline item');
  });

  test('parseConfig default pipeline item has pipeline metadata', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem);
    assert.strictEqual(pipelineItem!.metadata?.type, 'pipeline');
    assert.strictEqual(pipelineItem!.metadata?.pipelinePath, 'default');
  });

  test('parseConfig default pipeline item is runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem);
    assert.ok(pipelineItem!.onRunActionCommand, 'Pipeline item should be runnable');
    assert.strictEqual(pipelineItem!.onRunActionCommand!.command, 'workspaceTasks.runTask');
  });

  test('parseConfig step items exist under default pipeline', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem?.children && pipelineItem.children.length > 0);
    const buildStep = pipelineItem!.children!.find((c) => c.label === 'Build');
    assert.ok(buildStep, 'Should have Build step');
  });

  test('parseConfig named steps are runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const buildStep = pipelineItem!.children!.find((c) => c.label === 'Build');
    assert.ok(buildStep!.onRunActionCommand, 'Named step should be runnable');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — unnamed steps
  // ──────────────────────────────────────────────────────────────

  test('parseConfig unnamed steps are not runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'unnamed-steps.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem);
    const unnamedStep = pipelineItem!.children!.find((c) => c.label === '[unnamed step]');
    assert.ok(unnamedStep, 'Should have unnamed step item');
    assert.strictEqual(unnamedStep!.onRunActionCommand, undefined, 'Unnamed step should not be runnable');
  });

  test('parseConfig named steps among unnamed steps are runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'unnamed-steps.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const namedStep = pipelineItem!.children!.find((c) => c.label === 'Named Step');
    assert.ok(namedStep);
    assert.ok(namedStep!.onRunActionCommand, 'Named step should be runnable');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — duplicate step names
  // ──────────────────────────────────────────────────────────────

  test('parseConfig duplicate step names get index suffix', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'duplicate-step-names.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const labels = pipelineItem!.children!.map((c) => c.label);
    assert.ok(labels.includes('Build'), 'First duplicate should keep original name');
    assert.ok(labels.includes('Build (1)'), 'Second duplicate should have index suffix');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — parallel steps (array shape)
  // ──────────────────────────────────────────────────────────────

  test('parseConfig parallel array steps are flattened under pipeline', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'parallel-steps-array.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem?.children);
    const labels = pipelineItem!.children!.map((c) => c.label);
    assert.ok(labels.includes('Lint'), 'Should include Lint step from parallel block');
    assert.ok(labels.includes('Type Check'), 'Should include Type Check step from parallel block');
    assert.ok(labels.includes('Build'), 'Should include Build step');
  });

  test('parseConfig parallel array steps have parallel tooltip', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'parallel-steps-array.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const lintStep = pipelineItem!.children!.find((c) => c.label === 'Lint');
    assert.ok(lintStep);
    assert.ok(String(lintStep!.tooltip ?? '').includes('[parallel]'), 'Parallel step should have [parallel] in tooltip');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — parallel steps (object shape)
  // ──────────────────────────────────────────────────────────────

  test('parseConfig parallel object steps are flattened under pipeline', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'parallel-steps-object.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const labels = pipelineItem!.children!.map((c) => c.label);
    assert.ok(labels.includes('Unit Tests'));
    assert.ok(labels.includes('Integration Tests'));
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — stage blocks
  // ──────────────────────────────────────────────────────────────

  test('parseConfig stage blocks create stage items', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'stage-blocks.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'master');
    assert.ok(pipelineItem, 'Should find master pipeline');
    const buildStage = pipelineItem!.children!.find((c) => c.label === 'Build Stage');
    assert.ok(buildStage, 'Should have Build Stage item');
    assert.strictEqual(buildStage!.metadata?.type, 'stage');
  });

  test('parseConfig named stage items are runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'stage-blocks.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'master');
    const buildStage = pipelineItem!.children!.find((c) => c.label === 'Build Stage');
    assert.ok(buildStage!.onRunActionCommand, 'Named stage should be runnable');
  });

  test('parseConfig stage items have steps as children', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'stage-blocks.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'master');
    const buildStage = pipelineItem!.children!.find((c) => c.label === 'Build Stage');
    assert.ok(buildStage?.children && buildStage.children.length > 0, 'Stage should have children');
    const compileStep = buildStage!.children!.find((c) => c.label === 'Compile');
    assert.ok(compileStep, 'Stage should have Compile step');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — unnamed stages
  // ──────────────────────────────────────────────────────────────

  test('parseConfig unnamed stages are not runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'unnamed-stages.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    assert.ok(pipelineItem);
    const unnamedStage = pipelineItem!.children!.find((c) => c.label === '[unnamed stage]');
    assert.ok(unnamedStage, 'Should have unnamed stage');
    assert.strictEqual(unnamedStage!.onRunActionCommand, undefined, 'Unnamed stage should not be runnable');
  });

  test('parseConfig named stage among unnamed stages is runnable', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'unnamed-stages.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const namedStage = pipelineItem!.children!.find((c) => c.label === 'Named Stage');
    assert.ok(namedStage);
    assert.ok(namedStage!.onRunActionCommand, 'Named stage should be runnable');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — full pipelines (all sections)
  // ──────────────────────────────────────────────────────────────

  test('parseConfig full pipelines includes default, branches, pull-requests, tags, custom', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'full-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const labels = result!.children!.map((c) => c.label);
    assert.ok(labels.includes('default'));
    assert.ok(labels.includes('master'));
    assert.ok(labels.includes('develop'));
    assert.ok(labels.includes('**'));
    assert.ok(labels.includes('v*'));
    assert.ok(labels.includes('manual-deploy'));
    assert.ok(labels.includes('smoke-tests'));
  });

  test('parseConfig branch pipeline items have section in description', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'full-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const masterItem = result!.children!.find((c) => c.label === 'master');
    assert.ok(masterItem);
    assert.strictEqual(masterItem!.description, 'branches');
  });

  test('parseConfig branch pipeline path includes section prefix', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'full-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const masterItem = result!.children!.find((c) => c.label === 'master');
    assert.ok(masterItem);
    assert.strictEqual(masterItem!.metadata?.pipelinePath, 'branches.master');
  });

  test('parseConfig custom pipeline metadata type is pipeline', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'full-pipelines.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const deployItem = result!.children!.find((c) => c.label === 'manual-deploy');
    assert.ok(deployItem);
    assert.strictEqual(deployItem!.metadata?.type, 'pipeline');
    assert.strictEqual(deployItem!.metadata?.pipelinePath, 'custom.manual-deploy');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — parent/child linkage
  // ──────────────────────────────────────────────────────────────

  test('parseConfig pipeline children have parent set to pipeline item', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    for (const child of pipelineItem!.children!) {
      assert.strictEqual(child.parent, pipelineItem, 'Step parent should be pipeline item');
    }
  });

  test('parseConfig step metadata has type step', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'simple-default.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    const pipelineItem = result!.children?.find((c) => c.label === 'default');
    const buildStep = pipelineItem!.children!.find((c) => c.label === 'Build');
    assert.strictEqual(buildStep!.metadata?.type, 'step');
    assert.strictEqual(buildStep!.metadata?.stepName, 'Build');
    assert.strictEqual(buildStep!.metadata?.pipelinePath, 'default');
  });

  // ──────────────────────────────────────────────────────────────
  // parseConfig — branch with dots
  // ──────────────────────────────────────────────────────────────

  test('parseConfig branch names with slashes create correct pipeline paths', () => {
    const fileUri = makeFileUri(tempDir);
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'branch-with-dots.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.ok(result);
    const featureItem = result!.children!.find((c) => c.label === 'feature/my-feature');
    assert.ok(featureItem, 'Should find feature branch pipeline');
    assert.ok(featureItem!.metadata?.pipelinePath?.startsWith('branches.'), 'Pipeline path should start with branches.');
  });
});
