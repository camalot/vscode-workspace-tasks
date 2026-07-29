# Plan: Task Output Capture & Full-Text Search (Failed Runs First)

## TL;DR

Capture stdout/stderr for task executions using VS Code's Shell Integration API
(`vscode.window.onDidStartTerminalShellExecution`, `TerminalShellExecution.read()`), write it to a
size-capped, redacted, rotated log file per execution, and add a "Search Task Output" command that
full-text searches captured logs and jumps to the matching Task History record. **Phase 1 scope is
deliberately narrowed to failed-run capture only, opt-in and default OFF**, based on review
feedback that the original all-runs proposal understated its security surface. Goal: let users
find "which run had this error message" without re-running or scrolling back through terminal
scrollback.

---

## Self-Critique & Viability Assessment

*(Reviewed by a rubber-duck sub-agent pass against the real codebase before finalizing this plan.)*

**Strengths:**

- `TaskHistoryService` (via the shipped `persistent-task-history` plan) stores only execution
  *metadata* (`exitCode`, duration, timestamps) — confirmed no stdout/stderr field exists today —
  so this is a genuine capability gap, not a duplicate of existing history/export features.
  `task-history-export` exports the metadata table; this plan is about the raw content that table
  can't show.
- The Shell Integration API used here is a real, stable (non-proposed) VS Code API, and the
  extension's `engines.vscode` floor is well past its introduction — technically available today.

**Risks / Weaknesses (from review) — these substantially reshaped Phase 1 scope:**

- **This is a from-scratch integration, not "hook into an existing pattern."** A workspace-wide
  search found zero existing usage of `onDidStartTerminalShellExecution` in this codebase. The
  plan must budget for a new, unproven integration, including a non-trivial correlation problem:
  `onDidStartTerminalShellExecution` yields a `Terminal` + `TerminalShellExecution`, not a
  `vscode.TaskExecution` — matching a shell execution back to the specific
  `ITaskExecutionRecord` requires correlating by terminal identity/creation-time window against
  `TaskStateManager`'s execution tracking. This correlation logic needs its own design/test pass,
  not a one-line assumption.
- **Coverage gaps must be explicit, not a footnote.** Shell integration only activates for
  terminals where `terminal.integrated.shellIntegration.enabled` is on (default on, but
  user-configurable) and only for supported shells (bash/zsh/pwsh/fish — not plain `cmd.exe`).
  Tasks using `CustomExecution` (e.g. the Jupyter provider's `JupyterTerm` pseudoterminal) or a
  `ProcessExecution` without shell integration produce **no captured output at all**. The feature
  must degrade gracefully — "Search Task Output" reports "no output captured for this run" rather
  than treating an empty result as an error — and the docs must state coverage limits plainly.
- **Security is the dominant risk of this entire plan**, more so than the original draft
  acknowledged. Captured stdout/stderr routinely contains tokens, credentials, connection strings,
  and stack traces with local paths/usernames — a broader leakage surface than the existing
  `env-secret-warning` feature, which only inspects *env files*, not arbitrary command output.
  "Opt-in, default OFF" alone is necessary but not sufficient. **Resolution, folded into this
  plan (not deferred):**
  1. **Phase 1 captures failed runs only** (the actual stated use case — "find which run had this
     error"), cutting both storage volume and secret-exposure surface substantially compared to
     capturing every run.
  2. **A redaction pass runs before any bytes touch disk**, reusing `TaskEnvService`'s already-
     resolved known-secret-value list for the task (same values `TaskSecretWarningService` already
     treats as sensitive) to scrub matches from captured output.
  3. Default OFF, one explicit setting to enable, with in-product copy warning about the
     redaction limitations (best-effort, not a guarantee — arbitrary command output can't be
     perfectly scrubbed).
- **File I/O and retention must reuse existing patterns, not invent new ones.** `TaskHistoryService`
  already solved concurrent-write serialization for its NDJSON archive via a write queue; log
  capture must reuse that queue pattern rather than adding a second, divergent file-I/O mechanism.
  Retention must be tied to the *existing* `workspaceTasks.history.retentionDays` /
  `maxPersistedRecords` settings so logs and history records are pruned in lockstep — no parallel
  retention settings.
- **Search performance.** Full-text search across rotated logs must be chunked/streamed (or run in
  a worker) rather than reading entire files synchronously on the extension host thread, to avoid
  UI jank as captured volume grows.

**Verdict:** Go, but only in the rescoped, conservative form below (failed-runs-only, redaction-
first, default OFF, explicit coverage-gap messaging). This is the highest engineering-and-security-
risk idea in this batch and must not ship in its originally-drafted "capture everything" form.

---

## Key Design Decisions

- **Setting**: `workspaceTasks.output.captureOnFailure` (boolean, default `false`). No "capture
  all runs" option in Phase 1 — that is an explicit non-goal until the redaction/coverage story is
  field-proven.
- **Capture trigger**: on `vscode.tasks.onDidEndTaskProcess` reporting a non-zero exit code (or
  the task's existing `Failed` classification already used by `TaskHistoryService`), if capture is
  enabled, look up the correlated `TerminalShellExecution` buffer for that task's terminal and
  write it out; if no shell-integration data is available (unsupported shell/`CustomExecution`),
  skip silently and mark the history record as `outputCaptured: false`.
- **Correlation**: track `(terminal, startTime)` → task ID in a short-lived map populated in the
  existing task-start handling path (`TaskHistoryService`/`TaskStateManager`), consulted when
  `onDidStartTerminalShellExecution` fires, matched against `onDidEndTaskProcess` for the same
  execution.
- **Redaction**: before writing to disk, replace any substring matching a value from
  `TaskEnvService`'s resolved secret-value set for that task's env with a fixed placeholder
  (`***REDACTED***`), reusing `TaskSecretWarningService`'s matching approach where applicable.
- **Storage**: one log file per captured execution under `.vscode/task-output-logs/`, size-capped
  (default 256 KB per file, configurable via `workspaceTasks.output.maxCaptureBytes`), named by
  execution ID so it can be joined back to the `ITaskExecutionRecord`.
- **Write path**: reuse `TaskHistoryService`'s existing async write-queue implementation rather
  than adding a second queue.
- **Retention**: pruned by the same `workspaceTasks.history.retentionDays` /
  `maxPersistedRecords` sweep that already prunes history records — a log file is deleted exactly
  when its owning history record is pruned, never independently.
- **Search command**: `workspaceTasks.output.search` — prompts for a search term, greps captured
  log files (chunked read, not full in-memory load for large files), and shows matches in a
  QuickPick (task label + timestamp + matching line snippet); selecting a result opens the History
  record and reveals the log file.
- **History record flag**: add `outputCaptured: boolean` to `ITaskExecutionRecord` so the History
  UI can show a small indicator (and "Search Task Output" can skip records with no captured log).

---

## Phases

### Phase 1: Failed-Run Capture (opt-in, default OFF)

1. Correlation map + `onDidStartTerminalShellExecution`/`onDidEndTaskProcess` wiring in
   `TaskHistoryService`.
2. Redaction helper reusing `TaskEnvService` secret values.
3. Write-queue-backed log file persistence under `.vscode/task-output-logs/`.
4. `outputCaptured` flag on `ITaskExecutionRecord`; retention tied to existing history settings.
5. Explicit docs section on coverage gaps (unsupported shells/`CustomExecution`) and the
   best-effort nature of redaction.

### Phase 2: Search Command & History UI Integration

1. `src/commands/searchTaskOutputCommand.ts` — `workspaceTasks.output.search`.
2. History webview: small "output captured" indicator per row; click-through to log content.
3. Tests: correlation matching, redaction correctness, retention-lockstep pruning, graceful
   no-capture-available path.

### Phase 3 (future, not committed): All-Run Capture

Only considered after Phase 1/2 field feedback confirms the redaction approach and storage volume
are acceptable in practice — explicitly out of scope for the initial release.
