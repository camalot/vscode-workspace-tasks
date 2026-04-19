# Plan: CircleCI Task Provider (`circleci`)

## TL;DR

Add a new `circleci` task provider that discovers `.circleci/config.{yml,yaml}` files, surfaces both
`workflows` and `jobs` in the task tree, executes jobs locally via the CircleCI CLI, and runs
workflows through internal sequential orchestration (Compound Task style). Because CircleCI CLI local
execution supports only jobs, workflow runs are emulated by executing each workflow job in order.

---

## Inputs Used

### GitHub Issue

- Issue: [#179](https://github.com/camalot/vscode-workspace-tasks/issues/179)
- Title: `[Task Support]: CircleCI Local Run Support`
- Requested by: @camalot
- Key requirements from issue:
  - Task type for CircleCI
  - File pattern: `.circleci/config.{yml,yaml}`
  - Include both `jobs` and `workflows`
  - Use CircleCI local CLI for execution

### CircleCI Documentation

- Source: [How to use the CircleCI local CLI](https://circleci.com/docs/guides/toolkit/how-to-use-the-circleci-local-cli/)
- Key implementation constraints:
  - Local execution command: `circleci local execute -c <config> <job-name>`
  - For many `version: 2.1` configs, recommended flow is:
    1. `circleci config process .circleci/config.yml > process.yml`
    2. `circleci local execute -c process.yml <job-name>`
  - Local CLI does not execute workflows; it runs single jobs only
  - Docker is required for local execution
  - Some online-only behavior differs locally (cache/artifacts/contexts behavior caveats)

---

## Requirements

1. Add a CircleCI task group similar to existing GitHub Actions/GitLab CI groups.
2. Discover CircleCI config files via `GLOB_CIRCLECI` (`**/.circleci/config.{yml,yaml}`).
3. Parse and display both:
   - `workflows` (as hierarchy/grouping nodes)
   - `jobs` (as runnable leaf tasks)
4. Run jobs locally through CircleCI CLI.
5. Run workflows as sequential job pipelines (Compound Task style) using workflow job order.
6. If workflow execution is stopped, do not continue to the next job.
7. Add docs under:
   - `docs/task-types/devops/circleci.md`
   - `docs/configuration/environment` (application path page + index wiring)
8. Add user-facing sample(s) under `sample/sample-workspace-tasks`.
9. Add test fixtures under `src/test/task-files/circleci` (repo convention corresponding to requested `test/task-files`).
10. Include full implementation plan for code, tests, docs, and samples.

---

## Proposed Behavior

### Tree Model

```text
circleci
└── config.yml                         (file node)
   ├── workflow: build-and-test       (runnable, sequential)
    │   ├── job: lint                  (runnable)
    │   └── job: test                  (runnable)
   ├── workflow: deploy               (runnable, sequential)
    │   └── job: publish               (runnable)
    └── jobs (unreferenced)            (optional group)
        └── job: maintenance           (runnable)
```

### Execution Model

- Jobs run with CircleCI CLI in the config file directory.
- Default command shape:
  - `circleci local execute -c <config-file> <job-name>`
- Optional processed-config mode for 2.1 configs:
  - Generate processed YAML first, then run `local execute -c <processed-file>`.
- Workflows run through internal sequential orchestration by resolving the workflow job list from `workflows.<name>.jobs`, executing each job one-at-a-time using normal CircleCI job execution, and halting on failure, launch error, or stop request so remaining jobs are not started.
- Parallel/fan-out workflow semantics are linearized locally in v1.

---

## Design Decisions

### 1) Provider Name and Task Type

- Task type key: `circleci`
- Provider class: `CircleCiTaskProvider`
- File: `src/providers/circleCiTaskProvider.ts`

Rationale: consistent with existing naming (`GitlabCiTaskProvider`, `GithubActionsTaskProvider`) and
short task type IDs used throughout `taskFactory.ts` and settings schemas.

### 2) Discovery Strategy

- Parse YAML config directly (same pattern as GitHub Actions provider using `yaml`).
- Extract:
  - `jobs` map keys
  - `workflows.<workflowName>.jobs` references
- Build workflow group nodes and attach referenced jobs.
- Include **all defined jobs** in a `jobs` grouping section so individual jobs are always directly runnable, regardless of workflow membership.

Rationale: CircleCI CLI does not expose a direct machine-readable job listing equivalent to
`gitlab-ci-local --list-json`.

### 3) Workflow Execution via Sequential Orchestration

- Workflows are shown and runnable.
- A workflow run is translated into a sequential queue of CircleCI job items.
- Execution reuses existing compound-sequence behavior from `TaskRunner.runCompoundTask`: wait for each job to complete, stop sequence on failure/cancel, and never continue after explicit stop.
- Job children remain individually runnable as standalone job runs.

Rationale: aligns with user request to run full workflows locally despite CircleCI CLI limitations,
while reusing proven queue/compound orchestration behavior already implemented in the extension.

### 4) Scoped Workflow Identity

- Workflow orchestration names must be unique per config file and workflow label.
- Use a scoped internal key pattern, for example `circleci@<configPath>::<workflowName>`.

Rationale: avoids collisions for identical workflow names across multiple workspace folders or files.

### 5) CLI Processing Mode

- Add setting to control preprocessing behavior:
  - `workspaceTasks.circleci.configProcessing`: `auto | always | never`
- `auto` default behavior:
  - Attempt direct run first
  - fall back to processed config execution if needed

Rationale: balances correctness for 2.1/orb-heavy configs with performance and simpler configs.

---

## Implementation Plan

### A) Code Changes

1. Create `src/providers/circleCiTaskProvider.ts`.
2. Register provider in `src/providers/index.ts`:
   - import provider
   - extend constructor union
   - include in provider registration array
3. Add task type handling in `src/taskFactory.ts`:
   - include `circleci` in `KNOWN_TASK_TYPES`
   - add `case 'circleci'` execution branch for job-level execution
4. Add workflow orchestration path in `src/taskRunner.ts`:
   - detect CircleCI workflow task items (metadata/type)
   - delegate workflow execution to sequential orchestration
   - ensure stop/failure/cancel prevents starting next workflow job
5. Integrate with `CompoundTaskService` for workflow orchestration tokens/state:
   - create scoped workflow run identifiers
   - mark running/stopped state for workflow runs
   - reuse existing cancellation semantics
6. Add/adjust stop command behavior (`src/commands/stopCompoundTask.ts` and related flow) so stopping a running CircleCI workflow maps to the scoped workflow orchestration and halts progression.
7. Confirm `GLOB_CIRCLECI` usage from `src/libs/constants.ts`.
8. Add settings in `package.json`:
   - `workspaceTasks.enabledTaskTypes.circleci`
   - `workspaceTasks.applicationPath.circleci`
   - `workspaceTasks.circleci.configProcessing`
   - optional extensibility settings:
     - `workspaceTasks.circleci.additionalFilePatterns`
9. Add localization keys to `package.nls.json` for all new settings.
10. Add icon assets for `circleci` task type if needed for parity with devops group icons (`res/icons/light/circleci.svg` and `res/icons/dark/circleci.svg`), plus generated png counterparts if project currently expects them.

### B) Tests

1. Create provider suite: `src/test/suite/circleCiTaskProvider.test.ts`
2. Create task factory suite: `src/test/suite/taskFactoryCircleCi.test.ts`
3. Create workflow orchestration suite (new or extension of task runner tests), covering:
   - workflow item delegates to sequential orchestration path
   - workflow executes jobs in listed order
   - workflow stop prevents subsequent jobs from starting
   - workflow failure prevents subsequent jobs from starting
   - scoped workflow ID generation avoids name collisions across files
4. Add fixtures under `src/test/task-files/circleci/`:
   - `simple-config.yml`
   - `workflow-config.yml`
   - `unassigned-jobs-config.yml`
   - `invalid-config.yml`
   - optional processed-config fixture if preprocessing logic is included
5. Add glob-pattern tests in `src/test/suite/globPatterns.test.ts` for `GLOB_CIRCLECI` (if missing coverage gaps exist).
6. Add/adjust task type item tests in `src/test/suite/taskTypeItems.test.ts` if a dedicated task-type item is introduced.
7. Run `npm test`.

### C) Documentation

1. Create `docs/task-types/devops/circleci.md` with:
   - overview
   - requirements (CircleCI CLI + Docker)
   - task tree examples for workflows/jobs
   - execution behavior for both job runs and workflow sequential runs
   - stop behavior: stop current job and prevent next jobs
   - fidelity note: workflow fan-out is linearized locally
   - configuration table and examples
   - troubleshooting section
2. Create `docs/configuration/environment/application-paths/circleci.md`.
3. Update `docs/configuration/environment/application-paths/index.md` to include CircleCI subpage.
4. Update `docs/task-types/devops/index.md`:
   - include CircleCI in table
   - include icon reference if used
5. Update `README.md` task type summary to include CircleCI support.

### D) Samples

1. Add user sample config at `sample/sample-workspace-tasks/.circleci/config.yml`.
2. Ensure sample demonstrates:
   - at least 2 jobs
   - at least 1 workflow referencing jobs
   - a job not in a workflow (optional edge-case coverage)
3. Add short usage notes in `sample/README.md` if needed.

---

## Test Matrix

1. Discovery:
   - valid config with jobs/workflows
   - valid config with only jobs
   - invalid YAML
   - empty jobs
2. Tree construction:
   - workflow nodes created and runnable
   - job nodes runnable with metadata
   - unreferenced jobs still displayed
3. Execution:
   - command contains `local execute`
   - command uses correct `-c` config path
   - cwd resolves to config directory
   - additional args appended correctly
   - running a workflow triggers sequential job execution in configured order
   - stopping a workflow prevents starting the next job
   - failed workflow job prevents starting the next job
   - processing mode behavior (`auto|always|never`) if implemented
4. Config:
   - `enabledTaskTypes.circleci`
   - `applicationPath.circleci`
   - `circleci.configProcessing`

---

## Risks and Mitigations

1. Workflow fidelity mismatch vs CircleCI cloud semantics:
   - Mitigation: document that workflow runs are local sequential emulation; parallel/fan-out is linearized in v1.
2. Workflow stop/race conditions in multi-root or duplicate names:
   - Mitigation: scoped workflow identifiers (`circleci@<configPath>::<workflowName>`) and targeted stop mapping.
3. 2.1/orb config execution issues:
   - Mitigation: processing mode setting and troubleshooting docs.
4. Local CLI dependency failures:
   - Mitigation: clear error messages and application-path setting docs.
5. Docker requirement confusion:
   - Mitigation: requirement callouts in task-type doc and README.

---

## Rubber Duck Review (Sub-Agent Critique) and Plan Adjustments

The implementation was critiqued with the Explore sub-agent. The following adjustments were made to
this plan after critique:

1. Changed workflow behavior to runnable sequential orchestration:
   - Workflows now run as ordered job chains (Compound Task style).
   - Jobs remain runnable directly through CircleCI local CLI.
2. Added explicit discovery approach:
   - Parse YAML directly because CircleCI CLI lacks a `--list-json` equivalent.
3. Added config preprocessing strategy:
   - Introduced `configProcessing` behavior (`auto|always|never`) to handle 2.1/orb scenarios.
4. Added scoped workflow identity to avoid collisions:
   - Workflows are keyed by config path + workflow name for run/stop correctness.
5. Added task runner integration requirement:
   - Workflow items delegate to sequential orchestration path, not direct shell task execution.
6. Added stronger docs/testing scope for workflow emulation:
   - stop-on-cancel, stop-on-failure, and sequential/fan-out fidelity notes are required test/doc points.

---

## Final Deliverables

1. New CircleCI provider code and registration.
2. CircleCI job execution branch in task factory.
3. CircleCI workflow sequential orchestration path integrated with task runner/compound semantics.
4. Settings schema + localization entries.
5. Test suites + fixtures (including workflow sequence/stop behavior).
6. DevOps task-type documentation + environment application path documentation.
7. User sample config and docs index updates.
