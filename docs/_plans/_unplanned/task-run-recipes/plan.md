# Plan: Task Run Recipes (Saved Argument Presets)

## TL;DR

Let users save a named set of "Run with Args" inputs (arguments and, optionally, env var
overrides) per task — e.g. save `--coverage --watch` for a `test` task as **"Coverage Watch"**.
Recipes are stored per-task in `workspaceState` (same tier as Favorites/Recent Tasks). When a task
has saved recipes, a new capped/sorted picker step (top 5 by recency, with overflow and inline
delete — see "UI Scaling") appears ahead of today's existing "Run with Args" flow; tasks with no
recipes see no change at all. Recipes are manageable both via a global
`workspaceTasks.recipes.manage` command and via two new **right-click context menu items** per
task — **Run Recipe** and **Delete Recipe** — for fast, task-scoped management without opening the
full cross-task list. Goal: stop users retyping the same argument combinations every time they run
a parameterized task, without turning the picker into a wall of stale entries as recipes
accumulate.

The save flow itself (when/how a recipe gets created) is treated as the least-settled part of
this plan — see "Save-Flow UX Risk" in the Self-Critique below. It uses a post-run notification
(not an inline prompt) as an experiment to validate before considering it final.

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
- **Save-Flow UX Risk — resolved by switching from an inline prompt to a post-run notification.**
  An earlier draft folded a "save as recipe?" *input box* into the last step of "Run with Args",
  after the last argument/`${input}` variable but before launch. Even made "skippable" via
  Escape, an input box still steals focus and costs a deliberate dismissal on every single custom
  run — that's an ongoing tax for users who never want to save anything. **Resolution:** the task
  is dispatched immediately with no gating step at all, and only *after* dispatch does a
  non-modal `vscode.window.showInformationMessage` toast appear with a single **"Save as
  Recipe"** action. Ignoring it costs nothing (no keystroke, no stolen focus, no blocking of the
  already-running task); only clicking the action opens a name prompt. This is still new surface
  area and should be treated as provisional — the exact-duplicate skip and kill-switch setting
  below exist specifically so it can be dialed back or removed cheaply if it proves noisy in
  practice.
- **Reality check: "Run with Args" is not currently a QuickPick.** [runTaskWithArgs.ts](../../../../src/commands/runTaskWithArgs.ts)
  drives either guided per-parameter prompts or a loop of free-text `showInputBox` calls
  ([collectAdditionalArgs](../../../../src/libs/guidedArgInput.ts)) — there is no existing item list to "prepend recipes
  to". Recipes must introduce one new, *conditional* `showQuickPick` step ahead of the existing
  flow — conditional so that tasks with zero saved recipes see **no new step at all** and the
  current input-box behavior is completely unchanged for them.
- **Reality check: the secret matcher works on key names, not arbitrary strings.**
  [`TaskSecretWarningService.matchesAnyPattern(key, patterns)`](../../../../src/services/taskSecretWarningService.ts) glob-matches a
  single *key name* (e.g. an env var name) against `workspaceTasks.envVars.secretPatterns` — it
  has no facility for scanning a free-form string like `--token=abc123` for secret-looking
  values. Reusing it for recipe args means parsing each `--flag=value` / `-flag value` token to
  extract the flag name first, then running just that name through the existing matcher. For
  `envOverrides` this requires no parsing — the keys are already discrete.
- **UI noise at scale.** A per-task recipe list that only ever grows will eventually turn the
  "helpful shortcut" into a wall of stale entries the user has to read past every time. Addressed
  directly under "UI Scaling" below: hard-capped visible list, recency-based ordering so unused
  recipes sink out of view on their own, inline delete, and a soft nudge (never silent deletion)
  toward pruning once a task's recipe count gets large.

**Verdict:** Go, with the storage-location, secret-warning, and save-flow corrections folded in
from the start. Low effort relative to value — the main remaining design question (env layering)
is a one-time decision, not open-ended risk. The notification-based save trigger and the list-cap
behavior are the two provisional pieces most likely to need tuning after real usage.

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

- **Entry-point integration (conditional, not a rewrite of existing input)**: `runTaskWithArgs`
  and `runActiveEditorTaskWithArgs` check `TaskRunRecipeService.getRecipes(taskId)` *before*
  starting today's guided/free-text flow. If the task has **zero** saved recipes, behavior is
  byte-for-byte unchanged — no new step, no picker, nothing to read past. If it has one or more,
  a single `showQuickPick` step is inserted first: items are the capped/sorted recipe list (see
  "UI Scaling" below) plus a final, always-present item **"Enter custom arguments…"** which hands
  off directly into the existing `tryGuidedInputWithStatus` / `collectAdditionalArgs` flow,
  unchanged. Selecting a recipe instead runs immediately with its stored `args`/`envOverrides` —
  no extra confirmation step, and bumps `lastUsedAt`.
- **Saving a recipe — post-run notification, not an inline prompt**: the task is dispatched the
  moment args are collected, exactly as today, with zero added latency or gating step. Only
  *after* dispatch:
  1. **Selecting an existing recipe** never triggers a save notification — that path only bumps
     `lastUsedAt`.
  2. **Custom arguments** that, once normalized (trimmed, whitespace-collapsed), exactly match an
     existing recipe's `args` + `envOverrides` for this task also skip the notification — bump
     that recipe's `lastUsedAt` instead of offering to save a duplicate.
  3. Otherwise, show one non-modal `vscode.window.showInformationMessage` with a single action:
     **"Save these arguments as a recipe?"** / action button `Save as Recipe`. It does not block,
     does not steal focus from the task's terminal, and disappears on its own if ignored — the
     cost of *not* wanting a recipe is exactly zero. Clicking the action opens a `showInputBox`
     for the recipe name (subject to the secret check below); dismissing the notification or
     never clicking it is a silent no-op.
  4. **Kill switch**: `workspaceTasks.recipes.notifyOnRunWithArgs` (boolean, default `true`).
     Setting it to `false` disables step 3 entirely — recipes can then only be created via the
     explicit `workspaceTasks.recipes.manage` "Save current args as recipe" action (Phase 2).
- **Secret check on save**: Parse the args string into `--flag=value` / `-flag value` tokens and
  extract just the flag/key portion of each (e.g. `--token=abc123` → `token`); run each extracted
  key, plus every `envOverrides` key, through the existing
  `TaskSecretWarningService.matchesAnyPattern(key, secretPatterns)` glob matcher (same
  `workspaceTasks.envVars.secretPatterns` setting already used for env files). This service
  matches key *names*, not values, so no new heuristic engine is needed — only a small tokenizer.
  If any key matches, the save action becomes a `showWarningMessage` confirmation instead of
  proceeding straight to the name `showInputBox`.

### UI Scaling — keeping the recipe list from becoming noise

The single biggest failure mode for this feature is a task accumulating enough recipes that the
picker becomes something the user has to read past rather than a shortcut. Mitigations, all in
Phase 1 (not deferred, since the list is the *first* thing a user sees):

- **Hard cap on visible items: top 5.** Sorted by `lastUsedAt` desc (falling back to `createdAt`
  desc for never-reused recipes). This is self-maintaining — a recipe a user stops using
  naturally sinks out of the visible top 5 without any manual pinning/archiving feature needed for
  v1.
- **Overflow, not truncation.** When more than 5 recipes exist for a task, item 5 is replaced by
  a separator followed by **"$(list-unordered) Show all {n} recipes for '{taskLabel}'…"**.
  Selecting it opens a second `showQuickPick` with the full list and VS Code's built-in fuzzy
  filter box — appropriate once a user has opted into browsing a longer list, but never the
  default view.
- **Inline delete, right where the noise is.** Each recipe `QuickPickItem` gets a trash-icon
  `button` (`onDidTriggerItemButton`) so a stale entry can be pruned the moment it's noticed,
  without leaving the picker or invoking a separate command.
- **Soft cap with a nudge, never silent deletion.** When saving a *new* recipe would push a
  task's count past 10, the save notification/confirmation gets one extra line — *"You now have
  {n} recipes for this task — [Manage Recipes]"* — linking to `workspaceTasks.recipes.manage`
  scoped to that task. The save still succeeds; nothing is auto-deleted or blocked. This treats
  "too many recipes" as a user problem to nudge toward fixing, not a system problem to solve by
  discarding their data.
- **Deferred, not built now:** usage-count-weighted ordering and manual pinning are called out as
  a possible Phase 3 if recency-only ordering proves insufficient in practice — not worth the
  complexity until the recency-based cap is validated with real usage.
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
  plus (Phase 2) a "Save current args as recipe" entry point for when the post-run notification is
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

### Phase 1: Core Storage, Execution & Post-Run Save (provisional)

1. `src/services/taskRunRecipeService.ts` — new singleton: `initialize(context)`,
   `getRecipes(taskId)` (returns full list; capping/overflow is a picker-building concern, not a
   service concern), `findExactMatch(taskId, args, envOverrides)`, `saveRecipe(taskId, recipe)`,
   `deleteRecipe(taskId, recipeId)`, `clearRecipes(taskId)`, `renameRecipe(taskId, recipeId, newName)`,
   `touchLastUsed(taskId, recipeId)`, `onDidChangeRecipes` event.
2. Wire into `runTaskWithArgs.ts` / `runActiveEditorTaskWithArgs.ts`: insert a conditional
   `showQuickPick` step (recipes present only) ahead of the existing guided/free-text flow, capped
   to top-5-by-`lastUsedAt` plus a "Show all N…" overflow item and trash-icon item buttons as
   described under "UI Scaling". On the custom-arguments path (including the fallback when no
   recipes exist yet), after the task is dispatched, show the post-run `showInformationMessage`
   save action (gated by `notifyOnRunWithArgs` and the exact-match skip check) plus the soft-cap
   nudge line once a task's recipe count exceeds 10.
3. `workspaceTasks.recipes.notifyOnRunWithArgs` setting in `package.json` (default `true`).
4. Secret-check gating on save: tokenize `args` into flag names and check them, plus every
   `envOverrides` key, via `TaskSecretWarningService.matchesAnyPattern`.

### Phase 2: Right-Click Management, Manage Command & Polish

1. `src/commands/runRecipeCommand.ts` — `workspaceTasks.recipes.run` (task-scoped QuickPick,
   empty-state message).
2. `src/commands/deleteRecipeCommand.ts` — `workspaceTasks.recipes.delete` (task-scoped QuickPick
   with per-item delete + confirmed "Clear All"; empty-state message).
3. `package.json` — register both commands and their `6_recipes@1`/`6_recipes@2` context-menu
   contributions (context-menu only, no inline icons).
4. `src/commands/manageRunRecipesCommand.ts` — `workspaceTasks.recipes.manage` (cross-task list)
   plus a "Save current args as recipe" entry for when the post-run notification is disabled.
5. "Export Recipes to file" action (explicit, manual — writes a JSON file via
   `showSaveDialog`, never silent).
6. Docs: new `docs/features/task-run-recipes.md` page documenting the post-run save notification
   (and its kill switch), the recipe-picker overflow/cap behavior, and the right-click management
   commands; README feature bullet.
7. Tests: recipe picker cap/overflow/sort ordering, inline delete via item button, drift-skip
   behavior, secret-token-parsing gating on save, env-layer precedence in `TaskEnvService`,
   exact-match skip logic, soft-cap nudge threshold, empty-state messaging for both context-menu
   commands, and confirmed "Clear All" behavior.
