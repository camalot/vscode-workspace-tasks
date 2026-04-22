---
title: '[Bug]: GitHub Actions workflow_dispatch input collection logic is duplicated — fixes in one branch do not propagate'
labels: ['bug', 'needs-triage']
---

## Bug Description

In the `github-actions` case of `taskFactory.ts`, the logic for collecting `workflow_dispatch` input values via `vscode.window.showInputBox()` is copy-pasted verbatim in two separate branches:

1. When `meta.type === 'workflow'` and `meta.event === 'workflow_dispatch'` (~lines 630–675)
2. In the generic/fallback branch when the selected event is `'workflow_dispatch'` (~lines 710–755)

Both blocks handle both the legacy `string[]` array format and the new `Record<string, WorkflowInput>` format, prompting the user for each required input and appending `--input key=value` to the args array.

Any bug fix, enhancement, or new input type support (e.g., `choice` dropdowns, `boolean` toggles) applied to one branch must be manually applied to the other — which is easy to forget and has already caused the branches to drift slightly.

## Steps to Reproduce

1. Open a workflow file with `workflow_dispatch` inputs.
2. Trigger it as a "workflow" type task (meta.type === 'workflow').
3. Observe input prompting behavior.
4. Trigger it via the generic/fallback path.
5. Compare behavior — subtle differences may exist.

## Expected Behavior

Input collection for `workflow_dispatch` should use a single shared implementation. Any change or fix applies consistently to all paths.

## Actual Behavior

Two identical blocks of ~40 lines each handle input collection independently. A regression or enhancement in one block will not be present in the other.

**Affected code in `taskFactory.ts`:**

```typescript
// Branch 1: meta.type === 'workflow' && meta.event === 'workflow_dispatch'
if (Array.isArray(inputsObj)) {
  for (const input of inputsObj) { /* ... showInputBox ... */ }
} else {
  for (const [key, details] of Object.entries(inputsObj)) { /* ... showInputBox ... */ }
}

// Branch 2: generic event selection where useEvent === 'workflow_dispatch'
// IDENTICAL BLOCK — copy-pasted
if (Array.isArray(inputsObj)) {
  for (const input of inputsObj) { /* ... showInputBox ... */ }
} else {
  for (const [key, details] of Object.entries(inputsObj)) { /* ... showInputBox ... */ }
}
```

## Task Type

- [x] GitHub Actions

## Error Messages / Logs

No error thrown — this is a code quality / latent bug issue. Inconsistent behavior may surface after future modifications to one branch only.

## Environment

Discovered via static code analysis during `taskFactory.ts` refactoring planning.

## Workspace Structure

```
project-root/
└── .github/
    └── workflows/
        └── my-workflow.yml   (with workflow_dispatch trigger and inputs)
```

## Additional Context

**Recommended fix**: Extract input collection into a shared async helper function:

```typescript
async function _collectWorkflowDispatchInputs(
  inputs: string[] | Record<string, WorkflowInput>
): Promise<string[]> {
  const actArgs: string[] = [];
  if (Array.isArray(inputs)) {
    for (const input of inputs) {
      const val = await vscode.window.showInputBox({ prompt: `Enter input for '${input}'`, ... });
      if (val) actArgs.push('--input', `${input}=${val}`);
    }
  } else {
    for (const [key, details] of Object.entries(inputs)) {
      const val = await vscode.window.showInputBox({ prompt: details.description, ... });
      if (val) actArgs.push('--input', `${key}=${val}`);
    }
  }
  return actArgs;
}
```

Both branches then call `actArgs.push(...await _collectWorkflowDispatchInputs(meta.inputs))`.

This also facilitates future support for `choice` type inputs (QuickPick), `boolean` type inputs (QuickPick with Yes/No), and `environment` type.

## Pre-submission Checklist

- [x] I have searched existing issues to ensure this bug hasn't been reported
- [x] I have checked the extension output logs for error messages
