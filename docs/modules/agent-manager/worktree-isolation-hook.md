# worktree-isolation-hook

**Layer:** agent-manager
**Source:** `src/main/agent-manager/worktree-isolation-hook.ts`

## Purpose
Enforce at tool-use time that a pipeline agent's Bash / Edit / Write /
MultiEdit / NotebookEdit calls stay inside its assigned worktree.
Replaces the prompt-level "don't cd out of your worktree" rule with a
structural gate.

## Public API
- `createWorktreeIsolationHook(deps): CanUseTool` — returns a
  `@anthropic-ai/claude-agent-sdk` `CanUseTool` callback. `deps` has
  `worktreePath` (the agent's cwd), `mainRepoPaths` (absolute paths to
  every configured primary repo checkout), and optional `logger`.
- `WorktreeIsolationDeps` — dependency interface consumed by the
  factory.

## Key Dependencies
- `@anthropic-ai/claude-agent-sdk` — for the `CanUseTool` type.
- `node:path` — for absolute-path normalization (`resolve`).
- `../logger` — optional `Logger` type passed through to emit deny warnings.

## Notes
The Bash scanner tokenizes on whitespace + common shell operators (it is not a
real shell parser). Creatively-obfuscated commands (e.g., `$(echo /Users/...)`)
may slip through. This is acceptable for the intended threat model (honest
agent mistakes, not adversarial evasion).
