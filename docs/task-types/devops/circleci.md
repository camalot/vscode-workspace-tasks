---
layout: default
title: ⭕ CircleCI
parent: 🚦 DevOps & Containers
nav_order: 3
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# CircleCI
{: .no_toc }

Run CircleCI jobs locally and execute workflows as sequential local pipelines directly from Workspace Tasks.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Workspace Tasks discovers CircleCI config files (`.circleci/config.yml` / `.circleci/config.yaml`) and builds a tree with workflows and jobs.

- **Jobs** run via the CircleCI local CLI (`circleci local execute`).
- **Workflows** run as a local **sequential orchestration** of their jobs (Compound Task style).

### Task Tree Structure

```text
config.yml                         (non-runnable, group)
├── workflow: build-and-test        (runnable, sequential)
│   ├── lint                        (runnable)
│   └── test                        (runnable)
└── jobs                            (non-runnable, group)
    ├── lint                        (runnable)
    ├── test                        (runnable)
    └── nightly-cleanup             (runnable)
```

- The **config file** node is a non-runnable group — it provides open-file access only.
- The **workflow** nodes are runnable and execute all their jobs sequentially.
- The **jobs** group always lists **every job defined in the config**, so individual jobs can be run directly at any time, regardless of whether they belong to a workflow.

---

## Requirements

- **[CircleCI CLI](https://circleci.com/docs/guides/toolkit/local-cli/)** must be installed and configured for use.
- **[Docker](https://www.docker.com/)** must be running for local job execution.

If `circleci` is not in your system path, configure `workspaceTasks.applicationPath.circleci`.

---

## Execution Behavior

### Running a Job

Jobs are executed with the CircleCI local CLI:

```bash
circleci local execute --temp-dir <workspace>/.circleci/.workspace-tasks-temp -c .circleci/config.yml <job-name>
```

Workspace Tasks always passes `--temp-dir` to avoid `/tmp` [mount issues](https://github.com/CircleCI-Public/circleci-cli/issues/716) seen with some Docker runtimes (for example Lima/Colima/Rancher Desktop).
The temp directory is created under the task workspace so Docker can mount it consistently in remote/dev-container setups.

### Running a Workflow

CircleCI CLI does not natively run workflows locally. Workspace Tasks emulates this by executing workflow jobs **one-by-one in workflow order**.

- If a job fails, the workflow run stops.
- If you stop the workflow, the current job is terminated and no next job starts.

---

## Limitations

- Local workflow runs are **sequential emulation**, not full CircleCI cloud orchestration.
- Parallel/fan-out branches in a workflow are linearized in v1 local execution.
- Online-only features (cache/artifacts/platform-managed contexts) may differ when running locally.

---

## Configuration

```jsonc
{
  "workspaceTasks.enabledTaskTypes": {
    "circleci": true
  },
  "workspaceTasks.applicationPath.circleci": "circleci",
  "workspaceTasks.circleci.configProcessing": "auto",
  "workspaceTasks.circleci.additionalFilePatterns": []
}
```

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `workspaceTasks.applicationPath.circleci` | `string` | `"circleci"` | Path to the CircleCI CLI executable |
| `workspaceTasks.circleci.configProcessing` | `"auto" \| "always" \| "never"` | `"auto"` | Pre-processing strategy before local execution |
| `workspaceTasks.circleci.additionalFilePatterns` | `string[]` | `[]` | Extra globs merged with built-in `.circleci/config` discovery patterns |

---

## Troubleshooting

- **No CircleCI tasks appear**
  - Ensure `.circleci/config.yml` exists.
  - Confirm `workspaceTasks.enabledTaskTypes.circleci` is enabled.
- **Job fails immediately**
  - Verify Docker is running.
  - Run the same command manually in a terminal to validate local CLI setup.
- **Workflow stops early**
  - A prior job failed or the workflow was manually stopped.
