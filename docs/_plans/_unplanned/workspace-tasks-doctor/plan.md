# Plan: Workspace Tasks Doctor (Environment Health Check)

## TL;DR

Add an on-demand `workspaceTasks.doctor` command that checks, for every task type actually
discovered in the current workspace, whether its required external CLI tool is present and
resolvable on `PATH`, reports the version where possible, and links to install docs. Results
surface in a dedicated "Diagnostics" output plus optional Problems-panel entries, reusing the
existing `DiagnosticCollection` pattern already proven by the env-secret-warning feature. Goal:
close the documented gap between "task discovered" and "task actually runnable" (README already
calls this out as a known limitation).

---

## Self-Critique & Viability Assessment

*(Reviewed by a rubber-duck sub-agent pass against the real codebase before finalizing this plan.)*

**Strengths:**

- Motivated by a real, already-documented gap (README: "discovery regardless of whether tools are
  installed; execution requires the tool on PATH").
- The Problems-panel/`DiagnosticCollection` pattern is not new to this codebase —
  `TaskSecretWarningService` already does exactly this for git-tracked secret files, so Doctor
  reuses a proven mechanism rather than inventing a new surfacing method.
- `TaskCacheService.getProviders()` / `hasTasksForProviderType()` are real, existing APIs that
  give an accurate anchor for "which task types are actually in play right now," so Doctor doesn't
  need to check tools for types the workspace doesn't even use.

**Risks / Weaknesses (from review):**

- **Workspace Trust conflict — must be designed in from the start, not bolted on.** This repo's
  `.github/copilot-instructions.md` mandates that *any* provider spawning an external CLI process
  must check `vscode.workspace.isTrusted` first, and every existing provider (`gitlabCiTaskProvider`,
  `justfileTaskProvider`, `rakeTaskProvider`, `taskfileTaskProvider`, etc.) already follows this
  rule. Doctor's entire purpose is spawning `--version` checks for external CLIs, so it is a direct
  instance of this rule, not an exception to it. **Resolution:** the `workspaceTasks.doctor`
  command checks `vscode.workspace.isTrusted` before doing anything, and shows a clear "Workspace
  is not trusted — Doctor requires a trusted workspace to check external tools" message rather
  than silently no-op-ing or partially running.
- **Maintenance burden / rot risk.** A hardcoded map of `{ taskType → command, version args,
  install URL }` will silently miss every new provider added in the future unless it's part of the
  provider's own contract. **Resolution:** add an optional `getDoctorCheck()` method to
  `BaseTaskProvider` so each provider owns its own check definition; Doctor iterates registered
  providers and calls the hook if present, skipping providers that don't define one (e.g. `npm`,
  `shell` need no external tool beyond what's already assumed present).
- **Cost of spawning many `--version` processes.** Must be strictly on-demand (command palette /
  tree action), never triggered automatically on refresh or activation, and cached for the
  session with a manual "Recheck" action — not re-run on every tree refresh.
- **False negatives from PATH/shim mismatches.** A tool may be installed via `asdf`/`mise`/a
  different shell profile than the one the integrated terminal resolves, causing "not found" even
  though the task would actually run. The Doctor UI must include a disclaimer that it only checks
  the PATH visible to the extension host process, not necessarily the exact resolution a spawned
  shell task would use.
- **Per-tool version parsing is real, ongoing work.** Each CLI (`act`, `circleci`, `gitlab-ci-local`,
  `pipeline-runner`, `docker`, `cargo-make`, `mise`, etc.) has a different `--version` output
  format; this is provider-owned maintenance, not a one-time cost — reinforces the
  `getDoctorCheck()` contract decision above (each provider author already knows their tool's
  output format).

**Verdict:** Go, with trust-gating and the extensible per-provider check contract designed in
from Phase 1 — not treated as follow-up work.

---

## Key Design Decisions

- **Command**: `workspaceTasks.doctor` — Command Palette entry "Workspace Tasks: Run Diagnostics
  (Doctor)". Also available as a tree view title-bar action (`$(pulse)` icon).
- **Trust gate**: First line of the command handler checks `vscode.workspace.isTrusted`; if
  `false`, shows an information message and returns immediately — no process is spawned.
- **Provider contract**:

  ```ts
  interface IDoctorCheck {
    command: string;                        // e.g. "act", "circleci", "gitlab-ci-local"
    versionArgs: string[];                   // e.g. ["--version"]
    parseVersion?: (stdout: string) => string | undefined;
    docsUrl: string;                         // install/setup docs link
  }

  // On BaseTaskProvider (optional — undefined means "no external tool required")
  getDoctorCheck?(): IDoctorCheck | undefined;
  ```

- **Scope of checks**: Only providers where `TaskCacheService.hasTasksForProviderType(type)` is
  true for the current workspace are checked — Doctor never checks tools for task types with zero
  discovered tasks.
- **Execution**: Each check spawns `command versionArgs` via the same `child_process`/executable
  resolution helper already used by `ExecutableService`, with a short timeout (e.g. 5s) per tool,
  run in parallel (`Promise.allSettled`) so one hanging tool doesn't block the rest.
- **Results surface**:
  - A summary output channel ("Workspace Tasks: Doctor") listing each checked tool: ✅ found +
    version, ⚠️ found but version unparseable, ❌ not found, with the `docsUrl` printed for any
    ❌/⚠️ entries.
  - Optionally, a lightweight `DiagnosticCollection` entry attached to the relevant task
    definition file (e.g. `.github/workflows/*.yml` for missing `act`) so the Problems panel shows
    an actionable warning near the task source, mirroring `TaskSecretWarningService`'s approach.
- **Caching**: Results cached in memory for the session; a "Recheck" button/command re-runs all
  checks on demand. Never auto-invoked by `TaskCacheService.refresh()`.
- **Disclaimer copy**: Doctor's output explicitly states it only reflects the PATH visible to the
  extension host process and may not exactly match a task's shell resolution (version managers,
  shims, per-shell profiles).

---

## Phases

### Phase 1: Core Service & Command

1. Add `getDoctorCheck?(): IDoctorCheck | undefined` to `BaseTaskProvider` (`src/taskProvider.ts`);
   implement it for providers with a real external CLI dependency: `githubActionsTaskProvider`
   (`act`), `circleCiTaskProvider` (`circleci`), `gitlabCiTaskProvider` (`gitlab-ci-local`),
   `bitbucketPipelinesTaskProvider` (`pipeline-runner`), `cargoMakeTaskProvider` (`cargo-make`),
   `miseTaskProvider` (`mise`), plus Docker-based providers.
2. `src/services/taskDoctorService.ts` — singleton: `runChecks(): Promise<IDoctorResult[]>`,
   `isTrusted-gated`, session-scoped result cache, `onDidChangeResults` event.
3. `src/commands/runDoctorCommand.ts` — `workspaceTasks.doctor`, writes to a dedicated output
   channel.

### Phase 2: Problems Panel Integration & UI Polish

1. Reuse `DiagnosticCollection` plumbing from `taskSecretWarningService.ts` for a
   `taskDoctorDiagnostics` collection.
2. Tree title-bar "Recheck" action; status summary badge (e.g. "2 issues") if unresolved
   ❌/⚠️ results exist.
3. Docs: `docs/getting-started/requirements.html`-adjacent page documenting Doctor; README
   feature bullet linking to it from the existing "External tools" callout.
4. Tests: trust-gate short-circuit, per-provider check invocation, timeout/failure handling,
   result caching and manual recheck.
