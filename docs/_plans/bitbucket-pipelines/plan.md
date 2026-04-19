# Plan: Bitbucket Pipelines Task Provider

## TL;DR

Add `bitbucket` as a new task type backed by [`pipeline-runner`](https://github.com/mathieu-lemay/pipeline-runner),
which runs Bitbucket Pipelines locally using Docker. The extension discovers
`bitbucket-pipelines.yml` files in the workspace (typically at the repository root), parses each file's
YAML directly to extract pipelines and steps, and surfaces the tree hierarchy as:

```tree
workspace/
└── bitbucket/                    ← type-level group, not runnable
    └── bitbucket-pipelines.yml   ← file parent, not runnable
        ├── default               ← pipeline item, runnable
        │   └── Build and Test    ← step item (no stage), runnable
        ├── branches.master       ← pipeline item, runnable
        │   └── Deploy            ← stage item, runnable
        │       ├── Security Scan         ← step item, runnable
        │       └── Deploy to Production  ← step item, runnable
        └── custom.manual-deployment  ← pipeline item, runnable
            └── Custom Manual Step    ← step item (no stage), runnable
```

Pipelines with a mix of top-level steps and stages show both as direct children of the pipeline:

```tree
default
├── Build and Test    ← direct step (no stage), runnable via --step
└── Release Stage     ← stage item, runnable via --stage
    ├── Package       ← step inside stage, runnable via --step
    └── Publish       ← step inside stage, runnable via --step
```

Running a **pipeline** executes `pipeline-runner run <pipeline-path>` (e.g. `branches.master`).
Running a **stage** executes `pipeline-runner run --stage "<Stage Name>" <pipeline-path>`.
---

## Self-Critique & Viability Assessment (post-review)

A sub-agent critiqued the solution. Below are all findings with resolutions.

**Strengths confirmed by review:**

- Direct YAML parsing is the correct approach since `pipeline-runner` has no `--list` machine-readable
  output (unlike `gitlab-ci-local --list-json`). This is consistent with how `circleCiTaskProvider`
  works.
- The three-level tree hierarchy (file → pipeline → step) maps naturally onto the Bitbucket
  YAML structure.
- Using `vscode.workspace.asRelativePath(fileUri)` as `description` for file items disambiguates
  multi-root workspaces cleanly.
- Config namespace (`applicationPath.bitbucketPipelineRunner` vs `bitbucketPipelineRunner.*`) is
  consistent with the pattern used by all other CI providers.

**Issues accepted and incorporated into this plan:**

1. **[Critical] Glob pattern corrected**: The `bitbucket-pipelines.yml` file lives at the
   **repository root** in most projects, not inside `.bitbucket/`. The sample workspace happens to
   place it inside `.bitbucket/` to mirror a less-common project layout, but the primary glob must
   be `**/bitbucket-pipelines.yml`. The `.bitbucket/` directory is for PR templates, not the
   pipeline file. Glob updated to:
   ```
   GLOB_BITBUCKET_PIPELINES: '**/bitbucket-pipelines.yml'
   ```
   Users can use `additionalFilePatterns` to add `.bitbucket/bitbucket-pipelines.yml` if needed.
   The sample's file location will be moved to the workspace root.

2. **[Critical] `--env-file` argument order fixed**: `--env-file` is a `run` subcommand flag. The
   factory must push `'run'` first, then env-file flags, then the pipeline path. The correct order:
   ```
   pipeline-runner run --env-file f1 --env-file f2 [--step "X"] <pipeline-path>
   ```

3. **[Critical] `KNOWN_TASK_TYPES` + `src/providers/index.ts` added to implementation steps**:
   Both were omitted from the original checklist.

4. **[High] `cwd` corrected to workspace folder root**: `pipeline-runner` must run from the
   project root (where `.git` is), not from the YAML file's directory. The factory will use
   `vscode.workspace.getWorkspaceFolder(item.taskFileUri)?.uri.fsPath` (falling back to
   `path.dirname`) as the `cwd`, consistent with the CircleCI provider pattern.

5. **[High] Unnamed steps are non-runnable**: Steps without a `name:` field cannot be targeted by
   `--step` since the CLI matches on the literal name. Unnamed steps are assigned a generated label
   (`Step <index>`) for display only and have no `onRunActionCommand` set — they will appear in the
   tree but cannot be executed individually.

6. **[High] Both parallel block shapes handled**: Bitbucket supports two YAML shapes for
   `parallel:` — an object with a `steps:` array and a direct array. The parser will detect both.

7. **[High] `meta.stepName as string` / `meta.pipelinePath as string` — explicit type guards
   added**: The factory will guard with `typeof meta.pipelinePath !== 'string'` before use.

8. **[High] `step: meta.stepName` in task definition**: For pipeline-level items `meta.stepName`
   is `undefined`. The task definition will conditionally include `step` only when defined:
   `{ type: 'bitbucket', pipeline: meta.pipelinePath, ...(meta.stepName ? { step: meta.stepName } : {}) }`.

9. **[High] `getSystemTasks()` added to implementation**: Must return `[]`.

10. **[High] `null` guard on `pipelines:` object**: A `typeof`/`!== null` guard is added before
    iterating pipeline sections.

11. **[Medium] Display string quoting**: The human-readable command string in the status bar will
    quote arguments containing spaces (e.g., `--step "Build and Test"`), matching the
    `github-actions` pattern.

12. **[Medium] Duplicate step names**: If two steps within the same pipeline share a name, only
    the first is marked runnable; subsequent duplicates get an index suffix appended
    (`Step Name (2)`) and are still runnable (since `pipeline-runner` will run the first match).
    This is documented in tooltips.

13. **[High] 100% coverage requirement added explicitly**, and glob pattern tests in
    `src/test/suite/globPatterns.test.ts` are added to the plan.

14. **[High] `package.json` `contributes.taskDefinitions` added to implementation checklist**.

15. **[High] File watcher**: The extension's existing watcher infrastructure watches all provider
    globs registered at startup. Adding `GLOB_BITBUCKET_PIPELINES` to `constants.ts` and
    registering the provider in `index.ts` is sufficient — no additional watcher code needed.

16. **[Medium] `getCommand()` URI parameter**: The provider's `getCommand()` receives
    `item.taskFileUri` (the YAML file). `ExecutableService.getCommand()` uses this to resolve
    workspace-relative configured paths. Passing the file URI is correct — it matches how
    `gitlabCiTaskProvider.ts` passes the file URI to its own `getCommand()`.

17. **[Medium] `environmentFiles` path resolution**: Documented as workspace-root-relative paths.
    If a relative path is given, `pipeline-runner` resolves it from `cwd` (the workspace root),
    which is correct.

**Issues rejected with reasoning:**

- **Critique: use `yaml.parseDocument()` with `keepSourceTokens` for ordering**: Standard
  `yaml.parse()` preserves YAML document key insertion order in the `yaml` package (v2+). The
  existing CircleCI and GitLab providers both use `yaml.parse()` without this option and exhibit
  stable ordering. Switching to `parseDocument()` adds complexity without meaningful benefit.

- **Critique: show placeholder node for parse failures**: Returning `undefined` and omitting the
  file from the tree (existing pattern) is simpler and avoids displaying a permanently broken node.
  A warning is logged. This is consistent with all other YAML-parsing providers in the codebase.

- **Critique: expand file node when only one file exists**: This would require custom state logic
  not present in any other provider. Out of scope for this implementation.

---

## Requirements

- Discover `bitbucket-pipelines.yml` within `.bitbucket/` directories in the workspace.
- Also allow additional glob patterns via `workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns`.
- Parse the YAML directly (no CLI invocation for listing) to extract pipelines and steps.
- Support all top-level pipeline sections: `default`, `branches`, `pull-requests`, `tags`, `custom`.
- Handle `parallel:` blocks by flattening individual steps directly under the pipeline (with `[parallel]` tooltip note).
- Handle `stage:` blocks by surfacing each stage as its own collapsible, runnable tree node.
- Surface a tree of up to four levels: file → pipeline → stage (when present) → step.
- Pipelines are runnable: `pipeline-runner run <pipeline-path>`.
- Stages are runnable: `pipeline-runner run --stage "<stage-name>" <pipeline-path>`.
- Steps are runnable: `pipeline-runner run --step "<step-name>" <pipeline-path>`.
- Document clearly that running a pipeline or stage does **not** cause the VS Code task UI to update
  for individual sub-steps — execution is managed entirely by `pipeline-runner` inside Docker.
- Provide `workspaceTasks.applicationPath.bitbucketPipelineRunner` (default: `pipeline-runner`).
- Provide `workspaceTasks.bitbucketPipelineRunner.environmentFiles` (array of `--env-file` values).
- Enable the type **disabled by default** — requires Docker and `pipeline-runner` to be installed.
- Add `'bitbucket'` to `KNOWN_TASK_TYPES` in `taskFactory.ts`.
- Add `'bitbucket'` entry in the `enabledTaskTypes` schema in `package.json`.
- Provide full documentation in `docs/task-types/bitbucket-pipelines.md`.
- Provide application-path documentation in `docs/configuration/environment/application-paths/bitbucket-pipeline-runner.md`.
- Add a sample `bitbucket-pipelines.yml` — already present at `sample/sample-workspace-tasks/.bitbucket/bitbucket-pipelines.yml`.
- Achieve 100% test coverage for all new code.

---

## Key Design Decisions

### YAML Parsing (No CLI for Discovery)

`pipeline-runner` has no machine-readable list output. The YAML file is parsed directly using the
existing `yaml` package (already used by `circleCiTaskProvider`). This is the same strategy as the
CircleCI provider.

### Pipeline Path Encoding

Bitbucket pipeline paths follow the pattern used by `pipeline-runner run`:

| Section | Example path |
|---------|--------------|
| `default` | `default` |
| `branches.master` | `branches.master` |
| `pull-requests.*` | `pull-requests.*` |
| `tags.v*` | `tags.v*` |
| `custom.my-pipeline` | `custom.my-pipeline` |

### Step Identification

Step names come from the `name:` field of a `step:` block. If a step has no `name:`, it is given a
generated display label like `Step <index>` and is marked **non-runnable** — no `onRunActionCommand`
is set — because `pipeline-runner --step` matches on the literal `name:` field, which is absent.
A tooltip explains why the step cannot be run individually.

### Parallel and Stage Handling

Bitbucket supports **two YAML shapes** for `parallel:` blocks that must both be handled:

```yaml
# Form 1 (direct array — newer)
- parallel:
    - step: { name: Lint }
    - step: { name: Test }

# Form 2 (object with steps key — older)
- parallel:
    steps:
      - step: { name: Lint }
      - step: { name: Test }

# Stage block example
- stage:
    name: Build Stage
    steps:
      - step: { name: Compile }
      - step: { name: Package }
```

**Parallel blocks** are flattened: each contained `step:` becomes a direct child of its pipeline
item. Tooltip notes `[parallel]`.

**Stage blocks** are **not** flattened. Each `stage:` becomes a collapsible, runnable `TaskItem`
at the pipeline level; the steps inside the stage become children of that stage item.

Entry type discriminated via type guards:
- Has `step` key → step entry → create step `TaskItem` as child of pipeline (or stage)
- Has `parallel` key → parallel entry (check if value is array or has `steps` key) → flatten steps under pipeline
- Has `stage` key → stage entry → create stage `TaskItem` as child of pipeline; its steps as children of the stage
- Otherwise → unknown key, skip with warning log

### Glob Pattern

```
GLOB_BITBUCKET_PIPELINES: '**/bitbucket-pipelines.yml'
```

The file is placed at the repository root in virtually all real-world projects. The `.bitbucket/`
directory contains PR templates and other Bitbucket metadata — not the pipeline configuration.
Users can add `**/.bitbucket/bitbucket-pipelines.yml` via `additionalFilePatterns` if their
project layout differs.

### Tree Item Construction

| Level | Label | Description | Runnable? | Collapsible? |
|-------|-------|-------------|-----------|--------------|
| File | `bitbucket-pipelines.yml` | relative path of file | No | Collapsed |
| Pipeline | `default`, `branches.master`, etc. | child count | Yes | Collapsed |
| Stage | stage name | step count | Yes | Collapsed |
| Step | step name | `[parallel]` or empty | Yes | None |

Stage items only appear when the pipeline YAML contains a `stage:` block. Pipelines with only
`step:` entries (and no stages) have steps as direct children — the tree depth is then three
levels (file → pipeline → step) rather than four.

### Execution Commands

**Run a full pipeline:**
```
pipeline-runner run [--env-file <f>]... <pipeline-path>
```

**Run a single stage within a pipeline:**
```
pipeline-runner run [--env-file <f>]... --stage "<stage-name>" <pipeline-path>
```

**Run a single step within a pipeline:**
```
pipeline-runner run [--env-file <f>]... --step "<step-name>" <pipeline-path>
```

Argument order in the factory is:
1. `run` subcommand
2. `--env-file` flags (scoped to `run` subcommand)
3. `--stage <name>` (for stage-level runs only) **or** `--step <name>` (for step-level runs only)
4. `<pipeline-path>`

> **Important**: `pipeline-runner` manages its own execution loop internally inside Docker.
> Running a pipeline, stage, or step via this extension will **not** cause the VS Code task UI
> to update for each sub-step as they execute. There is no compound-task behaviour — the entire
> `pipeline-runner` invocation is a single VS Code task. This is documented prominently in
> `docs/task-types/bitbucket-pipelines.md`.

The `cwd` is the **workspace folder root** (via `vscode.workspace.getWorkspaceFolder(item.taskFileUri)?.uri.fsPath`),
not the YAML file's directory. `pipeline-runner` requires the Git repository root as its working
directory to correctly locate source files and `.git`. Falls back to `path.dirname(taskFileUri.fsPath)`
when no workspace folder is found.

The human-readable command string quotes arguments containing spaces
(e.g., `--step "Build and Test"`) using the same pattern as the GitHub Actions factory.

---

## Configuration Settings

All settings have `"scope": "resource"` where applicable.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `workspaceTasks.applicationPath.bitbucketPipelineRunner` | `string` | `"pipeline-runner"` | Path to the `pipeline-runner` executable |
| `workspaceTasks.bitbucketPipelineRunner.environmentFiles` | `string[]` | `[]` | List of env files to pass via `--env-file` on each execution |
| `workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns` | `string[]` | `[]` | Additional glob patterns merged with `GLOB_BITBUCKET_PIPELINES` for file discovery |

---

## Files to Modify / Create

| File | Action | Description |
|------|--------|-------------|
| `src/providers/bitbucketPipelinesTaskProvider.ts` | **Create** | New provider class (includes `getSystemTasks()` returning `[]`) |
| `src/providers/index.ts` | **Modify** | Import, add to `TaskProviderConstructor` union, register |
| `src/taskFactory.ts` | **Modify** | Add `'bitbucket'` to `KNOWN_TASK_TYPES`; add switch case |
| `src/libs/constants.ts` | **Modify** | Add `GLOB_BITBUCKET_PIPELINES` |
| `package.json` | **Modify** | `contributes.configuration`, `contributes.taskDefinitions`, `enabledTaskTypes` schema + default, `keywords` |
| `package.nls.json` | **Modify** | NLS strings for all new config keys |
| `src/test/suite/bitbucketPipelinesTaskProvider.test.ts` | **Create** | Provider unit tests (100% coverage) |
| `src/test/suite/taskFactoryBitbucket.test.ts` | **Create** | Task factory integration tests |
| `src/test/suite/globPatterns.test.ts` | **Modify** | Add `GLOB_BITBUCKET_PIPELINES` test cases |
| `src/test/task-files/bitbucket/` | **Create** | YAML fixture files for unit tests |
| `res/icons/light/bitbucket.svg` | **Create** | Light theme icon |
| `res/icons/dark/bitbucket.svg` | **Create** | Dark theme icon |
| `res/icons/light/bitbucket.png` | **Create** | Light PNG (generated via `scripts/svg-convert.ps1`) |
| `res/icons/dark/bitbucket.png` | **Create** | Dark PNG |
| `docs/task-types/bitbucket-pipelines.md` | **Create** | User-facing documentation |
| `docs/configuration/environment/application-paths/bitbucket-pipeline-runner.md` | **Create** | App-path config docs |
| `sample/sample-workspace-tasks/bitbucket-pipelines.yml` | **Create** | Sample file at workspace root (all pipeline sections) |
| `sample/sample-workspace-tasks/.bitbucket/bitbucket-pipelines.yml` | **Keep** | Existing file; serves as example of the alternate location pattern |
| `README.md` | **Modify** | Add Bitbucket Pipelines to supported task types list |

---

## Provider Implementation

### Interface Definitions

```typescript
interface BitbucketStep {
  name?: string;
  script?: string[];
  caches?: string[];
  [key: string]: unknown;
}

interface BitbucketParallel {
  parallel: Array<{ step: BitbucketStep }> | { steps: Array<{ step: BitbucketStep }> };
}

interface BitbucketStage {
  stage: {
    name?: string;
    steps: Array<{ step: BitbucketStep }>;
  };
}

type BitbucketPipelineEntry = { step: BitbucketStep } | BitbucketParallel | BitbucketStage;

interface BitbucketPipelinesConfig {
  image?: string | { name: string };
  pipelines?: {
    default?: BitbucketPipelineEntry[];
    branches?: Record<string, BitbucketPipelineEntry[]>;
    'pull-requests'?: Record<string, BitbucketPipelineEntry[]>;
    tags?: Record<string, BitbucketPipelineEntry[]>;
    custom?: Record<string, BitbucketPipelineEntry[]>;
  };
}
```

### Class Structure

```typescript
export class BitbucketPipelinesTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('bitbucket', constants.GLOB_BITBUCKET_PIPELINES);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    // configKey: 'applicationPath.bitbucketPipelineRunner'
    // defaultValue: 'pipeline-runner'
    // NO windowsExecutableExtension — not a Windows-native tool
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) { return []; }
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const extraPatterns = config.get<string[]>('bitbucketPipelineRunner.additionalFilePatterns', []);
    const globs = [constants.GLOB_BITBUCKET_PIPELINES, ...extraPatterns];
    const files = await TaskFilesService.getInstance().findFiles(globs);
    const results = await Promise.all(files.map(f => this.parseFile(f)));
    return results.filter((r): r is TaskItem => r !== undefined);
  }

  /**
   * Reads and parses a single bitbucket-pipelines.yml file.
   * Extracted as public for direct unit testing without file I/O.
   */
  public async parseFile(fileUri: vscode.Uri, iconService?: TaskIconService): Promise<TaskItem | undefined> {
    let text: string;
    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      text = Buffer.from(content).toString('utf8');
    } catch (err: unknown) {
      LoggerService.getInstance().warn(`[bitbucket] Failed to read ${fileUri.fsPath}: ...`);
      return undefined;
    }
    return this.parseConfig(fileUri, text, iconService);
  }

  /**
   * Parses YAML text into a TaskItem tree.
   * Public for unit testing with raw YAML strings.
   */
  public parseConfig(fileUri: vscode.Uri, text: string, iconService?: TaskIconService): TaskItem | undefined {
    // ... parse YAML, build tree
  }
}
```

### `parseConfig` Logic

1. Parse YAML using `yaml.parse(text)`.
2. Guard: if `config.pipelines` is not a non-null object, return `undefined`.
3. Create a **file-level** `TaskItem` (collapsible, not runnable, label = `bitbucket-pipelines.yml`).
4. For each pipeline section (`default`, `branches`, `pull-requests`, `tags`, `custom`):
   - For `default`: one pipeline item with path `default`.
   - For `branches`, `pull-requests`, `tags`, `custom`: iterate over keys, pipeline path = `<section>.<key>`.
5. For each pipeline: create a **pipeline-level** `TaskItem` (collapsible, runnable).
   - `metadata`: `{ type: 'pipeline', pipelinePath: string }`
6. Iterate the pipeline's entry list:
   - Entry has `step` key → create a **step-level** `TaskItem` as a direct child of the pipeline.
     - `metadata`: `{ type: 'step', pipelinePath: string, stepName: string }`
   - Entry has `parallel` key → determine shape (array vs `{ steps: [...] }`), flatten each
     contained `step:` as a direct child of the pipeline with `[parallel]` in tooltip.
     - `metadata`: `{ type: 'step', pipelinePath: string, stepName: string, parallel: true }`
   - Entry has `stage` key → create a **stage-level** `TaskItem` as a child of the pipeline.
     - `metadata`: `{ type: 'stage', pipelinePath: string, stageName: string }`
     - Each `step:` inside the stage becomes a **step-level** `TaskItem` as a child of the stage.
       - `metadata`: `{ type: 'step', pipelinePath: string, stepName: string, stageName: string }`
7. Unnamed stages get generated label `Stage <index>` and are still runnable (the CLI can match
   a stage without a name if it is the only one; document this as best-effort).
8. Unnamed steps get generated display label `Step <index>` and are **non-runnable** (no
   `onRunActionCommand`).

### Factory Case (`src/taskFactory.ts`)

```typescript
case 'bitbucket': {
  if (!item.taskFileUri) {
    return undefined;
  }

  const bbProvider = new BitbucketPipelinesTaskProvider();
  const { command: bbCmd, args: providerArgs } = bbProvider.getCommand(item.taskFileUri);
  const bbArgs = [...(providerArgs ?? [])];

  bbArgs.push('run');

  const bbConfig = vscode.workspace.getConfiguration('workspaceTasks');
  const envFiles = bbConfig.get<string[]>('bitbucketPipelineRunner.environmentFiles', []);
  for (const ef of envFiles) {
    bbArgs.push('--env-file', ef);
  }

  const meta = item.metadata;
  if (meta?.type === 'step') {
    if (typeof meta.stepName !== 'string' || typeof meta.pipelinePath !== 'string') {
      return undefined;
    }
    bbArgs.push('--step', meta.stepName);
    bbArgs.push(meta.pipelinePath);
  } else if (meta?.type === 'stage') {
    if (typeof meta.stageName !== 'string' || typeof meta.pipelinePath !== 'string') {
      return undefined;
    }
    bbArgs.push('--stage', meta.stageName);
    bbArgs.push(meta.pipelinePath);
  } else if (meta?.type === 'pipeline') {
    if (typeof meta.pipelinePath !== 'string') {
      return undefined;
    }
    bbArgs.push(meta.pipelinePath);
  } else {
    // File-level or unknown type — not runnable
    return undefined;
  }

  if (args) {
    bbArgs.push(...args.split(' '));
  }

  const bbWorkspaceFolder = vscode.workspace.getWorkspaceFolder(item.taskFileUri);
  const bbCwd = bbWorkspaceFolder?.uri.fsPath ?? path.dirname(item.taskFileUri.fsPath);
  const shellExec = new vscode.ShellExecution(bbCmd, bbArgs, { cwd: bbCwd });
  const full = `${bbCmd} ${bbArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;

  const taskDef: { type: string; pipeline: string; stage?: string; step?: string } = {
    type: 'bitbucket',
    pipeline: meta.pipelinePath as string,
  };
  if (meta?.type === 'stage') {
    taskDef.stage = meta.stageName as string;
  } else if (meta?.type === 'step') {
    taskDef.step = meta.stepName as string;
  }

  const task = new vscode.Task(
    taskDef,
    vscode.TaskScope.Workspace,
    taskLabel,
    'bitbucket',
    shellExec,
  );
  return { task, command: full, cwd: bbCwd, native: false };
}
```

---

## Test Plan

All new files must achieve **100% code coverage**. Run `npm run vscode:test:coverage` to verify.

### Unit Tests: `src/test/suite/bitbucketPipelinesTaskProvider.test.ts`

**Fixture files** (`src/test/task-files/bitbucket/`):
- `full-pipelines.yml` — all section types: `default`, `branches`, `pull-requests`, `tags`, `custom`
- `parallel-steps-array.yml` — pipeline with `parallel:` as a direct array (Form 1)
- `parallel-steps-object.yml` — pipeline with `parallel:` as an object with `steps:` key (Form 2)
- `stage-blocks.yml` — pipeline with `stage:` blocks (named stages with named steps)
- `mixed-pipeline.yml` — pipeline with both direct steps and a stage block
- `no-pipelines.yml` — YAML with no `pipelines:` key
- `null-pipelines.yml` — YAML with `pipelines: null`
- `invalid.yml` — not valid YAML (triggers parse error)
- `unnamed-steps.yml` — steps without `name:` fields (non-runnable)
- `unnamed-stages.yml` — stage without a `name:` field (runnable with generated label)
- `branch-with-dots.yml` — branch name `release.1.0` to verify path encoding
- `empty-pipeline-section.yml` — a pipeline key mapping to an empty array `[]`
- `duplicate-step-names.yml` — two steps with the same name within one pipeline

**Test cases:**
- `getTasks()` returns empty when provider is disabled
- `getTasks()` merges `additionalFilePatterns` with base glob
- `parseConfig()` with `full-pipelines.yml` produces correct tree with all section types
- `parseConfig()` correctly encodes pipeline paths (`default`, `branches.master`, `custom.foo`, `pull-requests.*`, `tags.v*`)
- `parseConfig()` flattens `parallel:` array-form steps as direct pipeline children with `[parallel]` tooltip
- `parseConfig()` flattens `parallel:` object-form steps as direct pipeline children with `[parallel]` tooltip
- `parseConfig()` with `stage-blocks.yml`: stage appears as collapsible child of pipeline; steps appear as children of stage
- `parseConfig()` with `mixed-pipeline.yml`: direct steps and stage node coexist as siblings under pipeline
- `parseConfig()` sets `metadata.type = 'stage'`, `metadata.pipelinePath`, `metadata.stageName` on stage items
- `parseConfig()` sets `metadata.type = 'step'`, `metadata.pipelinePath`, `metadata.stepName` on step items (inside stages and direct)
- `parseConfig()` stage items have `onRunActionCommand` set
- `parseConfig()` with `no-pipelines.yml` returns `undefined`
- `parseConfig()` with `null-pipelines.yml` returns `undefined` without throwing
- `parseConfig()` with `invalid.yml` returns `undefined` and logs warning
- `parseConfig()` with `unnamed-steps.yml`: unnamed steps shown with generated label, NOT runnable (no `onRunActionCommand`)
- `parseConfig()` with `unnamed-stages.yml`: unnamed stage shown with generated label, IS runnable
- `parseConfig()` with `branch-with-dots.yml` produces path `branches.release.1.0`
- `parseConfig()` with `empty-pipeline-section.yml` returns no children for that pipeline
- `parseConfig()` with `duplicate-step-names.yml` handles duplicates
- `parseConfig()` file-level item has no `onRunActionCommand`
- `parseConfig()` sets `metadata.type = 'pipeline'` on pipeline items
- `getCommand()` returns correct command from config
- `getCommand()` uses default `pipeline-runner` when config is not set
- `getSystemTasks()` returns empty array

### Glob Pattern Tests: `src/test/suite/globPatterns.test.ts`

Add test cases for `GLOB_BITBUCKET_PIPELINES`:
- Matches `bitbucket-pipelines.yml` at workspace root
- Matches `myapp/bitbucket-pipelines.yml` (nested project)
- Does NOT match `bitbucket-pipelines.yaml` (wrong extension — Bitbucket only supports `.yml`)
- Does NOT match `my-bitbucket-pipelines.yml` (wrong filename)

### Integration Tests: `src/test/suite/taskFactoryBitbucket.test.ts`

**Test cases:**
- Factory builds correct `ShellExecution` for a pipeline item (`run <path>`, no `--step` or `--stage`)
- Factory builds correct `ShellExecution` for a stage item (`run --stage "name" <path>`)
- Factory builds correct `ShellExecution` for a step item (`run --step "name" <path>`)
- Factory places `run` before `--env-file` flags (argument order regression test)
- Factory appends `--env-file` for each entry in `bitbucketPipelineRunner.environmentFiles`
- Factory returns `undefined` for a file-level item (`metadata.type` is not `pipeline`, `stage`, or `step`)
- Factory returns `undefined` when `item.taskFileUri` is unset
- Factory returns `undefined` when `meta.pipelinePath` is not a string
- Factory returns `undefined` when `meta.stageName` is not a string (for stage items)
- Factory returns `undefined` when `meta.stepName` is not a string (for step items)
- Factory command includes extra `args` when provided
- Factory uses workspace folder root as `cwd` (not YAML directory)
- Factory quotes stage/step names with spaces in the human-readable command string
- Task definition includes `stage` key for stage items, `step` key for step items, neither for pipeline items

---

## Documentation

### `docs/task-types/bitbucket-pipelines.md`

Covers:
- Overview: what Bitbucket Pipelines is; why `pipeline-runner` is used
- Prerequisites: `pipeline-runner` install (`pipx install bitbucket-pipeline-runner`), Docker required at runtime
- Enabling the task type in VS Code settings
- Tree structure walkthrough with screenshot placeholder (showing file → pipeline → stage → step hierarchy)
- Running a pipeline vs running a stage vs running a step
- **Prominent note: task UI opacity** — when a pipeline, stage, or step is run, `pipeline-runner`
  manages execution entirely inside Docker. The VS Code task panel shows only a single running task
  for the entire `pipeline-runner` invocation. Individual steps do **not** appear as separate VS Code
  tasks and do not update the task status UI independently. This is fundamentally different from VS
  Code compound tasks (which queue individual tasks in the panel). Users should monitor output in
  the terminal panel for step-level progress.
- Configuration reference (all settings)
- Limitations (parallel steps run sequentially in `pipeline-runner`, Windows not natively supported, task UI opacity)
- Link to `pipeline-runner` GitHub

### `docs/configuration/environment/application-paths/bitbucket-pipeline-runner.md`

Covers:
- What `workspaceTasks.applicationPath.bitbucketPipelineRunner` controls
- Default value and how to override
- Install instructions

---

## Sample

The existing `sample/sample-workspace-tasks/.bitbucket/bitbucket-pipelines.yml` demonstrates the
alternate `.bitbucket/` directory layout. A new `sample/sample-workspace-tasks/bitbucket-pipelines.yml`
will be added at the workspace root as the canonical example, covering:
- `default` pipeline with one direct step (Build and Test)
- `branches.master` pipeline with a named stage (`Deploy`) containing two steps (Security Scan, Deploy to Production)
- `custom.manual-deployment` pipeline with one direct step (Custom Manual Step)

This sample exercises both direct-step and stage-containing pipelines to showcase the 3- and 4-level tree.

---

## NLS Strings Required (`package.nls.json`)

| Key | Value |
|-----|-------|
| `config.workspaceTasks.applicationPath.bitbucketPipelineRunner` | `Path to the pipeline-runner executable` |
| `config.workspaceTasks.applicationPath.bitbucketPipelineRunner.markdown` | `Path to the [\`pipeline-runner\`](https://github.com/mathieu-lemay/pipeline-runner) executable used to run Bitbucket Pipelines locally.` |
| `config.workspaceTasks.bitbucketPipelineRunner.environmentFiles` | `Bitbucket Pipeline Runner env files` |
| `config.workspaceTasks.bitbucketPipelineRunner.environmentFiles.markdown` | `List of environment variable files passed via \`--env-file\` to \`pipeline-runner\` on each invocation. See [Bitbucket Pipelines](../task-types/bitbucket-pipelines) documentation for details.` |
| `config.workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns` | `Additional file patterns for Bitbucket Pipelines discovery` |
| `config.workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns.markdown` | `Additional glob patterns merged with the default \`**/bitbucket-pipelines.yml\` pattern when discovering pipeline files.` |

---

## `package.json` Changes Summary

### `enabledTaskTypes` schema — add `"bitbucket"` entry (disabled by default):
```json
{ "const": "bitbucket", "description": "Bitbucket Pipelines (pipeline-runner)" }
```
Default value for `enabledTaskTypes` does **not** include `"bitbucket"` (opt-in required).

### New configuration group entry (in `Environment` section):
```json
"workspaceTasks.applicationPath.bitbucketPipelineRunner": {
  "type": "string",
  "default": "pipeline-runner",
  "description": "%config.workspaceTasks.applicationPath.bitbucketPipelineRunner%",
  "markdownDescription": "%config.workspaceTasks.applicationPath.bitbucketPipelineRunner.markdown%"
},
"workspaceTasks.bitbucketPipelineRunner.environmentFiles": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "%config.workspaceTasks.bitbucketPipelineRunner.environmentFiles%",
  "markdownDescription": "%config.workspaceTasks.bitbucketPipelineRunner.environmentFiles.markdown%",
  "scope": "resource"
},
"workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "markdownDescription": "%config.workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns.markdown%",
  "scope": "resource"
}
```

---

## Implementation Order

1. Add `GLOB_BITBUCKET_PIPELINES` constant to `src/libs/constants.ts`
2. Create `src/providers/bitbucketPipelinesTaskProvider.ts`
3. Register provider in `src/providers/index.ts`
4. Add `'bitbucket'` to `KNOWN_TASK_TYPES` and factory case in `src/taskFactory.ts`
5. Update `package.json` (configuration, enabledTaskTypes schema)
6. Update `package.nls.json`
7. Add icons (`res/icons/light/bitbucket.svg`, `res/icons/dark/bitbucket.svg`, PNGs)
8. Write unit tests (`bitbucketPipelinesTaskProvider.test.ts`)
9. Write factory integration tests (`taskFactoryBitbucket.test.ts`)
10. Add fixture YAML files (`src/test/task-files/bitbucket/`)
11. Write documentation (`docs/task-types/bitbucket-pipelines.md`)
12. Write app-path docs (`docs/configuration/environment/application-paths/bitbucket-pipeline-runner.md`)
13. Update `README.md`
14. Run `npm test` and verify 100% coverage for new files
