# Bug Report: pnpm package.yaml Tasks Are Not Discovered

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** Task Discovery, pnpm provider

---

## Bug Description

Tasks defined in `package.yaml` files (used by some pnpm workspaces) are not discovered by the extension. The Workspace Tasks tree view shows no pnpm tasks from `package.yaml` files, even when the pnpm task provider is enabled.

---

## Steps to Reproduce

1. Open a workspace that uses pnpm with a `package.yaml` file (YAML format equivalent of `package.json`).
2. Open the Workspace Tasks panel.
3. Observe that no pnpm tasks from `package.yaml` appear.
4. Compare with a standard `package.json` — tasks from JSON files are discovered correctly.

---

## Expected Behavior

Tasks defined in `package.yaml` files should be discovered and displayed in the Workspace Tasks tree view, just like tasks defined in `package.json`.

---

## Actual Behavior

No tasks are discovered from `package.yaml` files. The pnpm provider silently skips YAML package files.

---

## Task Type

- [x] npm/yarn/pnpm

---

## Root Cause

`PackageJsonTaskProvider.getTasks()` hardcodes `JSON.parse(content)` directly instead of calling the virtual `this.parseContent()` method:

```typescript
const json = JSON.parse(content); // ← never calls this.parseContent()
```

`PackageYamlTaskProvider` overrides `parseContent()` to use a YAML parser for `.yaml`/`.yml` files. However, because the base class hardcodes `JSON.parse`, this override is never invoked. When pnpm reads `package.yaml`, `JSON.parse(content)` throws a SyntaxError (YAML is not valid JSON), the `catch` block executes `continue`, and the file is silently skipped.

---

## Environment

- Extension: Workspace Tasks
- Provider: `packageJsonTaskProvider.ts`, `packageYamlTaskProvider.ts`
- File: `package.yaml`

---

## Additional Context

The fix is a single-line change in `PackageJsonTaskProvider.getTasks()`: replace `JSON.parse(content)` with `await this.parseContent(content, file)`. This allows subclasses (like `PackageYamlTaskProvider`) to override the parsing behavior without duplicating the entire `getTasks()` method.
