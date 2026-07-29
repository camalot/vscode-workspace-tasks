# Plan: Task Run Recipes (Saved Argument Presets)

## TL;DR

Let users save a named set of "Run with Args" inputs (arguments and, optionally, env var
overrides) per task — e.g. save `--coverage --watch` for a `test` task as **"Coverage Watch"**.
Recipes are stored per-task in `workspaceState` (same tier as Favorites/Recent Tasks), surfaced as
extra entries at the top of the existing "Run with Args" QuickPick, and manageable both via a
global `workspaceTasks.recipes.manage` command and via two new **right-click context menu items**
per task — **Run Recipe** and **Delete Recipe** — for fast, task-scoped management without opening
the full cross-task list. Goal: stop users retyping the same argument combinations every time
they run a parameterized task.

The save flow itself (when/how a recipe gets created) is treated as the least-settled part of
this plan — see "Save-Flow UX Risk" in the Self-Critique below. It is being folded into the last
step of "Run with Args" as an experiment to validate before considering it final.

---

## Self-Critique & Viability Assessment

*(Reviewed by a rubber-duck sub-agent pass against the real codebase before finalizing this plan.)*

**Strengths:**

- The execution hook-in point is real and low-risk: `TaskRunner.runTask()` already accepts
  `args?: string` / `varAssignments?: string[]`, so recipes only need to *supply* those values,
  not change how a task actually runs.
- Directly extends already-shipped infrastructure (`run-with-args-placeholder`,
  `script-input-enhancements`) rather than inventing a new execution path.
- Zero impact on users who never save a recipe — the QuickPick behaves exactly as it does today
  unless at least one recipe exists for the selected task.

**Risks / Weaknesses (from review):**

- **Storage location ambiguity.** The initial draft proposed storing recipes in
  `.workspace-tasks.json`, but that file's schema is oriented around *declaring tasks*, not
  personal run preferences, and recipes must apply to **any** discovered task (npm, gradle,
  shell, etc.), not just workspace-tasks-defined ones. **Resolution:** store recipes in
  `workspaceState`, keyed by the same stable task ID format `TaskStateManager` already uses for
  Favorites/Recent Tasks. An explicit, opt-in **"Export Recipes to file"** action remains
  available for teams who want to share recipes via source control — but nothing is committed
  silently.
- **Conceptual overlap with the unplanned `task-profiles` plan** — both are "named, saved,
  switchable" snapshots of user preferences over the same `workspaceState` pattern. Recipes should
  be designed so they *could* later become one more snapshot category inside Task Profiles rather
  than a fully separate subsystem with divergent versioning/drift logic. This plan explicitly
  reuses the profile plan's data-drift-check pattern (see below) for that reason.
- **ID drift.** If a script is renamed or a task's definition changes, a saved recipe can become
  orphaned (same class of problem flagged in the Task Profiles plan). Recipes must self-heal by
  being dropped silently (not shown) when their task ID is no longer known, rather than erroring.
- **Secret exposure in saved args/env.** A saved recipe can capture `--token=xxx`-style values.
  Before persisting a recipe, run it through `TaskSecretWarningService`'s existing heuristics and
  warn the user inline ("This looks like it may contain a secret — continue saving?") rather than
  silently persisting it, especially before any export-to-file action.
- **Env var override layering.** If a recipe includes env var overrides, it must slot into the
  existing 14-layer precedence in `TaskEnvService` at a clearly documented layer (recipe overrides
  sit just below manual "Run with Args" input, above workspace/task-level env). This must be
  decided explicitly, not left implicit.
- **Save-Flow UX Risk (open, explicitly flagged, not yet resolved by design alone).** Folding the
  "save as recipe?" prompt into the last step of "Run with Args" directly trades off against user
  expectations: a user who enters args expects the very next thing to happen to be "the task
  runs," not "answer a question about saving." Adding *any* step after the last arg is entered —
  even an optional, skippable one — changes that flow's shape. This is a genuine, not fully
  resolvable-on-paper risk: it needs to be tried and felt, not just reasoned about. The mitigations
  below (execution never blocks on the answer, auto-skip on exact duplicate, an easy kill-switch
  setting) reduce the cost of trying it, but do not eliminate the possibility that any prompt at
  all — however optional — is the wrong call. Treat Phase 1's save-flow as provisional and expect
  it may be replaced (e.g. by a pure post-hoc "save last run's args" command with no inline prompt
  at all) after real usage.

**Verdict:** Go, with the storage-location and secret-warning changes folded in from the start.
Low effort relative to value — the main remaining design question (env layering) is a one-time
decision, not open-ended risk. The save-flow trigger point is explicitly called out as
**provisional** and should be validated with real use before being treated as settled.

---

## Key Design Decisions

- **Storage**: `workspaceState` key `taskRunRecipes`, shape
  `Record<taskId, ITaskRunRecipe[]>`. No `globalState`/sync in Phase 1 (matches Favorites'
  default, non-synced behavior for parameterized data that is often machine/context-specific).
- **Recipe schema**:

  ```ts
  interface ITaskRunRecipe {
    id: string;            // uuid, stable across renames of the recipe itself
    name: string;           // user-facing label, e.g. "Coverage Watch"
    args: string;           // raw argument string, same format Run-with-Args already accepts
    envOverrides?: Record<string, string>; // optional
    createdAt: number;
    lastUsedAt?: number;
  }
  ```

- **QuickPick integration**: When the user invokes "Run with Args" for a task that has saved
  recipes, the picker's top section lists recipes (sorted by `lastUsedAt` desc, then `createdAt`
  desc), each showing `name` as label and `args` as detail. A separator follows, then the normal
  free-text input entry ("Enter custom arguments…") as today. Selecting a recipe runs immediately
  with its stored args/env — no extra confirmation step.
- **Saving a recipe — folded into "Run with Args" as its last step**: Rather than a separate
  post-run notification, the save prompt is the final step of the *same* multi-step input the user
  is already in, immediately after the last argument/`${input}` variable is entered and immediately
  before the task launches:
  1. **Selecting an existing recipe** from the top of the picker never triggers the save prompt —
     that path only bumps the selected recipe's `lastUsedAt` and runs.
  2. **Typing custom arguments** that, once normalized (trimmed, whitespace-collapsed), exactly
     match an existing recipe's `args` + `envOverrides` for this task also skips the prompt
     entirely — bump that recipe's `lastUsedAt` instead of asking to save a duplicate.
  3. Otherwise, show one optional input box: **"Save these arguments as a recipe? Enter a name,
     or press Enter/Esc to skip."** Task execution is **not gated** on this box — the run is
     already dispatched (or dispatches immediately on submit/skip, whichever is simpler to
     implement without perceptible delay) so a user who only wanted to run the task never
     experiences added latency, only an extra (skippable) keystroke. A non-empty name persists a
     new recipe (subject to the secret check below); empty/Escape is a silent no-op.
  4. **Kill switch**: `workspaceTasks.recipes.promptOnRunWithArgs` (boolean, default `true`).
     Setting it to `false` disables step 3 entirely — recipes can then only be created via the
     explicit `workspaceTasks.recipes.manage` "Save current args as recipe" action (Phase 2). This
     setting exists specifically so the in-flow prompt can be evaluated and abandoned cheaply if it
     proves disruptive in practice (see "Save-Flow UX Risk" above) — Phase 1 should not be
     considered a final answer on this flow.
- **Secret check on save**: Reuse `TaskSecretWarningService`'s value-pattern heuristics against
  the args string and any env override values; if a match is found, the save prompt becomes a
  warning-styled confirmation instead of a plain save.
- **Right-click management on task tree items** (in addition to the global manage command):
  - **"Run Recipe"** (`workspaceTasks.recipes.run`) — context-menu-only (not an inline icon, to
    avoid crowding the already-dense inline action row). Opens a QuickPick scoped to *this task's*
    recipes only (label = name, detail = args) — no free-text "custom arguments" entry, since that
    role is already served by "Run with Args". Selecting an item runs it immediately and bumps
    `lastUsedAt`. If the task has zero saved recipes, show an information message ("No recipes
    saved for '{taskLabel}' yet — use Run with Args to create one.") instead of opening an empty
    picker.
  - **"Delete Recipe"** (`workspaceTasks.recipes.delete`) — context-menu-only. Opens a QuickPick
    listing this task's recipes plus a distinct, visually-separated **"$(trash) Clear All ({n})"**
    item at the bottom. Selecting a single recipe deletes it immediately (low-risk, easily
    recreated). Selecting "Clear All" requires an explicit `showWarningMessage` confirmation
    ("Delete all {n} recipes for '{taskLabel}'? This cannot be undone.") before removing every
    recipe for that task, consistent with this repo's convention of confirming bulk/destructive
    actions. Same empty-state message as "Run Recipe" when there is nothing to delete.
  - Both commands are registered in the task item context menu (right-click), gated by the same
    `viewItem =~ /[tT]ask$/ && !(viewItem =~ /[cC]ompound[Tt]ask/)` condition already used by
    `workspaceTasks.copyTaskCommand` / `workspaceTasks.env.inspect`, in a dedicated `6_recipes@1`/
    `6_recipes@2` menu group — visible on every leaf task regardless of whether it currently has
    recipes (matches the existing precedent set by `workspaceTasks.metrics.clearTask`, which is
    always shown and no-ops gracefully rather than being conditionally hidden).
- **Management command**: `workspaceTasks.recipes.manage` — QuickPick listing all recipes across
  all tasks (grouped by task label), with rename/delete actions per item via QuickPick buttons,
  plus (Phase 2) a "Save current args as recipe" entry point for when the in-flow prompt is
  disabled via the kill switch above.
- **Drift handling**: On tree refresh, any recipe whose `taskId` is not present in
  `TaskCacheService` is skipped when building the QuickPick (not deleted from storage — the task
  may reappear after a provider refresh, e.g. a temporarily-closed file).
- **Env layering**: Recipe `envOverrides`, when present, apply immediately below manual
  "Run with Args" ad-hoc input and above workspace/task-level env in `TaskEnvService`'s existing
  precedence chain. Documented as a named layer, not inserted implicitly.
- **Future consolidation**: Cross-reference the `task-profiles` plan; if Task Profiles ships
  first, Recipes' storage format should be revisited to nest under a profile rather than being
  workspace-global, to avoid two parallel "saved preference" systems.

---

## Phases

### Phase 1: Core Storage, Execution & In-Flow Save (provisional)

1. `src/services/taskRunRecipeService.ts` — new singleton: `initialize(context)`,
   `getRecipes(taskId)`, `findExactMatch(taskId, args, envOverrides)`, `saveRecipe(taskId, recipe)`,
   `deleteRecipe(taskId, recipeId)`, `clearRecipes(taskId)`, `renameRecipe(taskId, recipeId, newName)`,
   `touchLastUsed(taskId, recipeId)`, `onDidChangeRecipes` event.
2. Wire into existing "Run with Args" QuickPick builder (`runTaskWithArgs.ts` /
   `runActiveEditorTaskWithArgs.ts`) to prepend recipe items and, on the custom-arguments path,
   run the last-step save prompt described above (gated by `promptOnRunWithArgs` and the
   exact-match skip check).
3. `workspaceTasks.recipes.promptOnRunWithArgs` setting in `package.json` (default `true`).
4. Secret-heuristic gating on save, reusing `TaskSecretWarningService`.

### Phase 2: Right-Click Management, Manage Command & Polish

1. `src/commands/runRecipeCommand.ts` — `workspaceTasks.recipes.run` (task-scoped QuickPick,
   empty-state message).
2. `src/commands/deleteRecipeCommand.ts` — `workspaceTasks.recipes.delete` (task-scoped QuickPick
   with per-item delete + confirmed "Clear All"; empty-state message).
3. `package.json` — register both commands and their `6_recipes@1`/`6_recipes@2` context-menu
   contributions (context-menu only, no inline icons).
4. `src/commands/manageRunRecipesCommand.ts` — `workspaceTasks.recipes.manage` (cross-task list)
   plus a "Save current args as recipe" entry for when the in-flow prompt is disabled.
5. "Export Recipes to file" action (explicit, manual — writes a JSON file via
   `showSaveDialog`, never silent).
6. Docs: new `docs/features/task-run-recipes.md` page documenting both the in-flow save step
   (and its kill switch) and the right-click management commands; README feature bullet.
7. Tests: recipe QuickPick ordering, drift-skip behavior, secret-heuristic gating on save,
   env-layer precedence in `TaskEnvService`, exact-match skip logic, empty-state messaging for
   both context-menu commands, and confirmed "Clear All" behavior.
