# Plan: Task Quick Open (Fuzzy Search)

## TL;DR

Add a `workspaceTasks.quickOpen` command that presents a `vscode.QuickPick` populated with all
discovered tasks, supporting fuzzy name matching, recent-task boosting, and inline run-with-args.
This gives power users a keyboard-first way to find and execute any task instantly without
navigating the tree view.

---

## Self-Critique & Viability Assessment

**Strengths:**

- VS Code's built-in `QuickPick` API is mature and provides fuzzy matching, keyboard navigation,
  and previews with zero custom rendering code.
- All task data is already available from `TaskCacheService` — no new discovery logic is needed.
- Complements rather than replaces the tree view; users can continue using whichever interface fits
  their workflow.
- "Recent tasks at the top" naturally makes this the fastest path for repetitive task execution —
  faster even than clicking Favorites because it requires no mouse movement.
- Trivial to bind to a keyboard shortcut (default: unbound; recommended: `Ctrl+Alt+T`).

**Risks / Weaknesses:**

- **Staleness**: If the task cache hasn't been populated yet (cold start), the picker may be empty
  or show a spinner. Must handle the loading state gracefully (show "Discovering tasks…" item or
  progress indicator while awaiting `TaskCacheService.isReady()`).
- **Label collisions**: Many task types produce identically labeled tasks (e.g. multiple
  `package.json` files each have a `"build"` script). The picker must display disambiguating
  detail text (workspace folder + source file path) alongside each item.
- **Input overlap with "Run with Args"**: Some users will expect the quick open itself to accept
  arguments after a separator character (e.g. `build -- --watch`). This adds parsing complexity.
  Consider deferring argument support to a separate follow-up.
- **Performance at scale**: Workspaces with thousands of tasks (monorepos) may make the picker
  slow to open if all items are built synchronously. Use `QuickPick.items` assignment in a
  microtask after the picker appears to avoid blocking the UI thread.

**Verdict:** High-value, low-risk addition. The only non-trivial engineering is the loading-state
handling and the label disambiguation. Argument support should be Phase 2.

---

## Key Design Decisions

- **Command**: `workspaceTasks.quickOpen` — registered in `package.json` with a title of
  "Workspace Tasks: Quick Open Task".
- **Sorting**: Recent tasks first (by `RecentTasksService` order), then Favorites, then alphabetical
  by label within each group. Groups separated by `QuickPickItem` separators.
- **Detail line**: `{workspaceFolder} › {relativeSourcePath}` — gives enough context to
  distinguish duplicates without being verbose.
- **Run with args inline**: A **"$(run-all) Run with args…"** button in each item's `buttons`
  array (requires VS Code ≥ 1.86 `QuickPickItem.buttons`). When clicked, the picker is replaced
  by a single `vscode.window.showInputBox()` for the arguments.
- **Accepted item action**: On `onDidAccept`, close the picker and call `TaskRunner.runTask(item)`.
- **Keyboard shortcut suggestion**: Show a one-time notification after the first use suggesting
  the user bind `workspaceTasks.quickOpen` to a shortcut. Dismissed permanently via
  `globalState`.

---

## Phases

### Phase 1: Core Command & QuickPick

1. **`src/commands/quickOpenCommand.ts`** — New command handler:
   - Creates a `vscode.QuickPick<ITaskQuickPickItem>` (extend `vscode.QuickPickItem`).
   - `ITaskQuickPickItem` adds `taskItem: TaskItem` for resolution on accept.
   - Shows picker immediately (before data loads) with `busy = true`.
   - Calls `TaskCacheService.getInstance().getAllCachedItems()` (or equivalent) to get all
     `TaskItem` objects.
   - Sorts: recent first, favorites second, remainder alphabetically.
   - Builds `QuickPickItem[]` asynchronously; sets `picker.items` in one assignment to avoid
     flicker.
   - Sets `picker.busy = false` once items are assigned.
   - On `onDidAccept`: resolves selected item, disposes picker, calls
     `TaskRunner.getInstance().runTask(item)`.
   - On `onDidTriggerItemButton` (run-with-args button): disposes picker, prompts for args via
     `vscode.window.showInputBox`, then calls `TaskRunner.getInstance().runTask(item, args)`.

2. **`src/commands/index.ts`** — Export and register `QuickOpenCommand`.

3. **`package.json`**:
   - Add `workspaceTasks.quickOpen` to `contributes.commands` with title and icon (`$(search)`).
   - Add to `contributes.menus`:
     - `view/title` for `workspaceTasks` view (icon button in tree title bar).
     - `commandPalette` entry (always visible).

4. **`src/extension.ts`** — Register the command in `activate()`.

### Phase 2: Label Grouping & Disambiguation

1. Add `QuickPickItem` separators between groups (Recent, Favorites, All Tasks).
2. Dedupe tasks with identical labels by appending a disambiguator in `description`:
   `npm — package.json` vs `npm — packages/ui/package.json`.
3. Add `matchOnDescription = true` and `matchOnDetail = true` on the picker so users can type
   part of the source path as a filter.

### Phase 3: Run-with-Args Inline Support

1. Enable the `$(run-all)` button in `QuickPickItem.buttons` (guarded by a VS Code version check
   for the `buttons` API; gracefully degraded to "run task, then prompt for args").
2. Parse `input.split(' -- ', 2)` to split task label from trailing arguments if the user manually
   types `-- arg1 arg2` in the picker search box, as a power-user shortcut.

### Phase 4: Keyboard Shortcut Nudge

1. On first successful quick-open execution, check `globalState.get('quickOpenNudgeDismissed')`.
2. If not dismissed, show `vscode.window.showInformationMessage` suggesting the user assign a
   keybinding, with **"Open Keyboard Shortcuts"** and **"Don't show again"** buttons.
3. **"Open Keyboard Shortcuts"** fires `vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'workspaceTasks.quickOpen')`.

### Phase 5: Tests

1. `src/test/suite/commands/quickOpenCommand.test.ts`
   - Picker opens with `busy = true` initially, transitions to `busy = false` after items set.
   - Recent tasks appear before non-recent tasks in the item list.
   - Favorites appear before non-favorite, non-recent tasks.
   - Items with duplicate labels receive disambiguating `description`.
   - `onDidAccept` calls `TaskRunner.runTask` with correct `TaskItem`.
   - Run-with-args button calls `TaskRunner.runTask` with the entered args string.
   - Empty cache renders a no-items message gracefully.

### Phase 6: Documentation

1. **`docs/features/quick-open.md`** — New page: how to use, keyboard shortcut recommendation,
   group ordering explanation, run-with-args button usage.
2. **`README.md`** — Add **"🔍 Quick Open (Fuzzy Search)"** to the Key Features list.
3. **`docs/features/index.md`** — Add entry.
