---
layout: default
title: 🧹 Purge Invalid Compound Task Storage
parent: 🔧 Troubleshooting
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Purge Invalid Compound Task Storage
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Compound task definitions are persisted in VS Code's workspace state storage so they survive between sessions. Under certain circumstances, the stored data can become stale — containing entries that reference files outside the current workspace, tasks with unrecognized task types, or entire compound tasks that have no runnable items remaining. These are referred to as **invalid** or **ghost** entries.

The **Purge Invalid Compound Tasks from Storage** command inspects the stored compound task data and removes anything that can no longer run. It operates in three phases:

| Phase | What it does |
| --- | --- |
| **Phase 1 — Auto-remove unrunnable items** | Items whose `taskType` is not recognized by any task provider are removed silently without prompting. |
| **Phase 2 — Ghost compound tasks** | Whole compound tasks that have no items reachable in the current workspace are shown in a review list. |
| **Phase 3 — Out-of-workspace items** | Individual items whose source files exist outside the current workspace are shown in a review list. |

---

## Indicators That the Command Needs to Be Run

### "No runnable task could be created for '…'"

The most common symptom. When running a compound task, one or more of its stored items cannot be mapped to a real task — usually because the item's `taskType` does not match any known provider (e.g. it was stored under an old type name like `queue` from a previous extension version).

### A compound task appears in the Command Palette but not in the Sidebar

The **Run Compound Task** command palette entry uses the workspace-filtered list (the same set shown in the tree). If a compound task appears in the command palette but is invisible in the Compound Tasks section of the sidebar, the compound task exists in storage but has no items that belong to the current workspace. This means all its items reference files that are not part of the open workspace folders.

### Items listed in a compound task do not run and are silently skipped

If the extension's debug logging is enabled (`workspaceTasks.debug: true`), skipped items are reported to the **Workspace Tasks** output channel with a message such as:

```log
[WARN] [TaskRunner] Skipping unrunnable item 'Queue' in compound task 'My Pipeline': taskType='queue'.
```

An in-editor warning notification is also shown referencing this command.

---

## What Causes Invalid Storage

### Legacy Migration (`queue` task type)

Versions of this extension prior to `v1.5.0` used a "Queue" concept where queue _items_ were stored with a `taskType` of `queue`. After the rename to **Compound Tasks**, items left over with `taskType: 'queue'` have no corresponding task provider and cannot be run.

{: .important }
If you see `'Queue'` in the "No runnable task could be created for" message, this is almost certainly the cause. Run the Purge command once to clean it up.

### Workspace Root Change

If you move or rename the root folder of a workspace, or open the same repository from a different path, all stored URIs in compound task items point to the old path. None of those items will be considered valid for the new location, making the entire compound task a ghost.

### Removing a Workspace Folder from a Multi-Root Workspace

In a multi-root workspace, removing one of the folders invalidates all compound task items that referenced files inside that folder. The items remain in storage but are no longer reachable.

### Deleting or Renaming a Task File

If a file that was added to a compound task (e.g. a `Makefile`, `Gruntfile.js`, or shell script) is deleted or moved, the stored item's URI no longer resolves to a file inside the workspace, making it an out-of-workspace item.

---

## How to Run the Command

1. Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Type **Purge Invalid Compound Tasks**.
3. Select **Purge Invalid Compound Tasks from Storage**.

If items with unrecognized task types are found, they are removed automatically and a summary notification is shown.

If ghost compound tasks or out-of-workspace items are found, a multi-select quick pick is presented so you can review each entry before confirming removal.

---

## Debug Logging

Enable debug logging to get detailed output about what is stored and why items fail:

1. Open VS Code Settings (`Ctrl+,` / `Cmd+,`).
2. Search for **workspaceTasks.debug**.
3. Set it to `true`.

With debug logging enabled, the **Workspace Tasks** output channel (View → Output → Workspace Tasks) will show:

- All compound tasks found in storage at startup, including per-item details (id, label, taskType, URI).
- Any ID normalization or format migrations that occur on load.
- Items skipped at runtime due to unrecognized task types.
- Items filtered out because their URI is not in the current workspace.
- Full details of what each purge phase removed.

---

## Related

- [Compound Tasks (Queues)](../features/task-queues) — Creating and managing compound tasks
- [VSCode Compound Tasks](../features/compound-tasks) — Using VS Code's native `dependsOn` compound tasks
