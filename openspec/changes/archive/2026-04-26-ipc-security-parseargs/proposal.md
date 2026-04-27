## Why

IPC channels are process trust boundaries — the renderer (Electron's sandboxed renderer process) can be compromised via XSS or prototype pollution, making every `ipcRenderer.invoke` call a potential injection vector. `safeHandle()` already supports a `parseArgs` validator parameter for exactly this purpose, but 25+ channels across 7 handler files ship without one, accepting raw `unknown[]` directly as typed arguments. A malicious payload that passes TypeScript's compile-time types can still carry wrong shapes, path-traversal strings, or out-of-range values at runtime.

## What Changes

- Add `parseArgs` validators to all high-risk IPC channels that currently accept structured payloads without runtime validation
- Highest risk: `review.*` (14 channels, all mutating), `sprint:batchUpdate` (bulk operations), `settings:setJson` (writes arbitrary JSON to DB), `terminal:create` (spawns a PTY with a caller-supplied `cwd`), `workbench:researchRepo` / `workbench:chatStream` (execute repo searches and stream SDK calls)
- `git:stage` / `git:unstage` already call `validateRepoPath` on `cwd` — add similar path validation for the `files` array entries
- Validators follow the established `IpcArgsParser<K>` pattern; they throw on bad input, which `safeHandle` catches and logs

## Capabilities

### New Capabilities

- `ipc-parseargs-validators`: Runtime argument validators for IPC channels at the main-process trust boundary — covers review, sprint-batch, settings, terminal, workbench, and git handlers

### Modified Capabilities

- None — no spec-level requirements change; this is a security hardening layer on existing channels

## Impact

- `src/main/handlers/review.ts` — 14 channels gain `parseArgs`
- `src/main/handlers/sprint-batch-handlers.ts` — `sprint:batchUpdate` gains taskId + field validation
- `src/main/handlers/config-handlers.ts` — `settings:setJson` gains key allowlist + value size cap
- `src/main/handlers/terminal-handlers.ts` — `terminal:create` gains `cwd` path validation
- `src/main/handlers/workbench.ts` — `workbench:researchRepo`, `workbench:chatStream` gain shape guards
- `src/main/handlers/git-handlers.ts` — `git:stage`, `git:unstage` gain per-file path validation
- `src/main/handlers/sprint-local.ts` — `sprint:forceFailTask`, `sprint:forceDoneTask`, `sprint:createWorkflow` gain shape guards
- No renderer changes, no IPC channel renames — purely additive main-process validation
