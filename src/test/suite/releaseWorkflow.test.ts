import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import micromatch from 'micromatch';
import * as YAML from 'yaml';

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
}

interface ReleaseJob {
  permissions: Record<string, string>;
  steps: WorkflowStep[];
}

suite('Release supply-chain artifacts', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8'));
  const job: ReleaseJob = workflow.jobs['publish-vscode-marketplace'];
  const action = YAML.parse(fs.readFileSync(path.join(root, '.github', 'actions', 'sbom', 'action.yml'), 'utf8'));
  const actionSteps: WorkflowStep[] = action.runs.steps;

  function step(id: string): WorkflowStep {
    const result = job.steps.find(candidate => candidate.id === id);
    assert.ok(result, `Missing release step: ${id}`);
    return result;
  }

  test('generates the SBOM and provenance before creating the release', () => {
    const sbom = step('sbom');
    const provenance = step('provenance');
    const release = step('create_release');
    assert.strictEqual(sbom.uses, './.github/actions/sbom');
    assert.ok(sbom.with?.['target-asset']?.toString().endsWith('.vsix'));
    assert.ok(job.steps.indexOf(sbom) < job.steps.indexOf(provenance));
    assert.ok(job.steps.indexOf(provenance) < job.steps.indexOf(release));
    assert.strictEqual(sbom.if, undefined);
    assert.strictEqual(provenance.if, undefined);
  });

  test('requests OIDC and attestation permissions only in the publishing job', () => {
    assert.strictEqual(job.permissions['id-token'], 'write');
    assert.strictEqual(job.permissions.attestations, 'write');
    for (const [name, otherJob] of Object.entries(workflow.jobs)) {
      if (name !== 'publish-vscode-marketplace') {
        const permissions = (otherJob as ReleaseJob).permissions;
        assert.strictEqual(permissions?.attestations, undefined);
      }
    }
  });

  test('attests both release assets and uploads the signed bundle to the workflow run', () => {
    const provenance = step('provenance');
    assert.strictEqual(provenance.uses, 'actions/attest-build-provenance@v4');
    const subjects = String(provenance.with?.['subject-path']).trim().split('\n');
    assert.strictEqual(subjects[0], step('sbom').with?.['target-asset']);
    assert.strictEqual(subjects[1], '${{ steps.sbom.outputs.sbom-path }}');
    const upload = job.steps.find(candidate => candidate.name === 'Attach provenance to workflow run');
    assert.ok(upload);
    assert.strictEqual(upload.uses, 'actions/upload-artifact@v7');
    assert.strictEqual(upload.with?.path, '${{ steps.provenance.outputs.bundle-path }}');
    assert.strictEqual(upload.with?.['if-no-files-found'], 'error');
    assert.ok(job.steps.indexOf(upload) < job.steps.indexOf(step('create_release')));
  });

  test('release assets include the VSIX and appended SBOM but not extension build outputs', () => {
    const pattern = step('create_release').env?.RELEASE_FILES_GLOB;
    assert.ok(pattern);
    const vsix = 'dist/darthminos-workspace-tasks-1.14.4.vsix';
    for (const file of [vsix, `${vsix}.sbom.json`]) {
      assert.ok(micromatch.isMatch(file, pattern), `Release must include ${file}`);
    }
    for (const file of ['dist/extension.js', 'dist/extension.js.map']) {
      assert.ok(!micromatch.isMatch(file, pattern), `Release must not include ${file}`);
    }
  });

  test('scans extracted VSIX contents as SPDX JSON and preserves the entire package filename', () => {
    const extract = actionSteps.find(candidate => candidate.id === 'extract_vsix');
    const generate = actionSteps.find(candidate => candidate.name === 'Generate SBOM');
    assert.ok(extract?.run);
    assert.ok(generate);
    assert.ok(extract.run.includes('exit 1'), 'Missing packages must fail rather than skip generation');
    assert.ok(extract.run.includes('unzip -q "$TARGET_ASSET" -d "$EXTRACT_DIR"'));
    assert.ok(extract.run.includes('sbom_path=${TARGET_ASSET}.sbom.json'));
    assert.ok(extract.run.includes('sbom_name=$(basename "$TARGET_ASSET").sbom.json'));
    assert.strictEqual(generate.with?.format, 'spdx-json');
    assert.strictEqual(generate.with?.path, '${{ steps.extract_vsix.outputs.extract_dir }}');
    assert.strictEqual(generate.with?.['output-file'], '${{ steps.extract_vsix.outputs.sbom_path }}');
    assert.strictEqual(generate.with?.['upload-release-assets'], false);
    assert.strictEqual(action.outputs['sbom-path'].value, '${{ steps.extract_vsix.outputs.sbom_path }}');
    const cleanup = actionSteps.find(candidate => candidate.name === 'Clean extracted VSIX');
    assert.ok(cleanup?.if?.includes('always()'), 'Extracted package cleanup must run on failure');
  });
});
