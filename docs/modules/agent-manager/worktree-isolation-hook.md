# worktree-isolation-hook

**Layer:** agent-manager
**Source:** `src/main/agent-manager/worktree-isolation-hook.ts`

## Purpose
Default-deny gate that sits between a pipeline agent's SDK session and the
host filesystem. Any `Bash` command or `Write`/`Edit`/`MultiEdit`/`NotebookEdit`
call targeting an absolute path outside the agent's worktree is rejected
unless that path is explicitly on the allowlist. Replaces the prompt-level
"don't cd out of your worktree" rule with a structural guard and closes
the audit-flagged exposure where only main-repo paths were blocked.

## Public API
- `createWorktreeIsolationHook(deps): CanUseTool` — returns a
  `@anthropic-ai/claude-agent-sdk` `CanUseTool` callback.
- `WorktreeIsolationDeps` — dependency interface:
  - `worktreePath: string` — absolute path to the agent's cwd.
  - `mainRepoPaths: readonly string[]` — absolute paths to primary repo
    checkouts; used to tailor the deny message with "main checkout path"
    wording when that's what was hit.
  - `extraAllowedPaths?: readonly string[]` — absolute paths outside the
    worktree that the agent is still permitted to read/write (e.g.
    `FLEET_MEMORY_DIR`). Everything not in the worktree and not on this
    allowlist is denied.
  - `logger?: Logger` — optional; `warn` called on every deny with tool
    name and offending path.

## Key Dependencies
- `@anthropic-ai/claude-agent-sdk` — for the `CanUseTool` type.
- `node:path` — for absolute-path normalization (`resolve`).
- `../logger` — optional `Logger` type passed through to emit deny warnings.

## Notes
The Bash scanner tokenizes on whitespace + common shell operators (it is not a
real shell parser). Creatively-obfuscated commands (e.g., `$(echo /Users/...)`)
may slip through. This is acceptable for the intended threat model
(honest agent mistakes and direct prompt-injection payloads, not
adversarial evasion). The allow branch echoes the model's input back as
`updatedInput` so MCP tools with required fields don't lose their args.
