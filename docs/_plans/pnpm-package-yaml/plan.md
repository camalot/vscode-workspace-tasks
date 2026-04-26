# Plan: pnpm package.yaml Task Discovery Fix (I10)

**Status:** Final (post rubber-duck review)
**Area:** Task Discovery / pnpm provider

---

## 1. Rubber-Duck Review Summary

The draft was reviewed by a sub-agent. The critique was generally supportive of the proposed fix.

| Issue | Severity | Resolution |
|---|---|---|
| **C1** `parseContent` may not handle all YAML variants and encoding edge cases | Low | Acknowledged — `PackageYamlTaskProvider.parseContent()` already uses the `yaml` npm package which handles these cases; log errors on parse failure (already done) |
| **C2** Missing tests for malformed YAML resilience and JSON/YAML parity | Medium | Adopted — added explicit parity and malformed-YAML test cases to §5 |
| **C3** Behavior drift between JSON and YAML paths | Low | Reviewed — `parseContent` returns a plain object with the same shape as JSON.parse for valid YAML; the subsequent script extraction code is identical; drift is minimal |
| **C4** Emit provider-scoped diagnostics, not generic error spam | Low | Acknowledged — existing error logging already scopes to provider; no change needed |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Unified parse pipeline enforcing strict output schema | Out of scope for a single-line bug fix; future refactor |
| Clarify precedence when both `package.json` and `package.yaml` exist | Both are independent files; both are processed; no precedence conflict |

---

## 2. Root Cause

In `src/providers/packageJsonTaskProvider.ts`, `getTasks()` hardcodes `JSON.parse(content)` instead of calling the virtual `this.parseContent()`:

```typescript
const json = JSON.parse(content); // ← override never invoked
```

`PackageYamlTaskProvider` correctly overrides `parseContent()` to use a YAML parser, but the override is unreachable because the base class bypasses it.

---

## 3. Fix

**File:** `src/providers/packageJsonTaskProvider.ts`

**Change (single line):**
```typescript
// Before:
const json = JSON.parse(content);

// After:
const json = await this.parseContent(content, file);
```

The `catch` block already handles parse errors gracefully. The `parseContent` method signature is `async` and the `getTasks()` method is already `async`, so no signature changes are needed.

---

## 4. Implementation

1. Locate `JSON.parse(content)` in `PackageJsonTaskProvider.getTasks()` (around line 57).
2. Replace with `await this.parseContent(content, file)`.
3. Verify the existing `catch` block remains in place.

---

## 5. Testing Plan

**File:** `src/test/suite/packageYamlTaskProvider.test.ts` (create)
Also verify: `src/test/suite/npmTaskProvider.test.ts` / `src/test/suite/packageJsonTaskProvider.test.ts`

| Test | Description |
|---|---|
| T01 | `package.yaml` with a `scripts` section → pnpm provider returns the correct tasks |
| T02 | `package.yaml` tasks have correct `taskFileUri` pointing to the YAML file |
| T03 | `package.yaml` tasks have correct `startLine` values (matching YAML line positions) |
| T04 | Malformed YAML in `package.yaml` → provider logs an error and returns zero tasks (no crash) |
| T05 | `package.json` files are still parsed correctly via `JSON.parse` path after the change |
| T06 | A workspace with both `package.json` and `package.yaml` → tasks from both files are discovered independently |

---

## 6. Documentation Plan

This is a fix for behavior that should already work. No user-visible documentation changes are required.

---

## 7. Risks

- **Low risk:** Single-line change, no structural modifications.
- **Regression risk:** `parseContent` is `async`; verify the call site is properly `await`ed (it is, since `getTasks()` is already `async`).
