---
title: '[Bug]: yarn/bun/pnpm task execution ignores cwd resolved by ExecutableService'
labels: ['bug', 'needs-triage']
---

## Bug Description

In `taskFactory.ts`, the `yarn`, `bun`, and `pnpm` switch cases each call `provider.getCommand(workspaceFolder?.uri)`, which returns a `{ command, args, cwd }` triple via `ExecutableService`. The resolved `cwd` value is destructured (`yarnCwd`, `bunCwd`, `pnpmCwd`) but is then silently discarded; the outer `cwd` (computed from `effectiveResourceUri`) is used in the `ShellExecution` instead.

The same issue applies to the `npm` case (`npmCwd`) and potentially others. If a user or environment has a configured installation that sets a custom working directory via `ExecutableService`, it is silently ignored.

## Steps to Reproduce

1. Configure a workspace where the `yarn`/`bun`/`pnpm` executable is installed at a non-standard path that also implies a non-standard `cwd`.
2. Open a workspace with a `package.json`.
3. Run a task via the Workspace Tasks tree view.
4. Observe the working directory used for execution in the terminal.

## Expected Behavior

The `cwd` returned by `provider.getCommand(workspaceFolder?.uri)` (via `ExecutableService`) should be used when constructing the `ShellExecution`, unless the file-derived `cwd` is intentionally overriding it.

If the file-derived `cwd` is the correct choice, the destructured `*Cwd` variable should be removed to eliminate dead code and the reasoning should be documented with a comment.

## Actual Behavior

The `cwd` from `ExecutableService` is destructured and immediately discarded. The `ShellExecution` uses `cwd` from `effectiveResourceUri` (the file's parent directory), ignoring any value from the provider.

**Affected code in `taskFactory.ts`:**

```typescript
// yarn case (identical pattern in bun and pnpm cases)
const { command: yarnCmd, args: yarnInitialArgs, cwd: yarnCwd } = yarnProvider.getCommand(workspaceFolder?.uri);
// ...
const shellExec = new vscode.ShellExecution(yarnCmd, yarnArgs, { cwd }); // uses outer `cwd`, not `yarnCwd`
```

## Task Type

- [x] npm/yarn/pnpm

## Error Messages / Logs

No error is thrown. The bug manifests as the wrong working directory being used silently.

## Environment

Discovered via static code analysis during `taskFactory.ts` refactoring planning.

## Workspace Structure

```
project-root/
├── package.json
```

## Additional Context

- Affects: `yarn` (line ~170), `bun` (line ~195), `pnpm` (line ~220), `npm` (line ~122)
- Root cause: The pattern `const { ..., cwd: xCwd } = provider.getCommand(...)` followed by `{ cwd }` (outer cwd) in `ShellExecution` is repeated in every npm-like case and represents a copy-paste oversight.
- Related to the planned `taskFactory` refactor — the migration should explicitly decide which `cwd` is authoritative per provider.

## Pre-submission Checklist

- [x] I have searched existing issues to ensure this bug hasn't been reported
- [x] I have checked the extension output logs for error messages
