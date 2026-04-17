# credential-service

**Layer:** services
**Source:** `src/main/services/credential-service.ts`

## Purpose

Single discriminated-return entry point for resolving Claude and GitHub credentials. Every new call site should prefer this service over the legacy three check points (`auth-guard.ts`, `agent-manager/oauth-checker.ts`, `env-utils.ts`), which continue to work unchanged. Pre-spawn refresh for pipeline agents and the `gh` PR guard are the first consumers.

## Public API

- `createCredentialService(deps)` — factory. Inject custom `ClaudeCredentialStore` / `GithubCredentialStore` in tests.
- `getDefaultCredentialService(logger)` — module-level singleton for call sites that don't have DI wiring.
- `CredentialService`
  - `getCredential(kind)` — cached resolution (5 min on ok, 30 s on failure).
  - `refreshCredential(kind)` — bypasses cache; use immediately before a spawn.
  - `invalidateCache(kind)` — clears cache entry without re-reading.
- `CredentialResult` — discriminated union on `status: 'ok' | 'missing' | 'expired' | 'keychain-locked' | 'cli-missing'`. The `ok` variant carries `token`, `expiresAt`, `cliFound`. Failure variants carry `actionable` (user-facing guidance string, or `null` when the user opted out).
- `CredentialKind = 'claude' | 'github'`
- `CREDENTIAL_GUIDANCE` — canonical copy map used across toasts, task notes, and spawn-failure messages. Reference this instead of hand-rolling guidance strings.
- `ClaudeCredentialStore` / `GithubCredentialStore` — ports for testing.

## Key Dependencies

- `../auth-guard.ts` — `checkAuthStatus` + `MacOSCredentialStore` (Claude expiry + CLI detection).
- `../env-utils.ts` — `getOAuthToken`, `refreshOAuthTokenFromKeychain` (Claude token file + Keychain refresh).
- `../settings.ts` — reads `githubOptedOut` for the opt-out branch.
- `gh` CLI (via `execFile`) — used by `DefaultGithubStore.isAuthenticated` when no `GH_TOKEN` is set.

## Design reference

Full design rationale and migration notes: `docs/superpowers/specs/credential-service.md`.
