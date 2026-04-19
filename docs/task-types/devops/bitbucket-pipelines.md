---
layout: default
title: 🪣 Bitbucket Pipelines
parent: 🚦 DevOps & Containers
nav_order: 4
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Bitbucket Pipelines
{: .no_toc }

Run Bitbucket Pipelines locally using `pipeline-runner` directly from Workspace Tasks.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
> **New in v1.9.0**: Bitbucket Pipelines support.

## Overview

Workspace Tasks discovers `bitbucket-pipelines.yml` files and builds a 4-level tree with pipeline sections, stages, and steps.

- **Pipelines** (default, branches, pull-requests, tags, custom) run via `pipeline-runner run <pipeline-path>`.
- **Stages** run via `pipeline-runner run --stage "<stage-name>" <pipeline-path>`.
- **Named steps** run via `pipeline-runner run --step "<step-name>" <pipeline-path>`.
- **Unnamed steps and stages** are shown in the tree but are non-runnable.

### Task Tree Structure

```tree
bitbucket-pipelines.yml           ← (non-runnable, group)
├── default                       ← (runnable, pipeline)
│   ├── Install                   ← (runnable, named step)
│   └── [unnamed step]            ← (non-runnable)
├── master  (branches)            ← (runnable, pipeline)
│   ├── Build Stage               ← (runnable, stage)
│   │   ├── Compile               ← (runnable, step)
│   │   └── Test                  ← (runnable, step)
│   └── Deploy Stage              ← (runnable, stage)
│       └── Deploy                ← (runnable, step)
└── manual-deploy  (custom)       ← (runnable, pipeline)
    └── Deploy                    ← (runnable, step)
```

- The **file** node is non-runnable and provides open-file access only.
- **Pipeline** nodes run the entire pipeline (all steps) via `pipeline-runner run`.
- **Stage** nodes run a named stage within a pipeline via `pipeline-runner run --stage`.
- **Named step** nodes run a specific step via `pipeline-runner run --step`.
- **Unnamed steps/stages** appear in the tree but cannot be run individually.
- **Parallel steps** are flattened under their pipeline with a `[parallel]` tooltip.

---

## Requirements

- **[pipeline-runner](https://github.com/bitbucket-pipeline-runner/pipeline-runner)** must be installed:

  ```bash
  pipx install bitbucket-pipeline-runner
  ```

- **[Docker](https://www.docker.com/)** must be running for local pipeline execution.
- The **Bitbucket Pipelines** task type must be enabled (it is disabled by default):

  ```json
  "workspaceTasks.enabledTaskTypes": {
    "bitbucket": true
  }
  ```

If `pipeline-runner` is not in your system path, configure `workspaceTasks.applicationPath.bitbucketPipelineRunner`.

---

## Execution Behavior

### Running a Pipeline

```bash
pipeline-runner run default
pipeline-runner run branches.master
pipeline-runner run custom.manual-deploy
```

### Running a Stage

```bash
pipeline-runner run --stage "Build Stage" branches.master
```

### Running a Step

```bash
pipeline-runner run --step "Compile" branches.master
```

### Environment Files

You can configure env files to be passed to `pipeline-runner` via `workspaceTasks.bitbucketPipelineRunner.environmentFiles`:

```json
"workspaceTasks.bitbucketPipelineRunner.environmentFiles": [".env", ".env.local"]
```

This results in:

```bash
pipeline-runner run --env-file .env --env-file .env.local default
```

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `workspaceTasks.applicationPath.bitbucketPipelineRunner` | `pipeline-runner` | Path to the `pipeline-runner` executable |
| `workspaceTasks.bitbucketPipelineRunner.environmentFiles` | `[]` | Env files passed via `--env-file` |
| `workspaceTasks.bitbucketPipelineRunner.additionalFilePatterns` | `[]` | Extra glob patterns for pipeline file discovery |
| `workspaceTasks.enabledTaskTypes.bitbucket` | `false` | Enable/disable Bitbucket Pipelines task type |

---

## Pipeline Sections

Workspace Tasks discovers all standard Bitbucket Pipelines sections:

| Section | Example path |
| --- | --- |
| `default` | `default` |
| `branches` | `branches.master` |
| `pull-requests` | `pull-requests.**` |
| `tags` | `tags.v*` |
| `custom` | `custom.manual-deploy` |


## Sample `bitbucket-pipelines.yml`

```yaml

```

## Sample Output

```log
2026-04-19 06:52:43.284 pipeline_runner.context: Loading .env file (if exists)
2026-04-19 06:52:43.302 pipeline_runner.runner: Running pipeline: custom.smoke-tests
2026-04-19 06:52:43.303 pipeline_runner.runner: Pipeline UUID: 7322b84d-d0d4-48c4-8f25-b13f7c51fc30
2026-04-19 06:52:43.321 pipeline_runner.runner: Running step: Smoke Tests
2026-04-19 06:52:43.322 pipeline_runner.runner: Step ID: 05341a6f-9066-400f-b1f4-2709d35d6d0f
2026-04-19 06:52:43.324 pipeline_runner.runner: Creating network sample-workspace-tasks-network.
2026-04-19 06:52:43.445 pipeline_runner.container: Pulling image: atlassian/default-image:4
2026-04-19 06:52:44.284 pipeline_runner.container: Creating container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests
2026-04-19 06:52:44.601 pipeline_runner.container: Created container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests
2026-04-19 06:52:44.601 pipeline_runner.container: Image Used: atlassian/default-image:4
2026-04-19 06:52:44.887 pipeline_runner.runner: Build setup: 'Smoke Tests'
2026-04-19 06:52:44.911 pipeline_runner.container: Pulling image: alpine/git
2026-04-19 06:52:45.716 pipeline_runner.container: Creating container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-clone
2026-04-19 06:52:46.017 pipeline_runner.container: Created container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-clone
2026-04-19 06:52:46.017 pipeline_runner.container: Image Used: alpine/git
+ GIT_LFS_SKIP_SMUDGE=1 git clone --branch='main' --depth 50 file:///opt/atlassian/workspace $BUILD_DIR
Cloning into '/opt/atlassian/pipelines/agent/build'...
remote: Enumerating objects: 421, done.
remote: Counting objects: 100% (421/421), done.
remote: Compressing objects: 100% (268/268), done.
remote: Total 421 (delta 155), reused 223 (delta 85), pack-reused 0 (from 0)
Receiving objects: 100% (421/421), 191.25 KiB | 644.00 KiB/s, done.
Resolving deltas: 100% (155/155), done.

+ git reset --hard $BITBUCKET_COMMIT
HEAD is now at 123d7d4 chore: bitbucket pielines

+ git config user.name bitbucket-pipelines

+ git config user.email commits-noreply@bitbucket.org

+ git config push.default current

+ git remote set-url origin file:///opt/atlassian/workspace

+ git reflog expire --expire=all --all

+ echo '.bitbucket/pipelines/generated' >> .git/info/exclude

2026-04-19 06:52:48.279 pipeline_runner.container: Removing container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-clone
2026-04-19 06:52:48.521 pipeline_runner.artifacts: Loading artifacts
2026-04-19 06:52:48.521 pipeline_runner.artifacts: Creating artifacts manager container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-artifacts
2026-04-19 06:52:48.820 pipeline_runner.artifacts: Deleting artifacts manager container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-artifacts
2026-04-19 06:52:49.041 pipeline_runner.artifacts: Artifacts loaded in 0.520s

Images used:
        build: atlassian/default-image@sha256:71960b111dfa043daa26d7c794b70b40385371edea552e94b3ab05b0a5999796

2026-04-19 06:52:49.077 pipeline_runner.runner: Build setup finished in 4.191s: 'Smoke Tests'
+ npm run test:smoke

> root-sample-tasks@1.2.1 test:smoke
> echo 'Running smoke tests ...' && echo 'All smoke tests passed!'

Running smoke tests ...
All smoke tests passed!

>>> Execution time: 0.167s

2026-04-19 06:52:49.603 pipeline_runner.runner: Build teardown: 'Smoke Tests'
2026-04-19 06:52:49.604 pipeline_runner.runner: Build teardown finished in 0.000s: 'Smoke Tests'
2026-04-19 06:52:49.604 pipeline_runner.container: Removing container: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests
2026-04-19 06:52:49.969 pipeline_runner.runner: Removing volume: sample-workspace-tasks-l6dV1Yvt-step-smoke-tests-data
2026-04-19 06:52:49.983 pipeline_runner.runner: Step 'Smoke Tests' executed in 6.661s with exit code: 0
2026-04-19 06:52:49.983 pipeline_runner.runner: Pipeline 'custom.smoke-tests' executed in 6.680s.
2026-04-19 06:52:49.983 pipeline_runner.runner: Pipeline 'custom.smoke-tests': Successful
```
