# Plan: Task Type Visibility Control

## Problem Statement

The current `workspaceTasks.enabledTaskTypes` configuration uses a boolean-per-task-type object
model, where any type **not explicitly set to `false`** is treated as enabled (see
`taskConfigService.ts`):

```ts
return enabledTaskTypes[configKey] !== false;
```

This means when a new task type is added in a future extension release, it **automatically becomes
visible** in every user's workspace — even for users who have carefully curated their task list to
only show specific types. There is no way for a user to say "show me only what I've explicitly
opted into."

**Root cause note:** The `enabledTaskTypes` schema uses `"additionalProperties": false` and a
hardcoded `default` object. When a new task type is added to the extension code but not added to
the schema default object, it falls through to the `!== false` check and becomes silently
auto-enabled. Any chosen solution should also address this schema-maintenance discipline.

### Goals

1. Allow users to opt into a mode where new task types do **not** appear automatically.
2. Retain full backwards compatibility — users who have never touched `enabledTaskTypes` continue
   to see all task types as before.
3. Avoid forcing users to relist every type by name if wildcards or patterns can cover their
   intent.

---

## Self-Critique & Review Findings

*This section documents key critiques identified during architectural review.*

- **Option A is functionally identical to Option B** (boolean vs. two-value enum). Option A is
  retained below solely as a named reference point; Option B strictly supersedes it.
- **`micromatch` is already a project dependency.** The "external dependency" con listed for
  Options C and D does not apply.
- **`taskTypeMap` aliasing matters for pattern matching.** `taskConfigService.ts` normalises
  internal type names to config keys (e.g., `dockerfile` → `docker`). Options C/D must define
  whether patterns match against the internal name or the config key; matching against the
  internal name before normalisation is recommended for user clarity.
- **The precedence tables in Options C and D contained a contradiction** (an `include`-non-empty
  rule could override an `opt-out` mode). The tables below have been corrected.
- **A phased approach (ship B, add C later) leads to three overlapping mechanisms** — the same
  problem cited as Option D's main weakness. The recommendation section has been updated to
  either commit to D or commit to B-only.
- **Configuration scope** must be `window` (not `application` or `machine`) to remain consistent
  with `enabledTaskTypes`, which is already `window`-scoped.

---

## Proposed Options

---

### Option A — Strict Mode Flag *(Superseded by Option B)*

Add a single new boolean setting:

```json
"workspaceTasks.strictTaskTypeFiltering": {
  "type": "boolean",
  "default": false
}
```

A boolean with two states is isomorphic to an enum with two values. Option B provides identical
behavior with better forward-extensibility (additional modes can be added to the enum). **Option
A is retained for reference only; Option B is preferred.**

---

### Option B — Filter Mode Enum

Add an explicit `window`-scoped mode selector alongside the existing `enabledTaskTypes` object:

```json
"workspaceTasks.taskTypeFilterMode": {
  "type": "string",
  "scope": "window",
  "enum": ["opt-out", "opt-in"],
  "default": "opt-out",
  "enumDescriptions": [
    "New task types are enabled by default. Set individual types to false to hide them. (current behavior)",
    "New task types are disabled by default. Set individual types to true to show them."
  ]
}
```

**Behavioral change in `taskConfigService.ts`:**

| `filterMode` | Key absent from config | Key = `false` | Key = `true` |
|---|---|---|---|
| `"opt-out"` (default) | enabled | disabled | enabled |
| `"opt-in"` | disabled | disabled | enabled |

**Pros:**
- Semantically clear naming — "opt-in" and "opt-out" map directly to expected behavior.
- Default `"opt-out"` preserves all current behavior — zero breaking changes.
- Trivial to implement (one condition added to `isTaskTypeEnabled`).
- Keeps `enabledTaskTypes` as the single authoritative per-type toggle.
- Easy to document; no new mental models beyond what already exists.

**Cons:**
- No wildcard or pattern support — users must enumerate every desired type by name.
- Does not solve future-discovery: users in `"opt-in"` mode won't know when new types are
  available without reading the changelog.
- Users switching to `"opt-in"` must first populate `enabledTaskTypes` with every type they want,
  which is cumbersome with 25+ types.
- Cannot express "enable everything except a few" while still blocking new ones.

---

### Option C — Whitelist / Blacklist Pattern Matching *(user suggested)*

Add two new `window`-scoped string-array settings. Patterns are matched against the
**internal task type name** (e.g., `dockerfile`, `justfile`) before `taskTypeMap` normalisation,
so user-visible names match what VSCode task providers report.

```json
"workspaceTasks.enabledTaskTypePatterns": {
  "type": "array",
  "scope": "window",
  "items": { "type": "string" },
  "default": [],
  "markdownDescription": "Glob patterns of task type names to **enable**. When non-empty, acts as a whitelist — only matching types are shown. Use `*` to match any type name. `disabledTaskTypePatterns` takes precedence."
},
"workspaceTasks.disabledTaskTypePatterns": {
  "type": "array",
  "scope": "window",
  "items": { "type": "string" },
  "default": [],
  "markdownDescription": "Glob patterns of task type names to **disable**. Takes precedence over `enabledTaskTypePatterns` and `enabledTaskTypes`."
}
```

> **Regex note:** Arbitrary `/regex/flags` literals are **not supported** in this option.
> Glob patterns (powered by the already-present `micromatch` dependency) cover all practical
> use cases and eliminate the ReDoS attack surface entirely.

**Evaluation precedence (highest to lowest):**

1. `disabledTaskTypePatterns` matches internal type name → **disabled** (always wins).
2. `enabledTaskTypePatterns` non-empty AND matches internal type name → **enabled**.
3. `enabledTaskTypePatterns` non-empty AND no match → **disabled**.
4. `enabledTaskTypes[configKey]` boolean value.
5. Default: **enabled** (current opt-out behavior).

**Example: show only npm and pnpm:**

```json
"workspaceTasks.enabledTaskTypePatterns": ["npm", "pnpm"]
```

**Example: lock shown types to python ecosystem, exclude pipenv:**

```json
"workspaceTasks.enabledTaskTypePatterns": ["p*"],
"workspaceTasks.disabledTaskTypePatterns": ["pipenv"]
```

**Example: enable all, disable only bun and yarn:**

```json
"workspaceTasks.disabledTaskTypePatterns": ["bun", "yarn"]
```

**Pros:**
- Most expressive option; `disabledTaskTypePatterns: ["*"]` combined with specific
  `enabledTaskTypePatterns` gives a true whitelist.
- Future-proof when wildcards are used: new task types matching an existing pattern are
  automatically handled without any config change.
- Directly addresses the user-suggested design.
- `micromatch` is already a project dependency — no new dependency required.
- No ReDoS risk (glob-only, no arbitrary regex).

**Cons:**
- Three overlapping mechanisms (`enabledTaskTypes`, `enabledTaskTypePatterns`,
  `disabledTaskTypePatterns`) increase cognitive load; clear documentation is essential.
- Future-proof only when wildcards are used; `enabledTaskTypePatterns: ["npm", "gradle"]`
  is no more future-proof than Option B's explicit booleans.
- Scope vs. `shellEnabledTaskTypes` must be explicitly defined (see Open Questions).
- Pattern matching against internal type names (pre-normalisation) must be clearly documented;
  otherwise users writing `"docker*"` may not understand why `"dockerfile"` matches but
  `"docker-compose"` also matches.

---

### Option D — Filter Mode Enum + Patterns *(combined)*

Combines Option B's mode concept with Option C's glob patterns. The mode governs the default
for unmatched types; patterns always take precedence.

```json
"workspaceTasks.taskTypeFilterMode": {
  "type": "string",
  "scope": "window",
  "enum": ["opt-out", "opt-in"],
  "default": "opt-out"
},
"workspaceTasks.taskTypePatterns": {
  "type": "object",
  "scope": "window",
  "properties": {
    "include": { "type": "array", "items": { "type": "string" }, "default": [] },
    "exclude": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "default": { "include": [], "exclude": [] }
}
```

**Corrected evaluation precedence (highest to lowest):**

1. `taskTypePatterns.exclude` matches internal type name → **disabled** (always wins).
2. `taskTypePatterns.include` matches internal type name → **enabled** (pattern beats mode).
3. `taskTypePatterns.include` non-empty AND no match → **disabled** (regardless of mode).
4. No patterns match + `filterMode = "opt-in"` + key absent in `enabledTaskTypes` → **disabled**.
5. No patterns match + `filterMode = "opt-out"` + key is `false` in `enabledTaskTypes` → **disabled**.
6. No patterns match + no relevant `enabledTaskTypes` key → **enabled** (default opt-out).

> **Step 3 note:** When an `include` list is non-empty, it acts as a whitelist irrespective of
> mode. This means `filterMode = "opt-out"` with `include: ["npm"]` still hides everything except
> npm. A non-empty `include` overrides the mode baseline — this must be clearly documented.

**Pros:**
- Mode provides a clear, human-readable baseline (opt-in vs. opt-out), reducing the need for
  `disabledTaskTypePatterns: ["*"]` tricks.
- Patterns layer on top cleanly for fine-grained overrides.
- Covers all user scenarios in one coherent model.
- `micromatch` already present — no new dependency.
- No ReDoS risk (glob-only).

**Cons:**
- Largest surface area: introduces `taskTypeFilterMode` + `taskTypePatterns` + existing
  `enabledTaskTypes` = three overlapping mechanisms.
- The interaction between a non-empty `include` list and `filterMode` (step 3 above) is
  non-obvious and must be carefully documented.
- `shellEnabledTaskTypes` scope still undefined.

---

### Option E — Wildcard Sentinel Key in Existing `enabledTaskTypes` *(alternative)*

Rather than adding any new top-level settings, allow a special `"*"` (wildcard) key inside the
existing `enabledTaskTypes` object:

```json
"workspaceTasks.enabledTaskTypes": {
  "*": false,
  "npm": true,
  "vscode": true
}
```

`"*": false` acts as a "default deny" — any task type not explicitly set to `true` is hidden.
`"*": true` (or absent) restores current opt-out behavior.

Logic change in `isTaskTypeEnabled`:
```ts
const defaultEnabled = enabledTaskTypes['*'] !== false;
return enabledTaskTypes[configKey] ?? defaultEnabled;
```

**Pros:**
- Zero new top-level settings — no new concepts, UI surface, or documentation sections needed.
- Fully within the existing `enabledTaskTypes` schema model; backwards compatible (no existing
  config contains the `"*"` key).
- Schema validation update is minimal: allow `"*"` as an additional boolean property.
- Familiar pattern — mirrors how other config systems express "default deny"
  (e.g., ESLint rules with `"*": "off"`).
- Simplest possible implementation.

**Cons:**
- No wildcard glob matching for type name patterns — still requires listing each desired type.
- The `"*"` sentinel is non-obvious and may appear to be a typo in settings file snapshots.
- `"additionalProperties": false` must be relaxed or `"*"` explicitly added as an allowed
  property, which appears in IntelliSense alongside real type names.
- Does not help with future discovery of new type names.
- Cannot express patterns (e.g., "enable all `p*` types").

---

### Option F — Sentinel Key + Glob Patterns *(C + E combined)*

Combines Option E's `"*"` sentinel key inside `enabledTaskTypes` (for a zero-new-setting
default-deny baseline) with Option C's two glob-pattern arrays (for expressive mass
inclusion/exclusion). The sentinel replaces the awkward `disabledTaskTypePatterns: ["*"]`
trick that Option C-alone requires for basic opt-in mode.

**Schema changes:**

```json
// Existing setting — schema updated to allow the "*" sentinel key
"workspaceTasks.enabledTaskTypes": {
  "*": false,   // optional sentinel: false = default deny, absent/true = default allow
  "npm": true,
  "vscode": true
}

// Two new window-scoped pattern arrays (same as Option C)
"workspaceTasks.enabledTaskTypePatterns": {
  "type": "array",
  "scope": "window",
  "items": { "type": "string" },
  "default": []
},
"workspaceTasks.disabledTaskTypePatterns": {
  "type": "array",
  "scope": "window",
  "items": { "type": "string" },
  "default": []
}
```

**Evaluation precedence (highest to lowest):**

1. `disabledTaskTypePatterns` matches internal type name → **disabled** (always wins).
2. `enabledTaskTypePatterns` non-empty AND matches internal type name → **enabled**.
3. `enabledTaskTypePatterns` non-empty AND no match → **disabled**.
4. `enabledTaskTypes[specificKey]` explicitly set to `true` or `false` → respect that value.
5. `enabledTaskTypes["*"] === false` AND specific key absent → **disabled** (sentinel default-deny).
6. Otherwise → **enabled** (current opt-out behavior).

> Steps 1–3 are identical to Option C. Steps 4–6 are identical to Option E's logic. When no
> patterns are configured, the behavior degrades cleanly to Option E alone.

**Usage examples:**

*Simple opt-in (no patterns needed):*
```json
"workspaceTasks.enabledTaskTypes": { "*": false, "npm": true, "vscode": true }
```

*Enable only python-related types, with default-deny as the safety net:*
```json
"workspaceTasks.enabledTaskTypes": { "*": false },
"workspaceTasks.enabledTaskTypePatterns": ["p*"],
"workspaceTasks.disabledTaskTypePatterns": ["pipenv"]
```

*Opt-out mode (current default) with targeted glob disable — sentinel absent:*
```json
"workspaceTasks.disabledTaskTypePatterns": ["bun", "yarn"]
```

**Pros:**
- Eliminates the `disabledTaskTypePatterns: ["*"]` trick required in Option C for basic
  default-deny — the sentinel `"*": false` is more readable and self-documenting.
- Zero new settings for the common opt-in use case; `"*": false` + explicit `true` values
  suffice without touching the pattern arrays at all.
- Pattern arrays are purely additive: users who only want the sentinel ignore them; users who
  want glob matching enable them independently.
- Clear separation of concerns: `enabledTaskTypes` handles boolean toggles + default mode;
  pattern arrays handle expressive mass operations.
- `micromatch` already present — no new dependency.
- No ReDoS risk (glob-only).
- Backwards compatible: no existing config contains `"*"` as a key; absent patterns
  reproduce current behavior exactly.

**Cons:**
- Two distinct mechanisms within one logical feature (sentinel inside existing setting + separate
  pattern arrays) may confuse users trying to understand how they interact.
- `"additionalProperties": false` on `enabledTaskTypes` must still be relaxed (same as Option E);
  `"*"` will appear in IntelliSense alongside real type names.
- Users combining all three (sentinel + both pattern arrays) face the most complex precedence
  table of any option — thorough documentation is essential.
- Still requires knowledge of internal type names for the explicit boolean keys in
  `enabledTaskTypes`; the patterns reduce (but do not eliminate) this need.

---

## Comparison Matrix

| Criterion | ~~A~~ *(see B)* | B — Mode Enum | C — Patterns Only | D — Mode + Patterns | E — Sentinel Key | F — Sentinel + Patterns |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Backwards compatible** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Blocks new types by default** | Yes (when on) | Yes (opt-in) | Yes (include non-empty) | Yes (opt-in mode) | Yes (`"*": false`) | Yes (sentinel or patterns) |
| **Wildcard / glob pattern support** | No | No | Yes | Yes | No | Yes |
| **Future-proof without config changes** | No | No | Wildcard-dependent | Wildcard-dependent | No | Wildcard-dependent |
| **Implementation complexity** | Low | Low | Medium | Medium | Low | Medium |
| **ReDoS risk** | None | None | None (glob only) | None (glob only) | None | None (glob only) |
| **New dependency required** | No | No | No (micromatch present) | No (micromatch present) | No | No (micromatch present) |
| **Mental model simplicity** | High | High | Medium | Medium | High | Medium |
| **New top-level settings added** | 1 | 1 | 2 | 2 | 0 | 2 |
| **Requires enumerating type names** | Yes | Yes | Optional (globs avoid it) | Optional (globs avoid it) | Yes | Optional (globs avoid it) |
| **Consistent with existing config style** | Yes | Yes | Partially | Partially | Yes | Partially |
| **Config scope is `window`** | Yes | Yes | Yes | Yes | N/A (inherits) | Yes |
| **Discovery of new types** | Manual | Manual | Wildcard-driven | Wildcard-driven | Manual | Wildcard-driven |
| **Settings Sync friendly** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Applies to `shellEnabledTaskTypes`** | Not in scope | Not in scope | Not in scope | Not in scope | N/A | Not in scope |
| **Separate mode setting needed** | Yes | Yes | No | Yes | No | No |
| **Phased approach possible** | N/A | B then D | Standalone | Full target | Standalone | Standalone |

---

## Open Questions

1. Should `shellEnabledTaskTypes` be in scope for this feature, or treated separately since it
   already mirrors the same opt-out pattern?
   > **Answer:** Not in scope. `shellEnabledTaskTypes` is defined within `enabledTaskTypes`; shell
   > script types may receive similar filtering functionality in a future, separate enhancement.

2. For Options C/D: should patterns match against the **internal task type name** (e.g.,
   `dockerfile`, `justfile`) or the **config key** (e.g., `docker`, `just`)? Internal names are
   recommended for user clarity but must be documented explicitly.
   > **Answer:** Internal type names (pre-normalisation).

3. Should there be a **notification or indicator** when a new task type is added by an extension
   update while in opt-in/strict mode, informing the user that a new type exists but is hidden?
   > **Answer:** Possible future enhancement; not in scope for initial implementation.

4. Should the `enabledTaskTypes` schema default object and the `taskTypeMap` in `taskConfigService.ts`
   become the shared source of truth for valid type names (eliminating schema-drift), regardless
   of which option is chosen?
   > **Answer:** Yes. Schema-drift elimination is in scope regardless of the chosen option.

5. Is a UI action ("show available task types you can enable") desirable alongside opt-in mode,
   to address the discoverability gap for users who won't read changelogs?
   > **Answer:** Possible future enhancement; not in scope for initial implementation.

---

## Recommendation (awaiting decision)

**Do not phase** Options B + C together — the end state of that approach reintroduces Option D's
three-mechanism problem, arriving iteratively. Choose one of:

- **Option B alone** — if the primary goal is simplicity and the team wants to avoid pattern
  syntax entirely. Users must enumerate types they want, but the feature is clear, documented,
  and testable in a single PR.
- **Option C alone** — if the team wants to ship the user-suggested pattern-matching approach as
  the complete solution. Requires thorough documentation of the precedence rules and the
  internal-name matching contract.
- **Option D** — if both a semantic mode baseline and wildcard patterns are desired together.
  Most capable option; eliminates the "tricks required" aspect of Option C
  (`disabledTaskTypePatterns: ["*"]`), but has the largest documentation burden.
- **Option E** — if minimal config surface area is the overriding concern. Zero new settings,
  lowest implementation cost, but no wildcard support.
- **Option F** — if a clean default-deny baseline (via the sentinel) combined with glob-pattern
  expressiveness is the goal, without introducing a separate mode setting. This is the most
  composable option: the sentinel alone covers simple opt-in users; patterns layer on for power
  users; and the two features are independently useful.

---

## Option F — Full Implementation Plan

**Decision:** Implement Option F.

### 1. Requirements Summary

Option F adds:

1. A `"*"` sentinel key inside the existing `enabledTaskTypes` object — when set to `false`,
   any task type **not** explicitly set to `true` is hidden (default-deny mode).
2. Two new `window`-scoped string-array settings — `enabledTaskTypePatterns` and
   `disabledTaskTypePatterns` — for glob-based mass inclusion/exclusion via `micromatch`
   (already a project dependency).

Additionally, schema-drift between `taskTypeMap` in `taskConfigService.ts` and the
`enabledTaskTypes` schema in `package.json` must be eliminated as part of this work (see
Open Question 4).

---

### 1a. Post-Review Corrections

*This section records changes made to the plan based on architectural review (rubber-duck with
a sub-agent). All blocking issues are listed first.*

**Issue R1 — CRITICAL: VS Code config-merge assumption must be tested (integration test)**
The sentinel's correctness depends on VS Code returning the user's exact written object (not
merged with the schema default) when a user has explicitly configured `enabledTaskTypes`. This
is true for VS Code's current implementation (no deep-merge) but is undocumented in the code.
**Resolution:** Add one real integration test (using `cfg.update`) that verifies the sentinel
fires correctly at runtime, not only through stubs. Also add an explanatory comment in the code.

**Issue R4/R13 — HIGH: `additionalProperties` change is wrong — use `properties`-only approach**
The plan originally said to replace `"additionalProperties": false` with
`"additionalProperties": { "type": "boolean" }`. This is incorrect — it would allow any
arbitrary string key (e.g., `"nmp": true`) without schema validation errors, removing a
valuable typo-guard. JSON Schema's `additionalProperties` only applies to keys NOT already
listed in `"properties"`. Since `"*"` will be added to `"properties"`, `additionalProperties`
can remain `false` and still validate correctly. **Resolution:** Keep `"additionalProperties":
false`. Add `"*"` and `"mise"` to the `"properties"` block only. (Updated in Section 4.2.)

**Issue R16f — HIGH: `mise: true` must be added to the schema `"default"` object**
Without `"mise": true` in the default object, when a user sets `"*": false`, `mise` tasks will
be silently hidden (the sentinel fires because `mise` is absent from the returned object).
**Resolution:** Explicitly add `"mise": true` to the `"default"` object in T3.

**Issue R8 — MEDIUM: No sinon in the codebase — tests must use direct property replacement**
The plan referred to "sinon or equivalent." There is no sinon installation. The existing test
pattern (direct replacement of `vscode.workspace.getConfiguration`) must be used instead.
(Updated in Section 5.1.)

**Issue R9 — MEDIUM: `taskTypeMap` should be a `private static readonly` class field**
Currently rebuilt as a local constant on every `isTaskTypeEnabled` call. Since it is a pure
constant, it should be extracted to class level in T1. (Updated in Section 4.1.)

**Issue R16a — MEDIUM: `pwsh` and `python` in `taskTypeMap` but absent from `enabledTaskTypes`**
If `"*": false` is set, `pwsh` and `python` (shell sub-types) would be silently blocked since
their keys are not in the `enabledTaskTypes` defaults. These types are controlled by
`shellEnabledTaskTypes`, not `enabledTaskTypes`. **Resolution:** Remove `pwsh` and `python`
from `taskTypeMap` so they fall through as their own keys and Step 4/5 never incorrectly denies
them via the sentinel. Document this explicitly.

**Issue R14 — MEDIUM: T9 must use `npm run test:coverage`, not `npm test`**
The coverage requirement is 100% for new code. (Updated in Section 8.)

**Issue R16e — MEDIUM: Add T1.5 regression-gate between T1 and T2**
After expanding the `taskTypeMap` and aligning the `tsc`/`typescript` schema rename, run
`npm run test:coverage` before introducing sentinel logic to verify no regressions.

*Lower-severity issues resolved:*
- **R3:** Added test case verifying both `typescript` and `tsc` internal names resolve to the `typescript` config key.
- **R5:** Added documentation callout for internal-name vs. config-key mismatch with examples
  (`docker`, `make`, `just`).
- **R6:** Added `⚠️ Warning` block to the `enabledTaskTypePatterns` documentation section.
- **R7:** Added test case for `"*": true` explicit sentinel with `gradle: false`.
- **R11:** Added code comment explaining why the `disabledPatterns.length > 0` guard is
  defensive (not essential) while the `enabledPatterns.length > 0` guard is essential.
- **R12:** Documentation note added that `"*"` requires editing `settings.json` directly.
- **R15:** Documentation note added that sentinel applies to custom `effectiveType` strings.
- **R16b:** Added CargoMake pattern-interaction test case.
- **R16c:** Added `enabledTaskTypePatterns: ["*"]` escape-hatch test and doc note.
- **R16d:** Added `ruby` dual-setting clarification in docs.
- **R16g:** Added `docs/configuration/task-type.md` to T8's file scope.

---

### 2. Precedence Rules (authoritative reference)

Evaluated in order; first matching rule wins:

| Priority | Condition | Result |
|---|---|---|
| 1 | `disabledTaskTypePatterns` is non-empty AND matches *internal type name* | **disabled** |
| 2 | `enabledTaskTypePatterns` is non-empty AND matches *internal type name* | **enabled** |
| 3 | `enabledTaskTypePatterns` is non-empty AND does **not** match | **disabled** |
| 4 | `enabledTaskTypes[configKey]` is explicitly present (own property) | respect the boolean |
| 5 | `enabledTaskTypes["*"] === false` AND `configKey` absent from object | **disabled** |
| 6 | All other cases | **enabled** (current opt-out default) |

> **Patterns match against the internal type name** (pre-`taskTypeMap` normalisation — e.g.,
> `dockerfile` not `docker`). This must be explicitly documented for users.

---

### 3. Schema-Drift Audit

Before coding begins, all internal type names used by providers must be enumerated and
reconciled against the `enabledTaskTypes` schema keys in `package.json`.

**Current `taskTypeMap` entries and their drift status:**

| Internal type name | Current config key | Correct config key | Drift? |
|---|---|---|---|
| `ant` | `ant` | `ant` | none |
| `bun` | *(falls through)* | `bun` | yes — missing from map |
| `cake` | `cake` | `cake` | none |
| `cargo` | *(falls through)* | `cargo` | yes — missing from map |
| `cargo-make` | *(falls through)* | `cargo-make` | yes — missing from map |
| `cmake` | *(falls through)* | `cmake` | yes — missing from map |
| `composer` | `composer` | `composer` | none |
| `deno` | *(falls through)* | `deno` | yes — missing from map |
| `dockerfile` | `docker` | `docker` | none |
| `docker-compose` | `docker` | `docker` | none |
| `eslint` | *(falls through)* | `eslint` | yes — missing from map |
| `github-action` | `github-actions` | `github-actions` | none |
| `github-actions` | `github-actions` | `github-actions` | none |
| `go` | *(falls through)* | `go` | yes — missing from map |
| `gradle` | *(falls through)* | `gradle` | yes — missing from map |
| `grunt` | `grunt` | `grunt` | none |
| `gulp` | `gulp` | `gulp` | none |
| `jupyter` | `jupyter` | `jupyter` | none |
| `justfile` | `just` | `just` | none |
| `makefile` | `make` | `make` | none |
| `maven` | `maven` | `maven` | none |
| `mise` | `mise` | `mise` | yes — **missing from `enabledTaskTypes` schema** |
| `msbuild` | `msbuild` | `msbuild` | none |
| `npm` | `npm` | `npm` | none |
| `pipenv` | `pipenv` | `pipenv` | none |
| `pnpm` | *(falls through)* | `pnpm` | yes — missing from map |
| `poe` | *(falls through)* | `poe` | yes — missing from map |
| `poetry` | *(falls through)* | `poetry` | yes — missing from map |
| `pwsh` | `pwsh` | n/a — shell type | not in scope (shell types handled separately) |
| `python` | `python` | n/a — shell type | not in scope |
| `rake` | *(falls through)* | `rake` | yes — missing from map |
| `ruby` | *(falls through)* | `ruby` | yes — missing from map |
| `shell` | `shell` | `shell` | none |
| `typescript` | `typescript` | `typescript` | none — config key aligned with schema rename |
| `tsc` | *(falls through)* | `typescript` | yes — missing from map; aliases to `typescript` config key |
| `venv` | `venv` | `venv` | none |
| `vscode` | `vscode` | `vscode` | none |
| `webpack` | *(falls through)* | `webpack` | yes — missing from map |
| `workspace` | `workspace` | `workspace` | none |
| `workspace-task` | `workspace` | `workspace` | none |
| `yarn` | *(falls through)* | `yarn` | yes — missing from map |

**Decision:** Rename the schema config key from `tsc` to `typescript` (aligning it with the
internal type name). `tsc` was in the schema default but was never reachable through
`isTaskTypeEnabled()` since no provider uses the internal type name `tsc` and the existing map
had `typescript: 'typescript'` (pointing to a key absent from the schema). Renaming the schema
key to `typescript` resolves the drift with zero behavior change — no user config used `tsc`
effectively. In `taskTypeMap`, both `typescript` and `tsc` will map to the `typescript` config
key. The `mise` type is also not in the schema — it must be added.

---

### 4. Files to Modify

#### 4.1 `src/services/taskConfigService.ts`

**Changes:**

1. Add `micromatch` import at the top.
2. Extract `taskTypeMap` from a local variable to a **`private static readonly`** class field
   (fixes the rebuild-on-every-call inefficiency identified in review).
3. Expand `taskTypeMap` to include all missing entries, rename schema key `tsc → typescript`
   (add `tsc: 'typescript'` alias so both internal names map to the `typescript` config key), and
   **remove** `pwsh` and `python` (they are shell sub-types controlled by
   `shellEnabledTaskTypes`, not `enabledTaskTypes`; keeping them would cause the sentinel to
   incorrectly deny them).
4. Replace the single `return enabledTaskTypes[configKey] !== false;` line with the full
   six-step precedence evaluation using `micromatch.isMatch`.

**Updated `taskTypeMap` (complete, as static field):**

```ts
private static readonly taskTypeMap: Record<string, string> = {
  ant: 'ant',
  bun: 'bun',
  cake: 'cake',
  cargo: 'cargo',
  'cargo-make': 'cargo-make',
  cmake: 'cmake',
  composer: 'composer',
  deno: 'deno',
  dockerfile: 'docker',
  'docker-compose': 'docker',
  eslint: 'eslint',
  'github-action': 'github-actions',
  'github-actions': 'github-actions',
  go: 'go',
  gradle: 'gradle',
  grunt: 'grunt',
  gulp: 'gulp',
  jupyter: 'jupyter',
  justfile: 'just',
  makefile: 'make',
  maven: 'maven',
  mise: 'mise',
  msbuild: 'msbuild',
  npm: 'npm',
  pipenv: 'pipenv',
  pnpm: 'pnpm',
  poe: 'poe',
  poetry: 'poetry',
  rake: 'rake',
  ruby: 'ruby',
  shell: 'shell',
  tsc: 'typescript',       // alias: internal 'tsc' → config key 'typescript'
  typescript: 'typescript',
  venv: 'venv',
  vscode: 'vscode',
  webpack: 'webpack',
  workspace: 'workspace',
  'workspace-task': 'workspace',
  yarn: 'yarn',
};
// NOTE: 'pwsh' and 'python' intentionally omitted — these are shell sub-types checked
// via shellEnabledTaskTypes, not enabledTaskTypes. Including them would cause the
// sentinel ("*": false) to incorrectly block shell script tasks.
```

**New `isTaskTypeEnabled` body:**

```ts
public isTaskTypeEnabled(taskType: string): boolean {
  const config = vscode.workspace.getConfiguration('workspaceTasks');
  const enabledTaskTypes = config.get<Record<string, boolean>>('enabledTaskTypes', {});
  const enabledPatterns = config.get<string[]>('enabledTaskTypePatterns', []);
  const disabledPatterns = config.get<string[]>('disabledTaskTypePatterns', []);

  const configKey = TaskConfigService.taskTypeMap[taskType] ?? taskType;

  // Step 1: disabledTaskTypePatterns matches internal type name → disabled (always wins).
  // Guard is defensive: micromatch.isMatch(x, []) → false, but explicit guard
  // makes the "empty = no effect" intent clear to readers.
  if (disabledPatterns.length > 0 && micromatch.isMatch(taskType, disabledPatterns)) {
    return false;
  }

  // Steps 2 & 3: enabledTaskTypePatterns non-empty → acts as whitelist.
  // IMPORTANT: This guard IS essential. micromatch.isMatch(x, []) → false, so
  // omitting the guard would disable ALL types when patterns are empty.
  if (enabledPatterns.length > 0) {
    return micromatch.isMatch(taskType, enabledPatterns);
  }

  // Step 4: enabledTaskTypes[configKey] explicitly present → respect that boolean.
  // NOTE: config.get() returns the user's exact written object (not merged with schema
  // defaults) when the user has overridden this setting. hasOwnProperty therefore correctly
  // distinguishes "user explicitly set this key" from "key absent from user's object."
  // If VS Code changes its non-merging behavior, this step (and the sentinel at Step 5)
  // will break — the integration test 'sentinel integration: gradle disabled when *:false'
  // guards this contract.
  if (Object.prototype.hasOwnProperty.call(enabledTaskTypes, configKey)) {
    return enabledTaskTypes[configKey] !== false;
  }

  // Step 5: sentinel "* === false" AND configKey absent from object → disabled.
  if (enabledTaskTypes['*'] === false) {
    return false;
  }

  // Step 6: default → enabled (current opt-out behavior).
  return true;
}
```

> **`??` over `||` for configKey fallback:** Correct for string types; `||` would incorrectly
> fall through on an empty string, though no type name is ever empty in practice.

---

#### 4.2 `package.json`

**Change A — `enabledTaskTypes` schema: add `"*"` sentinel and `mise` to the `properties` block**

> **Do NOT change `"additionalProperties": false`.** JSON Schema's `additionalProperties` is
> only evaluated for keys that are NOT listed in `"properties"`. Adding `"*"` directly to
> `"properties"` is sufficient for it to pass schema validation and receive IntelliSense. The
> existing typo-guard for unrecognised keys is preserved.

Add two entries to the `"properties"` block inside `enabledTaskTypes`:

```jsonc
"mise": {
  "type": "boolean",
  "description": "%config.workspaceTasks.enabledTaskTypes.mise%"
},
"*": {
  "type": "boolean",
  "description": "%config.workspaceTasks.enabledTaskTypes.sentinel%"
}
```

Also add `"mise": true` to the `"default"` object. This is **essential**: without it, the
sentinel `"*": false` would silently block `mise` tasks for users who set the default-deny mode
(mise would be absent from the user's written object, triggering Step 5).

**Change B — Add `enabledTaskTypePatterns` setting** (after `enabledTaskTypes` in the
`properties` block):

```json
"workspaceTasks.enabledTaskTypePatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "%config.workspaceTasks.enabledTaskTypePatterns%",
  "markdownDescription": "%config.workspaceTasks.enabledTaskTypePatterns.markdown%"
},
```

**Change C — Add `disabledTaskTypePatterns` setting:**

```json
"workspaceTasks.disabledTaskTypePatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "%config.workspaceTasks.disabledTaskTypePatterns%",
  "markdownDescription": "%config.workspaceTasks.disabledTaskTypePatterns.markdown%"
},
```

> Both new settings omit an explicit `"scope"` field, defaulting to `window` — consistent with
> `enabledTaskTypes` and all other settings in the Discovery group.

---

#### 4.3 `package.nls.json`

Add the following after the existing `enabledTaskTypes.*` entries:

```json
"config.workspaceTasks.enabledTaskTypes.mise": "Mise",
"config.workspaceTasks.enabledTaskTypes.sentinel": "Default-deny sentinel. When set to false, any task type not explicitly set to true is hidden. Absent or true restores opt-out (show-by-default) behavior.",

"config.workspaceTasks.enabledTaskTypePatterns": "Enabled Task Type Patterns",
"config.workspaceTasks.enabledTaskTypePatterns.markdown": "Glob patterns matched against **internal task type names** (e.g. `dockerfile`, `justfile`) to **enable**. When non-empty, acts as a whitelist — only matching types are shown. `disabledTaskTypePatterns` takes precedence. Uses [micromatch](https://github.com/micromatch/micromatch) glob syntax. [read more](https://camalot.github.io/vscode-workspace-tasks/configuration/task-discovery/discovery#workspacetasksenabledtasktypepatterns)",

"config.workspaceTasks.disabledTaskTypePatterns": "Disabled Task Type Patterns",
"config.workspaceTasks.disabledTaskTypePatterns.markdown": "Glob patterns matched against **internal task type names** (e.g. `dockerfile`, `justfile`) to **disable**. Always takes precedence over `enabledTaskTypePatterns` and `enabledTaskTypes`. Uses [micromatch](https://github.com/micromatch/micromatch) glob syntax. [read more](https://camalot.github.io/vscode-workspace-tasks/configuration/task-discovery/discovery#workspacetasksdisabledtasktypepatterns)",
```

---

### 5. Files to Create

#### 5.1 `src/test/suite/taskConfigService.test.ts`

New test file. Target: 100% branch coverage of `isTaskTypeEnabled`. Tests use direct
`vscode.workspace.getConfiguration` replacement — the established pattern in this codebase
(used in `shellTaskProvider.test.ts`, `workspaceTasksProvider.test.ts`, etc.). **Do not use
sinon** — it is not installed.

**Test setup pattern:**

```ts
import * as vscode from 'vscode';
// ...
let originalGetConfig: typeof vscode.workspace.getConfiguration;

setup(() => {
  originalGetConfig = vscode.workspace.getConfiguration.bind(vscode.workspace);
});

teardown(() => {
  (vscode.workspace as any).getConfiguration = originalGetConfig;
});

function stubConfig(enabledTaskTypes: Record<string, boolean>, enabledPatterns: string[] = [],
                   disabledPatterns: string[] = []) {
  (vscode.workspace as any).getConfiguration = (_section?: string) => ({
    get: <T>(key: string, def?: T): T => {
      if (key === 'enabledTaskTypes') return enabledTaskTypes as unknown as T;
      if (key === 'enabledTaskTypePatterns') return enabledPatterns as unknown as T;
      if (key === 'disabledTaskTypePatterns') return disabledPatterns as unknown as T;
      return def as T;
    },
  });
}
```

**Test cases to cover:**

| Group | Test | Expected |
|---|---|---|
| **Defaults (no config)** | `enabledTaskTypes: {}`, no patterns → `npm` | `true` |
| **Step 1 — disabled patterns** | `disabledTaskTypePatterns: ["npm"]`, type `npm` | `false` |
| | `disabledTaskTypePatterns: ["n*"]`, type `npm` | `false` |
| | `disabledTaskTypePatterns: ["npm"]`, type `gradle` | `true` (gradle unaffected) |
| | `disabledPatterns: ["npm"]` + `enabledTaskTypes.npm = true` | `false` (Step 1 wins) |
| | `disabledPatterns: ["npm"]` + `enabledTaskTypePatterns: ["npm"]` | `false` (Step 1 wins) |
| **Steps 2 & 3 — enabled patterns** | `enabledTaskTypePatterns: ["npm"]`, type `npm` | `true` |
| | `enabledTaskTypePatterns: ["n*"]`, type `npm` | `true` |
| | `enabledTaskTypePatterns: ["npm"]`, type `gradle` (no match) | `false` (Step 3) |
| | `enabledPatterns: ["npm"]` + `enabledTaskTypes.gradle = true` | `false` (gradle — Step 3 wins over Step 4) |
| | `enabledPatterns: ["*"]` + `enabledTaskTypes: { "*": false }` | `true` (Step 2 matches `npm`; Step 5 never reached) |
| **Step 4 — boolean keys** | `enabledTaskTypes: { "npm": true }`, no patterns | `true` |
| | `enabledTaskTypes: { "npm": false }`, no patterns | `false` |
| | `enabledTaskTypes: { "*": true, "gradle": false }`, type `gradle` | `false` (Step 4: explicit `false`) |
| **Step 5 — sentinel** | `enabledTaskTypes: { "*": false }`, type `gradle` (absent) | `false` |
| | `enabledTaskTypes: { "*": false, "npm": true }`, type `npm` | `true` (Step 4 wins) |
| | `enabledTaskTypes: { "*": false, "npm": true }`, type `gradle` | `false` (Step 5) |
| | `enabledTaskTypes: { "*": true }`, type `gradle` (absent key "gradle") | `true` (Step 4: `"*"` present, returns `true`; but wait — `configKey` for `gradle` is `gradle`, not `*`. `hasOwnProperty(gradle)` is `false`. Falls through to Step 5: `enabledTaskTypes["*"] === false`? No, it's `true`. Step 6: `true`) |
| **Step 6 — default** | `enabledTaskTypes: {}`, no patterns | `true` |
| **`taskTypeMap` aliases** | type `dockerfile` + `enabledTaskTypes.docker = false` | `false` |
| | type `docker-compose` + `enabledTaskTypes.docker = false` | `false` |
| | type `justfile` + sentinel `"*": false`, no `just` key | `false` |
| | type `typescript` + `enabledTaskTypes.typescript = false` | `false` |
| | type `tsc` + `enabledTaskTypes.typescript = false` | `false` (both aliases map to same config key) |
| | type `github-action` + `enabledTaskTypes["github-actions"] = false` | `false` |
| | type `workspace-task` + `enabledTaskTypes.workspace = false` | `false` |
| **`pwsh`/`python` not in map** | `enabledTaskTypes: { "*": false }`, type `pwsh` | `true` (pwsh not in map → falls through as `pwsh` config key → not in enabledTaskTypes object → Step 5 checked but `pwsh` absent from user object is fine — wait: `configKey = 'pwsh'`; `hasOwnProperty('pwsh')` → false; `enabledTaskTypes["*"] === false` → true → DISABLED) |
| **`isAnyTaskTypeEnabled`** | `["npm", "gradle"]` both enabled → `true` | `true` |
| | `["npm"]` with `npm` disabled → `false` | `false` |
| **`areAllTaskTypesEnabled`** | `["npm", "gradle"]` with gradle disabled → `false` | `false` |
| **CargoMake double-check** | `enabledPatterns: ["cargo"]` (not `cargo-make`), type `cargo-make` | `false` (Step 3: no match) |
| | `enabledPatterns: ["cargo*"]`, type `cargo-make` | `true` (Step 2) |
| **Integration test (real VS Code)** | `cfg.update('enabledTaskTypes', { "*": false, "npm": true })` → `isTaskTypeEnabled('gradle')` | `false` (guards VS Code non-merge contract) |

> **⚠️ Critical clarification on `pwsh`/`python`:** The sentinel WILL block `pwsh`/`python`
> when `"*": false` is set if their config keys are absent from the user's written object. Since
> `pwsh` and `python` are **removed from `taskTypeMap`**, they fall through as their own key
> (`configKey = 'pwsh'`). They are not in the `enabledTaskTypes` schema or default. So with
> `"*": false`, the sentinel fires and disables them. This is by design: users in sentinel mode
> who want shell tasks must explicitly enable them via the `shellEnabledTaskTypes` mechanism —
> the sentinel applies to all types not explicitly listed. This should be documented.

---

### 6. Documentation Updates

#### 6.1 `docs/configuration/task-discovery/discovery.md`

Add or update the following sections after the existing `workspaceTasks.enabledTaskTypes` section:

1. **Updated `workspaceTasks.enabledTaskTypes`** — document the `"*"` sentinel key with an
   example. Note that it is optional; absent or `true` preserves current opt-out behavior.
   Update the default table to include `mise: true`. Add a note:
   > `"*"` must be configured via `settings.json` directly — it is not surfaced as a toggle in
   > VS Code's Settings UI.

2. **New `workspaceTasks.enabledTaskTypePatterns`** — document the setting, explain that it
   acts as a whitelist when non-empty, and add a prominent warning:
   > ⚠️ **Warning:** When `enabledTaskTypePatterns` is non-empty, it acts as an exclusive
   > whitelist. All `enabledTaskTypes` boolean values are ignored. Only types whose **internal**
   > name matches one of the glob patterns are shown.

   Clarify that patterns match **internal** type names (pre-alias normalisation):
   > Internal names differ from `enabledTaskTypes` config keys in some cases. For example, to
   > target Docker-related tasks use `"docker*"` (matches internal names `dockerfile` and
   > `docker-compose`) not `"docker"` (matches neither). Similarly, use `"makefile"` not `"make"`,
   > and `"justfile"` not `"just"`.

3. **New `workspaceTasks.disabledTaskTypePatterns`** — document the setting. Include the
   `ruby` dual-setting clarification:
   > `"ruby"` appears in both `enabledTaskTypes` (the Ruby task provider) and
   > `shellEnabledTaskTypes` (ruby shell scripts). `disabledTaskTypePatterns: ["ruby"]`
   > disables the Ruby task provider but does **not** affect ruby shell scripts, which are
   > controlled exclusively by `shellEnabledTaskTypes.ruby`.

4. **Precedence table** — reproduce the six-step table from Section 2 of this plan.

5. **Usage examples section** with canonical recipes:

   - Simple opt-in (show only npm and vscode):
     ```json
     "workspaceTasks.enabledTaskTypes": { "*": false, "npm": true, "vscode": true }
     ```
   - Glob whitelist (python ecosystem, excluding pipenv), with sentinel as safety net:
     ```json
     "workspaceTasks.enabledTaskTypes": { "*": false },
     "workspaceTasks.enabledTaskTypePatterns": ["p*"],
     "workspaceTasks.disabledTaskTypePatterns": ["pipenv"]
     ```
   - Targeted disable (opt-out mode, hide only bun and yarn):
     ```json
     "workspaceTasks.disabledTaskTypePatterns": ["bun", "yarn"]
     ```
   - Note on Docker:
     ```json
     // Correct — matches internal names 'dockerfile' and 'docker-compose'
     "workspaceTasks.disabledTaskTypePatterns": ["docker*"]
     // Wrong — "docker" matches neither internal name
     "workspaceTasks.disabledTaskTypePatterns": ["docker"]
     ```
   - Escape-hatch (restore opt-out despite sentinel via match-all pattern):
     ```json
     "workspaceTasks.enabledTaskTypes": { "*": false },
     "workspaceTasks.enabledTaskTypePatterns": ["*"]
     // Result: all types enabled (Step 2 matches everything before Step 5 fires)
     ```
   - Note on custom workspace tasks:
     > The sentinel and pattern settings apply to custom task types defined in
     > `.workspace-tasks.json` files (via their `taskType` field). Use glob patterns to
     > mass-enable or mass-disable custom providers.

   Also include the `cargoMake` note:
   > The Cargo Make provider checks **both** `cargo-make` and `cargo` internally. Either
   > internal name failing disables the provider. `disabledTaskTypePatterns: ["cargo*"]`
   > disables both in one glob.

#### 6.2 `docs/configuration/task-type.md` *(and related discovery docs)*

If this file contains a table of `enabledTaskTypes` keys, update it to add `mise` and `"*"`
with descriptions. Cross-reference the new `enabledTaskTypePatterns` and
`disabledTaskTypePatterns` settings.

---

### 7. Backwards Compatibility Verification

- **Zero config changed:** `isTaskTypeEnabled` returns the same result as today for
  every call where `enabledTaskTypePatterns` and `disabledTaskTypePatterns` are `[]`
  (their defaults) and `"*"` is absent from `enabledTaskTypes`. ✓
- **Existing `enabledTaskTypes: { "npm": false }` still works.** Step 4 catches it. ✓
- **Schema key rename `tsc` → `typescript` — no breaking change:** The schema key `tsc` is
  renamed to `typescript`. Since no provider ever called `isTaskTypeEnabled('tsc')` and the
  existing code mapped `typescript: 'typescript'` (pointing at a nonexistent schema key), no
  user's effective behavior changes. Both internal names `typescript` and `tsc` now map to the
  `typescript` config key. Users who previously set `"tsc": false` had no effect; they should
  now use `"typescript": false` — note in release notes.
- **`mise` now in schema with default `true`:** No behavior change for existing users since the
  fall-through already returned `true`; the explicit default just makes the behavior visible
  and ensures the sentinel treats `mise` correctly.
- **`pwsh`/`python` removed from `taskTypeMap`:** These types fall through to their own key.
  They are absent from the `enabledTaskTypes` schema and default, so without the sentinel they
  reach Step 6 and remain enabled (same as today). With the sentinel (`"*": false`), they will
  be blocked by Step 5 — but this is intentional: shell sub-types that a user wants in strict
  mode must be explicitly added. Document this in the release notes.

---

### 8. Task Breakdown

| # | Task | File(s) | Notes |
|---|---|---|---|
| T1 | Expand `taskTypeMap` (add all missing entries), add `tsc: 'typescript'` alias, rename schema key `tsc → typescript`, remove `pwsh`/`python`, extract map to `private static readonly` | `taskConfigService.ts`, `package.json`, `package.nls.json` | Schema-drift fix + performance fix |
| T1.5 | Run `npm run test:coverage` to verify no regressions from T1 | — | Gate before introducing new logic |
| T2 | Implement six-step precedence in `isTaskTypeEnabled`, add `micromatch` import, add inline comments | `taskConfigService.ts` | Core feature |
| T3 | Add `"*"` and `"mise"` to `enabledTaskTypes` `"properties"` block; keep `"additionalProperties": false`; add `"mise": true` to `"default"` | `package.json` | Schema update only — no relaxation |
| T4 | Add `enabledTaskTypePatterns` setting | `package.json` | Window scope (default) |
| T5 | Add `disabledTaskTypePatterns` setting | `package.json` | Window scope (default) |
| T6 | Add i18n strings for all new/changed settings | `package.nls.json` | |
| T7 | Write `taskConfigService.test.ts` including the sentinel integration test | `src/test/suite/` | 100% branch coverage; no sinon |
| T8 | Update docs: `discovery.md` + cross-reference from related config docs | `docs/configuration/task-discovery/discovery.md`, `docs/configuration/task-type.md` (if applicable) | |
| T9 | Run `npm run test:coverage` and confirm 100% branch coverage on `taskConfigService.ts` | — | Required per project guidelines |
