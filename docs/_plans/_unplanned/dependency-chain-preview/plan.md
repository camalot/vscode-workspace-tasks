# Plan: Dependency Chain & Compound Task Run-Order Preview

## TL;DR

Originally proposed as a full interactive webview graph of task relationships. After review, this
plan is **substantially rescoped down**: instead of a new webview panel, enhance the tree view's
*existing* `dependsOn` child-rendering with inline run actions, and add a lightweight, non-webview
**run-order preview** (a QuickPick list, not a graph) shown before executing a Compound Task, so
users can see the sequence/parallel grouping and back out before a large queue runs. Goal: give
users visual confirmation of "what will actually run, and in what order" for both native
`dependsOn` chains and Compound Task queues, at a fraction of the original proposal's cost.

---

## Self-Critique & Viability Assessment

*(Reviewed by a rubber-duck sub-agent pass against the real codebase before finalizing this plan
— this is the idea that changed the most as a result of that review.)*

**Why the original "graph view" proposal was dropped:**

- `dependsOnLabels` metadata — the thing a dependency graph would visualize — is populated **only**
  by `vscodeTaskProvider.ts` for native `tasks.json` `dependsOn` chains. No other task type (npm,
  gradle, shell, taskfile, etc.) produces it, so a general "task relationship graph" would in
  practice cover a narrow, uncommon pattern rather than "complex multi-task builds" broadly.
- Compound Tasks (queues) are **not a graph** in the code today: `CompoundTaskService` stores each
  compound task as a flat ordered list with a single `executionType: 'sequential' | 'parallel'`
  for the *whole* queue — there is no per-step "depends on step N" data model. Rendering this as a
  graph with real edges would require inventing a data model that doesn't exist, which is a much
  larger lift than the original plan implied by framing it as "reuse existing metadata."
  Presenting a flat list as a graph is also over-engineering: a graph renderer is unwarranted UI
  complexity for what is structurally a list.
- The tree view (`taskTreeDataProvider.ts`) already renders `dependsOn` children as collapsible
  nodes today — the marginal value of a *separate* webview for the same information (without the
  compound-task half, which isn't real graph data) is low relative to a new CSP/theming/message-
  passing surface to maintain.

**Rescoped plan — strengths:**

- Reuses the tree's existing collapsible `dependsOn` rendering (already shipped) instead of adding
  a new webview; the only new work is inline affordances on nodes that already exist.
- The Compound Task run-order preview is a QuickPick (already the codebase's default pattern for
  this kind of "confirm before acting" UI, e.g. `task-quick-open`), not a new rendering surface.
- Directly funnels execution through `TaskRunner.getInstance().runTask()` (not a bypass), so
  Run Guard confirmations are preserved for any guarded task in the chain — a bug in the original
  draft's "click a node to run it" framing, now corrected.

**Remaining risks:**

- Even rescoped, "preview before running a queue" adds one extra step to Compound Task execution.
  Must be **opt-in per queue or skippable** (e.g. a "Don't ask again for this queue" checkbox-style
  QuickPick item) so it doesn't slow down users who already trust their queues.
- Parallel-execution queues don't have a single "order" to preview meaningfully beyond "these N run
  together" — the preview UI must represent parallel groups as a labeled cluster, not a fake
  sequence, to avoid implying false ordering guarantees.

**Verdict:** Go, in the rescoped low-cost form only. The original graph-view proposal is
explicitly rejected in favor of this smaller design — recorded here so the rationale isn't lost if
"dependency graph" comes up again later.

---

## Key Design Decisions

- **No new webview.** All UI lives in the existing tree view and QuickPick components.
- **Tree enhancement**: `dependsOn` child nodes (already rendered per
  `taskTreeDataProvider.ts` lines ~769–980) gain an inline `$(play)` action per child so a user can
  run an individual dependency without expanding to the top-level task list separately. No change
  to the existing collapse/expand behavior.
- **Compound Task run-order preview**: before executing a Compound Task via
  `runCompoundTask.ts`, if the queue has more than 2 items (configurable via
  `workspaceTasks.compoundTasks.previewThreshold`, default `2`), show a QuickPick (non-modal,
  cancelable) listing steps in order:
  - Sequential queues: numbered list, top to bottom.
  - Parallel queues: a single labeled group "Runs in parallel:" followed by its members,
    unordered.
  - A "Run Now" confirm item at the top/bottom and a "Cancel" item; accepting proceeds through the
    existing `TaskRunner.runTask()` path unchanged, preserving Run Guard prompts per step.
- **Per-queue opt-out**: a "Don't preview this queue again" QuickPick button persists a
  `skipPreview: true` flag on that Compound Task's stored definition (`CompoundTaskService`),
  checked before showing the preview next time.
- **Setting**: `workspaceTasks.compoundTasks.previewThreshold` (number, default `2`; `0` disables
  the preview feature entirely for users who don't want it).

---

## Phases

### Phase 1: Dependency Chain Inline Run Actions

1. Add inline `$(play)` action to existing `dependsOn` child tree items in
   `taskTreeDataProvider.ts`, wired to `TaskRunner.runTask()` for that specific child.
2. Tests: inline action appears only on dependency children, not top-level tasks; run goes through
   Run Guard like any other task run.

### Phase 2: Compound Task Run-Order Preview

1. `runCompoundTask.ts` — before invoking execution, build and show the QuickPick preview when
   `previewThreshold` is exceeded and the queue isn't flagged `skipPreview`.
2. `CompoundTaskService` — add `skipPreview` flag to stored compound task definitions; expose a
   setter reachable from the QuickPick button.
3. `workspaceTasks.compoundTasks.previewThreshold` setting in `package.json`.
4. Docs: update `docs/features/compound-tasks.html`-equivalent source page with the new preview
   behavior and opt-out; README bullet update.
5. Tests: sequential vs. parallel rendering, threshold gating, skip-preview persistence, Run Guard
   preserved on confirm.
