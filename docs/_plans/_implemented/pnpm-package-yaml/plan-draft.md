# Plan: pnpm package.yaml Task Discovery Fix (I10)

**Status:** Draft (pre rubber-duck review)
**Area:** Task Discovery / pnpm provider

---

## 1. Overview

Tasks defined in `package.yaml` files (YAML-format package files used in some pnpm workspaces) are silently skipped during task discovery. The `PackageYamlTaskProvider` override of `parseContent()` is never called because the base class `PackageJsonTaskProvider.getTasks()` hardcodes `JSON.parse(content)`.

---

## 2. Root Cause

In `src/providers/packageJsonTaskProvider.ts`, the `getTasks()` method hardcodes:

```typescript
const json = JSON.parse(content);
```

`PackageYamlTaskProvider` overrides `parseContent()` to return a YAML-parsed object for `.yaml`/`.yml` files. However, because the base class directly calls `JSON.parse()` rather than `this.parseContent()`, the override is never invoked.

When `JSON.parse()` is called on YAML content, it throws a `SyntaxError`. The `catch` block executes `continue`, silently skipping the file.

---

## 3. Proposed Fix

**File:** `src/providers/packageJsonTaskProvider.ts`

Replace:
```typescript
const json = JSON.parse(content);
```

With:
```typescript
const json = await this.parseContent(content, file);
```

This is a single-line change that allows `PackageYamlTaskProvider` (and any future subclasses) to override the parsing logic without duplicating the entire `getTasks()` method.

**Note:** The existing `catch` block around this call already handles parsing failures gracefully:
```typescript
} catch (e) {
  this.logger.error(`[${this.type}TaskProvider] Error parsing package.json: ${file.fsPath}`, e);
}
```
So if `parseContent` throws (e.g., invalid YAML), the error is logged and the file is skipped — same behavior as before.

---

## 4. Implementation

**File:** `src/providers/packageJsonTaskProvider.ts`

Single-line change in the `getTasks()` method body, approximately at line 57:

```typescript
// Before:
const json = JSON.parse(content);

// After:
const json = await this.parseContent(content, file);
```

No other changes required. `PackageYamlTaskProvider.parseContent()` already handles the YAML parsing correctly.

---

## 5. Testing Plan

**File:** `src/test/suite/packageYamlTaskProvider.test.ts` (create if not present)

| Test | Description |
|---|---|
| T01 | `package.yaml` file with `scripts` section returns tasks for pnpm provider |
| T02 | Invalid YAML content in `package.yaml` is handled gracefully (logs error, no crash) |
| T03 | `package.json` files still work correctly (JSON parsing not broken by the change) |
| T04 | Tasks from `package.yaml` have correct `startLine` values |
| T05 | Tasks from `package.yaml` have `taskFileUri` set to the YAML file URI |

---

## 6. Documentation Plan

This is a fix for behavior that should already be working. No user-visible documentation changes are required.

---

## 7. Risks

- **Low risk:** The change is minimal (one line). The `parseContent` method is a simple YAML parser that is already tested.
- **Compatibility:** The `parseContent` call is `async`; the existing `getTasks()` method is already `async`, so no signature changes are required.
