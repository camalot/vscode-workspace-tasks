---
layout: default
title: 🔒 Workspace Trust
nav_order: 2
parent: 🔧 Troubleshooting
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Workspace Trust
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Workspace Tasks fully respects [VS Code's Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust) model. When a workspace is **not trusted**, the extension suspends all task discovery and displays no tasks in the Workspace Tasks sidebar.

This is a security measure: task files (`Taskfile.yml`, `Makefile`, `package.json` scripts, `Rakefile`, `.gitlab-ci.yml`, `justfile`, and others) are loaded directly from your workspace and may contain instructions that execute arbitrary commands. Workspace Tasks will not parse or execute any of these files until you explicitly trust the workspace.

---

## Tasks Are Not Showing

If no tasks appear in the Workspace Tasks sidebar, check whether the workspace is trusted:

1. Look for the trust indicator in the VS Code status bar (bottom-left). It shows a shield icon when the workspace is restricted.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Workspaces: Manage Workspace Trust**.
3. Click **Trust Workspace** to grant trust and allow task discovery.

Once the workspace is trusted, Workspace Tasks automatically refreshes and discovers all tasks.

---

## What Is Blocked in an Untrusted Workspace

| Action | Trusted | Untrusted |
| --- | :---: | :---: |
| Task discovery (file parsing) | ✅ | ❌ |
| CLI invocations (`just`, `task`, `rake`, `gitlab-ci-local`, …) | ✅ | ❌ |
| Displaying tasks in the sidebar | ✅ | ❌ |
| Running tasks | ✅ | ❌ |
| Favorites / Recent Tasks | ✅ | ❌ |

---

## Why This Behavior Exists

Workspace files can originate from any source — cloned repositories, downloaded archives, shared network drives, and so on. In an untrusted workspace the author of those files is unknown. Executing task definitions from such a source without explicit consent could allow an attacker to run arbitrary code on your machine.

By blocking all discovery in untrusted workspaces, Workspace Tasks ensures that **no task content is evaluated or executed** until you have reviewed and trusted the workspace.

---

## Related Resources

- [VS Code Workspace Trust documentation](https://code.visualstudio.com/docs/editor/workspace-trust)
- [VS Code Security guide](https://code.visualstudio.com/docs/editor/security)
