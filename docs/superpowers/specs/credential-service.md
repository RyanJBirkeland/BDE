# CredentialService — Unified credential resolution

**Status:** Draft
**Owner:** FLEET main process
**Scope:** Consolidate the three existing Claude/GitHub credential-check sites into a single injectable service with a discriminated return type.
**Source:** PLAN.md T2.1 (Phase 2 — Credential Handoff Unification). Addresses findings F-t3-credentials-1, -2, -3, -4, -7, -8, -9, -11.

---

## Problem

Three separate modules check the same credentials with subtly different semantics:

| Module | Entry point | Caller | Returns | Side effects |
|---|---|---|---|---|
| `src/main/auth-guard.ts` | `checkAuthStatus()` / `ensureSubscriptionAuth()` | `auth:status` IPC (Onboarding UI) | `AuthStatus { cliFound, tokenFound, tokenExpired, expiresAt? }` / throws `Error` | None |
| `src/main/agent-manager/oauth-checker.ts` | `checkOAuthToken()` | Drain-loop precondition | `boolean` | Proactively refreshes Keychain if token file >45min old |
| `src/main/env-utils.ts` | `getOAuthToken()` / `refreshOAuthTokenFromKeychain()` / `buildAgentEnvWithAuth()` | `adhoc-agent.ts`, `sdk-adapter.ts` | `string | null` token / boolean / env object | Writes rotated Keychain credentials; writes `~/.fleet/oauth-token`; broadcasts `manager:warning` on repeated Keychain failures |

Each site caches independently (5min/30s, 30s, 1s Keychain rate-limit), formats error messages differently, and decides independently whether to refresh. None of them handle GitHub credentials — `GH_TOKEN` / `GITHUB_TOKEN` / `gh auth status` live in handlers and onboarding step components.

The concrete failures the lens audit documented:

1. **No single source of truth** — three check sites mean three places to patch when auth semantics change.
2. **Inconsistent error surfacing** — drain-loop silently skips, auth-guard throws, env-utils returns `null`. Users see different (or no) guidance depending on which path failed.
3. **Pipeline spawn race (V0.6, partial)** — pipeline `spawn-and-wire.ts` trusts the drain-loop precondition cache (5min TTL) and does not re-refresh before calling the SDK. Adhoc does.
4. **GitHub auth not enforced** — onboarding's GhStep is purely informational; PR-requiring tasks fail deep inside `gh pr create` with cryptic messages.

## Goals

- One module owns credential resolution. Every other site calls it.
- Callers choose what they need from a single return shape: pass-fail boolean (drain-loop), full status (UI), actual token string (spawn).
- Refresh semantics centralized — one place decides when to hit the Keychain.
- GitHub credentials handled alongside Claude under the same contract.
- No behavior change for the happy path — this is a refactor plus the pre-spawn refresh fix from V0.6.

## Non-goals

- Introducing a new persistence layer (Keychain stays the source of truth for Claude; `gh` CLI + env vars stay for GitHub).
- Replacing the OAuth refresh HTTP flow in `env-utils.ts` — it stays, just moves behind the service.
- Changing the IPC shape of `auth:status` — existing renderer consumers are not refactored in this task.

---

## API

```ts
// src/main/services/credential-service.ts

export type CredentialKind = 'claude' | 'github'

export type CredentialResult =
  | {
      kind: CredentialKind
      status: 'ok'
      token: string
      expiresAt: Date | null
      cliFound: boolean
    }
  | {
      kind: CredentialKind
      status: 'missing' | 'expired' | 'keychain-locked' | 'cli-missing'
      token: null
      expiresAt: null
      cliFound: boolean
      actionable: string  // concrete next step, e.g. "Run: claude login"
    }

export interface CredentialService {
  /**
   * Resolve the credential for `kind`. Reads from the cache when possible;
   * refreshes from the Keychain / gh CLI when stale; returns a discriminated
   * result describing exactly what the caller should do.
   */
  getCredential(kind: CredentialKind): Promise<CredentialResult>

  /**
   * Force-refresh the credential from the underlying source and return the
   * fresh result. Use this immediately before a spawn when the cached
   * result must not be trusted (V0.6).
   */
  refreshCredential(kind: CredentialKind): Promise<CredentialResult>

  /**
   * Invalidate the cache for `kind` without re-reading. Cheap — use after
   * an auth failure in a live stream so the next check re-validates.
   */
  invalidateCache(kind: CredentialKind): void
}

export function createCredentialService(deps: {
  logger: Logger
  claudeStore?: ClaudeCredentialStore   // default: MacOSCredentialStore from auth-guard
  githubStore?: GithubCredentialStore    // default: GhCliCredentialStore (new)
}): CredentialService
```

### Cache semantics

- Success: cached for **5 minutes**.
- Failure: cached for **30 seconds** (recover quickly when user runs `claude login`).
- Proactive refresh: if cached token's `expiresAt` is within 5 minutes of now, service refreshes on the next `getCredential()` call before returning.

### GitHub resolution order

1. `GH_TOKEN` env var — if present and non-empty, return `status: 'ok'`, skip other checks. Matches `gh` CLI's own precedence.
2. `GITHUB_TOKEN` env var — same.
3. `gh auth status --active 2>&1` — zero exit + token format detected = ok. Non-zero or missing binary = `status: 'missing'` with actionable `Run: gh auth login`.
4. `settings.githubOptedOut === true` (new setting) — return a synthetic `status: 'missing'` with `actionable: null` so callers know GitHub is intentionally off.

### Actionable messages (canonical copy)

| Status | Kind | Message |
|---|---|---|
| `missing` | `claude` | `Run: claude login` |
| `missing` | `github` | `Run: gh auth login` |
| `expired` | `claude` | `Run: claude login to refresh your session` |
| `expired` | `github` | `Run: gh auth refresh` |
| `keychain-locked` | `claude` | `macOS Keychain is locked — unlock it and try again` |
| `cli-missing` | `claude` | `Install Claude Code CLI and add it to your PATH` |
| `cli-missing` | `github` | `Install the GitHub CLI (gh) and add it to your PATH` |

Store these in `CREDENTIAL_GUIDANCE` constants next to the service so UI, IPC, and spawn-failure code all surface identical copy.

## Migration

### Sites to replace (Claude)

| Before | After |
|---|---|
| `auth-guard.ts → ensureSubscriptionAuth()` | `credentialService.getCredential('claude')` + throw if not `'ok'` |
| `auth-guard.ts → checkAuthStatus()` (for `auth:status` IPC) | Same — returns `AuthStatus` synthesized from `getCredential('claude')` result. Legacy signature preserved for the renderer. |
| `oauth-checker.ts → checkOAuthToken()` | `credentialService.getCredential('claude')` and check `result.status === 'ok'` |
| `env-utils.ts → getOAuthToken()` | `credentialService.getCredential('claude')` then read `.token` |
| `env-utils.ts → refreshOAuthTokenFromKeychain()` | Moves inside the service as a private helper. Still called by `message-consumer.ts` on auth-error — now via `credentialService.refreshCredential('claude')`. |
| `env-utils.ts → buildAgentEnvWithAuth()` | Keeps the same signature, internally calls `credentialService.getCredential('claude')`. |

### Sites to add (Claude pre-spawn, V0.6)

| Site | Change |
|---|---|
| `src/main/agent-manager/spawn-and-wire.ts` | Before `spawnWithTimeout(...)`: call `credentialService.refreshCredential('claude')`. If `result.status !== 'ok'`, reject with a structured error that includes `result.actionable` as the user-facing message. Matches what `adhoc-agent.ts:93` already does. |

### Sites to add (GitHub)

| Site | Change |
|---|---|
| `src/main/handlers/operational-checks-handlers.ts` | New check: `github-auth` returning the same `CredentialResult` shape (UI shows `actionable`). |
| `src/main/agent-manager/pr-operations.ts` | Before any `gh pr create`-like call: `credentialService.getCredential('github')`. On non-ok, throw with `actionable` so the task failure note is specific. |
| New setting: `settings.githubOptedOut` (`boolean`, default `false`) | Surfaced in Onboarding GhStep's "Skip GitHub (read-only mode)" button. When true, PR-requiring handlers return a structured error before spawning `gh`, and Task Workbench / Code Review render a dismissable banner. |

## Error propagation

- Drain-loop continues to log and skip the tick — but now the log line includes `result.actionable` so the user sees the same message everywhere.
- `auth:status` IPC still returns the legacy `AuthStatus` shape; renderer unchanged for this phase.
- Spawn failures include `result.actionable` in the task's `notes` field (failure-classifier surfaces it).
- Review actions that call `gh` include the GitHub actionable message in their toast on failure (renderer's `useManagerEventListener` surfaces it — no new hook needed).

## Testing

The service is a pure TypeScript class; tests inject mock `ClaudeCredentialStore` / `GithubCredentialStore` and exercise every branch of the discriminated union.

Required matrix:

| Scenario | Expected |
|---|---|
| Keychain locked | `status: 'keychain-locked'` |
| No token on disk, no Keychain entry | `status: 'missing'` |
| Token on disk, Keychain valid, not expired | `status: 'ok'` |
| Token on disk but expired, refresh succeeds | `status: 'ok'` after one Keychain hit |
| Token on disk but expired, refresh fails | `status: 'expired'` |
| Corrupt token file (symlink, too-large, wrong mode) | `status: 'missing'` with specific actionable |
| `GH_TOKEN` set | GitHub `status: 'ok'` without touching `gh` |
| `gh auth status` exits non-zero | GitHub `status: 'missing'` |
| `githubOptedOut: true` | GitHub `status: 'missing'`, `actionable: null` |
| `refreshCredential` + failing refresh | returns the fresh failure, replaces cache |

Integration: drain-loop no-op when service returns non-ok; adhoc + pipeline spawn both hit the refresh path before calling the SDK (remove the existing `refreshOAuthTokenFromKeychain()` call from `adhoc-agent.ts:93` — that responsibility moves to the service).

## Rollout

Must land as one PR. Three old check sites need to be removed together to avoid regressions. Order within the PR:

1. Add `credential-service.ts` + tests.
2. Update `auth-guard.ts` to delegate to the service (preserve its exported signatures).
3. Update `oauth-checker.ts` to delegate to the service (preserve its exported signature for drain-loop's existing call site).
4. Update `env-utils.ts` to delegate `getOAuthToken` / `refreshOAuthTokenFromKeychain` to the service.
5. Wire `spawn-and-wire.ts` pre-spawn refresh.
6. Add `githubOptedOut` setting + GhStep skip button + PR-handler guard (T2.3).

After verification, no old entry point deletes — the wrapper functions stay as thin shims so existing call sites compile unchanged. A follow-up cleanup PR can inline the shims.

## Open questions (to resolve during T2.2)

- Is there a real Linux / Windows credential path to design for now, or does FLEET stay macOS-only through Phase 2? (Current answer from audit scope: macOS only.)
- Does the `auth:status` IPC need to carry a new `kind: 'claude' | 'github'` field so one call reports both? Pragmatic: keep `auth:status` Claude-only and add `onboarding:checkGhCli` for the GitHub branch (already exists).
