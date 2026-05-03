# Plan: Task Run History with Arguments (UX Design Concepts)

## TL;DR

When users run tasks — especially Taskfile tasks with required variables or shell tasks with
custom arguments — the extension does not remember what arguments were used. This plan explores
UX design options for **capturing arguments at run time**, **displaying them in history**, and
**providing a way to re-run a task with the exact same arguments again**.

---

## Design Review Notes

This document was rubber-ducked against a UX/architecture critique sub-agent after the initial
draft. The following are the most significant issues raised and what was done with each:

| Feedback item | Action taken |
|---|---|
| **Sensitive value redaction is a UX design decision, not an open question** — masking affects every display surface and must be resolved before any option ships | Added a dedicated [Sensitive Value Handling](#sensitive-value-handling) section with concrete UX decisions (redaction heuristic, display patterns, export rules) |
| **Task definition drift is the highest-risk operational gap** — stored invocations reference variable names that may be renamed or removed in the Taskfile | Added to Open Questions with a concrete UX recovery path proposal |
| **Option F's per-variable history creates incoherent arg combinations** — `ENV=prod` from one run + `TARGET=eu-west-1` from a different run produces a combination never actually used | Revised Option F to pre-fill from the most recent *complete invocation*, not per-variable history; updated the hybrid recommendation accordingly |
| **Option D's tree "sub-label" layout is not standard `TreeItem`** — `TreeItem` has `label`, `description`, `tooltip` but not a second line below the label | Added a design note in Option D clarifying this requires a webview list renderer, not a standard tree |
| **Workspace trust is entirely absent** — all re-run paths must check `vscode.workspace.isTrusted` | Added workspace trust requirement to all re-run UX descriptions and to the Phase 1 scope |
| **Comparison matrix uses three incompatible rating scales** | Standardised to High/Medium/Low/None throughout |
| **`$(debug-rerun)` icon has debugger connotations** | Updated icon recommendation to `$(refresh)` / `$(history)` |
| **Auto-save toast in Option B is an anti-pattern** (VS Code guidelines caution against notification overuse; defaulting to `"never"` makes the toast vestigial) | Removed auto-save toast; replaced with a passive "pin from history" workflow only |
| **Option C's two-command split fragments discoverability** | Consolidated to a single command with Quick Pick separators |
| **Option A's "sortable by combined arg string" column is useless** | Removed; column is not sortable |
| **Phase plan was entirely absent** | Added a [Phasing Sketch](#phasing-sketch) section |
| **Recents / Favorites / invocations relationship is undefined** | Added to Open Questions |
| **Open Question Q6 (argument diff) is scope creep** | Removed |
| **Accessibility / touch — tooltips are inaccessible** | Added accessibility notes to relevant options |

---

## Background & Problem Statement

### What arguments exist today

The extension supports two categories of runtime argument:

1. **Shell args** (`args: string`) — an arbitrary string appended to the command line, available
   on most task types.
2. **Taskfile variable assignments** (`varAssignments: string[]`) — prompted via
   `promptAndResolveRequiredVars()` when a Taskfile task declares `vars:` with `required: true`.
   These produce tokens like `ENV='prod'` or `TARGET='staging'`.

Both are passed through `TaskRunner.runTask()` and reach `createTaskForItem()`, but neither is
currently stored in `ITaskExecutionRecord`. Once a task finishes, the argument context is lost.

### User personas

| Persona | Pain point |
|---|---|
| **Solo developer** | Runs `deploy ENV=prod TARGET=us-east-1` repeatedly; re-typing is friction |
| **Team member (auditor/lead)** | Needs to see *what* was passed to a task, not just *whether* it succeeded |
| **New team member onboarding** | Wants to see what arg combinations colleagues use before running a task themselves |
| **Multi-environment user** | Regularly alternates between dev / staging / prod arg sets; wants to select from past invocations rather than type each time |

### Key user pain points

- **Repeatability**: No record of past arg combinations; must re-type or remember manually.
- **Auditability**: History shows outcomes but not inputs.
- **Collaboration**: Sharing a specific parameterised invocation requires copy-pasting out of a
  terminal or documentation.
- **Multi-environment workflows**: No structured way to switch between known arg sets.

---

## Scope of This Document

This is a **UX design-only** document. Data schema, persistence strategy, and migration are
deferred. The goal is to evaluate multiple design approaches at the interaction level, identify
their tradeoffs, and produce enough specificity to choose a direction.

**In scope for all options unless noted:**
- Taskfile variable assignments (`varAssignments`).
- Shell args strings (`args`).
- All task types that currently support these inputs (npm scripts, shell tasks, and others).

**Out of scope in this document:**
- CI/CD pipeline runs (non-interactive execution).
- Multi-root workspace disambiguation (tracked in Open Questions).
- Argument diff view between history rows.

---

## Terminology

| Term | Meaning |
|---|---|
| **Run** | A single recorded execution of a task |
| **Invocation** | A Run plus its complete argument context (args string + var assignments), stored as a unit |
| **Preset** | A user-saved, named Invocation that can be re-used intentionally |
| **Re-run** | Triggering a task again using the argument context from a past Invocation |
| **Complete invocation** | An Invocation where all arguments are stored together as a single snapshot (not per-variable) |

---

## Sensitive Value Handling

This is a **design-level decision** that affects every display surface in every option. It must
be resolved before any option ships.

### Problem

Variable assignments may contain secrets: `API_KEY=abc123`, `AWS_SECRET_ACCESS_KEY=xyz`,
`DB_PASSWORD=hunter2`. If stored and displayed unredacted, they are at risk in:
- History table / tree tooltip display.
- Export files committed to source control.
- Clipboard copy actions.
- Log files.

### UX Decisions (applicable to all options)

**Detection heuristic**: A value is treated as sensitive if its variable name matches any of:
`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL`, `*_PASS`, `*_AUTH`, `*_CERT`,
or exact names `TOKEN`, `SECRET`, `PASSWORD`, `KEY`. This is a conservative heuristic applied
at storage time; false positives are acceptable.

**Storage**: Sensitive values are **never stored** in `ITaskExecutionRecord`, `workspaceState`,
`globalState`, or any exported file. When a sensitive variable is detected, its value is replaced
with the placeholder `[redacted]` at capture time (before any write).

**Display**: Redacted values render as `••••••` in all history surfaces with a lock icon
(`$(lock)`) alongside. A "reveal" affordance is **not** provided — the value is gone at storage
time, not merely hidden.

**Re-run with redacted values**: If an invocation contains one or more redacted variables, the
`↩ Re-run with same args` action is replaced by `↩ Re-run with edits...` only — the user must
re-enter the sensitive values. A tooltip on the action explains why: `"Some arguments were not
stored for security reasons. Re-enter them to run."`.

**Export (Option D only)**: Files written to `.vscode/task-presets.json` contain only
non-sensitive values. Variables with `[redacted]` values are excluded from the exported object
entirely. The export UI shows a warning: `"N sensitive values were excluded from the export."`

**Workspace-trust gate**: All re-run actions and argument storage require
`vscode.workspace.isTrusted` to be `true`. In untrusted workspaces, history is read-only and no
re-run actions are available.

---

## Design Option A — Augmented History Table with Inline Re-run

### Concept

The existing Task History table is extended to capture and display argument context alongside
every execution. Each row with non-empty arguments gets an expandable argument summary. A
**Re-run** context menu action on any row re-launches the same task with the identical argument
context.

### UX Details

**Arguments Column (table)**
- A new `Arguments` column appears after `Task`.
- Displayed at a fixed max-width with consistent truncation (not auto-sized; avoids visual
  flickering as rows are added).
- Short strings (≤ 40 chars) are shown inline in monospace; longer strings are truncated with
  `...` and a tooltip shows the full value on hover.
- Rows with no arguments display an em dash `—`.
- The column is **not sortable** (sorting on a concatenated argument string has no practical
  value). The column can be hidden via the column visibility menu.
- Sensitive values render as `••••••` with `$(lock)` (see [Sensitive Value Handling](#sensitive-value-handling)).

**Expanded Argument Detail Panel**
- Clicking anywhere on the row (outside action targets) expands a sub-row showing:
  - **Shell args**: monospace code block.
  - **Variable assignments**: key → value table. Sensitive values show `••••••`.
- A `$(copy)` icon next to each value copies the display value to clipboard (i.e., `[redacted]`
  is what is copied for sensitive values, not the original).

**Accessibility note**: The tooltip-only display of arguments in the truncated state is
inaccessible on touch and invisible to screen readers. The expanded detail panel (keyboard
accessible via Enter on the row) is the primary accessible path.

> **Note on row expansion + virtualization**: Modern virtualized table implementations (likely
> used for performance in the history webview) cannot expand rows in-place without custom
> rendering. This design requires a custom row-expansion mechanism, not a simple `<details>`
> element. Implementation must plan accordingly.

**Re-run Action (context menu)**
- Right-click a row → `↩ Re-run with same args`: immediately executes the task with the stored
  args. Disabled in untrusted workspaces.
- Right-click a row → `↩ Re-run with edits...`: opens the argument prompt pre-filled with stored
  values.
- If the invocation contains redacted values, only `↩ Re-run with edits...` is available.
- These actions are context-menu only — not inline column buttons — to avoid conflating the
  history table's read-only audit semantics with executable actions.

**Filter: "Has Arguments"**
- A toggle in the filter bar: `Has Arguments`. When active, only rows with non-empty argument
  context are shown. This toggle ANDs with existing status filters.

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | High — arguments always visible in the table |
| **Audit / visibility** | High — full argument context scannable at a glance |
| **Re-run discoverability** | Medium — context menu is not immediately obvious |
| **UI complexity** | Medium — new column, row expansion, filter toggle |
| **Persistent presets** | None — history rows are ephemeral |
| **Team sharing** | None |
| **Implementation risk** | Medium — row expansion in virtualized table is non-trivial |

---

## Design Option B — "Saved Invocations" Subtree in Task Explorer

### Concept

Beneath each task item in the Task Explorer tree, a collapsible **Saved Invocations** child
group appears. User-pinned invocations are shown as named child nodes. Clicking a Saved
Invocation node immediately runs the task with its stored arguments. The group is hidden when
empty.

### UX Details

**Tree Structure**

```
▼ Task Explorer
  ▼ Taskfile
    ▼ deploy                                  ← existing task item
      ▼ Saved Invocations                     ← new collapsible group (hidden when empty)
          ↩ Deploy to Prod   [2 days ago]     ← saved invocation node
          ↩ Deploy to Staging  [1 week ago]
```

**Node Anatomy**
- Icon: `$(refresh)` (neutral; avoids debugger-icon connotations of `$(debug-rerun)`).
- Label: User-provided name (after rename) or auto-generated from argument summary:
  comma-separated `KEY=value` pairs truncated at 40 chars; shell args string truncated at 40
  chars. Auto-generated labels use `KEY=value` format consistently.
- Description (right-justified): Relative time of the most recent run using these args.
- Tooltip: Full argument breakdown (key → value table) + run count + success rate. Sensitive
  values shown as `••••••`.

**Saving an Invocation**
Saving is entirely **user-initiated** — there is no automatic toast or auto-save:
- Context menu on any History row → `Pin as Invocation`.
- Context menu on any History tree node → `Pin as Invocation`.
- A pinned invocation is stored independently from the history record; deleting the history
  record does not remove the pinned invocation.

> **Why no auto-save toast**: VS Code extension guidelines caution against notification overuse.
> Toasting after every parameterized run would train users to dismiss reflexively. Since `"never"`
> is the only sensible default, the toast mechanism adds complexity with no practical benefit.

**Managing Saved Invocations**
- Right-click context menu on a node:
  - `↩ Run` (disabled in untrusted workspaces)
  - `↩ Run with edits...`
  - `📋 Copy arguments` (copies non-sensitive values; sensitive values excluded)
  - `✏ Rename`
  - `🗑 Delete`
- A `Clear All Saved Invocations` command in the Command Palette (with confirmation dialog).
- `workspaceTasks.invocations.maxPerTask`: Maximum saved invocations per task (default: `10`).

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | Medium — subtree only appears after first save; new users won't see it |
| **Audit / visibility** | Low — only pinned invocations visible; no full history |
| **Re-run discoverability** | High — single click on the node runs immediately |
| **UI complexity** | Medium — new tree node type, context menu entries |
| **Persistent presets** | High — explicitly named and stored |
| **Team sharing** | None |
| **Implementation risk** | Low-Medium — standard tree node, no custom rendering |

---

## Design Option C — "Quick Invocation" Command Palette & Quick Pick

### Concept

A single command **"Workspace Tasks: Run Recent or Saved Invocation"** opens a VS Code Quick
Pick showing all recent invocations and saved presets, unified in one picker with group
separators. This design prioritises keyboard-first users who already use the Command Palette for
task running.

### UX Details

**Quick Pick Anatomy**

```
$(refresh)  deploy — ENV=prod, TARGET=us-east-1
            Taskfile · 2 minutes ago · Success
```

Fields:
- **Label**: `$(icon) taskName — arg-summary` (truncated at 50 chars).
- **Description**: `source · relative-time · outcome`. Sensitive values in arg-summary shown as
  `••••••`.
- **Detail** (lighter text): Full argument string or key→value breakdown.

**Grouping (Quick Pick separators)**

```
── Saved Presets ──
  ↩ Deploy to Prod
  ↩ Deploy to Staging
── Recent (last 7 days) ──
  ↩ deploy — ENV=prod, TARGET=us-east-1  [2 min ago]
── Older ──
  ...
```

**Actions per item**
- **Enter**: Re-run immediately with stored args. Disabled in untrusted workspaces.
- **Item button `$(edit)`** (right-side): Open "Run with edits..." pre-populated.
- **Item button `$(pin)` / `$(pinned)`**: Toggle saved-preset status.

> **Accessibility note**: Quick Pick item buttons (`QuickPickItem.buttons`) are 16px icon-only
> controls with no visible label. They are poorly discoverable and should not be the primary
> path for pinning. A `Save as Preset` option in a Quick Pick overflow or separator item is a
> more accessible alternative.

**Fuzzy search scope**: Search applies to task name and argument summary text. Standard fuzzy
match only — not semantic key=value parsing. Typing `ENV=prod` surfaces items containing that
string via fuzzy matching.

**Keyboard binding**: None assigned by default; user-assignable. Appears in the Command Palette
as `Workspace Tasks: Run Recent Invocation`.

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | Low — command-only; invisible to mouse-first users |
| **Audit / visibility** | Low — only recent/saved invocations shown, not full history |
| **Re-run discoverability** | Medium — obvious once the command is known |
| **UI complexity** | Low — no new panels or tree nodes |
| **Persistent presets** | High — pinning is in-picker |
| **Team sharing** | None |
| **Keyboard-first UX** | High |
| **Implementation risk** | Low |

---

## Design Option D — Dedicated "Run Presets" Side Panel

### Concept

A standalone VS Code panel **"Run Presets"** is added as a tab in the Task sidebar. It provides
a grouped list of all user-saved invocations across all tasks, with full management capabilities.
Best suited for teams that maintain a stable, named set of parameterised invocations.

### UX Details

**Panel Layout**

```
┌────────────────────────────────────────────┐
│  Run Presets                    [+] [🔍]   │
├────────────────────────────────────────────┤
│ ▼ Taskfile                                  │
│   ↩ Deploy to Prod                          │
│     ENV=prod, TARGET=us-east-1  ✅ 2h ago  │
│   ↩ Deploy to Staging                       │
│     ENV=staging, TARGET=eu-west-1  ✅ 3d   │
│ ▼ npm                                       │
│   ↩ Build (watch mode)                      │
│     --watch --sourcemaps  ✅ 10m            │
└────────────────────────────────────────────┘
```

> **Implementation constraint**: Standard VS Code `TreeItem` does not support a second line of
> text below the label (`description` renders to the right, not below). The layout above —
> with the argument summary on a subordinate line — **requires a custom webview list renderer**,
> not a standard `TreeDataProvider`. This is the most significant implementation risk in this
> option and must be explicitly scoped before choosing it.

**Node Anatomy**
- Icon: `$(refresh)`, coloured with last-run status (green = success, red = failed).
- Label (bold): User-provided name or auto-generated summary.
- Subordinate line (lighter, indented — webview only): Truncated argument string. Sensitive
  values shown as `••••••`.
- Description area: Relative time of last execution.

**Creating a Preset**
- `[+]` toolbar button: Opens a three-step flow:
  1. Quick pick to select a task.
  2. Argument input (same guided-input UI as task run).
  3. Name the preset (optional; defaults to auto-generated summary).
- `Save as Preset` context menu on any History row.
- `Save as Preset` context menu on any History tree node.

**Managing Presets**
- Right-click menu: `↩ Run` (disabled in untrusted workspaces), `↩ Run with edits...`,
  `📋 Copy arguments`, `✏ Rename`, `🗑 Delete`.
- `[🔍]` toolbar: Inline search filtering by name or argument content.
- Drag-and-drop reordering within a group.

**Export to source control**
- Presets can be exported to `.vscode/task-presets.json`. Sensitive values are **never written**
  to this file (see [Sensitive Value Handling](#sensitive-value-handling)).
- The export UI shows an explicit warning: `"This file will be committed to source control if
  not added to .gitignore. Sensitive values have been excluded."`
- On workspace open, if `task-presets.json` exists, its contents are shown as a read-only
  **Shared Presets** sub-group. Users can adopt individual shared presets into their personal list.

> **Note**: A clipboard-based "Share via JSON snippet" action was considered and rejected.
> Copying potentially sensitive-named variables to clipboard for sharing via chat is a security
> anti-pattern. File-based export only.

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | High — always-visible panel |
| **Audit / visibility** | Medium — preset-centric, not full history |
| **Re-run discoverability** | High — single click |
| **UI complexity** | High — new panel, new data schema, webview renderer |
| **Persistent presets** | High |
| **Team sharing** | High — file-based export |
| **Implementation risk** | High — requires custom webview list renderer |

---

## Design Option E — History Row "Re-run with Same Args" Context Menu Only (Lightweight)

### Concept

The most minimal option: arguments are added to `ITaskExecutionRecord` for display and one-click
re-run in the existing history UI only. No new panels, no new columns. The history tree and table
both gain context menu actions. There is no "save" or "preset" concept — re-runs are only
available while the history record exists.

### UX Details

**History Tree Enhancement**
- Each history node's tooltip is extended with an `Arguments:` section listing args and var
  assignments (sensitive values shown as `••••••`).
- Right-click a history node:
  - `↩ Re-run with same args` — appears only when args are present and workspace is trusted.
  - `↩ Re-run with edits...` — available regardless; opens prompt pre-filled.
  - If invocation has redacted values: only `↩ Re-run with edits...` is available.
- No new visual column or row decoration on the tree node itself.

**History Table Enhancement**
- Tooltip on each row is extended with argument data.
- Row context menu (right-click): same actions as the tree.
- No new table column.

**Accessibility**: Context menus are keyboard accessible. Tooltip content is not screen-reader
accessible — the detail panel expansion (clicking the row) should expose argument data in-DOM
for screen readers.

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | Low — argument data only in tooltip; not scannable |
| **Audit / visibility** | Low — no at-a-glance view of arguments across rows |
| **Re-run discoverability** | Low — context menu only |
| **UI complexity** | Low — no new surfaces |
| **Persistent presets** | None |
| **Team sharing** | None |
| **Implementation risk** | Low |

---

## Design Option F — "Run with Last Complete Invocation" Shortcut

### Concept

When the user is prompted for Taskfile variables or shell args, the input is pre-populated with
values from the most recent **complete invocation** (all args stored together as a unit). A
`↩ Run with last args` shortcut on the task tree item skips all prompts and immediately re-runs
with the stored invocation.

> **Important design decision**: Pre-fill must use the most recent *complete invocation* — all
> variables together as they were entered in the same run — **not per-variable history**.
> Per-variable history (where `ENV` is taken from one run and `TARGET` from a different run)
> produces combinations that were never actually used together, which in deployment tasks can
> silently point to the wrong environment. This risk is not acceptable.

### UX Details

**Variable Input Prompt Enhancement**
- When a complete prior invocation exists, a header note in the prompt title reads:
  `"Last run: ENV=prod, TARGET=us-east-1 — press Escape to enter manually"`.
- The first option in the Quick Pick is `↩ Re-use last invocation (ENV=prod, TARGET=us-east-1)`.
- Below it is the standard guided input for entering values manually.
- Sensitive values in the header/option show as `••••••`.

**Enum Variable Enhancement**
- When a variable uses `enum:` in the Taskfile, the most recently selected value floats to the
  top of the list with a `Recent` separator.

**"Run with last args" Shortcut on Task Tree Item**
- When a task has been run before with arguments, a secondary run action appears as an inline
  icon on the task tree item: `$(refresh)` (tooltip: `"Re-run with last args: ENV=prod,
  TARGET=us-east-1"`).
- This icon only appears when a complete prior invocation exists in storage.
- Sensitive values in the tooltip are shown as `••••••`.
- Clicking it skips all prompts. Disabled in untrusted workspaces.
- If the invocation contains redacted values, clicking opens `↩ Re-run with edits...` instead.

**Persistence**
- Per-task "last complete invocation" is stored in `workspaceState` keyed by
  `workspaceFolderPath + taskType + taskName`.
- Only the single most recent complete invocation is stored per task.
- `workspaceState` is machine-local and not synchronized across machines.
- Sensitive values are redacted at storage time.

### Tradeoffs

| Aspect | Assessment |
|---|---|
| **Discoverability** | Medium — inline icon appears on the task item only after first run |
| **Audit / visibility** | Low — no history table augmentation |
| **Re-run discoverability** | High — inline tree action |
| **UI complexity** | Low — no new panels; modifies existing prompt and tree item |
| **Persistent presets** | Low — single "last invocation" only; not named |
| **Team sharing** | None |
| **Implementation risk** | Low-Medium — prompt UI refactor touches a core interaction path |

---

## Comparison Matrix

| Dimension | A: Table Augment | B: Saved Subtree | C: Quick Pick | D: Presets Panel | E: Context Menu | F: Last Invocation |
|---|---|---|---|---|---|---|
| **Discoverability** | High | Medium | Low | High | Low | Medium |
| **Audit / visibility** | High | Low | Low | Medium | Low | Low |
| **Re-run discoverability** | Medium | High | Medium | High | Low | High |
| **Persistent named presets** | None | High | High | High | None | None |
| **Team sharing** | None | None | None | High | None | None |
| **Keyboard-first UX** | Medium | Medium | High | Medium | Medium | High |
| **UI complexity added** | Medium | Medium | Low | High | Low | Low |
| **Implementation risk** | Medium | Low | Low | High | Low | Medium |
| **Works before first run** | No | No | No | Yes (wizard) | No | No |
| **Cross-session persistence** | Per history TTL | Yes | Yes | Yes | Per history TTL | Yes (single invocation) |
| **Multi-root workspace safe** | Depends on keying | Depends on keying | Depends on keying | Depends on keying | Depends on keying | Depends on keying |
| **Handles stale invocations** | No recovery path | No recovery path | No recovery path | No recovery path | No recovery path | No recovery path |
| **Appropriate for solo dev** | High | High | High | Low | High | High |
| **Appropriate for team use** | High | Medium | Medium | High | Low | Medium |

> **Note on "handles stale invocations"**: All options currently have no recovery path for task
> definition drift (a Taskfile variable is renamed or removed after an invocation is saved).
> See [Open Questions](#open-questions) for the proposed recovery UX.

---

## Potential Hybrid Approaches

### Recommended Hybrid 1: Option E + Option F (Lightweight Phase 1)

**Best for**: Solo developers and small teams as a first release.

- **E**: Store args in history records; add `↩ Re-run with same args` and `↩ Re-run with edits...`
  to history context menus. Block re-run in untrusted workspaces. Apply sensitive value redaction.
- **F**: Store the last complete invocation per task; add `↩ Run with last args` inline icon to
  the task tree item. Pre-fill prompts from the last complete invocation (not per-variable).

**Why this works**: E validates the data model (storing args in `ITaskExecutionRecord`) and F
provides the highest-value repeat-run shortcut. Together they cover the core pain point
(repeatability) and the audit pain point (history visibility) without any new panels.

**Incoherent-args risk is eliminated**: F stores the last *complete* invocation. A user who ran
`deploy ENV=prod TARGET=us-east-1` will always see that combination offered together, never a
mix from different runs.

### Recommended Hybrid 2: Hybrid 1 + Option A (Phase 2 Augmentation)

**Best for**: Users who want argument visibility at a glance in the history table.

Adds the Arguments column and expanded detail panel from Option A on top of Hybrid 1.

### Recommended Hybrid 3: Hybrid 1 + Option B (Phase 2 for Preset Power Users)

**Best for**: Multi-task users who want named, re-usable presets alongside their history.

Adds the Saved Invocations subtree from Option B, populated via "Pin from history" context menu.
No auto-save, no toast notifications.

### Recommended Hybrid 4: Options A + D (Team Edition)

**Best for**: Teams with shared task invocation standards.

Full argument column in history (Option A) plus a Presets panel with file-based export (Option D).
Requires the most implementation effort and should be deferred until team-sharing feedback from
earlier phases indicates demand.

---

## Phasing Sketch

| Phase | Scope | Options | Primary goal |
|---|---|---|---|
| **1 — Foundation** | Store args in history + lightweight re-run | E + F | Validate data model; deliver highest-value shortcut with minimal risk |
| **2 — Visibility** | History table argument column | A | Audit use case for multi-task power users |
| **3 — Presets** | Saved invocations subtree or Presets panel | B or D | Named, persistent presets; team sharing (if D) |

> **Phase 1 note**: Option F modifies the argument prompt UI — a change to a core interaction
> path. This change must be gated by a feature flag initially and rolled out with a regression
> test suite covering all task types that use guided argument input.

---

## Open Questions

1. **Task definition drift**: If a Taskfile variable is renamed or removed after an invocation is
   saved, the stored invocation references a key that no longer exists. Proposed recovery UX:
   - On re-run attempt, validate stored variable names against the current task definition.
   - If a mismatch is found, show a warning: `"Some saved arguments no longer match this task's
     variable definitions: [list]. Opening editor to review."` and open the pre-filled prompt
     with mismatched variables highlighted in red.
   - The stale invocation is **not** silently deleted — the user confirms the discard.

2. **Sensitive value opt-out**: When a variable name matches the redaction heuristic but the
   user knows the value is not sensitive (e.g., `ENV_KEY` is just an environment label), is there
   an opt-out? Options: (a) no opt-out — heuristic always applies, (b) per-variable opt-out in
   task configuration. Recommended default: (a) with a future path to (b).

3. **Deduplication**: If a user runs `deploy ENV=prod TARGET=us-east-1` 50 times, should history
   show 50 rows or collapse with a run count? Follow-up: does argument comparison use
   order-independent semantic equality (`ENV=prod TARGET=us-east-1` == `TARGET=us-east-1
   ENV=prod`) or exact-string comparison? Recommendation: semantic equality for deduplication;
   exact string for display.

4. **Scope of saved invocations**: Per-workspace (`workspaceState`) or global (`globalState`)?
   Workspace-scoped is safer (no leakage of env-specific args into different projects) but
   doesn't travel with Settings Sync. Recommendation: workspace-scoped by default; opt-in
   `workspaceTasks.invocations.scope: "global"` setting for users who want sync.

5. **Run Guard integration**: Should re-running from history still trigger the Run Guard prompt?
   Recommendation: **yes** — Run Guards protect against accidental destructive runs and must fire
   regardless of the invocation source.

6. **Multi-root workspace disambiguation**: When two workspace folders define a task with the
   same name, invocation records must be keyed by `workspaceFolderPath + taskType + taskName`.
   The keying strategy must be defined before Phase 1 data storage is implemented to avoid
   silent collision.

7. **Relationship to Recents and Favorites**: The existing Recents panel tracks recently run task
   items. A saved invocation is conceptually a "parameterized favorite". Recommendation:
   Invocations are stored and managed independently; Recents may eventually link to the most
   recent invocation for a task; Favorites remain task-identity based (no args).

8. **Task types in scope**: Examples use Taskfile tasks. The feature should apply equally to npm
   scripts, shell tasks, and other types that support `args`. `varAssignments` is Taskfile-only
   by definition.

---

## Summary

Six design options span a spectrum from **minimal viable** (E) to **full-featured team tooling**
(D). The recommended entry point is **Hybrid 1 (E + F)**:

- Store args in `ITaskExecutionRecord`.
- Add re-run context menus to existing history surfaces (E).
- Store the last complete invocation per task and add the inline re-run shortcut to the task tree
  item (F, using complete-invocation pre-fill).
- Apply sensitive value redaction at storage time.
- Block all re-run actions in untrusted workspaces.

This phase delivers the highest user value (repeatability) and audit value (history visibility)
with the lowest UI complexity. Its data model choices are prerequisites for all subsequent phases.
Option A (history table augmentation) and Options B/D (presets) build naturally on top.
