---
layout: default
title: 🪣 Bitbucket Pipeline Runner
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 7
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Bitbucket Pipeline Runner Settings
{: .no_toc }

Bitbucket Pipelines support uses the local `pipeline-runner` CLI to run pipelines, stages, and steps locally in Docker.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

### workspaceTasks.applicationPath.bitbucketPipelineRunner

**Type:** `string`
**Default:** `"pipeline-runner"`
**Scope:** `resource`

Path to the `pipeline-runner` executable. Install via:

```bash
pipx install bitbucket-pipeline-runner
```

```jsonc
{
  "workspaceTasks.applicationPath.bitbucketPipelineRunner": "pipeline-runner"
}
```

---

### workspaceTasks.bitbucketPipelineRunner.environmentFiles

**Type:** `string[]`
**Default:** `[]`
**Scope:** `resource`

List of environment files passed to `pipeline-runner` via `--env-file`. Each entry becomes a separate `--env-file` argument.

```jsonc
{
  "workspaceTasks.bitbucketPipelineRunner.environmentFiles": [
    ".env",
    ".env.local"
  ]
}
```
