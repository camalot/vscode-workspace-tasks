# Plan: Release Workflow Hardening

## TL;DR

Harden the release workflow in [.github/workflows/release.yml](../../../../.github/workflows/release.yml) so
publish gating reflects real token availability, `vsix_publish` is normalized once and used consistently,
rollback fails loudly instead of silently partially succeeding, manual dispatch inputs are surfaced
correctly in verification output, and concurrent release runs cannot race while mutating tags and
GitHub Releases.

---

## Self-Critique & Viability Assessment

**Strengths:**

- The required fixes are localized to a single workflow file, which keeps the implementation surface
  narrow and the validation matrix manageable.
- The highest-risk defects are operational rather than architectural. They can be fixed by making
  workflow conditions, environment wiring, and shell strictness coherent.
- The workflow already has a useful shape: versioning, verification, packaging, release creation,
  and rollback are separated into readable steps, so hardening should not require redesigning the
  entire pipeline.

**Risks / Weaknesses:**

- **Silent non-publication:** The current publish-step `if` conditions appear to read workflow-level
  placeholder env vars instead of actual secret-backed values, which can allow a release to succeed
  without publishing the VSIX to one or both marketplaces.
- **Partial rollback remains possible:** Even after tightening shell flags, rollback cannot fully
  undo external marketplace publication if one registry succeeds before a later step fails.
- **Concurrency policy matters:** Adding concurrency without choosing the right behavior could cancel
  an in-flight release at the wrong time. This plan should prefer serialization over
  cancel-in-progress for release integrity.
- **Behavioral ambiguity:** The intended policy for `vsix_publish=true` with missing marketplace
  tokens is not explicit today. The implementation must decide whether that state should fail fast
  or intentionally skip with a clear summary.

**Verdict:** High-confidence, high-value maintenance work. The main risk is not implementation
difficulty; it is leaving policy ambiguous. The handoff should force explicit decisions around token
requirements and release serialization.

---

## Findings Summary

### 1. Publish gating likely evaluates the wrong token source

- In [.github/workflows/release.yml](../../../../.github/workflows/release.yml), workflow-level env
  initializes `OPEN_VSX_TOKEN` and `VS_MARKETPLACE_TOKEN` to empty strings.
- The publish-step `if` expressions check those env names before step-level env injects the secrets.
- Result: publish steps can be skipped even when secrets are configured, producing a successful tag
  and GitHub Release without marketplace publication.

**Severity:** High

### 2. Rollback script is not fail-fast

- The rollback step uses `set -uo pipefail` instead of `set -euo pipefail`.
- A failed `git revert` or `git push` can therefore be ignored while the rollback step still exits
  successfully.
- Result: the workflow can report rollback success after only partially undoing the release state.

**Severity:** High

### 3. `vsix_publish` handling is inconsistent

- The workflow normalizes the dispatch input into `VSIX_PUBLISH`, but only one publish path uses it.
- The Visual Studio Marketplace step still checks the raw dispatch input directly.
- Result: casing and default-handling can diverge across the two marketplace publish paths.

**Severity:** Medium

### 4. Verify summary cannot report `force_next_version`

- The verify job checks `FORCE_NEXT_VERSION`, but the job env block never defines it.
- Result: the summary output omits the forced version even when the workflow was dispatched with
  that input.

**Severity:** Low

### 5. Release workflow is not serialized

- The workflow mutates tags, creates a release, and may revert commits, but it has no
  `concurrency` control.
- Result: multiple manual dispatches can race on the same version/tag state and interfere with
  rollback assumptions.

**Severity:** High

---

## Desired Invariants

After the fix, the workflow should satisfy all of the following:

1. Marketplace publish steps run only when publication is enabled and the required token for that
   target is actually present.
2. Both marketplace publish paths consume the same normalized `vsix_publish` value.
3. Verification output reflects the actual dispatch inputs, including `force_next_version`.
4. Rollback stops on meaningful command failures and surfaces rollback failure clearly in the job
   result.
5. Only one release workflow run can mutate release state for this repository at a time.
6. Release behavior is deterministic for the cases `publish enabled + token missing`,
   `publish disabled`, and `publish enabled + tokens present`.

---

## Open Policy Decisions

These should be resolved before or during implementation, not left implicit:

1. When `vsix_publish` is enabled but `OPEN_VSX_TOKEN` is missing, should the workflow fail or skip
   Open VSX publication with a summary note?
2. When `vsix_publish` is enabled but `VS_MARKETPLACE_TOKEN` is missing, should the workflow fail or
   skip Visual Studio Marketplace publication with a summary note?
3. Should concurrency serialize releases using a queueing behavior, or block parallel runs without
   canceling the in-flight run?

**Recommendation:** Fail fast for enabled-but-misconfigured publication targets, and serialize
release runs without canceling an active release.

---

## Implementation Phases

### Phase 1: Fix publish gating and token-source wiring

Update the publish-step conditions in [.github/workflows/release.yml](../../../../.github/workflows/release.yml)
so they evaluate against env values that actually contain the secret-backed token values at `if`
evaluation time.

Implementation goals:

- Move publish-token env wiring to a scope that the `if` expressions can reliably read.
- Remove or stop relying on workflow-level placeholder token env values if they obscure the real
  source of truth.
- Make the condition for each publish step readable and deterministic.

Validation goals:

- Confirm Open VSX publish runs when `vsix_publish` is enabled and `OPEN_VSX_TOKEN` is present.
- Confirm Open VSX publish is skipped or fails according to the decided policy when the token is
  absent.
- Confirm Visual Studio Marketplace publish behaves the same way with its corresponding token.

### Phase 2: Normalize `vsix_publish` once and use it everywhere

Refactor the workflow so all publish decisions consume a single normalized value rather than mixing
raw input checks and derived env checks.

Implementation goals:

- Normalize the dispatch input exactly once.
- Use the normalized result for both marketplace publish steps.
- Avoid duplicating case normalization or string interpretation logic.

Validation goals:

- Exercise `true`, `false`, empty string, and mixed-case values such as `TRUE`.
- Confirm both publish steps make the same decision for the same input.

### Phase 3: Repair verify-job dispatch input reporting

Wire `force_next_version` through the verify job so the summary matches the actual dispatch input.

Implementation goals:

- Define `FORCE_NEXT_VERSION` in the verify job env if the summary is expected to report it.
- Ensure the verify summary remains correct for both blank and non-blank values.

Validation goals:

- Run or simulate a workflow dispatch with and without `force_next_version`.
- Confirm the summary output matches the supplied input value.

### Phase 4: Harden rollback shell behavior and observability

Make rollback fail fast and surface incomplete rollback clearly.

Implementation goals:

- Tighten shell strictness for the rollback step.
- Review which commands should remain best-effort with `|| true` and which should fail the step.
- Preserve intentional no-op cleanup behavior for deleting already-missing releases/tags.
- Ensure critical repair operations, especially revert/push, cannot silently fail.

Validation goals:

- Simulate a post-release failure path and confirm rollback executes.
- Simulate a rollback failure in a critical command and confirm the step fails visibly.
- Confirm benign cleanup misses do not fail the rollback unnecessarily.

### Phase 5: Add release concurrency control

Serialize release runs so concurrent manual dispatches cannot race on tags, release creation, or
rollback assumptions.

Implementation goals:

- Add workflow-level or job-level `concurrency` with a stable group name.
- Prefer serialization semantics that do not cancel an in-progress release.
- Keep the concurrency scope narrow enough to avoid interfering with unrelated workflows.

Validation goals:

- Confirm a second release dispatch does not run concurrently with an active release.
- Confirm the chosen concurrency behavior matches the intended operator experience.

---

## Validation Plan

### Static validation

1. Review the final `if` conditions and env scopes in [.github/workflows/release.yml](../../../../.github/workflows/release.yml)
   to confirm token presence is tested against the same variables later used by the publish steps.
2. Confirm all `vsix_publish` decision points read the same normalized value.
3. Confirm the verify job env block includes the inputs it reports.
4. Confirm rollback uses fail-fast shell settings for critical operations.
5. Confirm a `concurrency` block exists and does not use `cancel-in-progress: true` unless there is
   a deliberate reason.

### Scenario validation

1. `vsix_publish=true`, both tokens present:
   - Release is created.
   - Both marketplace publish steps run.
2. `vsix_publish=true`, Open VSX token missing:
   - Behavior matches the chosen policy exactly.
3. `vsix_publish=true`, VS Marketplace token missing:
   - Behavior matches the chosen policy exactly.
4. `vsix_publish=false`:
   - Release is created.
   - Both marketplace publish steps are skipped intentionally.
5. `force_next_version` provided:
   - Verify summary shows the supplied value.
6. Post-release failure after GitHub Release creation:
   - Rollback runs.
   - Critical rollback failures are surfaced as workflow failures.
7. Two manual release dispatches started close together:
   - Only one run mutates release state at a time.

### Post-change executable checks

At minimum:

1. Run the repository test suite with `pnpm test` to satisfy the extension repo’s standard post-change
   validation baseline.
2. If available in the maintainer workflow, validate the YAML with a workflow linter or a local
   GitHub Actions validation tool.
3. Inspect the final diff to ensure only intended release-workflow behavior changed.

---

## Residual Risks

These may remain even after the planned fixes and should be documented in the handoff result:

- A successful external marketplace publish cannot necessarily be rolled back automatically if a
  later step fails.
- Release behavior still depends on third-party actions whose semantics can change across major
  versions.
- Concurrency protects against overlapping runs, but it does not resolve operator error such as
  forcing an incorrect version.

---

## Exit Criteria

The work is complete when all of the following are true:

1. Publish-step gating is driven by real token-backed values and behaves deterministically.
2. `vsix_publish` is normalized once and reused consistently.
3. Verify output correctly surfaces `force_next_version`.
4. Rollback cannot silently ignore critical failures.
5. Release runs are serialized with an explicit concurrency policy.
6. The updated workflow has been validated against the scenarios listed above.
