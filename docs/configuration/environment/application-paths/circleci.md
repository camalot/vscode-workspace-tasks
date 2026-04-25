---
layout: default
title: ⭕ CircleCI CLI
parent: 📂 Application Paths
grand_parent: 🌐 Environment
nav_order: 6
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# CircleCI CLI Settings
{: .no_toc }

CircleCI support uses the local `circleci` CLI to run jobs and workflow job sequences.

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

{: .new }
> **New in v1.9.0**: CircleCI support.

---

### workspaceTasks.applicationPath.circleci

| | |
| --- | --- |
| **Type:** | `string` |
| **Default:** | `"circleci"` |
| **Scope:** | `resource` |

Path to the CircleCI CLI executable.

```jsonc
{
  "workspaceTasks.applicationPath.circleci": "circleci"
}
```

---

### workspaceTasks.circleci.additionalFilePatterns

| | |
| --- | --- |
| **Type:** | `string[]` |
| **Default:** | `[]` |
| **Scope:** | `resource` |

Additional discovery patterns merged with the built-in CircleCI config file glob.

```jsonc
{
  "workspaceTasks.circleci.additionalFilePatterns": [
    "**/.circleci/*.yml"
  ]
}
```
