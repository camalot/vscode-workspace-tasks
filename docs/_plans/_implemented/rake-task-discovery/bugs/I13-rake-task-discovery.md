# Bug Report: Rakefile Tasks Not Being Discovered

**Type:** Bug
**Labels:** bug, needs-triage
**Area:** Task Discovery, Rake provider

---

## Bug Description

Tasks defined in `Rakefile` or `.rake` files are not discovered by the extension. The Workspace Tasks tree view shows no Rake tasks even when Rakefiles are present in the workspace.

---

## Steps to Reproduce

1. Open a workspace containing a `Rakefile` or `.rake` files with task definitions (e.g., `task :build do ... end`).
2. Ensure the Rake task provider is enabled.
3. Open the Workspace Tasks panel.
4. Observe that no Rake tasks appear.

---

## Expected Behavior

Tasks defined in `Rakefile` and `.rake` files should be discovered and displayed in the Workspace Tasks tree view.

---

## Actual Behavior

No Rake tasks are discovered. The tree view shows no tasks for Rakefile/rake files.

---

## Task Type

- [x] Other/General (Rake)

---

## Error Messages / Logs

Check the Output panel (View → Output → Workspace Tasks) for errors like:
- `[RakeTaskProvider] Failed to get tasks from ...`
- `Error: spawn rake ENOENT` (rake not in PATH)
- Other execution errors

---

## Environment

- Extension: Workspace Tasks
- Provider: `rakeTaskProvider.ts`
- Files: `Rakefile`, `*.rake`

---

## Workspace Structure

Example structure:
```
project-root/
├── Rakefile
└── tasks/
    └── build.rake
```

---

## Additional Context

The `RakeTaskProvider` attempts to run `rake --tasks --file <path>` via CLI to enumerate tasks. Known failure modes:

1. **`rake` not in `PATH`**: The most common cause. `execFileAsync` throws an ENOENT error, the provider catches it and returns zero tasks for that file. No user-visible warning is shown.

2. **`.rake` task files requiring external dependencies**: Many `.rake` files `require` other files (e.g., Rails environment). Running `rake --tasks --file tasks/build.rake` in isolation will fail if those dependencies are not loadable.

3. **Rake CLI not available**: The `rake` executable may be installed but not on the system PATH.

4. **No static parsing fallback**: Unlike some other providers, there is no fallback to parse task names from the file content when the CLI invocation fails.

Please confirm:
- Is `rake` available in the terminal? (`which rake` or `rake --version`)
- Are the `.rake` files standalone or do they require a Rails environment?
- What error messages appear in the Workspace Tasks output log?
