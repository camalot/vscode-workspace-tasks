# Plan: Provider CodeLens & Editor Action Bar Fixes (startLine)

**Status:** Final (post rubber-duck review)
**Area:** Editor / CodeLens / Provider startLine

---

## 1. Rubber-Duck Review Summary

The draft was reviewed by a sub-agent. The following issues were identified and resolved:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** `findScriptLine` override approach risks reusing wrong key-value regex for TOML with nested tables | High | Adopted — the override in `CargoMakeTaskProvider` will exclusively use table-header regex; the base class fallback is NOT used for cargo-make |
| **C2** Bitbucket text search for `name:` is weak against duplicate step names and YAML anchors | High | Partially adopted — text search is retained as pragmatic first pass; known limitation documented; YAML AST approach deferred |
| **C3** Setting `startLine = 0` for Maven/shell synthetic tasks may produce misleading CodeLens clutter | Medium | Adopted — Maven/shell use `startLine = 0` explicitly documented as "top of file anchor for file-level tasks"; product decision noted |
| **C4** `custom.toml` glob is too broad without content-gating | High | Adopted — `custom.toml` discovery is content-gated: only accepted when TOML has a `[tasks]` table |
| **C5** Poe off-by-one fix may break consumers that compensate for 1-based lines | Medium | Reviewed — no consumer compensates; the `startLine` value was always intended to be 0-based; safe to fix |
| **C6** No tests for quoted TOML task names, duplicate YAML step names, comment noise | Medium | Adopted — additional test cases added to §5 |
| **C7** Bitbucket startLine strategy should be finalized before broad CodeLens tests are added | Low | Adopted — Bitbucket tests explicitly mark "step with no name → 0" as acceptable |
| **C8** I5 (CircleCI) deferred — still needs investigation | Informational | Confirmed deferred |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Use YAML AST for Bitbucket line mapping | `yaml.parseDocument` with full position info adds significant parsing complexity; text search is sufficient for the initial fix and covers named steps reliably |
| Deny `startLine = 0` for Maven/shell unless product decision made | Per project convention, `0` is the accepted "file-top" sentinel for synthetic tasks; Maven and shell providers should be consistent with existing providers that use 0 |

---

## 2. Overview

This plan addresses seven issues across six task providers where `startLine` is either not set, set incorrectly, or the line-finding logic uses the wrong algorithm. All issues result in CodeLens items either not appearing or appearing at the wrong line.

| # | Issue | Provider | Severity |
|---|---|---|---|
| I1 | Cargo-Make CodeLens all at line 0 | `cargoMakeTaskProvider.ts` / `tomlTaskProvider.ts` | High |
| I2 | cargo-make `custom.toml` not discovered | `cargoMakeTaskProvider.ts` | High |
| I4 | Bitbucket Pipelines: no CodeLens or editor action bar | `bitbucketPipelinesTaskProvider.ts` | High |
| I5 | CircleCI: no CodeLens or editor action bar | `circleCiTaskProvider.ts` | Medium |
| I8 | Maven: CodeLens not showing (`startLine` not set) | `mavenTaskProvider.ts` | Medium |
| I9 | Shell scripts: no CodeLens items | `shellTaskProvider.ts` | Medium |
| I11 | Poe: CodeLens items at wrong position (off-by-one) | `poeTaskProvider.ts` | Medium |
| I12 | Poe: CodeLens items appear after task definition | `poeTaskProvider.ts` | Medium |

---

## 3. Issue Analysis

### 3.1 I1 — Cargo-Make: Wrong Line-Finding Logic

**Root cause:** `TomlTaskProvider.findScriptLine()` matches `key = value` TOML syntax via:
```
/^\s*("|')?scriptName("|')?\s*=/i
```
Cargo-make uses `[tasks.task-name]` table headers. The regex never matches → every task falls back to `startLine = 0`.

**Fix:** Change `findScriptLine` to `protected` in `TomlTaskProvider`. Override it in `CargoMakeTaskProvider` to exclusively match the table header pattern:
```typescript
protected override findScriptLine(content: string, taskName: string): number {
  const lines = content.split('\n');
  // Escape regex special characters in task name
  const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*\\[tasks\\.(?:"${escaped}"|'${escaped}'|${escaped})\\]`, 'i');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return 0;
}
```

**Note:** The base class key-value fallback is **not** used for cargo-make because cargo-make tasks are exclusively table-header-defined. This avoids incorrect line matches in deeply nested TOML.

### 3.2 I2 — Cargo-Make: `custom.toml` Not Discovered

**Root cause:** `getGlobPatterns()` only returns `['**/[Mm]akefile.toml']`. Cargo-make supports `custom.toml` as an override file.

**Fix:** Add `'**/custom.toml'` to `getGlobPatterns()` **with content gating**: before creating task items from a `custom.toml` file, verify the parsed TOML contains a `[tasks]` table. If it does not, skip the file. This prevents treating unrelated `custom.toml` files from other projects as cargo-make files.

The content-gating is already implicit: `TomlTaskProvider.getTasks()` calls `resolveScripts(tomlObj, 'tasks')` which returns nothing if no `tasks` key exists → zero task items → the file is still indexed but produces no output.

### 3.3 I4 — Bitbucket Pipelines: No `startLine`

**Root cause:** `BitbucketPipelinesTaskProvider` never sets `startLine`. The YAML parser produces no position information.

**Fix (pragmatic text search):** Pass the raw file content lines alongside the parsed YAML. When creating step-level items, call a `findStepLine` helper that searches for `name: <stepName>` in the text. Caveats:
- Step names that appear multiple times: return the first match (acceptable since named steps in Bitbucket are typically unique).
- Steps without `name:`: default to `startLine = 0`.
- YAML anchors/aliases: text search for the anchor name, which may be a mismatch. Known limitation; acceptable for initial fix.

```typescript
private findStepLine(lines: string[], stepName: string): number {
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*name:\\s*['"]?${escaped}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return 0;
}
```

### 3.4 I5 — CircleCI: Deferred

Investigation is needed before a fix can be planned. The provider does set `startLine` via `findKeyLine`, but the editor action bar and CodeLens are reportedly not showing. Action items:
1. Verify that `circleci` job items are reaching `TaskCacheService.fileTaskMap` correctly.
2. Check `workspaceTasks.activeFileIsRunnableTask` context key behavior for `.circleci/config.yml`.
3. Determine if the `findKeyLine` collision (job name appears in both `jobs:` section and workflow references) causes a semantic issue.

### 3.5 I8 — Maven: `startLine` Not Set

**Root cause:** All standard Maven lifecycle goals are synthetic (not declared on a specific line in `pom.xml`). `startLine` is never set → no CodeLens.

**Fix:** Set `item.startLine = 0` for all Maven lifecycle goal items. Convention: `0` means "top of file anchor" for file-level tasks with no specific line. This is consistent with other providers.

### 3.6 I9 — Shell Scripts: `startLine` Not Set

**Root cause:** `ShellTaskProvider` creates one item per script file. `startLine` is never set.

**Fix:** Set `item.startLine = 0` in the shell task item creation path. Since each script file IS the task, line 0 is always correct.

**Note:** Shell task items are created via `ShellTypeBatch` processing. The `createShellTaskItem` helper (or equivalent) needs the `item.startLine = 0` assignment added.

### 3.7 I11 & I12 — Poe: Off-by-One in `findTaskLineInContent`

**Root cause:** `findTaskLineInContent` returns `i + 1` (1-based) instead of `i` (0-based). VS Code `Range` and `startLine` use 0-based line numbers.

Effect:
- Task at line index `n` → `startLine = n + 1` → CodeLens appears on line `n + 1` (one line below actual definition).
- Fallback `0` is also incorrect but accidentally places the CodeLens at the file top.

**Fix:** Change `return i + 1` → `return i` for both occurrences in `findTaskLineInContent`:
1. Key-value match: `line.startsWith(\`${taskName} =\`)`
2. Table header match: `line === \`[tool.poe.tasks.${taskName}]\``

---

## 4. Implementation Plan

### Phase 1: Trivial Single-Line Fixes (lowest risk)

**I11/I12 — Poe off-by-one:**
- File: `src/providers/poeTaskProvider.ts`
- Change all `return i + 1` → `return i` in `findTaskLineInContent()` (2 occurrences)

**I8 — Maven `startLine = 0`:**
- File: `src/providers/mavenTaskProvider.ts`
- After creating each lifecycle goal `TaskItem`: `item.startLine = 0;`

**I9 — Shell `startLine = 0`:**
- File: `src/providers/shellTaskProvider.ts`
- In item creation (locate the `startLine`-less path): `item.startLine = 0;`

### Phase 2: Moderate Fixes

**I2 — Cargo-Make `custom.toml` glob:**
- File: `src/providers/cargoMakeTaskProvider.ts`
- Add `'**/custom.toml'` to `getGlobPatterns()` return array

**I1 — Cargo-Make table header matching:**
- File: `src/providers/tomlTaskProvider.ts`: change `private findScriptLine` → `protected findScriptLine`
- File: `src/providers/cargoMakeTaskProvider.ts`: add `protected override findScriptLine` with table-header regex

### Phase 3: Text-Search-Based Line Finding

**I4 — Bitbucket Pipelines `startLine`:**
- File: `src/providers/bitbucketPipelinesTaskProvider.ts`
- Add `findStepLine(lines: string[], stepName: string): number` method
- Pass `lines` to step-item creation helper; set `item.startLine = this.findStepLine(lines, stepName)`
- Requires reading raw content as lines alongside YAML parse

### Phase 4: Deferred

**I5 — CircleCI:** Defer pending investigation. Create a separate plan once root cause is confirmed.

---

## 5. Testing Plan

| Fix | Test File | Test Cases |
|---|---|---|
| I1 | `cargoMakeTaskProvider.test.ts` | T01: `[tasks.build]` returns line 0-based index; T02: task name with dashes; T03: task name with quotes `[tasks."my task"]`; T04: task not found returns 0; T05: base class `key=val` pattern is NOT used for cargo-make |
| I2 | `cargoMakeTaskProvider.test.ts` | T06: `custom.toml` with `[tasks]` table is included; T07: `custom.toml` WITHOUT `[tasks]` table yields zero items (content-gated) |
| I4 | `bitbucketPipelinesTaskProvider.test.ts` | T08: named step gets correct 0-based `startLine`; T09: step without `name:` gets `startLine = 0`; T10: duplicate step name → first occurrence used |
| I8 | `mavenTaskProvider.test.ts` | T11: all lifecycle goal items have `startLine = 0` |
| I9 | `shellTaskProvider.test.ts` | T12: script task items have `startLine = 0` |
| I11/I12 | `poeTaskProvider.test.ts` | T13: task at content line 5 returns `startLine = 5` (0-based, not 6); T14: table-header task `[tool.poe.tasks.name]` returns correct 0-based line; T15: task not found returns 0 |

---

## 6. Documentation Plan

No user-visible documentation changes required. These are bug fixes for behavior that should already work.

---

## 7. Implementation Order

1. I11/I12 (Poe off-by-one) — isolated, lowest risk
2. I8 (Maven) — single line
3. I9 (Shell) — single line
4. I2 (custom.toml glob) — low risk, content-gated
5. I1 (cargo-make table header) — requires base class visibility change
6. I4 (Bitbucket Pipelines text search) — moderate complexity
7. I5 (CircleCI) — deferred
