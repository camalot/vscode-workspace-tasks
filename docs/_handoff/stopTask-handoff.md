# StopTask Graceful-Kill Handoff

## Branch
`v1.12.x` — 1 commit ahead of origin (`7da9391`, NLS URL fix committed)

## Problem Being Solved
1. **`delay = 0` should opt out of force-kill entirely** — `0` now means SIGINT only, no hard kill, no timer.
2. **Terminal preservation on force-kill** — `execution.terminate()` destroys the VSCode terminal panel. Fix: use `process.kill(shellPid, 'SIGKILL')` when `presentation.close` is `false`, so VSCode treats the shell exit as natural and keeps the panel open.
3. **Both behaviours consistent** for standard tasks AND compound dependencies.

## Files Changed (all uncommitted, working tree)
| File | Status | Notes |
|------|--------|-------|
| `src/commands/stopTask.ts` | Modified | All logic complete — `forceKillPreservingTerminal`, `run()`, `stopCompoundDependencies()` |
| `src/test/suite/stopTask.test.ts` | Modified | 1 354 lines — full suite written and complete |
| `docs/configuration/task-execution/tasks.md` | Modified | Updated `stopGracefulDelayMilliseconds` description |
| `package.nls.json` | Modified | Description text update still uncommitted |

## What Was Implemented

### New export in `stopTask.ts`
```ts
export async function forceKillPreservingTerminal(
  terminal: vscode.Terminal | undefined,
  execution: vscode.TaskExecution,
): Promise<void>
```
- `presentation.close === false` AND terminal AND processId available → `process.kill(pid, 'SIGKILL')`
- All other cases → `execution.terminate()` (fallback; catches `process.kill` throws too)

### `run()` changes
- `timeout` hoisted before the `if (terminal)` block
- `timeout <= 0` path with terminal: sends SIGINT, returns immediately (no timer, no hard kill)
- `timeout <= 0` path without terminal: marks terminated, skips `execution.terminate()`
- Second-click path: resolves terminal, calls `forceKillPreservingTerminal` instead of `execution.terminate()`
- Timer callback: calls `forceKillPreservingTerminal` instead of `execution.terminate()`

### `stopCompoundDependencies()` changes
- `timeout` hoisted to top of method
- `timeout <= 0` guard in dependency loop (SIGINT only, no timer)
- Second-stop-timer path: resolves `depTerminal`, calls `forceKillPreservingTerminal`
- Timer callback: calls `forceKillPreservingTerminal`
- No-terminal path: `timeout > 0` guard before `dependencyExecution.terminate()`
- Logging: `gracefulCount` / `forcedCount` summary at end

### Test file (`stopTask.test.ts`) — 1 354 lines, complete
Helpers added: `makeTerminalWithPid(pid)`, `makeExecutionWithPresentation(opts)`

Key test groups now present:
- `forceKillPreservingTerminal` suite (6 tests): close=false with PID, close=true, no terminal, no PID, kill throws, close unset
- `delay of 0 with terminal` — SIGINT sent, no timer, no terminate
- `delay of 0 without terminal` — no terminate
- `fallback timer calls process.kill when presentation.close is false`
- `fallback timer calls execution.terminate when presentation.close is true`
- `second click uses process.kill to preserve terminal when presentation.close is false`
- `delay of 0 with dependency terminal` — compound: SIGINT, no timer
- `delay of 0 without dependency terminal` — compound: no terminate

## Current Status
- **Implementation: complete** — all logic is written
- **Tests: complete** — all cases covered (1 354-line test file)
- **Compile: not verified in this session** — use `pnpm run compile:tests` to confirm (pnpm-managed project; do NOT use bare `npm`)
- **Tests run: not verified in this session** — run `pnpm test` to confirm green
- **Nothing committed beyond the NLS URL fix** — all working-tree changes are staged

## Remaining Work
1. **Compile check**: `pnpm run compile:tests`
2. **Run tests**: `pnpm test`
3. **Commit** all working-tree changes once tests pass
4. **README / docs** — may want a brief note that `stopGracefulDelayMilliseconds: 0` = SIGINT-only (no force-kill)

## Key Design Decisions
- `delay = 0` → SIGINT only, no fallback kill of any kind (user explicitly opts out)
- `delay > 0` → SIGINT + timer → `forceKillPreservingTerminal` (preserves terminal unless `presentation.close: true`)
- `process.kill(SIGKILL)` preserves the terminal because VSCode treats shell PID exit as natural; `execution.terminate()` tears down the whole terminal panel
- Same logic applies to compound dependencies (consistent behaviour)
