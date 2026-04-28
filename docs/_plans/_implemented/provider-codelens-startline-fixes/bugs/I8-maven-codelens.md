# Bug Report: Maven CodeLens Items Not Showing

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** CodeLens, Maven provider

---

## Bug Description

CodeLens items (`▶️ Run Task | ⏯️ Run Task with Args | ⭐ Add to Favorites`) do not appear in the `pom.xml` editor for Maven task/lifecycle goals, even though Maven tasks are discovered and visible in the Workspace Tasks tree view.

---

## Steps to Reproduce

1. Open a workspace containing a Maven `pom.xml` file.
2. Open `pom.xml` in the editor.
3. Observe that no CodeLens items appear.
4. Verify that Maven tasks DO appear in the Workspace Tasks tree view (discovery works).

---

## Expected Behavior

CodeLens items should appear in `pom.xml` for each Maven lifecycle goal (`clean`, `compile`, `test`, `package`, etc.), enabling tasks to be run directly from the file editor.

---

## Actual Behavior

No CodeLens items appear in `pom.xml` even though Maven tasks are discovered in the tree view.

---

## Task Type

- [x] Gradle (Maven — not listed separately in dropdown)

---

## Root Cause

`MavenTaskProvider` creates `TaskItem` objects for each standard Maven lifecycle goal but never sets `item.startLine`. The `TaskCodeLensProvider` requires `isLeafTask(t) && t.startLine !== undefined` to show CodeLens items. Since `startLine` is always `undefined`, no CodeLens items are generated.

Maven lifecycle goals (`clean`, `compile`, `test`, etc.) are not declared on specific lines in `pom.xml` — they are synthetic, built-in goals. Setting `item.startLine = 0` is the appropriate sentinel value, placing CodeLens items at the top of the `pom.xml` file.

---

## Environment

- Extension: Workspace Tasks
- Provider: `mavenTaskProvider.ts`
- File: `pom.xml`

---

## Additional Context

The fix is straightforward: add `item.startLine = 0` for all standard Maven lifecycle goal `TaskItem`s in `mavenTaskProvider.ts`. This is consistent with other providers that use line 0 as a fallback when no specific line can be determined.
