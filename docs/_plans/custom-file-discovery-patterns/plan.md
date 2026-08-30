# Plan: User-Configurable File Discovery Patterns Per Task Provider

## TL;DR

Today there is **no way** for a user to say "for `makefile`, keep the built-in discovery pattern but
also look at `*.mk`". Only three providers (`taskfile`, `gitlab-ci`, `circleci`) expose bespoke,
copy-pasted `workspaceTasks.<type>.additionalFilePatterns` settings, and even those aren't fully wired
into the file-watcher/cache layer. This plan adds **one generic setting**,
`workspaceTasks.additionalFilePatterns` (an object keyed by the same task-type names used in
`enabledTaskTypes`), that every provider merges with its built-in glob pattern(s). The three existing
bespoke settings are kept for backward compatibility but marked deprecated in favor of the generic one.

---

## Inputs Used

### User Request

> for `makefile`, use the existing file patterns, but also use `*.mk`. A user should be able to define
> glob patterns for the task providers.

### Current State (verified in code)

- `BaseTaskProvider` ([src/taskProvider.ts](../../../src/taskProvider.ts)) stores a single `filePattern`
  string per provider and exposes `getFilePatterns(): string[]`, which by default returns
  `this.filePattern ? [this.filePattern] : []`.
- Roughly 20 providers hardcode `filesService.findFiles([constants.GLOB_X])` directly inside
  `getTasks()` (e.g. [src/providers/makefileTaskProvider.ts](../../../src/providers/makefileTaskProvider.ts#L37),
  `antTaskProvider.ts`, `cakeTaskProvider.ts`, `cmakeTaskProvider.ts`, `composerTaskProvider.ts`,
  `denoTaskProvider.ts`, `githubActionsTaskProvider.ts`, `gradleTaskProvider.ts`, `gruntTaskProvider.ts`,
  `gulpTaskProvider.ts`, `jupyterTaskProvider.ts`, `justfileTaskProvider.ts`, `mavenTaskProvider.ts`,
  `msbuildTaskProvider.ts`, `rakeTaskProvider.ts` (two call sites), `vscodeTaskProvider.ts`,
  `bitbucketPipelinesTaskProvider.ts`), so they never see anything the user configures.
- Three providers already have **bespoke, one-off** settings that read an extra `string[]` from config
  and prepend/append it to the built-in glob before calling `findFiles`:
  - `workspaceTasks.taskfile.additionalFilePatterns` ([taskfileTaskProvider.ts](../../../src/providers/taskfileTaskProvider.ts#L172))
  - `workspaceTasks.gitlabCiLocal.additionalFilePatterns` ([gitlabCiTaskProvider.ts](../../../src/providers/gitlabCiTaskProvider.ts#L56))
  - `workspaceTasks.circleci.additionalFilePatterns` ([circleCiTaskProvider.ts](../../../src/providers/circleCiTaskProvider.ts#L50))
  - **Gap:** none of these three override `getFilePatterns()`, so the extra patterns are never
    registered with `TaskFilesService` ([src/services/taskFilesService.ts](../../../src/services/taskFilesService.ts)).
    They are served through the "uncovered pattern" fallback path (a live, uncached
    `vscode.workspace.findFiles` per call), and — more importantly — file-system create/change/delete
    events for files that *only* match the extra pattern never invalidate the cache
    (`anyFileMatchesRegisteredPatterns` only checks `registeredPatterns`). Watch behavior is silently
    incomplete for these three today.
- `TomlTaskProvider` (mise, pipenv, poe, poetry, cargo-make) uses an abstract `getGlobPatterns()` that
  each subclass implements; `getFilePatterns()` already delegates to it, but `getTasks()` calls
  `this.getGlobPatterns()` directly instead of `this.getFilePatterns()`.
- `PackageJsonTaskProvider` (npm, pnpm, yarn, bun) reads `this.filePattern || constants.GLOB_NODEJS`
  directly instead of `this.getFilePatterns()`.
- `TaskConfigService` ([src/services/taskConfigService.ts](../../../src/services/taskConfigService.ts))
  already maintains a canonical `taskTypeMap` from internal provider `type` strings (e.g. `makefile`,
  `justfile`, `dockerfile`) to the public config-key names used in `enabledTaskTypes`
  (e.g. `make`, `just`, `docker`). This is the natural key space to reuse for the new setting so it
  stays consistent with `enabledTaskTypes` / `enabledTaskTypePatterns` / `disabledTaskTypePatterns`.
- `TaskFilesService.rebuildRegisteredPatterns()` already exists and is called on
  `workspaceTasks.shellAdditionalExtensions` config changes — re-collecting `getFilePatterns()` from
  every registered provider and invalidating the cache. The same hook can be reused for the new
  setting without inventing new plumbing.

**Conclusion:** the capability the user wants does not exist today, and the closest analogues
(`taskfile`/`gitlab-ci`/`circleci`) are incomplete, non-generic, and undiscoverable for other 25+
provider types. A generic mechanism is warranted.

---

## Goals

1. Let a user add extra glob patterns for **any** task-type provider without needing a bespoke setting
   per provider.
2. Keep the built-in patterns for the type **and additively merge** the user's patterns (never replace).
3. Fix the existing gap where extra patterns aren't part of the file-watcher registration.
4. Preserve backward compatibility for the three existing bespoke settings.
5. No behavior change for users who don't set the new setting (empty object default).

### Non-Goals

- Replacing a provider's built-in pattern entirely (out of scope — additive only, matches the user's
  literal request "use the existing file patterns, but also use ...").
- Per-folder / per-workspace-folder override granularity beyond what `scope: resource` already gives
  VS Code settings.
- Changing `ShellTaskProvider`'s extension-based discovery (`workspaceTasks.shellAdditionalExtensions`
  already covers that use case) or `WorkspaceTasksProvider`'s per-task-definition `globs.include`
  (already fully user-configurable via `workspace-tasks.json` itself). Both are explicitly excluded —
  see Design Decision 6.

---

## Proposed Setting

### `workspaceTasks.additionalFilePatterns`

| | |
| --- | --- |
| **Type:** | `object` (`Record<string, string[]>`) |
| **Default:** | `{}` |
| **Scope:** | `resource` |

Keys are task-type config keys — the **same names** used in `workspaceTasks.enabledTaskTypes`
(`make`, `just`, `gulp`, `docker`, `npm`, ...), not internal provider-class type strings. Values are
arrays of extra glob patterns merged with (not replacing) that provider's built-in pattern(s).

**Example — the user's original ask:**

```json
{
  "workspaceTasks.additionalFilePatterns": {
    "make": ["**/*.mk"]
  }
}
```

**Example — multiple types:**

```json
{
  "workspaceTasks.additionalFilePatterns": {
    "make": ["**/*.mk"],
    "just": ["**/*.justfile.custom"],
    "npm": ["**/package.dist.json"]
  }
}
```

Invalid keys (task types that don't exist) are ignored with a debug-log warning; invalid values
(non-array, non-string entries) are filtered out defensively.

---

## Design Decisions

### 1) Reuse `enabledTaskTypes` key space, not internal provider `type`

Internal provider `type` strings are implementation details (`makefile`, `justfile`, `dockerfile`,
`docker-compose`, `workspace-task`) that don't match what users already see and configure in
`enabledTaskTypes`/`shellPaths`/`shellEnabledTaskTypes` (`make`, `just`, `docker`, `workspace`).
Reusing the same key space means:

- Users already know the key names from `enabledTaskTypes`.
- `TaskConfigService.taskTypeMap` (private today) becomes the single source of truth for the mapping
  and gets a new public accessor, `getConfigKey(taskType: string): string`, used both by
  `isTaskTypeEnabled` (refactored to call it) and the new additional-patterns lookup — no duplicated
  mapping tables.
- `dockerfile` and `docker-compose` both read from the same `docker` key, matching existing
  `enabledTaskTypes.docker` behavior (one setting, two internal providers).

### 2) Merge point: `BaseTaskProvider`, not each provider

Add to `BaseTaskProvider`:

```ts
protected getConfiguredAdditionalPatterns(): string[] {
  const config = vscode.workspace.getConfiguration('workspaceTasks');
  const configKey = TaskConfigService.getInstance().getConfigKey(this.type);
  const map = config.get<Record<string, unknown>>('additionalFilePatterns', {});
  const raw = map?.[configKey];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

protected mergeFilePatterns(builtin: string[]): string[] {
  const extra = this.getConfiguredAdditionalPatterns();
  return Array.from(new Set([...builtin, ...extra]));
}
```

`getFilePatterns()`'s default implementation becomes:

```ts
getFilePatterns(): string[] {
  return this.mergeFilePatterns(this.filePattern ? [this.filePattern] : []);
}
```

Every provider that does **not** override `getFilePatterns()` (the majority — ant, cake, cmake,
composer, deno, github-actions, gradle, grunt, gulp, jupyter, justfile, makefile, maven, msbuild, rake,
vscode, bitbucket-pipelines, taskfile, gitlab-ci, circleci) gets the merge for free.

`TomlTaskProvider` (mise, pipenv, poe, poetry, cargo-make) overrides `getFilePatterns()` to call
`getGlobPatterns()`; that override changes to `this.mergeFilePatterns(this.getGlobPatterns())`.

`PackageJsonTaskProvider` (npm, pnpm, yarn, bun) doesn't override `getFilePatterns()` today (it reads
`this.filePattern` inline in `getTasks()`); no change needed there beyond point 3 below.

### 3) `getTasks()` must call `getFilePatterns()`, not the built-in constant, directly

Merging patterns in `getFilePatterns()` only helps if the discovery code path actually calls it. Two
groups of call sites need a one-line change:

- **~20 providers** that call `filesService.findFiles([constants.GLOB_X])` → change to
  `filesService.findFiles(this.getFilePatterns())`.
- **`TomlTaskProvider.getTasks()`** calls `this.getGlobPatterns()` directly → change to
  `this.getFilePatterns()`.
- **`PackageJsonTaskProvider.getTasks()`** reads `this.filePattern || constants.GLOB_NODEJS` directly →
  change to `this.getFilePatterns()` (falls back to `[]` only if a subclass ever forgets to pass a
  `filePattern`, which none do today; keep the `constants.GLOB_NODEJS` fallback as a defensive default
  inside `getFilePatterns` override for safety, not inline in `getTasks`).
- **`RakeTaskProvider`**: two call sites (`getTasks()` and the `getSystemTasks()` Rakefile-lookup loop)
  both need the swap so system-task file association also respects the custom patterns.

No changes needed for providers that already build their own merged list from a bespoke setting
(`taskfile`, `gitlab-ci`, `circleci`) — see Design Decision 4.

### 4) Fold the three legacy bespoke settings into the generic one (with back-compat)

`taskfileTaskProvider.ts`, `gitlabCiTaskProvider.ts`, and `circleCiTaskProvider.ts` currently do:

```ts
const extraPatterns = config.get<string[]>('circleci.additionalFilePatterns', []);
const globs = [constants.GLOB_CIRCLECI, ...extraPatterns];
```

Change each to call `this.getFilePatterns()` (which now includes the generic
`additionalFilePatterns.circleci` entries) **unioned** with the legacy setting, so users who already
adopted the bespoke setting keep working with zero migration:

```ts
override getFilePatterns(): string[] {
  const legacy = vscode.workspace.getConfiguration('workspaceTasks')
    .get<string[]>('circleci.additionalFilePatterns', []);
  return this.mergeFilePatterns([constants.GLOB_CIRCLECI, ...legacy]);
}
```

`getTasks()` in all three then simply calls `filesService.findFiles(this.getFilePatterns())`, deleting
the local `config.get(...)` / `globs` construction. This also **fixes the existing watcher gap**
(Design Decision — see "Current State") because `getFilePatterns()` output (now including legacy +
generic patterns) is what gets registered via `filesService.registerPatterns(...)` in
`providers/index.ts` and re-registered by `rebuildRegisteredPatterns()`.

The three legacy settings are marked `{: .deprecated}` in docs (kept functional, not removed) pointing
users to the generic setting. No removal timeline is set in this plan.

### 5) React to configuration changes

`TaskFilesService` already has a config-change handler that special-cases
`workspaceTasks.shellAdditionalExtensions` by calling `rebuildRegisteredPatterns()` +
`invalidateCache()`. Add one more branch:

```ts
if (e.affectsConfiguration('workspaceTasks.additionalFilePatterns')) {
  this.rebuildRegisteredPatterns();
  this.invalidateCache();
}
```

This reuses existing, tested plumbing — no new watcher/cache logic required. The legacy per-provider
settings (`taskfile.additionalFilePatterns` etc.) already implicitly trigger a rebuild today only via
whatever generic config-change handling exists elsewhere (verify during implementation whether an
equivalent branch is needed for them too, or whether they were previously relying on the "uncovered
pattern" live-query fallback and never actually reacted to fs watcher events — see Open Question 1).

### 6) Explicitly out of scope: `ShellTaskProvider`, `WorkspaceTasksProvider`, and keys with no file-based provider

- `ShellTaskProvider` builds its glob from a dynamic *extension* set
  (`workspaceTasks.shellEnabledTaskTypes` + `workspaceTasks.shellAdditionalExtensions`), not a single
  static glob. Folding in arbitrary full globs from `additionalFilePatterns.shell` would create two
  overlapping, differently-shaped mechanisms for the same provider. Left for a future iteration if
  requested. This also covers the `ruby` key: `ruby` is dual-control today (a real `taskTypeMap` entry
  used by `isTaskTypeEnabled('ruby')` for Rake tasks, **and** a `ShellTaskProvider` sub-type gated by
  `shellEnabledTaskTypes.ruby` — see [shellTaskProvider.ts](../../../src/providers/shellTaskProvider.ts#L50)).
  Only the Rake side is a real file-discovery target; see the allowlist below.
- `WorkspaceTasksProvider`'s per-definition `globs.include`/`globs.exclude` are already fully
  user-defined per task provider *inside* `workspace-tasks.json` — a second, extension-settings-level
  override would be redundant and confusing about precedence. `additionalFilePatterns.workspace` would
  still apply to the outer discovery glob for the `workspace-tasks.json` file itself (unaffected,
  low-risk, included).
- **`docker` has no file-discovery provider at all and must not be an accepted key.** Verified:
  `dockerfile` is handled entirely inside `taskFactory.ts`'s `SPECIAL_CASE_TASK_TYPES` special-case
  branch (no `BaseTaskProvider` subclass, no `getFilePatterns()`, no `GLOB_DOCKER*` constant exists).
  There is no `docker-compose` provider either. If `docker` were accepted as a valid key purely because
  it exists in `taskTypeMap`/`enabledTaskTypes`, `additionalFilePatterns.docker` would look like a
  supported setting in the JSON schema/docs but silently do nothing — a real correctness bug, not a
  cosmetic gap. Implementing Dockerfile/docker-compose file discovery is out of scope for this plan.
- **Same dead-key problem exists for `eslint`, `webpack`, `go`, `cargo`, `typescript`/`tsc`.** These are
  declared in `enabledTaskTypes` (package.json) and `TaskConfigService.taskTypeMap` but have **zero**
  provider classes or `findFiles` call sites anywhere in `src/providers/` — confirmed via a full-tree
  search. They appear to be reserved/roadmap surface area (some matching `GLOB_*` constants exist in
  `constants.ts` and are unit-tested in isolation but never imported by a provider). Treat these the
  same as `docker`/`ruby`: not accepted keys for this feature.

#### Allowlist of valid `additionalFilePatterns` keys (v1)

Rather than accepting any string key that exists in `taskTypeMap` (which includes the dead keys above),
`getConfiguredAdditionalPatterns()` validates the key against an explicit allowlist — the config keys
of providers that actually call `TaskFilesService.findFiles()` with a static glob:

`ant`, `bitbucket` (config key for `BitbucketPipelinesTaskProvider`, verified in
`package.json`'s `enabledTaskTypes` default object — the provider's internal `type` is `'bitbucket'`
and it is absent from `taskTypeMap`, so `getConfigKey('bitbucket')` falls back to the input unchanged,
which still resolves correctly), `bun`, `cake`, `cargo-make`, `circleci`, `cmake`, `composer`, `deno`,
`github-actions`, `gitlab-ci`, `gradle`, `grunt`, `gulp`, `just`, `jupyter`, `make`, `maven`, `mise`,
`msbuild`, `npm`, `pipenv`, `pnpm`, `poe`, `poetry`, `rake`, `taskfile`, `vscode`, `workspace`, `yarn`.

A unit test (`taskConfigService.test.ts` or a new `additionalFilePatternsAllowlist.test.ts`) must assert
that this allowlist is a subset of `taskTypeMap`'s values (fails loudly if someone renames a config key)
and — ideally — that every `getProviderConstructors()` entry in `providers/index.ts` whose class extends
a file-pattern-based base (`BaseTaskProvider` excluding `ShellTaskProvider`/`WorkspaceTasksProvider`
special paths) has a corresponding allowlist entry, so newly added providers don't silently fall through
the cracks the way `docker`/`eslint`/`webpack`/`go`/`cargo`/`typescript` did.

### 7) Validation and error handling

- Non-object value for `additionalFilePatterns` → treated as `{}` (VS Code JSON schema validation
  should already catch this in settings UI; defensive `typeof` check in code).
- **Key not in the allowlist above** → ignored, with a `debug`-level log distinguishing two cases so
  troubleshooting is possible: (a) key not recognized at all (likely a typo), vs. (b) key recognized as
  a valid `enabledTaskTypes` config key but not applicable to file-based discovery (e.g. `docker`,
  `ruby`, `shell`, `eslint`) — the log message for case (b) should say so explicitly rather than a
  generic "unknown type" message, since users will reasonably try these names first.
- Non-array value for a given key → ignored (treated as no extra patterns for that type), logged at
  `debug` level once per offending key per config load to avoid log spam.
- Non-string array entries → filtered out silently (schema-level `items.type: string` prevents this in
  practice via Settings UI, but hand-edited `settings.json` can still violate it).
- Empty-string patterns are filtered out (avoid accidentally matching everything via a stray `""`).
- No glob-syntax validation is performed — an invalid glob simply matches nothing (existing behavior
  for built-in patterns is the same; `micromatch` doesn't throw on most malformed input).

---

## Implementation Plan

### 7.1 `TaskConfigService` (src/services/taskConfigService.ts)

- Add `public getConfigKey(taskType: string): string` returning `taskTypeMap[taskType] ?? taskType`.
- Refactor `isTaskTypeEnabled` to call `this.getConfigKey(taskType)` instead of inlining the lookup
  (behavior-neutral refactor).

### 7.2 `BaseTaskProvider` (src/taskProvider.ts)

- Import `TaskConfigService`.
- Add `protected getConfiguredAdditionalPatterns(): string[]` and
  `protected mergeFilePatterns(builtin: string[]): string[]` as shown in Design Decision 2.
- Change default `getFilePatterns()` to use `mergeFilePatterns`.

### 7.3 Simple single-glob providers (one-line `findFiles` change each)

`antTaskProvider.ts`, `cakeTaskProvider.ts`, `cmakeTaskProvider.ts`, `composerTaskProvider.ts`,
`denoTaskProvider.ts`, `githubActionsTaskProvider.ts`, `gradleTaskProvider.ts`, `gruntTaskProvider.ts`,
`gulpTaskProvider.ts`, `jupyterTaskProvider.ts`, `justfileTaskProvider.ts`, `makefileTaskProvider.ts`,
`mavenTaskProvider.ts`, `msbuildTaskProvider.ts`, `rakeTaskProvider.ts` (both call sites),
`vscodeTaskProvider.ts`, `bitbucketPipelinesTaskProvider.ts`:

```diff
- const files = await filesService.findFiles([constants.GLOB_X]);
+ const files = await filesService.findFiles(this.getFilePatterns());
```

**Centralize via a `BaseTaskProvider` helper instead of a bare inline call.** Rather than repeating
`filesService.findFiles(this.getFilePatterns())` in ~20 places (which reintroduces the exact
copy/paste risk that created the current `[constants.GLOB_X]` inconsistency), add one more method to
`BaseTaskProvider`:

```ts
protected async getMatchingFiles(exclude?: string[]): Promise<vscode.Uri[]> {
  return TaskFilesService.getInstance().findFiles(this.getFilePatterns(), exclude);
}
```

Each of the ~20 call sites then becomes `const files = await this.getMatchingFiles();` (or
`this.getMatchingFiles([constants.GLOB_SOME_EXCLUDE])` where a provider already passes an exclude
list). This doesn't reduce the number of touched files, but it removes the recurring "did I forget to
call `this.getFilePatterns()` instead of hardcoding the constant" failure mode for any *future*
provider — a new provider that forgets to override anything still gets correct merge behavior for
free as long as it calls `this.getMatchingFiles()`.

### 7.4 `TomlTaskProvider` (src/providers/tomlTaskProvider.ts)

```diff
  override getFilePatterns(): string[] {
-   return this.getGlobPatterns();
+   return this.mergeFilePatterns(this.getGlobPatterns());
  }
  ...
-   const files = await filesService.findFiles(this.getGlobPatterns());
+   const files = await this.getMatchingFiles();
```

Covers `cargoMakeTaskProvider.ts`, `miseTaskProvider.ts`, `pipenvTaskProvider.ts`, `poeTaskProvider.ts`,
`poetryTaskProvider.ts` with no per-subclass changes (each already implements `getGlobPatterns()`).

### 7.5 `PackageJsonTaskProvider` (src/providers/packageJsonTaskProvider.ts)

```diff
  override getFilePatterns(): string[] {
-   return this.filePattern ? [this.filePattern] : [];
+   return this.mergeFilePatterns(this.filePattern ? [this.filePattern] : [constants.GLOB_NODEJS]);
  }
  ...
-   const files = await filesService.findFiles([this.filePattern || constants.GLOB_NODEJS]);
+   const files = await this.getMatchingFiles();
```

(Add the `getFilePatterns()` override since it doesn't have one today; base class default already
does the same merge, but the `GLOB_NODEJS` fallback is preserved explicitly here for clarity.)

Covers `npmTaskProvider.ts` (Bun/Npm/Pnpm/Yarn all extend this).

### 7.6 Legacy bespoke-setting providers

`taskfileTaskProvider.ts`, `gitlabCiTaskProvider.ts`, `circleCiTaskProvider.ts`: add a `getFilePatterns()`
override that merges built-in + legacy setting + generic setting (Design Decision 4); simplify
`getTasks()` to call `this.getFilePatterns()`.

### 7.7 `WorkspaceTasksProvider` (src/providers/workspaceTasksProvider.ts)

- `getFilePatterns()` currently returns `[this.filePattern!]` only (the outer `workspace-tasks.json`
  discovery glob). Change to `this.mergeFilePatterns([this.filePattern!])` so
  `additionalFilePatterns.workspace` can add alternate config filenames. Per-definition
  `globs.include`/`exclude` inside the config file are untouched (Design Decision 6).

### 7.8 `TaskFilesService` (src/services/taskFilesService.ts)

- Add the `workspaceTasks.additionalFilePatterns` branch to the existing config-change handler
  (Design Decision 5).

### 7.9 `package.json` configuration schema

Add:

```jsonc
"workspaceTasks.additionalFilePatterns": {
  "type": "object",
  "additionalProperties": {
    "type": "array",
    "items": { "type": "string" }
  },
  "default": {},
  "markdownDescription": "%config.workspaceTasks.additionalFilePatterns.markdown%",
  "scope": "resource"
}
```

Mark the three legacy settings' `markdownDescription` strings (in `package.nls.json`) with a
"Deprecated: use `workspaceTasks.additionalFilePatterns.<type>` instead." prefix, without removing them.

### 7.10 `package.nls.json`

Add `config.workspaceTasks.additionalFilePatterns.markdown` with an explanation + the `make`/`*.mk`
example from this plan. Update the three legacy keys' markdown strings per 7.9.

### 7.11 Docs

- [docs/configuration/task-discovery/discovery.md](../../configuration/task-discovery/discovery.md):
  add a new `### workspaceTasks.additionalFilePatterns` section (placed near the top, before the
  per-provider legacy sections), following the existing doc style (type/default/scope table + example
  + screenshot placeholder if applicable). Add `{: .new }` callout with the target version.
  Update the three legacy sections with a `{: .deprecated}` callout cross-linking to the new setting.
  Include the allowlist of valid keys (Design Decision 6) directly in this section so users don't have
  to guess which `enabledTaskTypes` keys are accepted.
- **Scope decision for the ~24 individual provider pages under `docs/task-types/`:** do **not** edit
  every provider's own doc page for this change. The single canonical section in `discovery.md` is the
  source of truth for this cross-cutting setting, exactly like `enabledTaskTypePatterns` and
  `disabledTaskTypePatterns` already are (neither of those is duplicated onto every provider page
  either). This keeps the docs diff proportional to the setting's nature (one generic mechanism) rather
  than the number of providers it applies to. Exception: if a provider page already has its own
  "Custom file patterns" callout (only `taskfile`'s page is expected to, given its existing bespoke
  setting), add a one-line cross-reference there to avoid contradicting the newly-deprecated local
  setting.
- README.md: no change needed (README is "minimal form" and doesn't enumerate individual settings
  today — verify during implementation and add a one-line mention only if the README already lists
  comparable settings).

### 7.12 Tests

Verified exact existing test file names against the repo (do **not** assume a provider's test file is
named `<ProviderClassName>.test.ts` — the convention is inconsistent):

| Provider source file | Actual test file |
| --- | --- |
| `antTaskProvider.ts` | `ant.test.ts` |
| `cakeTaskProvider.ts` | `cake.test.ts` |
| `cmakeTaskProvider.ts` | `cmake.test.ts` |
| `composerTaskProvider.ts` | `composer.test.ts` |
| `denoTaskProvider.ts` | `deno.test.ts` |
| `githubActionsTaskProvider.ts` | `githubActionsTaskProvider.test.ts` |
| `gradleTaskProvider.ts` | `gradle.test.ts` |
| `gruntTaskProvider.ts` | `grunt.test.ts` |
| `gulpTaskProvider.ts` | `gulp.test.ts` (+ `gulpExecution.test.ts`) |
| `jupyterTaskProvider.ts` | `jupyterTaskProvider.test.ts` |
| `justfileTaskProvider.ts` | `justfile.test.ts` |
| `makefileTaskProvider.ts` | `makefile.test.ts` (**not** `makefileTaskProvider.test.ts`) |
| `mavenTaskProvider.ts` | `maven.test.ts` |
| `msbuildTaskProvider.ts` | `msbuild.test.ts` |
| `rakeTaskProvider.ts` | `rake.test.ts` |
| `vscodeTaskProvider.ts` | `vscodeTaskProvider.test.ts` |
| `bitbucketPipelinesTaskProvider.ts` | `bitbucketPipelinesTaskProvider.test.ts` |
| `cargoMakeTaskProvider.ts` | `cargoMake.test.ts` |
| `miseTaskProvider.ts` | `mise.test.ts` |
| `pipenvTaskProvider.ts` | `toml.test.ts` (shared with cargo-make/poe/poetry-style TOML coverage; also referenced in `simpleProviderCreateTask.test.ts`) |
| `poeTaskProvider.ts` | `poe.test.ts` |
| `poetryTaskProvider.ts` | `poetry.test.ts` |
| `packageJsonTaskProvider.ts` / `npmTaskProvider.ts` | `packageJsonTaskProvider.test.ts`, `npmTaskProvider.test.ts`, `packageYamlTaskProvider.test.ts` (pnpm) |
| `taskfileTaskProvider.ts` | `taskfileTaskProvider.test.ts` |
| `gitlabCiTaskProvider.ts` | `gitlabCiTaskProvider.test.ts` |
| `circleCiTaskProvider.ts` | `circleCiTaskProvider.test.ts` |
| `workspaceTasksProvider.ts` | `workspaceTasksProvider.test.ts` |

Re-verify this table against the working tree immediately before implementation (test files may have
moved since this plan was written).

- `src/test/suite/taskConfigService.test.ts`: add coverage for `getConfigKey` (known mapping +
  fallback to input for unrecognized types) and for the allowlist-membership assertion described in
  Design Decision 6 (allowlist ⊆ `taskTypeMap` values; every file-pattern-based provider in
  `providers/index.ts` has an allowlist entry).
- New/extended suite for `BaseTaskProvider.mergeFilePatterns` / `getConfiguredAdditionalPatterns` /
  `getMatchingFiles`: empty config → passthrough; valid extra patterns → merged + deduped; non-array
  value → ignored; non-string entries → filtered; key not in allowlist → no effect (both "unknown
  entirely" and "known `enabledTaskTypes` key but not file-based" sub-cases, per Design Decision 7).
  This is new logic with zero existing coverage, so it needs its own dedicated test file/suite, not an
  incidental assertion tucked into an unrelated provider test.
- **Every one of the ~24 provider files in the table above gets its own test**, not a representative
  sample — each file's changed line (`this.getMatchingFiles()` replacing
  `filesService.findFiles([constants.GLOB_X])`) is new, previously-untested branch logic in that file,
  and the repo's coverage gate (`pnpm run vscode:test:coverage`) is enforced **per file** at ≥95% per
  [.github/copilot-instructions.md](../../../.github/copilot-instructions.md). A "few representative
  providers" approach would leave the untested files' new line(s) below the coverage bar and fail CI.
  The existing `taskfileTaskProvider.test.ts` `additionalFilePatterns` suite
  ([taskfileTaskProvider.test.ts#L317](../../../src/test/suite/taskfileTaskProvider.test.ts#L317)) is
  the pattern to replicate in each file: mock `filesService.findFiles` to capture the patterns array
  and assert it equals `[builtin, ...configured]`.
- `taskfileTaskProvider.test.ts` / `gitlabCiTaskProvider.test.ts` / `circleCiTaskProvider.test.ts`:
  extend existing `additionalFilePatterns` suites to also verify the generic setting works, that the
  legacy + generic settings can be combined without duplicate results (dedup check), and that the
  merged pattern list is what actually gets **registered** with `TaskFilesService` (new assertion —
  see Open Question 1 resolution below, this is the behavior the legacy settings were missing).
- `taskFilesService.test.ts`: add a case verifying that `workspaceTasks.additionalFilePatterns` config
  changes trigger `rebuildRegisteredPatterns` + cache invalidation, mirroring the existing
  `shellAdditionalExtensions` test.
- Run `pnpm test` and `pnpm run vscode:test:coverage` and confirm coverage stays ≥ 95% for every
  touched file individually, not just in aggregate.

---

## Migration / Backward Compatibility

- Default `{}` means zero behavior change for existing users.
- Legacy `taskfile.additionalFilePatterns` / `gitlabCiLocal.additionalFilePatterns` /
  `circleci.additionalFilePatterns` keep working, unioned with the new generic setting — no breaking
  change, no forced migration.
- No provider's built-in pattern is ever removed or replaced — purely additive.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| ~25 files touched increases review surface / regression risk | Every change is a mechanical one-line swap (`[constants.GLOB_X]` → `this.getMatchingFiles()`); no behavior change when the new setting is unset because `getFilePatterns()` returns `[builtin]` in that case. Covered by existing per-provider test suites (must all still pass unmodified). |
| Duplicate glob patterns causing duplicate file results | `mergeFilePatterns` dedupes via `Set`; `TaskFilesService` cache/`findFiles` already dedupes by file path across combined patterns. |
| **Dead-key correctness bug**: a documented-looking setting key (e.g. `docker`, `ruby`, `eslint`, `webpack`, `go`, `cargo`, `typescript`) silently does nothing because no provider implements file-based discovery for it | Explicit allowlist (Design Decision 6) instead of accepting any `taskTypeMap` key; distinguish "unrecognized" vs. "recognized but not file-based" in debug logs (Design Decision 7); docs enumerate the allowlist explicitly rather than implying "any `enabledTaskTypes` key works". |
| **Allowlist/provider drift**: a future new provider is added to `providers/index.ts` but never added to the `additionalFilePatterns` allowlist, silently repeating the dead-key problem | Unit test asserting every file-pattern-based provider in `getProviderConstructors()` has a corresponding allowlist entry (Design Decision 6), so CI fails loudly instead of shipping a silent gap. |
| User sets a type key that doesn't exist / typos the key | Silently a no-op (documented); consider a startup validation warning in a future iteration (not blocking for v1). |
| Performance regression from more registered glob patterns | Patterns are combined into a single brace-expanded `vscode.workspace.findFiles` call already (existing `_doBuildCache` behavior) — adding more literal patterns to the same combined call is the same cost model as today's built-ins, not a new scan per pattern. |
| **Coverage gate failure**: repo enforces ≥95% coverage per touched file; new `BaseTaskProvider` merge logic and ~24 changed provider call sites are all new, previously-uncovered branches | Testing plan (7.12) requires a test in every touched provider file (no "representative sample"), plus a dedicated suite for the new `BaseTaskProvider` methods themselves. |
| Silent behavior change for existing `taskfile`/`gitlab-ci`/`circleci` `additionalFilePatterns` users once the watcher-registration gap is fixed (their extra patterns start participating in fs-watch invalidation for the first time) | Low risk in practice — the change only makes file create/change/delete events for extra-pattern files *also* trigger a refresh, which is a strict improvement (more responsive, never fewer results). Call out explicitly in the changelog-facing commit message per Open Question 1 resolution below so it isn't mistaken for an unrelated fix. |

---

## Open Questions

1. ~~Do the three legacy bespoke settings currently invalidate the fs-watcher cache at all today~~
   **Resolved during rubber-duck review.** Confirmed by reading
   [taskfileTaskProvider.test.ts](../../../src/test/suite/taskfileTaskProvider.test.ts#L317-L360)'s
   existing `additionalFilePatterns` suite: it only mocks `TaskFilesService.findFiles` at the
   `getTasks()` call boundary and asserts the merged pattern *array passed in*; no test anywhere
   asserts that the legacy patterns are ever passed to `registerPatterns()` or participate in
   `anyFileMatchesRegisteredPatterns()`. Combined with the static-analysis finding that none of the
   three providers override `getFilePatterns()`, this confirms the gap is real, not just theoretical,
   and that no existing test depends on the gap's absence-of-watching behavior (i.e., fixing it cannot
   regress a currently-tested guarantee). Decision: implement the fix as part of the same commit/PR as
   the new generic setting, and call it out explicitly in the PR description and commit body (e.g. a
   `feat:` commit whose body includes a "Fixes: `additionalFilePatterns` for taskfile/gitlab-ci/circleci
   now participate in file-watcher invalidation" note) so reviewers and the auto-generated CHANGELOG
   entry aren't ambiguous about scope.
2. Should there be a companion `workspaceTasks.excludeFilePatterns` (per-type) for symmetry, given
   `workspaceTasks.exclude` already exists globally? Deferred — not requested by the user; flag as a
   natural follow-up in docs "Related Settings" if reviewers want it.

---

## Rubber-Duck Review

An independent sub-agent reviewed the first draft of this plan against the actual codebase (not just
the plan text) with instructions to be skeptical and cite file/line evidence. Its critique and how each
point was resolved:

1. **"`docker` key covers two providers" was factually broken** — no `dockerTaskProvider.ts` exists;
   `dockerfile` is a `SPECIAL_CASE_TASK_TYPE` in `taskFactory.ts` with no file-pattern-based discovery
   at all. **Resolution:** `docker` removed from the design entirely; Design Decision 6 now explicitly
   documents why, and the setting uses an explicit allowlist instead of "any `taskTypeMap` key."
2. **`eslint`, `webpack`, `go`, `cargo`, `typescript`/`tsc` are also dead keys** — declared in
   `enabledTaskTypes`/`taskTypeMap` but backed by zero providers. **Resolution:** added to the
   explicitly-excluded list in Design Decision 6; the allowlist approach (rather than "reuse the whole
   key space") structurally prevents this class of bug instead of just documenting around it.
3. **`ruby` is ambiguous even among implemented code** (real `taskTypeMap` entry for Rake, but also a
   `ShellTaskProvider` sub-type). **Resolution:** called out explicitly in Design Decision 6 as
   dual-control and excluded from the allowlist, matching the existing `enabledTaskTypes.ruby`
   dual-control precedent documented elsewhere in the codebase.
4. **Core claim about the three legacy providers' watcher gap was verified accurate.** No change to
   the plan's factual description; used as supporting evidence for Open Question 1's resolution.
5. **Plan cited a non-existent test file** (`makefileTaskProvider.test.ts` instead of the real
   `makefile.test.ts`). **Resolution:** Section 7.12 now has a verified table of every provider file to
   its actual test file, with a note to re-verify immediately before implementation since file layout
   can drift.
6. **"Mechanical one-line change, 25 files" understated the real work**, missing JSDoc/coverage
   obligations and schema-drift risk. **Resolution:** added three new rows to the Risk table
   (dead-key correctness bug, allowlist/provider drift, coverage-gate failure) and added an explicit
   allowlist-consistency unit test requirement.
7. **"Representative few" providers for tests was inconsistent with the repo's per-file 95% coverage
   gate.** **Resolution:** Section 7.12 now requires a test in **every** touched provider file, not a
   sample, matching the existing `taskfileTaskProvider.test.ts` pattern as the template to replicate.
8. **Docs plan didn't say whether ~24 individual provider pages needed updates.** **Resolution:**
   Section 7.11 now explicitly scopes docs to the single canonical `discovery.md` section (consistent
   with how `enabledTaskTypePatterns`/`disabledTaskTypePatterns` are documented once, not per-provider),
   with a narrow exception for `taskfile`'s page if it already has a local callout.
9. **Suggested a lighter-weight alternative** (centralize in `TaskFilesService` instead of touching
   every provider) but also correctly identified why it doesn't work: `findFiles()`'s cache-covered
   path matches only against the patterns *that specific caller* passes in, so a provider that doesn't
   pass the extra patterns into its own `findFiles()` call would never see the extra files regardless
   of what's registered globally. **Resolution:** kept the per-provider call-site changes (they're
   unavoidable) but adopted the reviewer's cheaper mitigation — a `BaseTaskProvider.getMatchingFiles()`
   helper (Section 7.3) that centralizes the "did you remember to call `getFilePatterns()`" concern for
   all current and future providers, without reducing the touched-file count.
10. **Open Question 1 was deferred too late** given it affects whether the change ships as a `fix:` or
    `feat:` commit. **Resolution:** resolved directly during this review by reading the existing
    `taskfileTaskProvider.test.ts` suite — confirmed no test depends on the gap's absence, so the fix is
    safe to ship in the same commit, with explicit commit-message guidance added to the Open Questions
    section instead of leaving it open.

No points from the critique were rejected outright; all resulted in a plan change. Open Question 2
(a companion per-type exclude setting) remains genuinely open/deferred as a possible future iteration,
since it wasn't part of the user's original request.
