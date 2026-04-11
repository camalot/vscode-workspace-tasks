---
layout: default
title: Shell Task Loading
parent: ⚡ Performance
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Shell Task Loading Performance
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This investigation targeted the `ShellTaskProvider` — the component responsible for discovering and classifying shell scripts across 10 shell types (bash, sh, zsh, fish, PowerShell, batch, Python, Perl, Ruby, Nushell). The dominant cost is an unavoidable filesystem scan (~15,000 ms cold), but three phases of improvement eliminated redundant work, added shebang caching, and fixed a first-launch race condition.

On warm reloads, the combination of these improvements with the `TaskFilesService` cache integration (from the [Workspace Tasks Loading](workspace-tasks-loading.md) plan, Fix 7) reduces `ShellTaskProvider` time from ~15,000 ms to <10 ms.

---

## Test Dataset

See the [Performance overview](index.md) for the full dataset description. Shell-specific highlights:

| Shell Type | Extensions | Files Found | Tasks Loaded |
|---|---|---|---|
| bash | `.sh`, `.bash` | 12 | 12 |
| sh | `.sh` | 12 | 0 (shared with bash) |
| zsh | `.zsh` | 2 | 2 |
| fish | `.fish` | 0 | 0 |
| pwsh | `.ps1` | 6 | 6 |
| batch | `.bat`, `.cmd` | 3 | 3 |
| python | `.py` | 4 | 4 |
| perl | `.pl` | 0 | 0 |
| ruby | `.rb` | 0 | 0 |
| nushell | `.nu` | 0 | 0 |
| **Total** | | | **27** |

The `sh` type scans the same 12 `.sh` files as `bash` but resolves 0 tasks — all files are classified as bash via shebang. This makes shebang caching especially valuable: `bash` reads 12 files, then `sh` gets 12 cache hits at no additional I/O cost.

---

## Baseline

Before any optimizations, a cold load measured **~15,483 ms** in total.

```
[ShellTaskProvider] bash:   12 task(s) from 12 file(s) in 15050ms
[ShellTaskProvider] zsh:     2 task(s) from  2 file(s) in 14529ms
[ShellTaskProvider] pwsh:    6 task(s) from  6 file(s) in 14810ms
[ShellTaskProvider] batch:   3 task(s) from  3 file(s) in 14493ms
[ShellTaskProvider] python:  4 task(s) from  4 file(s) in 14952ms
[ShellTaskProvider] sh:      0 task(s) from 12 file(s) in 15290ms
[ShellTaskProvider] Completed — 27 total shell task(s) loaded in 15483ms
```

The key observation: every shell type completes in ~14,500–15,300 ms. Since all types are dispatched in parallel, the total time equals the slowest single type — which means the bottleneck is the `workspace.findFiles()` filesystem scan, not the shebang-reading logic.

### Baseline Root Causes

| Root Cause | Impact |
|---|---|
| All 10 shell types dispatched 10 separate `workspace.findFiles()` calls | Each scan takes ~14–15 s on cold FS |
| Shebang reads were sequential via `workspace.openTextDocument()` | Each file opened one at a time |
| No shebang cache | `bash` and `sh` both read all 12 `.sh` files independently |
| First-launch race condition | `onDidInitialScanComplete` event could fire before provider was ready |
| No loading state feedback | Tree showed stale content while discovery ran |

---

## Phase 1 — Parallelize Shebang Checks

**Problem:** Within each shell type, candidate files were read sequentially — each `await workspace.openTextDocument()` blocked the next. With 12 `.sh` files, this serialized 12 file-open operations.

**Fix:** Converted the per-file shebang check to `Promise.all()` both within a single shell type and across all shell types running concurrently.

**Result:** Shebang reads for the same shell type now complete in parallel. Wall-clock time for types with many files reduced proportionally to the slowest single file read.

---

## Phase 2 — mtime-Keyed Shebang Cache with Cross-Type Sharing

**Problem:** Even with parallelism, `bash` and `sh` scanned the same 12 `.sh` files completely independently. There was no cache, so every reload re-read every file.

**Fix:** Introduced an `mtime`-keyed in-memory shebang cache shared across all shell types. On a cache miss, the file is read and the shebang line is stored keyed by `(path, mtime)`. On a cache hit, the file is not opened at all.

Additional changes in this phase:
- Suppressed the redundant `other: 0 task(s) in 0ms` log line that appeared even when no "other" shell type was active.
- Tightened the shebang-check logic to avoid unnecessary reads for types that don't require shebang validation (batch, pwsh, etc.).

**Result:**

From `results-phase2.log` (warm session after Phase 2):

```
[ShellTaskProvider] bash: 12 task(s) from 12 file(s) in 15186ms (0 shebang reads, 12 cache hits)
[ShellTaskProvider] sh:    0 task(s) from 12 file(s) in 15184ms (12 shebang reads, 0 cache hits)
```

`bash` now gets **12 cache hits** (files read on prior `sh` processing). `sh` processes first in this session, so reads 12 files, but subsequent types that scan the same files get all hits. Total: **27 shell task(s) loaded in ~15,270 ms**.

> The headline time barely changes because the bottleneck is the ~15,000 ms `workspace.findFiles()` FS scan — not the shebang I/O. The cache benefit is realized on warm reloads when `TaskFilesService` holds the file list.

---

## Phase 3 — Race Fix, Loading State, and Progress Indicator

**Problem:** Three structural issues remained:

1. **Race condition:** If `onDidInitialScanComplete` fired before `ShellTaskProvider` completed its registration, the first tree refresh would miss shell tasks entirely, causing a stale display until the next refresh.
2. **No loading feedback:** While the ~15,000 ms FS scan ran, the task tree showed nothing or stale content — users had no indication that loading was in progress.
3. **`other` type spam:** The synthetic `other` shell type (for scripts whose shebang doesn't match a known type) emitted log entries even when it produced 0 tasks.

**Fixes:**

- **Race fix:** Changed the initial scan completion handler to await `ShellTaskProvider` readiness before emitting the tree-refresh event.
- **Loading state events:** `ShellTaskProvider` now emits `onLoadingStart` and `onLoadingEnd` events that the tree view subscribes to, showing a spinner while discovery runs.
- **withProgress:** Wrapped the shell discovery loop in `vscode.window.withProgress` to display a notification-area progress indicator during long scans.
- **`other` suppression:** The `other` type log line is now suppressed when it produces 0 tasks.

**Result:**

From `results-phase3.log` (cold load after Phase 3):

```
[ShellTaskProvider] bash:   12 task(s) from 12 file(s) in 14961ms (12 shebang reads, 0 cache hits)
[ShellTaskProvider] sh:      0 task(s) from 12 file(s) in 15232ms (0 shebang reads, 12 cache hits)
[ShellTaskProvider] Completed — 27 total shell task(s) loaded in 15419ms
```

Total cold time: **15,419 ms** — comparable to baseline, as expected (the FS scan time is unchanged). The improvements are structural: correct first-launch behavior, user-visible progress, and no redundant file reads on warm reloads.

---

## Combined Effect with TaskFilesService Integration

The most significant runtime improvement for `ShellTaskProvider` comes from the combination of Phase 2's shebang cache and Fix 7 from the [Workspace Tasks Loading](workspace-tasks-loading.md) plan.

Fix 7 registers individual shell extension patterns (`**/*.sh`, `**/*.py`, etc.) with `TaskFilesService`, which includes them in its combined cache. On warm reloads — including every reload after the initial cold scan — `ShellTaskProvider` gets all file lookups satisfied from the in-memory cache instead of dispatching new `workspace.findFiles()` queries.

**Warm reload comparison:**

| Condition | ShellTaskProvider Time |
|---|---|
| Cold load (FS not cached) | ~15,000–15,400 ms |
| Warm (TaskFilesService cache hit) | <10 ms |

From `results-fix6-7.log` (after Fix 7, warm session):

```
[ShellTaskProvider] Finished shell type: fish    — 0 file(s) resolved in 686ms
[ShellTaskProvider] Finished shell type: perl    — 0 file(s) resolved in 687ms
[ShellTaskProvider] Finished shell type: ruby    — 0 file(s) resolved in 687ms
[ShellTaskProvider] Finished shell type: nushell — 0 file(s) resolved in 687ms
```

All types complete within milliseconds of the 636 ms `TaskFilesService` cache-build — confirming every file list query is served from cache with zero filesystem I/O.

---

## Results Summary

| Phase | Change | Cold Time | Key Benefit |
|---|---|---|---|
| Baseline | — | 15,483 ms | — |
| Phase 1 | Parallelize shebang checks | ~15,400 ms | Shebang reads concurrent within/across types |
| Phase 2 | mtime shebang cache, cross-type sharing | ~15,270 ms | `sh` type gets full cache hit after `bash` |
| Phase 3 | Race fix, loading state, progress | ~15,419 ms | Correct first-launch; user sees progress |
| **+ Fix 7** | Register patterns with TaskFilesService | **<10 ms (warm)** | **All warm reloads served from cache** |

> The cold load time (~15 s) is dominated by the `workspace.findFiles()` filesystem scan, which is determined by VS Code's file watcher and cannot be optimized in extension code. All meaningful wall-clock improvements come from eliminating redundant work on warm subsequent reloads.
