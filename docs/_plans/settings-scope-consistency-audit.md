# Settings Scope Consistency Audit

Date: 2026-10-17
Status: Static audit complete; deliveries 1-2 implemented (debug/history window scopes). Other application changes remain planned and unauthorized.

## Summary

Yes, other settings can exhibit the same multi-root folder-override problem. The original audit covered **88 settings: 71 resource-scoped and 17 window-scoped**. Deliveries 1-2 now reclassify debug and both history settings to `window`, leaving **68 resource-scoped and 20 window-scoped** registrations. The inventory below preserves the original 71-setting snapshot. No language-overridable or machine-overridable registrations are present.

The main problems are unscoped configuration reads, shared caches that discard folder ownership, discovery overrides that bypass resource-aware filtering, and executable resolution that accepts a URI but does not use it for configuration. F10 records approved scope directions for shared-workspace behavior and a migration-aware implementation plan. Only the debug/history registration changes in deliveries 1-2 have been implemented; metrics and per-folder global Taskfile work remain planned.

This is not a claim of 71 independently reproduced runtime bugs. Three task-type settings already work on the shared base-provider path but have bypasses; two registered executable settings are not consumed; one CMake getter has no identified caller; and shared-state settings require design decisions. Findings are based on source inspection, not runtime verification.

## Scope And Method

The settings manifest in [package.json](../../package.json#L570) is the authority for eligibility. This audit does not propose extending folder support to settings registered with `window`, `application`, or non-overridable `machine` scope. No application code changes or tests are part of this audit.

For resource-scoped settings, VS Code must resolve configuration against the relevant task file, document, or workspace-folder URI. Omitting that resource can preserve user/workspace precedence while losing workspace-folder overrides in a multi-root workspace. A root's `.vscode/settings.json` is folder configuration in a multi-root workspace; arbitrary nested directories do not create additional VS Code configuration scopes. Single-folder workspaces can mask these defects.

Expected resolution for eligible settings is default < user < workspace < owning workspace folder, subject to VS Code's own configuration and policy rules. Use `workspace.getConfiguration(section, resource)` rather than hand-merging layers. Object-valued settings merge through VS Code; array-valued settings replace inherited arrays. An omitted object property can therefore continue to inherit a lower-scope value.

Scope precedence and feature precedence are different. For example, an inherited non-empty `enabledTaskTypePatterns` whitelist still takes precedence over `enabledTaskTypes`; a folder boolean does not cancel a different setting's whitelist. Resolve each setting for the same resource first, then preserve the existing feature's precedence rules.

### Explicit Exclusions

The 17 window-scoped registrations are outside the change list: group expansion defaults, recent-task group visibility, empty secrets-group visibility, task action-bar controls, single/double-click actions, task icon settings, guided argument input, recent-task limits, CodeLens settings, force-stop behavior, compound-dependency stopping, compound execution defaults, VS Code compound inclusion, and task presentation options. Their unscoped reads are not folder-precedence defects under the current manifest. Unregistered configuration keys are likewise excluded.

## Findings

### F1. Shared Configuration Helper Drops Resource Context

**Confirmed, foundational.** The [configuration helper](../../src/libs/configuration.ts#L10) caches `workspace.getConfiguration('workspaceTasks')` without a resource. Its `get` API accepts only a key and fallback. Resource-scoped consumers cannot select the owning folder through this API.

Future change: add an optional resource argument without changing the meaning of existing fallback arguments. Use scoped reads on demand, or cache by URI and invalidate appropriately. Keep genuinely window-wide reads unscoped. Do not silently change existing commands' explicit global/workspace write targets; reading a resource and choosing a write target are separate decisions.

Configuration ownership must be separate from execution-directory fallback. [Task context resolution](../../src/libs/taskCreationUtils.ts#L55), [executable resolution](../../src/services/executableService.ts#L85), and [environment folder resolution](../../src/services/taskEnvService.ts#L402) can fall back to the first root. A mechanically forwarded fallback URI could therefore select the wrong folder's settings. Synthetic tree-item `resourceUri` values are not automatically configuration owners.

| Task Or Operation | Preferred Configuration Owner | Fallback Or Decision |
| --- | --- | --- |
| File-backed task | Actual task file's owning workspace folder, using the file URI for the lookup. | If outside all roots, use no-folder configuration unless a separate explicit owner exists. Keep cwd independent. |
| Workspace-defined task | Definition `sourceUri` and target-file ownership must have an explicit rule. | Prefer the definition source for no-file tasks. Do not accidentally combine source-root permission with target-root execution settings. |
| Native folder task | Original `WorkspaceFolder` task scope or authoritative source file. | Preserve original scope metadata through task conversion and clones. |
| Native workspace-level or user/global task | Original scope category, not a guessed folder. | Document no-folder workspace/user behavior; numeric workspace scope is not proof of user-profile ownership. |
| Source-less definition or empty window | No resource owner. | Use the documented no-folder fallback; do not invent a first-root owner. |
| Home/global Taskfile | Explicit policy decision, not its cwd or the first root. | Use the same chosen owner for listing, execution, aliases, environment, guards, and watch behavior. |
| Favorites, Recents, compound clones | Original task's preserved owner metadata. | Shared container layout has a separate policy; display URIs do not redefine the task's owner. |

### F2. Task-Type Enablement Is Only Partially Correct

**Confirmed, partial support.** [TaskConfigService](../../src/services/taskConfigService.ts#L125) accepts a resource, and the [base provider](../../src/taskProvider.ts#L81) correctly combines folder-aware scheduling eligibility with file-scoped filtering. Preserve that pattern.

Remaining gaps affect `enabledTaskTypes`, `enabledTaskTypePatterns`, and `disabledTaskTypePatterns`:

- [Shell discovery](../../src/providers/shellTaskProvider.ts#L123) reads subtype settings and invokes type checks without resources, then searches directly rather than using the base per-file filter. Built-in, custom-extension, and background extensionless results all need owning-file checks.
- [Poe](../../src/providers/poeTaskProvider.ts#L32) and [Poetry](../../src/providers/poetryTaskProvider.ts#L35) search directly using `getGlobPatterns()`. Their aggregate provider gate cannot prevent tasks from a disabled sibling folder from being returned.
- [Cargo Make](../../src/providers/cargoMakeTaskProvider.ts#L47) overrides `enabled` with unscoped checks of both `cargo-make` and `cargo`. Both requirements must hold in the **same** folder; separate any-folder checks would be incorrect. Apply the same conjunction per file, not just at scheduling time.
- [Jupyter](../../src/providers/jupyterTaskProvider.ts#L93) has an unscoped early gate before the otherwise scoped base-file path, so folder-only enablement can be suppressed.
- [Workspace-defined tasks](../../src/providers/workspaceTasksProvider.ts#L47) gate effective types globally and search dynamic globs directly. Check both the workspace-task provider and effective task type with an explicit owner. For no-file tasks, use the definition's `sourceUri` when available; source-less tasks need a documented fallback.
- [Fetched VS Code tasks](../../src/providers/vscodeTaskProvider.ts#L177) use an aggregate gate without per-task filtering. The gate can also prevent fetching user tasks when every root disables the provider, even if the eventual no-folder policy would permit them. Separate scheduling eligibility for native folder tasks from no-folder tasks. Preserve and classify original task scope: the current metadata groups non-folder scopes as user-profile tasks, but numeric workspace scope is not proof of user ownership. Folder-scoped tasks expose folder/file metadata; workspace/user/global tasks need deliberate fallbacks, not whichever folder happens to be first.

The `isAnyTaskTypeEnabled` / `areAllTaskTypesEnabled` helpers are URI-less APIs too. No production caller was identified in the audited paths; extend them only when needed by an actual scoped caller rather than treating them as an additional demonstrated runtime failure.

### F3. Discovery Patterns, Exclusions, And Depth Are Workspace-Wide

**Confirmed.** [Base additional patterns](../../src/taskProvider.ts#L33), [Taskfile patterns](../../src/providers/taskfileTaskProvider.ts#L59), [GitLab patterns](../../src/providers/gitlabCiTaskProvider.ts#L31), and [CircleCI patterns](../../src/providers/circleCiTaskProvider.ts#L29) are read without a resource. Poe/Poetry's direct searches also bypass merged generic additional patterns.

[TaskFilesService](../../src/services/taskFilesService.ts#L450) reads one fetch-depth limit for all candidates. Its [initialization](../../src/services/taskFilesService.ts#L496) builds one global configured-exclude matcher, and its [change listener](../../src/services/taskFilesService.ts#L543) compares only unscoped excludes. A folder-only exclude change can therefore produce the same comparison value and fail to refresh the matcher. [Taskfile save recognition](../../src/services/taskFilesService.ts#L740) also reads its extra patterns unscoped.

Future change: discover per folder using `RelativePattern`, or use a broad cached candidate union with per-folder matching afterward. A union is only a scan optimization: a pattern configured in folder A must not authorize matches in B. Global pruning must not remove candidates that another folder's effective settings permit. Apply configured exclusions and fetch depth against the candidate's owning root, retaining built-in exclusions and existing `.tasksignore` precedence. Cache registration, save-event provider matching, and invalidation must use the same effective patterns.

Specify a root-relative matching contract consistently across cold scans, [cached matching and uncovered batches](../../src/services/taskFilesService.ts#L257), and save recognition; the current cached matching uses absolute paths. Extensionless shell scanning bypasses this service, so its exclusions and depth limits need explicit handling. Invalidate or recheck in-flight and buffered results before publication, rather than relying on a later refresh to repair stale output.

### F4. Shell Settings Share One Snapshot

**Confirmed.** [Shell registration](../../src/providers/shellTaskProvider.ts#L85), [task discovery](../../src/providers/shellTaskProvider.ts#L123), and [extensionless discovery](../../src/providers/shellTaskProvider.ts#L320) use unscoped `shellEnabledTaskTypes`, `shellPaths`, and `shellAdditionalExtensions`.

Future change: resolve enablement and interpreter selection per candidate file, and register the effective extra extensions of every root without cross-root leakage. Refresh buffered extensionless results when the owning folder's settings change. Preserve existing shebang requirements and direct-execution semantics; changing scope must not replace the OS-selected interpreter when shebang execution is intentional.

### F5. Executable URI Is Used For Paths, Not Configuration

**Confirmed.** [ExecutableService.getCommand](../../src/services/executableService.ts#L54) accepts `resourceUri`, but its configuration lookup uses F1's unscoped helper. Correct cwd and relative-path resolution do **not** imply correct executable configuration. Nineteen registered `applicationPath` settings flow through this path; see the inventory.

[Gradle wrapper selection](../../src/providers/gradleTaskProvider.ts#L102) separately reads the same setting without a resource. Fixing the resolver alone could still choose the wrong wrapper policy.

Two distinct wiring gaps are not simply precedence bugs:

- [Deno command construction](../../src/providers/denoTaskProvider.ts#L96) does not pass a configuration key, so registered `applicationPath.deno` is not consumed even at user/workspace scope.
- [Cargo Make command construction](../../src/providers/cargoMakeTaskProvider.ts#L53) uses `applicationPath.cargo` and builds `cargo make`; registered `applicationPath.cargo-make` is not consumed. Decide whether its intended executable is standalone `cargo-make`, or whether the registration/docs should describe a different supported contract. Do not substitute it blindly for `cargo` while retaining `make` arguments.

Future change: preserve the resource through executable selection and all related wrapper checks. Preserve quoting, platform handling, path bases, and workspace trust guards around CLI spawning.

### F6. Provider Execution And Display Options Lose Ownership

**Confirmed reads; one dormant getter.**

| Settings | Evidence And Effect | Future Change |
| --- | --- | --- |
| `act.envFile`, `act.variablesFile`, `act.secretsFile`, `act.variables` | [GitHub Actions](../../src/providers/githubActionsTaskProvider.ts#L130) reads one unscoped configuration in the workflow execution branch. | Use the available workflow URI. Separately define applicability to file/job branches; do not assume they currently consume these settings. |
| `gitlabCiLocal.variablesFile`, `gitlabCiLocal.variable`, `gitlabCiLocal.unsetVariable`, `gitlabCiLocal.remoteVariables`, `gitlabCiLocal.home` | [GitLab execution](../../src/providers/gitlabCiTaskProvider.ts#L218) has an effective file URI but reads unscoped settings. | Resolve all five against that URI, preserving CLI argument precedence. |
| `bitbucketPipelineRunner.environmentFiles` | [Bitbucket execution](../../src/providers/bitbucketPipelinesTaskProvider.ts#L231) resolves cwd separately from an unscoped settings read. | Use the task file URI for configuration and retain existing path resolution. |
| `cmake.buildDirectory`, `cmake.buildType`, `cmake.generator` | [CMake getters](../../src/providers/cmakeTaskProvider.ts#L52) have no resource argument and use F1. Build execution consumes the first two; no caller of `getGenerator()` was identified. | Scope the active getters and their callers. Treat generator wiring as a separate dormant-feature decision, not a reproduced execution regression. |
| `ant.ansicon.enabled` | [Ant's Windows-only decision](../../src/providers/antTaskProvider.ts#L170) uses F1. | Pass the same owner to this decision and the Ant/Ansicon executable resolver. |
| `taskfile.showAliases` | [Taskfile output parsing](../../src/providers/taskfileTaskProvider.ts#L558) reads one global value before processing entries. | Choose an explicit owning Taskfile/root for the CLI listing. Imported/global Taskfiles may require a distinct owner policy; do not silently switch settings based on each reported location. |
| `taskfile.enableWatchMode` | [Watch command](../../src/commands/watchTaskfileCommand.ts#L17) ignores the selected item's URI. | Read using the selected task's explicit configuration owner; for home/imported Taskfiles, follow F10 rather than treating the reported source file as the folder owner. |

Setting names in this table omit only the common `workspaceTasks.` prefix. The full registrations appear in the inventory.

### F7. Environment And Secret-Warning Configuration Is Cached Globally

**Confirmed.** [TaskEnvService.loadConfig](../../src/services/taskEnvService.ts#L320) caches one `env`, `envFiles`, `secretFiles`, `secretPatterns`, and `taskEnv` set for all tasks. [Task environment resolution](../../src/services/taskEnvService.ts#L103) chooses a folder for file paths but still consumes those global cached values. `currentSecretPatterns` is a global getter too.

[Proactive secret warnings](../../src/services/taskSecretWarningService.ts#L74) read `warnIfGitTracked` and file lists once, then apply those lists to every folder. Folder-local lists and warning preferences are ignored even though file resolution itself uses each folder URI. This flag currently controls proactive checks, not [execution-time `checkAndWarn`](../../src/services/taskSecretWarningService.ts#L129); extending its meaning would be a separate behavior change.

Future change: use an effective-settings snapshot per owning folder/task throughout environment resolution and warnings. Keep the existing fourteen-layer environment precedence unchanged: resolving settings scope must not reorder definition/task/rule layers. Watch each folder's effective file references and rule file references; rebuild on configuration and workspace-folder changes. Scope secret-pattern consumers and diagnostic clearing too, so refreshing or disabling warnings for A does not erase valid diagnostics for B. Never copy secret values into the report, logs, or configuration caches beyond existing requirements.

Preserve the current injection boundary: [task creation](../../src/taskFactory.ts#L269) applies environment injection to non-native `ShellExecution` results, not every execution type. Do not inadvertently add injection to native tasks or custom execution while repairing configuration scope. Warning scans also need generation checks or equivalent stale-result rejection so an older scan cannot republish diagnostics after a setting is disabled or a root removed. Track owner contributions when multiple roots refer to the same absolute file. Watch supported resolved external references too; not every reference is representable by a root-relative watcher.

### F8. Guard Patterns And Status Delay Ignore Task Ownership

**Confirmed.** [TaskRunGuardService](../../src/services/taskRunGuardService.ts#L156) compiles one global `task.confirmPatterns` array, then [matches by task label](../../src/services/taskRunGuardService.ts#L77). Folder-only confirmation patterns can be missed. Preserve manual and definition guards' existing precedence while resolving pattern guards per task resource.

[Status reset scheduling](../../src/extension.ts#L115) reads `task.statusResetDelay` through F1 using only a task ID. Carry task/file/folder context into this callback or resolve it from authoritative task state; do not infer a folder by parsing display labels. No-resource tasks need an explicit fallback.

### F9. Folder-Overridable Tree Settings Are Read Once For The Whole Tree

**Confirmed mismatch; mixed-root presentation needs design.** [Tree organization](../../src/taskTreeDataProvider.ts#L404) reads sorting, grouping, parent-folder grouping, compound grouping, and separator options once before partitioning tasks by workspace. [Justfile grouping](../../src/providers/justfileTaskProvider.ts#L153) independently reads its setting unscoped.

Future change: evaluate file-local Just grouping against its file URI, and apply folder-owned tree preferences within each folder's partition. Specify the ordering and grouping of root-level, mixed-folder, Favorites, Recents, and compound containers, which have no single natural folder owner. Do not sort a shared list with a comparator whose policy changes by item. Preserve current explicit window-scoped view preferences.

### F10. Agreed Scope Decisions And Implementation Plan

**Policy update: 2026-10-17.** These decisions supersede F10's earlier preference for retaining all resource scopes. The inventory below remains a snapshot of the original audit manifest. Debug/history window scopes are now implemented; the other decisions remain planned.

| Settings (Common `workspaceTasks.` Prefix Omitted) | Audited Scope | Target Scope | Decision And Rationale |
| --- | --- | --- | --- |
| `debug` | `resource` | `window` | Implemented. One extension output channel and log-level policy per window; folder-specific logging is unnecessary. No log/state migration is needed. |
| `metrics.scope`, `metrics.maxDurationSamples`, `metrics.retentionDays` | `resource` | `application` | User-proposed direction, recommended here: make collection/storage policy, sample caps, and retention user-wide rather than repository- or folder-controlled. Confirm application scope's exact profile and local/remote behavior before implementation. |
| `history.maxPersistedRecords`, `history.retentionDays` | `resource` | `window` | Implemented. History and graphs are window-wide, not partitioned by folder. Keep one effective policy per window. |
| `taskfile.discoverGlobalTaskfile` | `resource` | `resource` | Approved. Retain the registration and implement genuine per-folder discovery with an explicit owner for every returned task. |

After these registration changes, the existing 88 settings would comprise **65 resource, 20 window, and 3 application settings**, assuming no unrelated manifest changes.

#### Metrics Scope Feedback

`application` scope is a reasonable policy choice, but not because metrics are exclusively global today. [Metrics record handling](../../src/services/taskMetricsService.ts#L86) supports `workspaceState`, `globalState`, both, or neither, and the default `metrics.scope` value is `workspace`. The **configuration scope** determines who can set the policy; the **setting value** determines the data destination. Keep those concepts separate and retain all four values and the existing default in this work.

Application scope intentionally removes the ability for a repository to opt out of collection or tune retention. That is the main tradeoff versus `window`, which would preserve workspace overrides while still rejecting folder overrides. Given the requested user-wide policy, recommend `application` for all three keys together, conditional on the compatibility gates below. Verify profiles, apply-to-all-profiles behavior, local/remote settings, and extension-host placement; do not assume `ConfigurationTarget.Global` alone identifies the correct user-settings destination. Do not automatically change `metrics.scope` to `global`, migrate workspace records into a global store, or imply that `globalState` is shared across profiles, machines, or remote extension hosts.

Existing [global-store pruning](../../src/services/taskMetricsService.ts#L280) and [display-name-based workspace clearing](../../src/services/taskMetricsService.ts#L182) remain separate data-safety concerns. Scope metadata alone does not repair them. Retention currently runs at initialization, deletes whole aggregates by `lastRunAt`, and touches the selected stores; configuration reloads do not immediately prune. In `global`/`both`, another window can still prune shared records under its existing policy. A migration guard in one window cannot guarantee preservation across all windows. Preserve unknown legacy records during migration; stable owner IDs, aggregate splitting, cross-window write coordination, and storage migrations need a separate proposal rather than being bundled into these quick wins.

#### Target Semantics

- **Debug:** default < user < workspace; folder overrides are unsupported after the change. Keep one logger and existing live configuration updates. Do not aggregate folder booleans. No automatic setting promotion, log copying, or compatibility fallback is required.
- **History:** default < user < workspace; folder overrides are unsupported. Keep the current window-wide grouping, graphs, storage keys, and archive behavior, including normal retention and explicit clearing. `maxPersistedRecords` still caps the workspace-state cache, not the NDJSON archive; retention remains a separate archive policy.
- **Metrics:** resolve only scopes valid for the new application registration using VS Code's API. Workspace and folder values are not ongoing overrides. Keep the data destination selected by `metrics.scope`, existing keys/formats, and current user preferences; do not change sample caps or prune archives as a migration side effect.
- **Global Taskfile discovery:** resolve the switch and Taskfile task-type enablement against each folder URI. A folder qualifies only when both are enabled there. Show an owner-associated task instance for each qualifying root; these are intentional per-folder instances, not accidental duplicates. No-root windows return no per-folder global Taskfile tasks.
- **Global Taskfile execution:** keep four distinct fields/concepts: configuration owner URI, entry home Taskfile, reported source file (which can be an included Taskfile), and execution cwd. Carry owner and entry-file identity through task creation, alias children, and clones before canonical IDs are generated. The owner governs executable selection, aliases, environment, guards, and watch options; preserve established global/included-task cwd and entry-file invocation behavior independently. Listing and execution must use the same owner. Preserve workspace trust checks before every CLI spawn.

#### Migration And Backwards Compatibility

| Area | Compatibility Plan |
| --- | --- |
| Debug | Change only the registration and descriptions. Existing user/workspace values remain valid. Folder-only values stop applying; document the supported replacement location without automatically copying settings. No migration code or persisted marker for logging. |
| History | Preserve existing user/workspace values and the current shared archive/cache formats. Folder-only values were not reliably honored by the unscoped reader; document their removal rather than selecting one folder's value for the entire window. No migration-induced relocation, truncation, splitting, or merging of archives; normal retention and explicit clearing remain supported. The first-root archive location is an existing limitation, not authorization to move it during this change. |
| Metrics user settings | Keep names, types, ranges, defaults, and all storage-selection enum values. Respect any explicit existing application-valid value; never overwrite it with a workspace preference. Verify profile and remote-user settings behavior against supported VS Code before promising compatibility. |
| Metrics workspace/folder settings | Use a staged transition to announce the change, but make the enforcement release independently safe for skipped releases and unopened workspaces. When migration state is absent, inspect legacy configuration using a mechanism verified to retain the required scope values. If invalid-scope inspection is insufficient, design a read-only legacy settings reader with proper JSONC parsing and supported filesystem/remote behavior, or fail closed on unresolved legacy cases. Distinguish an absent settings file from an unreadable/invalid file. Do not assume that a prior notice or migration marker exists. Offer a user-invoked review/copy action; never promote automatically or edit repository settings silently. |
| Conflicting metrics preferences | Show user, workspace, and folder values separately without choosing a first-folder winner. A user may keep the existing application-valid value, select a legacy value to promote, or acknowledge using the default. Name the destination profile/local/remote settings target and cross-window impact before confirmation. Preserve repository entries unless separately asked to remove them. Write user settings first; mark migration complete only after the write or explicit no-write acknowledgment succeeds. |
| Legacy metrics opt-out | Distinguish a previously effective user/workspace `metrics.scope: disabled` from folder-only intent that the old unscoped reader may have ignored. Conservatively require review for either; do not claim every folder value was previously effective. If legacy state cannot be resolved safely, fail closed for that window until reviewed. Record a versioned pending guard before subscribing to metrics records or startup retention. Cancel, unreadable settings, user-setting write failure, or migration-state persistence failure must not enable collection or mark migration complete. |
| Migration guard behavior | Suppress new aggregation and automatic retention in the affected window until successful acknowledgment; keep task execution and history recording independent. Suppressed executions are not buffered or replayed. Re-evaluate pending state on restart and remove the guard only after the new policy is resolved and its acknowledgment persisted. Do not imply that already queued writes are canceled. The existing `disabled` mode also returns empty metrics reads and skips clear operations; specify explicitly whether the guard shares those UI semantics rather than silently changing that mode. |
| Metrics stored data | No schema change or automatic workspace/global copying. Inspect legacy configuration before collection/pruning starts; migration itself must not clear or prune records. This is a guarantee about this migration path, not other windows' existing global-store mutations. After resolution, ordinary metrics lifecycle semantics remain: `both` writes separate stores and reads with workspace precedence, sample caps affect subsequent updates, and stricter retention applies through the established initialization path rather than eager migration-time deletion. |
| Per-folder home Taskfile instances | Keep the boolean key and default `false`; inherit user/workspace values normally. A workspace-wide `true` now enables one instance per eligible root unless that root overrides it. Use stable owner-URI + home-file + task identity, including aliases, so instances do not collide across roots or reordered roots. |
| Taskfile favorites/recents/queues/hidden state | Inventory IDs, normalization, persisted references, and favorites' outside-workspace validation before changing identity. Generate canonical owner-aware IDs before cache insertion; preserve them through normalization and avoid collision-suffix-based ownership. Deduplicate repeated instances with the same owner, not different owners. One currently qualifying root is not proof of historical ownership. Only migrate a saved reference with authoritative evidence or explicit owner selection; ambiguous/unavailable references remain recoverable and non-executing. Version migration, make it idempotent, and retain a recoverable original until persistence succeeds. |

Metrics migration-state handling and skipped-release-safe legacy discovery must be designed and verified against actual VS Code application-scope/profile/remote rules before release. A staged notice is helpful but not sufficient. If a safe transition cannot preserve a legacy opt-out, postpone application-scope enforcement rather than enabling collection silently. Disabling collection during an unresolved transition does not require deleting data or blocking task execution.

#### Implementation Work Packages

These are F10 package identifiers, not the overall delivery order. Follow the low-impact-first sequence under **Proposed Follow-Up Work**; debug/history do not wait for metrics research. Estimates are rough engineering effort, excluding review/release lead time and the repository's full-suite runtime. Implementation still requires a separate go-ahead.

| Package | Work And Files | Future Verification | Estimate |
| --- | --- | --- | --- |
| 1 | Confirm VS Code scope semantics and record exact application/profile/remote targets; capture legacy metrics configuration before changing registration. Touch the manifest, configuration/migration integration, and existing service tests only when implementing. | User/workspace/folder conflicts, explicit user settings, unopened legacy workspaces, skipped releases, reloads, and multiple windows. | 0.5-1 day |
| 2 | Change debug and the two history registrations in [package.json](../../package.json#L570); update [package.nls.json](../../package.nls.json), existing logger/history setting tests, and relevant documentation. No service storage redesign. | Supported user/workspace precedence, ignored folder settings, live updates, unchanged history formats and cache-vs-archive limits. | 0.5 day |
| 3 | Ship the metrics notice/review path and versioned, idempotent migration guard; subsequently change all three metrics registrations to `application`. Update [TaskMetricsService](../../src/services/taskMetricsService.ts#L45) activation order and existing metrics tests as needed. Do not create a generic migration framework without a concrete need. | Explicit opt-out never silently resumes collection; no automatic global-setting writes or data movement; consent/error/cancel paths; correct profile/remote user target; retention does not run ahead of the guard. | 1-2 days, staged releases |
| 4 | Implement per-folder global Taskfile discovery in [TaskfileTaskProvider](../../src/providers/taskfileTaskProvider.ts#L660), explicit owner propagation in task metadata/creation, and same-owner settings reads. Coordinate executable scoping with F1/F5 and Taskfile alias/watch reads with F6. | Two roots with opposite values, same-root enablement conjunction, owner-specific commands/settings, no-root and untrusted windows, deliberate per-owner instances, aliases, and root reordering. | 1-2 days |
| 5 | Adapt Taskfile caches/watchers and saved-reference migrations. Start with correct per-owner CLI listing; cross-owner listing reuse is optional and can be deferred. If later shared, require equivalent owner-dependent executable/arguments/output policy. Deduplicate watcher resources and identical owner/task instances, not distinct owners. | Root add/remove, home-file edits, settings changes during in-flight listing, stale-result rejection, canonical IDs before insertion, aliases/clones, old favorites/recents/queues/hidden state, outside-workspace validation, partial migration failure. | 0.5-1 day |
| 6 | Review [README.md](../../README.md) and feature/configuration guides under `docs/`; update scope support, metrics rollout guidance, and home-Taskfile ownership examples. Do not edit the generated changelog. Run focused tests/coverage and then `pnpm test` only during authorized implementation. | Registration assertions, behavioral regression cases above, documentation consistency, and full required test gate. | 0.5 day plus test runtime |

These packages primarily use existing VS Code configuration, extension state, and task metadata APIs. If raw legacy settings must be read, verify existing JSONC support before selecting a maintained parser dependency; plain JSON parsing or regex is not a substitute for JSONC. Debug/history metadata changes can ship independently, yielding **68 resource and 20 window** registrations if metrics enforcement is deferred. Metrics requires the migration prerequisite; global Taskfiles requires owner-aware executable/settings reads and saved-reference compatibility, so neither should be treated as a one-line metadata fix.

#### F10 Plan Critique And Adjustments

A read-only sub-agent reviewed this policy update without changing files or running tests. The scope counts and current storage semantics were confirmed; the following adjustments were incorporated.

| Review Point | Adjustment And Reason |
| --- | --- |
| Staged notices cannot cover skipped releases or unopened workspaces. | Require independent legacy discovery in the enforcement release and fail-closed unresolved cases; do not equate rollout sequencing with compatibility. |
| Folder intent and previously effective opt-out are different. | Distinguish them explicitly and conservatively review both, preserving privacy without overstating old behavior. |
| Guard, storage-mode, and retention semantics need precise boundaries. | Specify acknowledgment/persistence failures, restart behavior, no replay, initialization ordering, and the limit of per-window guarantees; retain existing `disabled`, history, and ordinary pruning semantics. |
| Application policy does not define a universal user-settings or storage destination. | Keep enforcement conditional on verified profile/remote rules and explicit promotion targets; no silent global writes. |
| Taskfile owner metadata added after IDs are assigned is insufficient. | Require owner/entry/source/cwd separation, canonical IDs before insertion, owner propagation to aliases/clones, and recoverable saved/hidden references without guessing historical owners. |
| Listing reuse and broad metrics storage redesign exceed quick wins. | Defer both optimizations/redesign; debug/history remain independently shippable, while metrics and Taskfiles retain their compatibility gates. |

#### Release Acceptance Criteria

- The scope-only changes produce 65 resource, 20 window, and 3 application registrations, with unchanged names/defaults and no unrelated scope changes.
- Debug has no migration machinery; history records and archives are unchanged by the registration change.
- Metrics configuration scope and data storage mode remain independent; legacy repository opt-outs cannot silently enable collection, and no migration silently overwrites user settings or deletes metrics.
- Each global Taskfile task has a stable folder owner used consistently for listing, execution, environment, guards, aliases, and watch behavior. No permissions or settings are assembled from different roots.
- Existing saved Taskfile references remain recoverable when an owner cannot be inferred. Changing folder order cannot reassign ownership.
- All planned regression checks, documentation updates, and required repository tests pass during implementation. No tests are run as part of this planning update.

## Complete In-Scope Inventory

Every key below was registered with `scope: resource` at the original audit. Counts refer to registrations, not object properties. This historical snapshot retains debug/history, now implemented as `window`, and the three metrics keys still planned for `application`. Inclusion is not proof of an active runtime defect on every path.

| Setting Registrations | Count | Classification / Finding |
| --- | --- | --- |
| `workspaceTasks.enabledTaskTypes`<br>`workspaceTasks.enabledTaskTypePatterns`<br>`workspaceTasks.disabledTaskTypePatterns` | 3 | Partial support; bypasses remain. F2. |
| `workspaceTasks.additionalFilePatterns`<br>`workspaceTasks.taskfile.additionalFilePatterns`<br>`workspaceTasks.gitlabCiLocal.additionalFilePatterns`<br>`workspaceTasks.circleci.additionalFilePatterns` | 4 | Unscoped discovery configuration. F3. |
| `workspaceTasks.exclude`<br>`workspaceTasks.taskDiscovery.fetchDepth` | 2 | Global matcher/depth and refresh comparison. F3. |
| `workspaceTasks.shellEnabledTaskTypes`<br>`workspaceTasks.shellPaths`<br>`workspaceTasks.shellAdditionalExtensions` | 3 | Unscoped shell snapshots and registration. F4. |
| `workspaceTasks.applicationPath.act`<br>`workspaceTasks.applicationPath.circleci`<br>`workspaceTasks.applicationPath.bitbucketPipelineRunner`<br>`workspaceTasks.applicationPath.ansicon`<br>`workspaceTasks.applicationPath.ant`<br>`workspaceTasks.applicationPath.cargo`<br>`workspaceTasks.applicationPath.cmake`<br>`workspaceTasks.applicationPath.composer`<br>`workspaceTasks.applicationPath.gradle`<br>`workspaceTasks.applicationPath.just`<br>`workspaceTasks.applicationPath.make`<br>`workspaceTasks.applicationPath.maven`<br>`workspaceTasks.applicationPath.msbuild`<br>`workspaceTasks.applicationPath.pipenv`<br>`workspaceTasks.applicationPath.poe`<br>`workspaceTasks.applicationPath.poetry`<br>`workspaceTasks.applicationPath.rake`<br>`workspaceTasks.applicationPath.taskfile`<br>`workspaceTasks.applicationPath.gitlabCiLocal` | 19 | Shared resolver drops scope; Gradle also has a wrapper-selection read. F5. |
| `workspaceTasks.applicationPath.deno`<br>`workspaceTasks.applicationPath.cargo-make` | 2 | Registered but not consumed by the expected providers. F5. |
| `workspaceTasks.act.envFile`<br>`workspaceTasks.act.variablesFile`<br>`workspaceTasks.act.secretsFile`<br>`workspaceTasks.act.variables` | 4 | Unscoped workflow execution branch. F6. |
| `workspaceTasks.gitlabCiLocal.variablesFile`<br>`workspaceTasks.gitlabCiLocal.variable`<br>`workspaceTasks.gitlabCiLocal.unsetVariable`<br>`workspaceTasks.gitlabCiLocal.remoteVariables`<br>`workspaceTasks.gitlabCiLocal.home` | 5 | Unscoped execution options. F6. |
| `workspaceTasks.bitbucketPipelineRunner.environmentFiles` | 1 | Unscoped execution options. F6. |
| `workspaceTasks.cmake.buildDirectory`<br>`workspaceTasks.cmake.buildType`<br>`workspaceTasks.cmake.generator` | 3 | Two active unscoped getters; generator getter has no identified caller. F6. |
| `workspaceTasks.ant.ansicon.enabled` | 1 | Unscoped Windows-only option. F6. |
| `workspaceTasks.taskfile.showAliases`<br>`workspaceTasks.taskfile.enableWatchMode` | 2 | Unscoped listing/command options. F6. |
| `workspaceTasks.envVars.env`<br>`workspaceTasks.envVars.envFiles`<br>`workspaceTasks.envVars.secretFiles`<br>`workspaceTasks.envVars.warnIfGitTracked`<br>`workspaceTasks.envVars.secretPatterns`<br>`workspaceTasks.envVars.taskEnv` | 6 | Global environment snapshot and warning preferences. F7. |
| `workspaceTasks.task.confirmPatterns`<br>`workspaceTasks.task.statusResetDelay` | 2 | Task-owned settings read without task resource. F8. |
| `workspaceTasks.tasks.sortingEnabled`<br>`workspaceTasks.groups.enabled`<br>`workspaceTasks.groups.useParentFolder`<br>`workspaceTasks.groups.justfile.enabled`<br>`workspaceTasks.groups.compoundTasks.enabled`<br>`workspaceTasks.groups.taskSeparator`<br>`workspaceTasks.groups.taskSeparatorIsRegex` | 7 | Global tree policy; Just also has a file-local reader. F9. |
| `workspaceTasks.debug` | 1 | Implemented `window` scope; no logging migration. F10. |
| `workspaceTasks.metrics.scope`<br>`workspaceTasks.metrics.maxDurationSamples`<br>`workspaceTasks.metrics.retentionDays` | 3 | Planned `application` scope with staged settings compatibility; storage modes unchanged. F10. |
| `workspaceTasks.history.maxPersistedRecords`<br>`workspaceTasks.history.retentionDays` | 2 | Implemented `window` scope; shared history formats unchanged. F10. |
| `workspaceTasks.taskfile.discoverGlobalTaskfile` | 1 | Retain `resource`; implement per-folder home-Taskfile instances and owner compatibility. F10. |
| **Total** | **71** | **All eligible manifest registrations accounted for.** |

## Proposed Follow-Up Work

Deliveries 1-2 are implemented; the remaining rows are suggested future work, not authorization to implement the rest of the audit. **Prioritize low effort and small behavioral blast radius, not finding number or the earlier P1/P2 labels.** Impact below means regression/compatibility risk and how widely behavior changes, not the value of fixing the issue. A small edit to shared execution or persisted identity is not automatically low impact.

Dependencies take precedence over convenience: add safe foundations early, but do not require unrelated high-risk work before an independently shippable fix. Each row should be a separate reviewable delivery where practical. Keep original setting names/defaults and feature precedence unless a decision explicitly authorizes otherwise. VS Code's scoped configuration API is sufficient for ordinary reads; F10 separately gates any legacy JSONC-reader dependency needed for metrics migration.

### Suggested Delivery Sequence

Effort bands are relative: **XS** is a narrow metadata/read change, **S** is a localized change with focused coverage, **M** spans several callers or cache paths, and **L** requires cross-service ownership, compatibility, or migration work. They are not time commitments; F10's detailed package estimates remain provisional.

| Order | Adjustment And Coverage | Impact / Effort | Dependencies And Reason For Placement |
| --- | --- | --- | --- |
| 1 | **Implemented: debug registration.** `debug` is `window`; setting documentation updated. F10. | Low / XS | No migration, storage changes, folder aggregation, or new logger behavior. |
| 2 | **Implemented: history registrations.** Both `history.*` keys are `window`; cache/archive behavior preserved. F10. | Low / XS | Independent of metrics and ownership plumbing. Ordinary retention and clearing unchanged; no archive migration. |
| 3 | **Additive scoped-read foundation:** document configuration owners/fallbacks and add optional resource support to the shared helper. F1. | Low if behavior-preserving / S | Preserve fallback-argument meaning, unscoped callers, and write targets. Do not mass-convert consumers in this delivery. Enables most later rows without changing their behavior yet. |
| 4 | **File-local presentation:** `groups.justfile.enabled` and local `taskfile.showAliases`; local Taskfile watch gating via `taskfile.enableWatchMode`. F6/F9. | Low-medium / S | After 3 and an authoritative local-task owner. Keep home/imported Taskfile behavior unchanged until 16; do not guess its owner or claim these settings fully fixed yet. |
| 5 | **Status reset delay:** scope `task.statusResetDelay` for an identifiable task and retain explicit no-resource fallback. F8. | Low-medium / S | After 3 and task-context propagation into the reset callback. Isolated UI timing behavior; no task-label parsing to infer ownership. |
| 6 | **Provider-local execution options:** active CMake build directory/type, GitHub Actions workflow options, GitLab options, and Bitbucket env-file options. F6. | Medium / S-M | After 3; split by provider rather than batching all providers. A small call graph, but commands/arguments can change, so validate each owner and preserve current execution branches. Keep Ant's coupled reads together in 8; leave dormant CMake generator wiring to 18. |
| 7 | **Localized task-type bypasses:** Jupyter's early veto, Poe/Poetry's per-file filtering, and Cargo Make's same-root conjunction. F2. | Medium / S-M | After 3; no dependency on shared executable or guard changes. Preserve provider parsing; routing Poe/Poetry through the base path can retain existing workspace-level additional patterns. Full folder-specific extra-pattern support still depends on 11. Native/workspace-defined and shell paths remain tracked in 12/14. |
| 8 | **Shared executable selection and Ant consistency:** scope the 19 consumed `applicationPath.*` keys, Gradle wrapper selection, and Ant's `ant.ansicon.enabled` decision together. F5/F6. | Medium-high / M | After 3 and owner-vs-cwd contract. Wider execution blast radius warrants a separate review after local fixes. Do not ship folder-scoped Ant enablement with unscoped Ant/Ansicon executable selection. Preserve trust and platform handling. |
| 9 | **Run-guard patterns:** make `task.confirmPatterns` owner-aware while retaining manual/definition precedence. F8. | Medium-high / M | After 3 and reliable task/clone ownership. This is a safeguard, not a cosmetic read; do not introduce a temporary path that skips confirmation. |
| 10 | **Folder-specific exclusions and depth:** `exclude` and `taskDiscovery.fetchDepth`, including matcher ownership, cold/warm cache behavior, and live invalidation. F3. | Medium-high / M | After 3. Treat matching and invalidation as one delivery, not a leaf-read-only patch. Establish the root-relative candidate contract before broader pattern/scan changes. |
| 11 | **Folder-specific discovery patterns:** generic `additionalFilePatterns`, the three provider-specific arrays, and registration of `shellAdditionalExtensions`. F3/F4. | High / M-L | After 10. Registration, cached/uncovered searches, save recognition, and folder add/remove must agree; a union must not authorize sibling-root matches. Complete Poe/Poetry generic pattern integration here. |
| 12 | **Complete shell isolation:** `shellEnabledTaskTypes`, `shellPaths`, custom extension ownership, and all task-type pattern checks, including extensionless/buffered results. F2/F4. | High / M-L | After the applicable matching, exclusion, and pattern-registration contracts in 10-11; unrelated provider fixes in 7 are not prerequisites. Explicitly cover the extensionless path that bypasses shared discovery. Preserve shebang semantics and reject stale results before publication. |
| 13 | **Remaining tree organization:** folder-owned sorting, grouping, parent grouping, compound grouping, and separators. F9. | High / M-L | After 3 and a documented shared-container policy. Justfile grouping was handled in 4. Partition-local policy must not create an item-dependent shared-list comparator or redefine window-scoped view preferences. |
| 14 | **Native and workspace-defined task enablement:** independent native/user scheduling gates, per-task folder checks, effective-type checks, dynamic file searches, and no-file fallbacks. F2. | High / L | After 3 and the applicable discovery contracts in 10-11; unrelated provider fixes in 7 and guard work in 9 need not block it. Preserve original native scope and source ownership through conversion/cloning; a no-folder task must not disappear because every root disables folder tasks. Do not infer user ownership from numeric workspace scope. |
| 15 | **Environment and secret-warning isolation:** all six `envVars.*` keys, scoped snapshots/rules, watchers, secret-pattern consumers, per-owner diagnostics, and async stale-result rejection. F7. | High / L | After 3 and authoritative ownership for the relevant task kinds. Extract behavior-preserving owner metadata from 14 if needed; its enablement/search changes are not prerequisites. Preserve the existing non-native shell-injection boundary and fourteen-layer precedence. Shared/external files and warning ownership make this more than a configuration-read change. |
| 16 | **Per-folder global Taskfiles:** `taskfile.discoverGlobalTaskfile`, stable canonical IDs, owner-aware listing/execution/settings, aliases/clones, watchers, and saved/hidden-reference compatibility. F10 plus remaining F6 paths. | High / L | Requires owner-aware Taskfile executable/guard handling from 8-9, applicable Taskfile discovery contracts from 10-11, and owner-aware environment/warning integration from 15. Unrelated shell isolation in 12 is not a prerequisite. F10 packages 4-5 are one compatibility boundary even if developed in smaller steps. Do not release new IDs/discovery ahead of owner propagation and saved-reference handling. |
| 17 | **Application-wide metrics policy:** all three `metrics.*` registrations, verified profile/remote semantics, legacy discovery, review/promotion, and a skipped-release-safe opt-out guard. F10. | High / L; release gate | Independent research may begin earlier, but enforce the new scope only after F10's migration and privacy criteria are met. F10 packages 1/3 apply here; do not block 1-2 on them. Storage modes/formats remain unchanged. |
| 18 | **Separate wiring decisions:** `applicationPath.deno`, `applicationPath.cargo-make`, and the dormant `cmake.generator` path. F5/F6. | Undetermined until contract agreed / S-M or larger | After explicit behavior/API decisions; not prerequisites for the active scope fixes. Do not quietly turn an unused setting into a new command contract. Re-rank individually once the intended behavior is approved rather than assuming a small diff means low impact. |

### Delivery Rules And Deferred Work

- **Release the first wins early:** 1-2 can ship together without metrics migration or per-folder Taskfile support. Row 3 is additive infrastructure, not permission for a repository-wide rewrite.
- **Do not separate correctness from compatibility:** each change includes the affected cache/watcher/refresh behavior and, where relevant, saved identity. Preparatory changes can merge earlier only if they preserve current behavior.
- **Documentation and validation accompany every delivery:** update the relevant existing tests and feature/configuration guides, review README accuracy, run focused checks/coverage, then the repository-required `pnpm test` during authorized implementation. Do not save all testing/docs for row 18 or edit the generated changelog. No tests are run for this planning update.
- **Research is not enforcement:** metrics profile/remote and legacy-value discovery research, mixed-root tree policy, and dormant wiring decisions may be investigated in parallel without moving their high-impact behavior changes ahead of the small fixes.
- **Storage redesign stays outside this sequence:** stable metrics storage-owner IDs, aggregate splitting, global-store clear/pruning redesign, cross-window write coordination, and history archive relocation require separate proposals. They are not silently authorized or considered resolved by changing configuration scope.
- **Escalate a blocker, not scope:** if a row exposes an unresolved ownership or migration contract, retain that gate and continue with independent lower-impact rows instead of guessing a first-folder policy.

**Ordering review:** a read-only sub-agent checked coverage and dependencies. Its corrections moved localized task-type fixes ahead of higher-impact shared execution/guard changes, limited prerequisites to the actual shared contracts rather than whole unrelated deliveries, and kept Ant enablement/executable scoping together. These changes preserve the low-impact-first goal without shipping inconsistent intermediate behavior. No code changes or tests were performed for the review.

### Future Verification Matrix

- A two-root `.code-workspace` with deliberately opposing user, workspace, A, and B values. Repeat with the folder order reversed to expose first-folder assumptions.
- Missing folder values must inherit workspace/user/default values; partial objects must retain VS Code merging, while replacement arrays, empty arrays, `false`, `0`, empty strings, and `null` retain each setting's documented meaning.
- Folder booleans versus inherited whitelist/blacklist settings must retain feature precedence after resource resolution. Cargo Make's two enabling conditions must be checked in the same root and for each file.
- Folder-only added patterns, custom shell extensions, excludes, depth limits, aliases, and interpreters must affect only that root. Verify cold discovery, warm caches, background results, saved files, live setting edits, and root addition/removal.
- Task execution must use the correct executable, provider arguments, environment files/rules, secret patterns, and guard preferences for the owning task. Exercise Windows-only Ant/Ansicon behavior without weakening trust guards.
- Native tasks, no-file workspace-defined tasks, global Taskfiles, and Favorites/Recents/compound clones must retain or explicitly resolve ownership. Do not derive identity from a folder's display name alone.
- F10 metrics checks must cover application scope, workspace/global storage modes, profiles/remote targets, unresolved legacy opt-outs, and untouched stored data. History checks must cover window policy and unchanged archives; distinguish history cache caps from archive retention. Existing name-keyed metrics clearing/pruning hazards remain separately tracked rather than authorizing storage redesign in this scope change.
- Complete an older warning scan after changing settings or removing its owner; stale diagnostics must not reappear. Exercise shared absolute/external env files referenced by two roots with different warning preferences.
- Verify user/global task discovery when every root disables native folder tasks, and distinguish numeric workspace scope from genuine user scope. Global Taskfile permissions must not be assembled from different roots.

## Independent Critique

The original audit used two read-only sub-agent passes: provider evidence gathering, followed by an independent critique of the completed report and its proposed remedies. Neither pass changed files or ran tests. The critique agreed that the inventory contains all and only the 71 eligible registrations and that scope precedence must remain separate from feature precedence. The F10 policy decisions above supersede the original scope-preservation recommendation for the six explicitly reclassified settings; the historical critique below explains the original audit, not a rejection of those decisions.

| Critique | Disposition And Report Adjustment | Reasoning |
| --- | --- | --- |
| Distinguish configuration owner from cwd and synthetic display URI. | Accepted. Added the ownership/fallback table and explicit first-root fallback warning in F1. | URI propagation alone can select the wrong root if the supplied URI was only an execution fallback. |
| Native/user tasks need an independent early gate and original scope classification. | Accepted. Expanded F2 and the future verification matrix. | Per-item filtering cannot recover tasks that an aggregate gate never fetches; numeric workspace scope must not be misclassified as user ownership. |
| Existing metrics pruning and name-based clearing need explicit legacy-data constraints. | Accepted in the original audit. The updated F10 retains these hazards but defers stable-owner storage redesign and aggregate migration to separate work. | A scope fix must not silently delete or misattribute shared data, but application-scoped policy does not itself authorize changing storage identity. |
| History cache caps are not archive caps. | Accepted. Corrected F10 to distinguish workspace-state capping from retention rewrites and require non-destructive migration. | Conflating the two would introduce a new archive-truncation behavior rather than preserve current semantics. |
| Environment injection and warning flags have narrower production reach. | Accepted. Qualified F7 with the non-native shell boundary and proactive-only warning switch. | Scope consistency does not authorize new execution injection or a broader warning-disable contract. |
| Warning refresh needs async and shared-file ownership protection. | Accepted. Added stale-result rejection, per-owner diagnostic contributions, and external-reference watcher coverage. | Correct reads alone cannot prevent old scans from overwriting newer state or one root from clearing another's warning. |
| Discovery needs consistent matching and in-flight result rules. | Accepted. Expanded F3 to require a root-relative contract across caches/batches/save matching and explicit extensionless handling. | A folder-aware scan paired with absolute-path cache semantics can remain inconsistent or leak results. |
| Home Taskfile listing and execution need one policy and same-root permissions. | Accepted. Expanded F10 and the ownership table. | Different lookup URIs or permission aggregation across roots can produce different commands or authorize unintended discovery. |
| Preserve dormant-setting distinctions and stable shared-container sorting. | Retained; clarified the CMake generator finding as no identified production caller, not no tests. | These are useful limits on the audit's claims and prevent unrelated feature work or unstable comparators. |
| Consider blanket window-scope reclassification or implicit any-folder debug escalation. | Not selected as a default remedy. Kept scope changes and aggregation behind explicit product/compatibility decisions. | Neither silently dropping existing folder support nor enabling another root's debug logging fulfills the current resource-scoped contract. |

The critique changed the proposed future work, not application implementation. No source changes are authorized by this report.

## Verification Limits

The original audit and planning updates used static inspection only, without tests or application changes. The later authorized implementation of deliveries 1-2 changes only debug/history scope registrations, setting descriptions, regression coverage, and related documentation. Logger/history service behavior, persisted formats, metrics settings, Taskfile behavior, and the generated changelog are unchanged.

Implementation verification: the manifest comparison confirms that only the three intended scopes changed, with defaults/types/limits preserved and 68 resource / 20 window registrations. TypeScript checking, focused ESLint, and patch whitespace checks passed. The configuration/logger/history suites passed all 47 tests with coverage enabled, including the three new scope/default/limit regressions. The repository-required full `pnpm test` run passed: 2,546 passing, 3 pending, no failures; its compilation, bundling, and lint gates also passed.