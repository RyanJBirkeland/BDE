# Pipeline-agent path-traversal guard

## Multi-File: true

## Goal

Pipeline agents (and only pipeline agents) must be unable to read, edit, or write files outside their assigned worktree. Today the "isolation" is convention-only: the agent prompt mentions the worktree path, but the SDK's Read/Edit/Write/Bash tools accept any absolute path. Phase-B's B-arm-T-47 run (`dafed796`, 2026-04-24 13:54 local) demonstrated this — the agent received a main-repo absolute path through a Grep result, then used Write with that path and successfully created a file at `/Users/ryanbirkeland/Projects/git-repos/BDE/src/main/agent-manager/__tests__/review-transition.test.ts`. The contamination tripped `assertRepoCleanOrAbort` and deadlocked the pipeline. See `docs/superpowers/rca-2026-04-24/phase-b-results.md` §2.3 and `contamination/` for evidence.

## Files to Change

- `src/main/agent-manager/sdk-adapter.ts` — register a `canUseTool` callback (or equivalent SDK hook) that rejects pipeline tool invocations whose target absolute path escapes the agent's worktree. Apply only when `opts.pipelineTuning` is set; never to adhoc/assistant/copilot/synthesizer (they have their own spawn paths and run outside `~/.bde/worktrees`).
- `src/main/agent-manager/worktree-path-guard.ts` (new) — pure helper `isPathInsideWorktree(absolutePath: string, worktreePath: string): boolean` and `extractAbsolutePathsFromToolInput(toolName: string, input: unknown): string[]` (knows the per-tool input shape: `Read.file_path`, `Edit.file_path`, `Write.file_path`, `Glob.path`, `Grep.path`, `Bash.command` — for Bash, parse for absolute paths). Pure, exhaustively tested.
- `src/main/agent-manager/__tests__/worktree-path-guard.test.ts` (new) — covers each tool input shape, edge cases (relative paths, paths matching the worktree prefix exactly, symlinks via `fs.realpathSync`), and the "no absolute paths" case (allowed).
- `src/main/agent-event-mapper.ts` — emit a structured `agent:error` event when a tool is denied, classified `path_traversal_denied`. The agent sees the rejection in its tool-result stream and can recover (use a relative path within the worktree).

## Acceptance Criteria

- A pipeline agent that calls `Write({ file_path: '/Users/.../BDE/src/main/foo.ts' })` from a worktree at `/Users/.../.bde/worktrees/.../<taskId>/` receives a tool-result error and the file is NOT created in main.
- The same agent calling `Write({ file_path: '/Users/.../.bde/worktrees/.../<taskId>/src/main/foo.ts' })` succeeds (path is inside the worktree).
- A relative path (`Write({ file_path: 'src/main/foo.ts' })`) is unaffected — the SDK resolves it against `cwd`, which is already the worktree.
- `Bash({ command: 'echo hi > /tmp/x' })` is denied (writes outside the worktree). `Bash({ command: 'echo hi > x' })` is allowed.
- Adhoc/assistant/copilot/synthesizer agents are unaffected — no `canUseTool` hook is installed for them.
- The denial emits `agent:error` with `message: 'path_traversal_denied: <tool> attempted to write to <path> outside <worktree>'` so the live log and the Code Review Station can surface it.
- A unit test seeds an `assertRepoCleanOrAbort` scenario and confirms the guard prevents the dirty state.

## How to Test

- `npm run test:main src/main/agent-manager/__tests__/worktree-path-guard.test.ts` — covers the pure helper.
- A second integration test in `src/main/agent-manager/__tests__/sdk-adapter.test.ts` (extend existing or create) mocks the SDK's `canUseTool` invocation surface and asserts that pipeline tuning installs the hook with worktree-scoped behavior.
- `npm run test:main` overall — must pass.
- Manual smoke (post-merge): queue any task, watch agent_events for any `path_traversal_denied` (should be zero on a clean spec).

## Notes

- Confirm the exact SDK hook name in `@anthropic-ai/claude-agent-sdk` (likely `canUseTool` in `Options`). If absent, document an upstream-request follow-up.
- Use `path.resolve` + `path.relative` for containment (reject when relative starts with `..`); resolve symlinks via `fs.realpathSync`.
- `Bash.command` parser: a v1 deny-list of absolute-path tokens (`/...`) is sufficient; document the limitation. This is a guard against accidental contamination, not a sandbox — a prompt-injected agent could still escape via Bash. Real isolation needs OS-level sandboxing (Linux user namespaces, macOS sandbox-exec) and is out of scope.
