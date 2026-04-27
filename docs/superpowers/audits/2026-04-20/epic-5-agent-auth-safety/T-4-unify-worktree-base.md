# T-4 · Unify worktree base path and thread live config through

**Severity:** P1 · **Audit lenses:** clean-code, architecture

## Context

`src/main/agent-manager/sdk-adapter.ts:30-33` declares `ALLOWED_WORKTREE_BASES` containing both `DEFAULT_CONFIG.worktreeBase` (lowercase `~/worktrees/fleet`) and a hardcoded `${homedir()}/worktrees/FLEET` (uppercase). The comment concedes this is to match the current layout — meaning two places in the repo disagree on the canonical base. The allowlist also ignores the user's configured `agentManager.worktreeBase` (editable in Settings); if a user changes it, pipeline spawns throw `"Refusing to spawn agent: cwd ... is not inside any allowed worktree base"`.

## Files to Change

- `src/main/agent-manager/sdk-adapter.ts` (lines 30–47 — `ALLOWED_WORKTREE_BASES`, `isInsideAllowedWorktreeBase`, `assertCwdIsInsideWorktreeBase`)
- `src/main/agent-manager/spawn-sdk.ts` / `spawn-cli.ts` — confirm the cwd they pass matches the same convention.
- `src/main/agent-manager/worktree.ts` — confirm worktree creation uses the same configured base.
- `src/main/agent-manager/types.ts` — `DEFAULT_CONFIG.worktreeBase` value.
- Any place in the repo that references `~/worktrees/FLEET` (uppercase) — grep and reconcile.

## Implementation

1. Decide the canonical convention. Match what exists on disk today — the uppercase form is observably in use. Update `DEFAULT_CONFIG.worktreeBase` to match: `${homedir()}/worktrees/FLEET/Users-<username>-projects-FLEET` (or the exact prefix pattern documented in CLAUDE.md). If the configured base is already correct, verify.

2. Replace `ALLOWED_WORKTREE_BASES` with a function that accepts the live `worktreeBase` from `AgentManagerConfig`:

```ts
function buildAllowedWorktreeBases(configuredBase: string): readonly string[] {
  return [configuredBase]
}

function isInsideAllowedWorktreeBase(cwd: string, configuredBase: string): boolean {
  const resolved = resolvePath(cwd)
  return resolved.startsWith(resolvePath(configuredBase) + '/')
}
```

3. Thread the configured base through to `assertCwdIsInsideWorktreeBase`. This means `spawnAgent` (and the CLI variant) must accept the `AgentManagerConfig` or the `worktreeBase` string explicitly. Do not read from a module-level snapshot.

4. Update callers of `spawnAgent` to pass the config.

5. Grep for `worktrees/FLEET` and `worktrees/fleet` across the repo; reconcile each hit with the canonical convention. Update comments, docs, and tests.

6. Update CLAUDE.md §"Key File Locations" — the "Pipeline agent worktrees" line — to match whatever convention is picked. There must be exactly one documented convention.

## How to Test

```bash
npm run typecheck
npm run test:main -- agent-manager
npm run lint
```

Manual: change `agentManager.worktreeBase` in Settings to a custom path; restart; queue a task; confirm spawn succeeds into the configured base (not the default).

## Acceptance

- `ALLOWED_WORKTREE_BASES` (or equivalent) is driven by the live `AgentManagerConfig`, not a module snapshot.
- The repo contains exactly one canonical worktree-base convention (case-correct, documented in CLAUDE.md).
- `grep -rn "worktrees/FLEET\|worktrees/fleet" src/ docs/ CLAUDE.md` shows no inconsistencies.
- Manual spawn with a custom `worktreeBase` setting works.
- Full suite green.
