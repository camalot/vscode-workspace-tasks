# Plan: Provider CodeLens & Editor Action Bar Fixes (startLine)

**Status:** Draft (pre rubber-duck review)
**Area:** Editor / CodeLens / Provider startLine

---

## 1. Overview

This plan addresses seven issues across six task providers where `startLine` is either not set, set incorrectly, or the line-finding logic uses the wrong algorithm. All issues result in CodeLens items either not appearing or appearing at the wrong line.

| # | Issue | Provider | Severity |
|---|---|---|---|
| I1 | Cargo-Make CodeLens all at line 0 | `cargoMakeTaskProvider.ts` / `tomlTaskProvider.ts` | High |
| I2 | cargo-make `custom.toml` not discovered | `cargoMakeTaskProvider.ts` | High |
| I4 | Bitbucket Pipelines: no CodeLens or editor action bar | `bitbucketPipelinesTaskProvider.ts` | High |
| I5 | CircleCI: no CodeLens or editor action bar | `circleCiTaskProvider.ts` | Medium |
| I8 | Maven: CodeLens not showing (`startLine` not set) | `mavenTaskProvider.ts` | Medium |
| I9 | Shell scripts: no CodeLens items | `shellTaskProvider.ts` | Medium |
| I11 | Poe: CodeLens items at line 0 (off-by-one) | `poeTaskProvider.ts` | Medium |
| I12 | Poe: CodeLens items appear after task definition | `poeTaskProvider.ts` | Medium |

---

## 2. Issue Analysis

### 2.1 I1 — Cargo-Make: Wrong Line-Finding Logic

**Root cause:** `TomlTaskProvider.findScriptLine()` matches `key = value` TOML syntax. Cargo-make uses `[tasks.task-name]` table headers. The regex never matches → every task falls back to `startLine = 0`.

**Fix:** Override `findScriptLine` in `CargoMakeTaskProvider` (or add a new method) that:
1. First tries the table header pattern: `^\s*\[tasks\.${escapedName}\]`
2. Falls back to the base class `key = value` pattern for edge cases

Because `findScriptLine` is `private` in `TomlTaskProvider`, it must be changed to `protected` to allow the override. The override in `CargoMakeTaskProvider` implements cargo-make-specific header matching.

### 2.2 I2 — Cargo-Make: `custom.toml` Not Discovered

**Root cause:** `CargoMakeTaskProvider.getGlobPatterns()` returns only `['**/[Mm]akefile.toml']`.

**Fix:** Add `'**/custom.toml'` to the returned patterns array. Note: `custom.toml` is a broad filename. We should verify this is the correct cargo-make behavior (the file must be named exactly `custom.toml`). If so, the glob is acceptable since cargo-make projects typically include a `Makefile.toml`, and both files will be associated with the `cargo-make` provider.

**Risk:** `custom.toml` could match non-cargo-make files. Mitigation: validate the parsed TOML has a `[tasks]` table before adding tasks, which `TomlTaskProvider` already does via `getScriptsPath()`.

### 2.3 I4 — Bitbucket Pipelines: No `startLine`

**Root cause:** `BitbucketPipelinesTaskProvider` never sets `startLine` on any item. The YAML parser (`yaml.parse`) produces a plain JavaScript object with no position information.

**Fix:** Use a text-search fallback. After parsing the YAML object to discover step names, scan the raw file content for `name: <stepName>` to find the line index. This is a best-effort approach that handles the majority of cases. Edge cases (e.g., steps without explicit `name:` fields) fall back to `startLine = 0`.

**Implementation:**
```typescript
private findStepLine(lines: string[], stepName: string): number {
  const pattern = new RegExp(`^\\s*name:\\s*['"]?${escapeRegex(stepName)}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return 0;
}
```

The raw text lines should be passed into the parse pipeline alongside the YAML object.

### 2.4 I5 — CircleCI: Investigation Needed

**Preliminary analysis:** `circleCiTaskProvider.ts` does set `startLine` on job items via `findKeyLine`. Job items are `CollapsibleState.None` (leaf tasks). They have `taskFileUri` set.

**However, `onRunActionCommand` is NOT explicitly set** in `createJobTaskItem`. The constructor auto-assigns `onRunActionCommand = workspaceTasks.runTask` for `None` items, which should work.

**Possible root cause:** The `findKeyLine` function finds the _first_ occurrence of `${jobName}:` in the file. Job names appear in both the top-level `jobs:` section AND in workflow `jobs:` lists. If the first match is a workflow reference (indented) rather than the top-level definition, the line is wrong — but more importantly, the item should still appear with `startLine` set.

**Action:** This issue needs more investigation before a definitive fix can be planned. The plan defers a full fix and instead:
1. Improves `findKeyLine` to look for job definitions specifically under the `jobs:` top-level key (i.e., require the matching line to be at depth 1 indentation in the YAML file).
2. Adds explicit `onRunActionCommand` assignment in `createJobTaskItem` (belt and suspenders).

### 2.5 I8 — Maven: `startLine` Not Set

**Root cause:** `MavenTaskProvider` creates items for standard Maven lifecycle goals but never sets `item.startLine`. Since these are synthetic goals (not declared on a specific line in `pom.xml`), `startLine = 0` is the correct fallback.

**Fix:** Add `item.startLine = 0;` for all Maven lifecycle goal items.

### 2.6 I9 — Shell Scripts: `startLine` Not Set

**Root cause:** `ShellTaskProvider` creates one `TaskItem` per script file but never sets `item.startLine`. Since the task IS the file, `startLine = 0` is always the correct value.

**Fix:** Set `item.startLine = 0` in the item creation logic.

**Location:** Find the item creation path in `ShellTaskProvider`. Shell tasks are created via batched processing (`ShellTypeBatch`). The item creation needs `item.startLine = 0` added after item construction.

### 2.7 I11 & I12 — Poe: Off-by-One in `findTaskLineInContent`

**Root cause:** `PoeTaskProvider.findTaskLineInContent()` returns `i + 1` (1-based) when the correct value is `i` (0-based). VS Code `Range` uses 0-based line numbers. This causes:
- CodeLens to appear one line below the actual task definition.
- When fallback `0` is returned, it accidentally lands at the right place (line 0 of the file) but for the wrong reason.

**Fix:** Change all `return i + 1` statements to `return i` in `findTaskLineInContent()`. There are at least two occurrences:
1. The key-value match: `line.startsWith(${taskName} =`)`
2. The table header match: `line === \`[tool.poe.tasks.${taskName}]\``

---

## 3. Implementation Plan

### 3.1 Phase 1: Trivial Single-Line Fixes

These require minimal code changes and have no test complexity.

**I8 — Maven `startLine = 0`:**
- File: `src/providers/mavenTaskProvider.ts`
- Change: After creating each lifecycle goal `TaskItem`, add `item.startLine = 0;`

**I9 — Shell `startLine = 0`:**
- File: `src/providers/shellTaskProvider.ts`
- Change: Locate item creation in batch processing; add `item.startLine = 0;` after construction

**I11/I12 — Poe off-by-one:**
- File: `src/providers/poeTaskProvider.ts`
- Change: In `findTaskLineInContent()`, change `return i + 1` → `return i` (both occurrences)

### 3.2 Phase 2: Moderate Fixes

**I2 — Cargo-Make `custom.toml` glob:**
- File: `src/providers/cargoMakeTaskProvider.ts`
- Change: Add `'**/custom.toml'` to `getGlobPatterns()` return value

**I1 — Cargo-Make table header matching:**
- Files: `src/providers/tomlTaskProvider.ts`, `src/providers/cargoMakeTaskProvider.ts`
- Change: Make `findScriptLine` `protected` in `TomlTaskProvider`; override in `CargoMakeTaskProvider` to first try `[tasks.taskName]` pattern before falling back to base regex

### 3.3 Phase 3: Text-Search-Based Line Finding

**I4 — Bitbucket Pipelines `startLine`:**
- File: `src/providers/bitbucketPipelinesTaskProvider.ts`
- Change: Pass raw file lines to step-item creation; add `findStepLine(lines, stepName)` method; set `item.startLine` on step-level items

**I5 — CircleCI investigation + partial fix:**
- File: `src/providers/circleCiTaskProvider.ts`
- Change: Improve `findKeyLine` to scope to `jobs:` block; add explicit `onRunActionCommand` to `createJobTaskItem`; add integration test to confirm editor action bar context is set correctly

---

## 4. Testing Plan

For each fix, add or update tests in the corresponding test file:

| Fix | Test File | Test Cases |
|---|---|---|
| I1 | `src/test/suite/cargoMakeTaskProvider.test.ts` | T01: task defined as `[tasks.name]` returns correct line number; T02: nested task name with dashes; T03: fallback to 0 when not found |
| I2 | `src/test/suite/cargoMakeTaskProvider.test.ts` | T04: `custom.toml` file is included in glob patterns; T05: tasks parsed from `custom.toml` |
| I4 | `src/test/suite/bitbucketPipelinesTaskProvider.test.ts` | T06: step item with name has non-undefined `startLine`; T07: step with no name gets `startLine = 0` |
| I5 | `src/test/suite/circleCiTaskProvider.test.ts` | T08: job item has `onRunActionCommand` set; T09: `findKeyLine` returns line in `jobs:` block, not workflow reference |
| I8 | `src/test/suite/mavenTaskProvider.test.ts` | T10: all lifecycle goal items have `startLine = 0` |
| I9 | `src/test/suite/shellTaskProvider.test.ts` | T11: created shell task items have `startLine = 0` |
| I11/I12 | `src/test/suite/poeTaskProvider.test.ts` | T12: task at line index 5 returns `startLine = 5` (not 6); T13: table-header task returns correct 0-based line |

---

## 5. Documentation Plan

No user-visible documentation changes are required for these bug fixes. The behavior should work as users already expect. The fixes correct behavior that was already documented/implied by the CodeLens feature documentation.

---

## 6. Implementation Order

1. I11/I12 (Poe off-by-one) — lowest risk, most isolated
2. I8 (Maven) — single line, trivial
3. I9 (Shell) — single line, trivial
4. I2 (cargo-make custom.toml glob) — low risk
5. I1 (cargo-make table header) — requires base class visibility change
6. I4 (Bitbucket Pipelines text search) — moderate complexity
7. I5 (CircleCI) — deferred pending additional investigation
