# Plan: Environment Variable Interpolation in Env Values (Two-Pass Resolution)

## TL;DR

Allow values in the `env` map of task definitions and `taskEnv` rules to contain token
references that are resolved at task execution time. **Pass 1** replaces VS Code context
tokens (`${workspaceFolder}`, `${env.VAR}`, `${file}`, etc.) in all resolved env values.
**Pass 2** makes a single non-recursive pass over the resulting map to expand intra-task
cross-references (`${task.OTHER_KEY}`) between env entries defined in the same task.
Both passes are applied **after** the full 14-layer merge is complete, so all layers
participate in interpolation. The feature is opt-in, controlled by a new setting.

---

## Background

`TaskEnvService.resolveTaskEnv()` builds a `Map<string, IResolvedEnvEntry>` from 14 precedence
layers. Values are currently treated as opaque strings. The 14-layer merge already handles
precedence (last layer wins for duplicate keys), but there is no mechanism to compose a value
from another variable.

Example use case:
```jsonc
// .workspace-tasks.json
"env": {
  "BASE_URL": "https://${env.ENV_NAME}.example.com",
  "API_URL":  "${task.BASE_URL}/api/v2"
}
```

`ENV_NAME` comes from the developer's shell environment; `API_URL` composes `BASE_URL` from the
same task definition. Neither is possible today.

### Existing template token precedent

`WorkspaceTasksService.resolveTaskCommand()` already substitutes `{{ .FileName }}` and
`{{ .VarName }}` inputs in command strings. The Run-with-Args Placeholder plan extends this with
`${workspaceFolder}` etc. for command strings. This plan applies the same VS Code context token
set to **env values**, using identical token names for consistency.

---

## Requirements

1. VS Code context tokens in env values are resolved in **Pass 1** before any `${task.X}`
   references are processed.
2. Supported Pass 1 tokens are resolved via the **shared `src/libs/contextTokenResolver.ts`
   module** (introduced in the Run-with-Args Placeholder plan, Idea 2). Both plans import
   `resolveContextTokens` and `buildContextFromVscode` from that module. The supported token
   set is:

   | Token | Value |
   |-------|-------|
   | `${workspaceFolder}` | Absolute path of the workspace folder associated with the task |
   | `${workspaceFolderBasename}` | Base name of that folder |
   | `${file}` | Active editor file path (`''` if no editor focused) |
   | `${fileBasename}` | File name with extension |
   | `${fileDirname}` | Directory of the active file |
   | `${fileExtname}` | Extension including leading dot |
   | `${fileBasenameNoExtension}` | File name without extension |
   | `${env.VAR}` | `process.env.VAR` (`''` if absent) |
   | `${pathSeparator}` | OS path separator |

   > **Note on `${file}` and related tokens:** `vscode.window.activeTextEditor` may be
   > `undefined` when a terminal has focus. These tokens resolve to `''` in that case.
   > This is a known limitation documented in Plan 1 and applies equally here.

   > **Note on `${cwd}`:** Removed — its value is ambiguous in the env-value context and
   > `${workspaceFolder}` is a less ambiguous replacement. Consistent with Plan 1.

3. **Pass 2** cross-references use `${task.KEY}`, where `KEY` is another key in the same
   resolved env map. Pass 2 processes keys in **Map iteration order** (insertion order).

   - **Forward references** (A references B which appears later in the map) yield B's
     **Pass-1 intermediate value** (not `''`). This is because B's Pass-1 value is already
     written into the map entry before Pass 2 begins; only B's Pass-2 expansion (intra-task
     cross-refs) has not yet occurred. This is by design.
   - **Missing key references** (`${task.NONEXISTENT}`) yield `''` with a logged warning.
   - **Circular references** (A → B, B → A) cannot loop infinitely because Pass 2 is a
     single non-recursive pass. A is processed first: it reads B's Pass-1 value. B is
     processed second: it reads A's now-Pass-2 value. No cycle detection is needed.

4. Interpolation is applied to **all** env entries, including those with `isSecret = true`.
   When an entry has `isSecret = true`, its `originalValue` field must **not** be included
   in any log output.
5. Unrecognised `${...}` tokens are preserved as-is (shell variables remain functional).
6. The feature is controlled by `workspaceTasks.envVars.enableInterpolation` (default: `true`).
   When `false`, env values are passed through unchanged and `originalValue` is never set.
7. When interpolation changes a value, `IResolvedEnvEntry.originalValue` is set to the
   pre-interpolation string. When the value is unchanged, `originalValue` is not set.
8. 100% test coverage for all new code.

> **Dependency:** This plan shares `src/libs/contextTokenResolver.ts` with the Run-with-Args
> Placeholder plan (Idea 2). If Plan 1 is implemented first, import from that module.
> If implementing standalone, create `contextTokenResolver.ts` as specified in Plan 1.

---

## Key Design Decisions

### Two-pass design avoids recursion and cycle-detection complexity

- Pass 1 replaces only statically known tokens (`${workspaceFolder}`, `${env.VAR}`, etc.) using
  `resolveContextTokens` from the shared `contextTokenResolver` module. No loops, no recursion.
- Pass 2 iterates the map **once** in Map iteration order, replacing `${task.KEY}` tokens with
  values already in the map (Pass-1 values for forward references, Pass-2 values for
  already-processed backward references). No DFS or cycle detector is required.

  **Forward reference clarification:** When key A appears before key B in the map and A
  references `${task.B}`, A's expansion reads B's current map value, which is B's Pass-1 value
  (Pass-2 has not yet run for B). This is deterministic and correct — the user's Pass-1 value
  for B is always available before Pass 2 begins.

### Insertion order for Pass 2

JSON objects in JavaScript (V8/Node.js ≥ 0.12) preserve string-key insertion order as defined
in the ECMAScript 2015+ spec. `Map` also preserves insertion order. The `resolveTaskEnv`
function builds the `result` Map in layer order (1 → 14), so later layers overwrite earlier
entries for the same key. The final map's key iteration order for duplicate keys reflects the
**last-write** insertion, which is the expected user-visible precedence. This is correct for
Pass 2: if layer 8 defines `API_URL = ${task.BASE_URL}` and layer 12 overrides `API_URL` with a
literal value, Pass 2 sees only the layer-12 value and does not try to expand `${task.BASE_URL}`.

### Interpolation is applied post-merge

Applying both passes after the 14-layer merge ensures:
- All sources (env files, SecretStorage, rules) are available for `${task.X}` references.
- The interpolation logic is a single, isolated post-processing step — the 14 layers do not need
  to be modified.

### Shared `contextTokenResolver` module

Pass 1 imports `resolveContextTokens` and `buildContextFromVscode` from
`src/libs/contextTokenResolver.ts` (defined in the Run-with-Args Placeholder plan). This avoids
duplicating the token set and token-replacement logic. Both plans share the same module.

### `TaskEnvInterpolator` as a standalone module

The interpolation logic lives in `src/services/taskEnvInterpolator.ts` (pure functions,
no VS Code API calls). Only the context (workspace folder, active file, etc.) is passed in as a
plain data object. This enables complete unit testing without mocking VS Code APIs.

### `${task.X}` syntax over reusing `${env.X}`

- `${env.X}` is reserved for `process.env` lookups — sharing the namespace would be confusing.
- `${task.X}` is unambiguous and distinct from both `${env.X}` and shell syntax.
- VS Code uses `${task.taskId}` in `dependsOn` within `tasks.json`; the `${task.KEY}` namespace
  feels familiar to VS Code users, though this extension's usage is distinct.
- Shell syntax `$BASE_URL` or `${BASE_URL}` is preserved (not matched by the regex).

---

## Implementation

### Phase 1: `TaskEnvInterpolator` module

**New file: `src/services/taskEnvInterpolator.ts`**

Imports `resolveContextTokens`, `buildContextFromVscode` from `src/libs/contextTokenResolver.ts`.
Exports:

```typescript
import { resolveContextTokens, buildContextFromVscode } from '../libs/contextTokenResolver';
import type { IResolvedEnvEntry } from './taskEnvTypes';

/**
 * Apply Pass 1: resolve VS Code context tokens in every env entry value.
 * Mutates entry.value in-place. Sets entry.originalValue if the value changed.
 * Skips entries whose values are unchanged (originalValue not set).
 * Does NOT log originalValue for secret entries.
 */
export function applyPass1(
  envMap: Map<string, IResolvedEnvEntry>,
  ctx: ReturnType<typeof buildContextFromVscode>,
): void {
  for (const entry of envMap.values()) {
    const resolved = resolveContextTokens(entry.value, ctx);
    if (resolved !== entry.value) {
      entry.originalValue = entry.value;
      entry.value = resolved;
    }
  }
}

/**
 * Pass 2: Replace ${task.KEY} cross-references.
 * Processes keys in Map iteration order.
 * Forward references yield the Pass-1 value of the referenced key.
 * Missing keys yield '' + logged warning.
 * Does NOT log originalValue for secret entries.
 */
export function applyPass2(
  envMap: Map<string, IResolvedEnvEntry>,
  logger: { warn: (msg: string) => void },
): void { ... }
```

Note: `resolveContextTokensInValue` is no longer a separate export — callers use
`resolveContextTokens` from the shared `contextTokenResolver` module directly.

#### `applyPass2` implementation

```
resolvedSoFar = new Map<string, string>()  // key → current value (Pass-1 already applied)

// Pre-populate resolvedSoFar with Pass-1 values so forward references work:
for each [key, entry] of envMap:
  resolvedSoFar.set(key, entry.value)

// Single expansion pass:
for each [key, entry] of envMap:
  if entry.value contains /\$\{task\.([^}]+)\}/g:
    // Use function callback to avoid $& / $$ replacement pitfalls
    expanded = entry.value.replace(pattern, (_, refKey) => {
      if resolvedSoFar.has(refKey):
        return resolvedSoFar.get(refKey)!  // Pass-1 value for forward refs, Pass-2 for processed refs
      else:
        logger.warn(`${task.${refKey}} not found for env key '${key}'; substituting empty string`)
        return ''
    })
    if expanded !== entry.value:
      if entry.originalValue === undefined:  // don't overwrite Pass-1 originalValue
        entry.originalValue = entry.value
      entry.value = expanded
    resolvedSoFar.set(key, entry.value)  // update so later keys see Pass-2 value
```

> **`String.replace` pitfall:** The replacement must use a function callback `() => value`
> rather than a string literal, to prevent JS treating `$&`, `$$`, `$'` etc. specially in
> replacement strings. This is the same pitfall documented in Plan 1.

### Phase 2: `IResolvedEnvEntry` update

**File: `src/services/taskEnvTypes.ts`**

Add optional field:
```typescript
originalValue?: string;  // pre-interpolation value; set only when interpolation changed the value
```

### Phase 3: Wiring into `TaskEnvService`

**File: `src/services/taskEnvService.ts`**

At the end of `resolveTaskEnv()`, after the 14-layer merge is complete:

```typescript
const cfg = vscode.workspace.getConfiguration('workspaceTasks');
const enableInterpolation = cfg.get<boolean>('envVars.enableInterpolation', true);

if (enableInterpolation) {
  const ctx = buildContextFromVscode(taskItem.workspaceFolder);
  applyPass1(result, ctx);
  applyPass2(result, this.logger);
}
```

`buildContextFromVscode` (from `src/libs/contextTokenResolver.ts`) populates `workspaceFolder`,
`workspaceFolderBasename`, `activeFile` (`''` if `activeTextEditor` is `undefined`), and
`pathSeparator`. It does not accept a `cwd` parameter (removed per Plan 1 decision).

### Phase 4: Settings

**File: `package.json` — `contributes.configuration`**

```jsonc
"workspaceTasks.envVars.enableInterpolation": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "%config.workspaceTasks.envVars.enableInterpolation.markdown%"
}
```

**File: `package.nls.json`** — add:

```json
"config.workspaceTasks.envVars.enableInterpolation": "Enable interpolation in env values",
"config.workspaceTasks.envVars.enableInterpolation.markdown": "Enable `${workspaceFolder}`, `${env.VAR}`, and `${task.KEY}` token interpolation in environment variable values. When disabled, values are passed through unchanged."
```

### Phase 5: Inspect Environment update

**File: `src/commands/inspectTaskEnvCommand.ts`**

When rendering the env entry table, if `entry.originalValue` is set, show:
- Primary line: resolved value (`entry.value`)
- Secondary detail line: `  ↳ raw: ${entry.originalValue}`

For entries with `isSecret = true`, show `  ↳ raw: (secret)` — do not reveal the raw template
or the resolved value in the UI (consistent with how secrets are handled today).

### Phase 6: Documentation

**File: `docs/features/task-environment-variables.md`**

1. Add a "Value Interpolation" section explaining the two-pass behaviour.
2. Provide examples:
   - `${env.MY_ENV}` in a value
   - `${workspaceFolder}` in a value
   - `${task.OTHER_KEY}` cross-reference (with ordering note)
3. Document the `workspaceTasks.envVars.enableInterpolation` opt-out setting.
4. Include a warning about key ordering for `${task.X}` forward references.

---

## Test Plan

**Target: 100% coverage of all new code.**

### New test file: `src/test/suite/taskEnvInterpolator.test.ts`

#### Pass 1 — `applyPass1` (delegates to shared `resolveContextTokens`)

| Test | Assertion |
|------|-----------|
| `${workspaceFolder}` → replaced | correct |
| `${workspaceFolderBasename}` → replaced | correct |
| `${file}` when `activeTextEditor` is `undefined` → `''` | graceful |
| `${env.KNOWN}` → `processEnv['KNOWN']` | correct |
| `${env.MISSING}` → empty string | graceful |
| `${UNKNOWN_TOKEN}` → preserved as-is | not substituted |
| `$SHELL_VAR` (no braces) → preserved as-is | not matched |
| Multiple tokens in one value → all replaced | all |
| No tokens → value unchanged, `originalValue` not set | identity |
| Value changes → `originalValue` set to pre-interpolation value | field set |
| `isSecret = true` entry with interpolatable value → value changed, `originalValue` set | secret entry |
| `isSecret = true` entry → `originalValue` not emitted to logger | no secret log |

#### `applyPass1`

| Test | Assertion |
|------|-----------|
| Applies `resolveContextTokensInValue` to every entry in the map | all entries updated |
| Sets `entry.originalValue` when value changes | field set |
| Does NOT set `entry.originalValue` when value was not changed | field absent |

#### Pass 2 — `applyPass2`

| Test | Assertion |
|------|-----------|
| `${task.BASE_URL}` where `BASE_URL` defined before → expanded with Pass-2 value | correct |
| `${task.MISSING_KEY}` → empty string + warning logged | graceful |
| Forward reference (`A = "${task.B}"`, B defined after A) → A gets B's Pass-1 value | forward ref |
| Circular: `A = "${task.B}"`, `B = "${task.A}"` (A first) → A gets B's Pass-1 value, B gets A's Pass-2 value | circular safe |
| Key with no `${task.*}` tokens → unchanged, `originalValue` not set | identity |
| Multiple `${task.KEY}` in one value → all expanded | all |
| `${task.some.key}` (dots in key name) → only matched if exact key `some.key` exists in map | dot key |
| `isSecret = true` entry → `originalValue` not logged | no secret log |
| `enableInterpolation = false` → `applyPass2` not called, no `originalValue` fields set | opt-out |
| Replacement uses function callback → `$&` in value is not treated as back-reference | $ safety |

#### Integration test — `applyPass1` then `applyPass2` in sequence

| Test | Assertion |
|------|-----------|
| `BASE_URL = "https://${env.HOST}"`, `API_URL = "${task.BASE_URL}/api"` → `API_URL` correctly resolved | end-to-end |
| `A = "${task.B}"`, `B = "literal"`, A defined before B → A resolves to `"literal"` (forward ref) | forward ref |
| Value containing `$&` as literal text is not mangled during replacement | $ safety |

### Updates to existing tests

**`src/test/suite/taskEnvService.test.ts`**:

1. Add tests verifying that `resolveTaskEnv` applies Pass 1 and Pass 2 when
   `enableInterpolation` is `true`.
2. Add test verifying that `resolveTaskEnv` skips interpolation when
   `enableInterpolation` is `false`.
3. Verify `entry.originalValue` is populated when interpolation changes a value.
4. Verify `entry.originalValue` is absent when value is unchanged.

---

## Checklist

- [ ] `src/libs/contextTokenResolver.ts` exists (from Plan 1) or created here as prerequisite
- [ ] `src/services/taskEnvInterpolator.ts` created with `applyPass1`, `applyPass2`
- [ ] `originalValue?: string` field added to `IResolvedEnvEntry` in `taskEnvTypes.ts`
- [ ] `TaskEnvService.resolveTaskEnv()` updated to call interpolator post-merge (gated by setting)
- [ ] `workspaceTasks.envVars.enableInterpolation` added to `package.json` (NLS keys)
- [ ] `package.nls.json` NLS key entries added
- [ ] `inspectTaskEnvCommand.ts` updated to show `↳ raw:` detail when `originalValue` present
- [ ] `src/test/suite/services/taskEnvInterpolator.test.ts` created (100% coverage)
- [ ] `src/test/suite/services/taskEnvService.test.ts` updated with interpolation integration tests
- [ ] `docs/features/task-environment-variables.md` updated with "Value Interpolation" section

## Post-Review Notes

- **Shared `contextTokenResolver.ts`:** Pass 1 now delegates to the shared module from Plan 1
  instead of reimplementing token replacement. Eliminates duplicate token definitions.
- **`${cwd}` removed:** Consistent with Plan 1 decision — value is ambiguous in the env context.
- **Forward references yield Pass-1 value (not `''`):** `resolvedSoFar` is pre-populated with
  all Pass-1 values before the expansion loop, so forward references get the referenced key's
  Pass-1 value rather than an empty string.
- **`String.replace` function callback:** Replacement uses `() => value` to prevent `$&`/`$$`
  back-reference mangling. Same pitfall as Plan 1's `injectArgs`.
- **`isSecret = true` entries:** Interpolation applies; `originalValue` must not be logged.
- **`applyPass1` mutates in-place:** Sets `entry.originalValue` then `entry.value`. Does not
  return a new Map.
- **`${task.X}` namespace:** Semantically adjacent to VS Code's `${task.taskId}` in `dependsOn`;
  familiar to VS Code users while remaining distinct.
- **NLS keys required:** Setting description uses `markdownDescription` with `%key%` pattern
  and entries in `package.nls.json`.
- **`inspectTaskEnvCommand` display format:** Shows `  ↳ raw: (secret)` for `isSecret` entries
  to avoid leaking the raw template.
