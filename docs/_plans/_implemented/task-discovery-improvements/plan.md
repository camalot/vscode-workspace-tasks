# Plan: Task Discovery Improvements

## TL;DR

This revised plan focuses on CLI-based task discovery for cargo-make, Gulp, and Grunt.
mise is removed because it has already been implemented outside this plan.
Gradle is moved out of scope because CLI discovery overhead is too high.
Ant and MSBuild glob changes are deferred and remain unchanged.

---

## Background

Many providers still rely on static file parsing (regex/AST/TOML parsing). That is fast, but it
can miss tasks that are registered dynamically or composed through includes.

CLI-based discovery uses the tool itself as the source of truth and improves correctness for
task runners that support listing tasks.

Existing CLI-first providers include justfile, taskfile, gitlab-ci, and rake. This plan extends
that model only to the remaining in-scope providers listed below.

---

## Requirements

### R0 - Workspace Trust gate for all CLI-invoking providers

1. All providers in this plan that invoke external CLIs must check
   vscode.workspace.isTrusted before spawning any process.
2. If the workspace is untrusted, provider behavior must be:
   - return [] as no tasks should be discovered if the workspace is untrusted.
3. Emit one debug-level log entry when CLI invocation is skipped due to untrusted workspace.

### R1 - cargo-make: CLI-based discovery via cargo make --list-all-steps

1. CargoMakeTaskProvider.getTasks() must invoke cargo make --list-all-steps in each directory
   containing Makefile.toml.
2. The parser must handle output sections and parse task lines in the format:
   two leading spaces, task_name, space-dash-space, description.
3. Existing TOML parsing remains the fallback path.
4. The enabled gate requiring both cargo-make and cargo task types remains required.
5. No invalid cargo-make flags may be introduced.

### R2 - Gulp: CLI-based discovery via gulp --tasks-json

1. GulpTaskProvider.getTasks() must invoke the configured gulp executable with --tasks-json
   in each discovered gulpfile.* directory.
2. The parser must unwrap the root Tasks container and read tasks from nodes[].label.
3. Existing static analysis remains fallback when CLI discovery fails, including Gulp 3 cases.

### R3 - Grunt: CLI-based discovery via grunt --help

1. GruntTaskProvider.getTasks() must invoke the configured grunt executable with:
   --gruntfile <path> --help --no-color
2. The --gruntfile flag is required to target each discovered Gruntfile.* exactly.
3. Parse the Available tasks section using:
   ^\s{2}([\w:\-\.]+)\s{2,}(.*)
4. Section start detection must be locale-tolerant with /available tasks/i.
5. Section parsing ends at next blank line or end of output.
6. Existing static grunt.registerTask / grunt.registerMultiTask parsing remains fallback.

---

## Design Decisions

### CLI-first with static fallback

In-scope providers follow this structure:

```typescript
if (!vscode.workspace.isTrusted) {
  return this.staticParse(files);
}

try {
  const { stdout } = await this.execFileAsync(cmd, args, { cwd });
  return this.parseCliOutput(stdout);
} catch (err) {
  this.logger.warn('[Provider] CLI unavailable or failed, falling back to static parse', err);
  return this.staticParse(files);
}
```

### No new CLI toggles or timeout settings

This plan introduces no workspaceTasks.<provider>.useCli setting and no
workspaceTasks.<provider>.discoveryTimeout setting.

CLI-enabled providers in scope always use CLI discovery first, with fallback behavior defined in
their provider implementation.

### Shared provider base class

A shared CliTaskProvider abstract base class will centralize:
- workspace trust gating
- CLI invocation plumbing
- per-file fallback orchestration

### Testability

Providers should expose protected execFileAsync = promisify(execFile) directly or through the
base class so tests can inject mocks.

### Output decoding

Decode CLI stdout explicitly as UTF-8:

```typescript
const text = output.stdout.toString('utf8');
```

---

## Files to Modify

| File | Change |
|---|---|
| src/providers/cargoMakeTaskProvider.ts | Add CLI discovery via cargo make --list-all-steps and retain TOML fallback |
| src/providers/gulpTaskProvider.ts | Add CLI discovery via gulp --tasks-json and retain static fallback |
| src/providers/gruntTaskProvider.ts | Add CLI discovery via grunt --help and retain static fallback |

## Files to Add

| File | Content |
|---|---|
| src/providers/cliTaskProvider.ts | Abstract CliTaskProvider base class with shared trust gate, CLI path, and fallback orchestration |
| src/test/providers/cargoMakeTaskProvider.test.ts | CLI parsing and fallback coverage for cargo-make |
| src/test/providers/gulpTaskProvider.test.ts | CLI JSON parsing and fallback coverage for Gulp |
| src/test/providers/gruntTaskProvider.test.ts | CLI help parsing and fallback coverage for Grunt |
| src/test/providers/cliTaskProvider.test.ts | Base-class trust/fallback behavior coverage |

## Files to Update (Existing Tests)

| File | Required Update |
|---|---|
| src/test/providers/cargoMake.test.ts | Add coverage for CLI discovery success/fallback and enabled-gate behavior |
| src/test/providers/gulp.test.ts | Add coverage for root Tasks container unwrap and fallback behavior |
| src/test/providers/grunt.test.ts | Add coverage for Available tasks parsing and fallback behavior |

## Configuration Additions (package.json)

None.

---

## Documentation to Update

| File | Required Change |
|---|---|
| docs/task-types/cargo-make.md | Document CLI discovery coverage for include/extend-based steps and fallback behavior |
| docs/task-types/gulp.md | Document CLI discovery behavior and Gulp 3 fallback behavior |
| docs/task-types/grunt.md | Document CLI discovery behavior and Available tasks parsing notes |
| docs/troubleshooting/cli-task-discovery.md | New troubleshooting page for missing CLIs, trust mode, and fallback behavior |

---

## Phases

### Phase 1: cargo-make CLI Discovery (R1)

Deliverables:
1. Add CLI path using cargo make --list-all-steps.
2. Preserve current enabled gate and TOML fallback behavior.
3. Add/extend tests for CLI success, CLI failure fallback, and untrusted workspace behavior.
4. Run npm test.

### Phase 2: CliTaskProvider Base Class

Deliverables:
1. Add src/providers/cliTaskProvider.ts.
2. Implement shared trust-gate and fallback orchestration.
3. Add dedicated base-class unit tests.
4. Run npm test.

### Phase 3: Gulp CLI Discovery (R2)

Deliverables:
1. Refactor GulpTaskProvider to extend CliTaskProvider.
2. Implement invokeCliForFile() with gulp --tasks-json.
3. Keep static parse fallback path.
4. Add/extend tests for parser variants and fallback behavior.
5. Run npm test.

### Phase 4: Grunt CLI Discovery (R3)

Deliverables:
1. Refactor GruntTaskProvider to extend CliTaskProvider.
2. Implement invokeCliForFile() with --gruntfile <path> --help --no-color.
3. Implement locale-tolerant Available tasks parsing.
4. Keep static parse fallback path.
5. Add/extend tests for parser variants and fallback behavior.
6. Run npm test.

### Phase 5: Documentation

Deliverables:
1. Update cargo-make, Gulp, and Grunt docs.
2. Add cli-task-discovery troubleshooting doc.
3. Validate README/doc references remain consistent.

---

## Out of Scope

- mise provider changes (already implemented separately)
- Gradle provider CLI discovery and related refactors
- Ant glob pattern changes
- MSBuild glob pattern changes
- Maven, CMake, Poetry, venv, and Pipenv expansion work
- Workspace trust retrofit for pre-existing CLI providers not covered by this plan
- Concurrency limiting for parallel CLI invocations
- Additional per-file CLI caching beyond current TaskCacheService behavior

---

## Test Coverage Requirements

All new code paths should meet project coverage standards. New provider tests should cover:

- CLI success path
- CLI failure fallback paths (non-zero exit and ENOENT)
- untrusted workspace behavior (no process spawn)
- zero/one/multiple tasks in parsed output
- tasks with and without descriptions
- enabled = false behavior (returns [])

Parser methods may be exposed as public/protected for isolated unit tests where useful.

---

## Self-Critique and Viability Assessment

Strengths:

- Narrowed scope increases delivery confidence and shortens implementation time.
- Removes high-overhead Gradle work from this effort.
- Avoids adding new configuration surface area.
- Preserves reliability with fallback parsing.

Risks and Weaknesses:

- Gulp/Grunt output variants still require defensive parsing.
- CLI availability can vary across environments; fallback quality remains important.
- Without configurable timeout settings, unusually slow environments may experience slower
  discovery in worst-case scenarios.
