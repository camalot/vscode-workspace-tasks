# Plan: Lazy Task-Type Discovery for Large Workspaces (Performance)

## TL;DR

Extend the loading-performance work already shipped (`shell-task-loading-performance`,
`workspace-tasks-loading-performance`, which eliminated redundant `findFiles`/config-reload work
in the eager discovery path) with a further, opt-in change: defer running a task-type provider's
`getTasks()` until the user actually expands that task-type group in the tree (or a feature that
needs "all tasks now" — Quick Open, the LM tool, CodeLens — forces it). Collapsed/unused task
types never pay their discovery cost. Goal: reduce cold-start time for workspaces with many
*enabled task types*, most of which a given user never touches in a session.

---

## Self-Critique & Viability Assessment

*(Reviewed by a rubber-duck sub-agent pass against the real codebase before finalizing this plan.)*

**Strengths:**

- `TaskCacheService` already has a real per-type refresh primitive (`refreshProvider(type)`) and
  per-type loading state tracking (`loadingProviders` set, `onDidLoadingStateChange` event) to
  build on — this is not a new state-management concept, just a new trigger for existing hooks.
  it already correctly avoids redundant work; this plan is the next phase in that lineage.

**Risks / Weaknesses (from review) — these reshape the scope significantly:**

- **The monorepo-subproject framing was wrong.** A "provider" in this codebase is one *task
  type* (npm, gradle, shell, taskfile, …), and each provider's `getTasks()` already discovers the
  entire workspace for that type in a single call — there is no existing per-subproject
  granularity within a type. So deferring by task-type group helps when a workspace enables many
  *different* types the user doesn't use, but does **nothing** for a monorepo with, say, 50
  `package.json` files all under the single `npm` type — that's still one discovery call.
  **Resolution:** the plan's stated goal is corrected to "workspaces with many enabled task types
  where a session only touches a few," not "monorepos with many subprojects."
- **`TaskFilesService` pre-registers all provider glob patterns and does one combined `findFiles`
  scan up front** (this was the core fix in `workspace-tasks-loading-performance`). Deferring
  provider *processing* does not defer that combined file-scan/glob-registration step, since other
  eagerly-run providers still need it. The win from this plan is per-provider CPU/parse time, not
  the I/O scan that the earlier performance plans already showed was the actual bottleneck in
  their baseline logs — so expected gains must be measured, not assumed, and the plan should not
  overstate them.
- **Cache-dependent features must not silently regress.** Quick Open, the `#wTasks`/`#runWTask`
  LM tools, CodeLens, Favorites, Compound Tasks, and Run Guard are all keyed off `TaskItem.id`,
  which only exists once a provider's `rebuildCache()` has actually run. A favorited or queued task
  belonging to a not-yet-expanded type would silently vanish from those features until the type is
  expanded — this is a correctness regression, not just a UX quirk, and must be solved in Phase 1:
  any of those surfaces that need "all tasks" must force-trigger discovery for any deferred type
  they touch before answering.
- **Perceived latency shift.** Moving discovery cost from activation time to first-expand time can
  *feel* worse even if the aggregate is lower — first click on a group now shows a spinner where
  today it's instant. Needs a per-group loading indicator (reusing `loadingProviders`) so it reads
  as "expected," not "broken."

**Verdict:** Go, but rescoped: goal statement corrected to "many enabled task types," Phase 1 must
include the force-discovery fallback for Quick Open/LM tool/CodeLens/Favorites/Compound
Tasks/Run Guard before deferring anything, and a background idle-warm-up so deferred types still
populate without requiring a click in the common case.

---

## Key Design Decisions

- **Setting**: `workspaceTasks.discovery.lazyTaskTypes` (boolean, default `false` — opt-in until
  proven stable; can default `true` in a later minor version once field feedback is in).
- **Deferred unit**: one task-type group (matches `refreshProvider(type)` granularity), not
  per-file or per-subproject.
- **Trigger to populate a deferred type**:
  1. User expands its group in the tree (`TreeDataProvider.getChildren` for that group node).
  2. Any of: Quick Open, `#wTasks`/`#runWTask` LM tools, CodeLens resolution, Favorites/Recent
     Tasks/Compound Tasks/Run Guard lookups that reference a task ID whose type isn't yet
     populated — these call `TaskCacheService.ensureProviderLoaded(type)` (new method) and await
     it before answering, rather than returning "not found."
  3. A background idle-warm-up timer (default 8s after activation, configurable via
     `workspaceTasks.discovery.lazyWarmupDelayMs`) triggers remaining deferred types automatically
     if the user hasn't interacted yet — bounds worst-case "feature silently empty" surprise while
     still giving fast-path benefit to sessions where the user acts within that window.
- **Group UI while deferred**: group node shows a neutral placeholder (e.g. "Click to discover…")
  instead of a task count; on expand, shows the existing loading spinner pattern
  (`loadingProviders`) until populated.
- **No change to `TaskFilesService`'s combined glob scan** — it continues to register all
  patterns and scan up front; this plan only defers the per-provider processing step after files
  are known, consistent with what the architecture can actually deliver.
- **Baseline requirement**: before shipping, capture before/after timing logs (same methodology as
  `workspace-tasks-loading-performance/baseline.log`) on a real multi-type workspace, to confirm
  actual measured gains rather than assumed ones — log results the same way prior perf plans did
  (`results-phaseN.log`).

---

## Phases

### Phase 1: Force-Discovery Fallback (ship first, independent of laziness)

1. `TaskCacheService.ensureProviderLoaded(type): Promise<void>` — resolves immediately if already
   loaded, otherwise triggers and awaits `refreshProvider(type)`.
2. Audit and update Quick Open, LM tools (`getTasksTool`/`runWTaskTool`), CodeLens resolution,
   Favorites/Recent/Compound/Run Guard lookup paths to call `ensureProviderLoaded()` for any
   type referenced by a stored ID before treating it as "not found."
3. No laziness enabled yet — this phase is a safety net that must land and be tested before
   Phase 2 introduces any deferral.

### Phase 2: Opt-in Lazy Discovery

1. `workspaceTasks.discovery.lazyTaskTypes` setting; when `true`, `TaskCacheService.refresh()`
   skips `getTasks()` for providers with zero prior expansions this session.
2. Tree group placeholder + on-expand trigger wired to `ensureProviderLoaded()`.
3. Idle warm-up timer (`lazyWarmupDelayMs`) as a safety net for the common case.
4. Baseline/measurement logs on a representative multi-type test workspace; document actual
   before/after numbers in this plan folder, following the existing perf-plan convention.

### Phase 3: Tuning (only if Phase 2 measurements justify it)

1. Consider default flip to `true` once field feedback confirms no regressions in the
   cache-dependent features audited in Phase 1.
