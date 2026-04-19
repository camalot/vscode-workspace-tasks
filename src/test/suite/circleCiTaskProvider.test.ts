import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CircleCiTaskProvider } from '../../providers/circleCiTaskProvider';
import { TaskIconService } from '../../services/taskIconService';
import constants from '../../libs/constants';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'src', 'test', 'task-files', 'circleci');

suite('CircleCiTaskProvider Test Suite', () => {
  let provider: CircleCiTaskProvider;
  let originalGetTaskIcon: any;

  const fakeIcon = new vscode.ThemeIcon('circle-large-outline');
  const makeFileUri = (name = 'config.yml') => vscode.Uri.file(path.join('/tmp', '.circleci', name));

  setup(() => {
    provider = new CircleCiTaskProvider();
    const iconService = TaskIconService.getInstance();
    originalGetTaskIcon = iconService.getTaskIcon.bind(iconService);
    iconService.getTaskIcon = () => fakeIcon;
  });

  teardown(() => {
    const iconService = TaskIconService.getInstance();
    iconService.getTaskIcon = originalGetTaskIcon;
  });

  test('has correct type and pattern', () => {
    assert.strictEqual(provider.type, 'circleci');
    assert.strictEqual(provider.filePattern, constants.GLOB_CIRCLECI);
  });

  test('getCommand returns circleci as default command', () => {
    const result = provider.getCommand();
    assert.strictEqual(result.command, 'circleci');
  });

  test('parseConfig returns undefined for invalid YAML', () => {
    const fileUri = makeFileUri();
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'invalid-config.yml'), 'utf8');
    const result = provider.parseConfig(fileUri, text);
    assert.strictEqual(result, undefined);
  });

  test('parseConfig returns undefined when there are no jobs', () => {
    const fileUri = makeFileUri();
    const result = provider.parseConfig(fileUri, 'version: 2.1\nworkflows: {}\n');
    assert.strictEqual(result, undefined);
  });

  test('parseConfig builds workflow and job nodes', () => {
    const fileUri = makeFileUri();
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'workflow-config.yml'), 'utf8');
    const root = provider.parseConfig(fileUri, text);

    assert.ok(root, 'Expected root item');
    assert.strictEqual(root!.taskType, 'circleci');
    assert.strictEqual(root!.metadata?.type, 'file');
    assert.strictEqual(root!.onRunActionCommand, undefined);
    assert.strictEqual(root!.iconPath, fakeIcon);

    const workflow = root!.children.find((c) => c.metadata?.type === 'workflow');
    assert.ok(workflow, 'Expected a workflow node');
    assert.ok(Array.isArray(workflow!.metadata?.workflowJobs), 'Expected workflowJobs metadata');
    assert.deepStrictEqual(workflow!.metadata.workflowJobs, ['lint', 'test', 'deploy']);

    const workflowChildren = workflow!.children.map((c) => c.label);
    assert.deepStrictEqual(workflowChildren, ['lint', 'test', 'deploy']);
  });

  test('parseConfig creates jobs group with all defined jobs', () => {
    const fileUri = makeFileUri();
    const text = fs.readFileSync(path.join(FIXTURE_DIR, 'unassigned-jobs-config.yml'), 'utf8');
    const root = provider.parseConfig(fileUri, text);

    assert.ok(root, 'Expected root item');
    const jobsGroup = root!.children.find((c) => c.label === 'jobs');
    assert.ok(jobsGroup, 'Expected jobs group');
    assert.strictEqual(jobsGroup!.iconPath, fakeIcon);

    const labels = jobsGroup!.children.map((c) => c.label);
    assert.strictEqual(labels.length, 2);
    assert.ok(labels.includes('lint'));
    assert.ok(labels.includes('cleanup'));
  });
});
