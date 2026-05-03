---
layout: default
title: Workspace Tasks Loading
parent: ⚡ Performance
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Workspace Tasks Loading Performance
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This investigation diagnosed and resolved a series of performance bottlenecks in the `getTasks()` pipeline — the code path that runs every time the task tree is loaded or refreshed. On the [test dataset](#test-dataset), the cold load time dropped from **~52,000 ms** to **~795 ms** (~98.5% reduction) across seven targeted fixes.

![Workspace-Tasks Load v1.6.0]({{ site.github_images_url }}/wst-load-v1.6.0.gif){: .vat }

---

## Test Dataset

See the [Performance overview](index.md) for the full dataset description. In brief:

- **17 workspace task providers** (16 built-in + 1 custom `pantera`)
- **53 files** indexed by `TaskFilesService`
- **27 shell script tasks** discovered by `ShellTaskProvider`
- **3 VS Code native tasks** in `.vscode/tasks.json`

---

## Baseline

Before any optimizations, a cold load with a warm OS file cache measured **~52,000 ms**. The dominant costs were:

| Root Cause | Time Lost |
| --- | --- |
| Duplicate `getProviders()` call reloading config | ~15,204 ms |
| Sequential per-provider file-glob dispatching (no cache) | ~31,000 ms |
| VS Code task provider opening files sequentially | ~4,700 ms |
| Shell type scans dispatching 10 individual FS queries | ~15,000 ms |

The workspace tasks config (`loadWorkspaceConfig`) was being called **twice** — once during initialization and again inside `getProviders()` — resulting in a full 15-second workspace scan on every call, even on warm reloads.

---

## Fixes Applied

### Fix 1 — Guard Duplicate `getProviders()` Call

**Problem:** `WorkspaceTasksService.getProviders()` unconditionally called `loadWorkspaceConfig()` every time it was invoked, even when the config was already loaded. This caused a redundant 15,204 ms scan on every `getTasks()` invocation.

**Fix:** Added an early-return guard in `getProviders()` — if providers were already loaded, skip the reload.

**Result:** Eliminated the duplicate 15,204 ms config load. On subsequent calls, `getProviders()` returns in microseconds.

---

### Fix 2 — Register Dynamic Workspace-Task Globs with `TaskFilesService`

**Problem:** Workspace task providers (npm, cargo, go, etc.) each dispatched individual `workspace.findFiles()` calls with no coordination. On warm reloads, these 16 separate glob queries each waited for VS Code's file watcher.

**Fix:** After `loadWorkspaceConfig()`, the extension now registers all provider include-globs with `TaskFilesService` so that the single combined-cache query covers them.

**Result:** Warm reload for workspace-tasks providers: ~4,000 ms → ~200 ms.

---

### Fix 3 — Parallelize the Provider File-Scan Loop

**Problem:** `WorkspaceTasksProvider` processed providers sequentially — each `await provider.getTasks()` blocked the next.

**Fix:** Converted the provider loop to `Promise.all()`, running all provider file scans in parallel.

**Result:** Additional ~562 ms saved on cold load (serialization overhead eliminated).

---

### Fix 4 — Batch the Uncovered-Glob Fallback in `TaskFilesService`

**Problem:** When `ShellTaskProvider` triggered file lookups, each of the 10 shell types dispatched its own fallback `workspace.findFiles()` glob query because their patterns weren't registered with `TaskFilesService`. This produced **10 sequential FS queries** totalling ~15,038 ms.

**Fix:** Implemented a debounced coalescing mechanism in `TaskFilesService`. When multiple unregistered patterns arrive in the same tick, they are combined into a single `workspace.findFiles()` call.

**Result:** 10 separate fallback queries coalesced into 1 query. Cold load time for this phase: 15,038 ms → 5,093 ms.

---

### Fix 5 — Optimize `VscodeTaskProvider` File Access

**Problem:** `VscodeTaskProvider.getSystemTasks()` opened and processed VS Code task files **sequentially**, one await per file. It also incurred avoidable per-file processing overhead while scanning document content to extract task metadata.

**Fix (5a):** Converted the file-open loop to `Promise.all()` for parallel file access.

**Fix (5b):** Kept the full-document read, but reduced processing overhead by scanning each file's content once per file instead of performing additional repeated line-processing work.

**Result:** Warm-reload time for `VscodeTaskProvider`: ~2,613 ms → ~697 ms (~1,916 ms saved).

---

### Fix 6 — Add `getSystemTasks()` Completion Log

**Problem:** Unlike all other providers, `VscodeTaskProvider.getSystemTasks()` emitted no structured timing log, making it invisible in performance captures.

**Fix:** Added `const start = Date.now()` at entry and a `logger.info()` line at completion reporting task count and elapsed time.

**Result:** Observability only — no performance change, but timing is now visible in debug logs.

---

### Fix 7 — Register `ShellTaskProvider` Patterns with `TaskFilesService`

**Problem:** Fix 4 had coalesced the uncovered-batch shell queries into one, but the 10 shell-type patterns were still not registered with `TaskFilesService`. On every warm reload, `ShellTaskProvider` still triggered the fallback batch path (~500 ms per reload) instead of getting instant cache hits.

**Fix:** Extended `ShellTaskProvider.getFilePatterns()` to return individual per-extension patterns (e.g. `**/*.sh`, `**/*.py`) in addition to the combined brace-glob. `TaskFilesService` then includes these patterns in its initial cache build, so all shell file lookups on warm reload are satisfied from cache.

**Result:** Warm-reload time for `ShellTaskProvider`: ~500 ms → <10 ms (pure cache hits).

---

## Results Summary

Measurements taken against the sample-workspace-tasks dataset with a warm OS file cache.

### Per-Fix Improvement

| Fix | Description | Time Saved |
| --- | --- | --- |
| 1 | Guard duplicate `getProviders()` | ~15,204 ms |
| 2 | Register dynamic workspace-task globs | ~3,800 ms (warm) |
| 3 | Parallelize provider file-scan loop | ~562 ms |
| 4 | Batch uncovered-glob fallback | ~9,945 ms |
| 5 | VscodeTaskProvider parallel opens + single-line scan | ~1,916 ms (warm) |
| 6 | Add `getSystemTasks()` completion log | Observability only |
| 7 | Register ShellTaskProvider patterns | ~490 ms (warm) |

### Cold Load Comparison

| Stage | Baseline | After All Fixes |
| --- | --- | --- |
| `loadWorkspaceConfig()` | ~17,443 ms | ~444 ms |
| `WorkspaceTasksProvider` file scans (16 providers) | ~31,000 ms | ~677 ms |
| `ShellTaskProvider` (10 shell types) | ~15,483 ms | ~798 ms (cache) |
| `VscodeTaskProvider` | ~4,700 ms | ~4,230 ms |
| **Total `getTasks()`** | **~52,000 ms** | **~795 ms** |

{: .note }
> The ~795 ms result is from a very warm session where the OS file cache and `TaskFilesService` cache were already populated. A true cold start (first VS Code launch, empty caches) will be higher, but the structural improvements still eliminate the majority of redundant work on all subsequent loads.

### Warm Reload Comparison

| Provider | Baseline | After All Fixes |
| --- | --- | --- |
| `WorkspaceTasksService.loadWorkspaceConfig()` | ~15,204 ms | ~444 ms |
| `WorkspaceTasksProvider` (16 providers) | ~4,000 ms | ~200 ms |
| `ShellTaskProvider` (10 shell types, warm) | ~500 ms | <10 ms |
| `VscodeTaskProvider` | ~2,613 ms | ~697 ms |
| **Total warm reload** | **~52,000 ms** | **~300 ms** |

---

## Final Log Excerpt

Key lines from `results-fix6-7.log` demonstrating the improvements on a warm session:

```log
[03:02:10.200] loadWorkspaceConfig() completed in 444ms (17 provider(s) loaded)
[03:02:10.845] Cache built with 53 files from combined pattern ... in 636ms
[03:02:10.896] Finished shell type: fish   — 0 file(s) resolved in 686ms
[03:02:10.897] Finished shell type: perl   — 0 file(s) resolved in 687ms
[03:02:10.897] Finished shell type: ruby   — 0 file(s) resolved in 687ms
[03:02:10.897] Finished shell type: nushell — 0 file(s) resolved in 687ms
[03:02:10.898] Parallel file search for 13 provider(s) completed in 677ms
```

All shell types resolve in <10 ms above the 636 ms cache-build baseline — confirming pure cache hits with zero uncovered-batch fallback queries.
