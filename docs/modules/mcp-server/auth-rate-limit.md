# auth-rate-limit

**Layer:** mcp-server
**Source:** `src/main/mcp-server/auth-rate-limit.ts`

## Purpose
Progressive-delay rate limit for consecutive 401s on the MCP server. The
bearer token is 256-bit random so brute-force is infeasible, but a
misconfigured client in a tight loop — or a probing attacker — can still
spam `~/.fleet/fleet.log` and burn CPU on every rejection. This module tracks
failed auth attempts per remote address and returns a delay (0 ≤ N ≤
5000 ms) the caller applies before writing the 401.

## Public API
- `createAuthRateLimit(options?)` — returns an `AuthRateLimit` handle. `options` accepts `{ logger?: Logger; now?: () => number }` (the clock is injectable for deterministic tests).
- `AuthRateLimit.recordAuthFailure(remoteAddress)` — records a 401 and returns the delay (ms) the caller should apply before responding. Triggers a one-shot `logger.warn({event:'mcp.auth.brute-force-suspected',…})` when the threshold is first reached.
- `AuthRateLimit.recordAuthSuccess(remoteAddress)` — clears the counter for a remote address (recovering client isn't permanently penalized).
- `AuthRateLimit.size()` — introspection hook; number of tracked remote addresses.
- `computeDelayMs(failureCount)` — pure delay schedule; exported for tests.
- Constants: `BRUTE_FORCE_THRESHOLD` (3), `WINDOW_MS` (60_000), `INITIAL_DELAY_MS` (200), `MAX_DELAY_MS` (5_000).

## Key Dependencies
- `../logger` — `Logger` type for the optional warn hook.

## Wire-up
Wired in Phase 5 alongside T-42. `createTransportHandler(buildMcpServer, token, port, logger, rateLimit?)` accepts an optional `AuthRateLimit` and defaults to a per-handler `createAuthRateLimit({ logger })` when no instance is passed. `transport.ts` calls `recordAuthSuccess(remoteAddress)` on every successful auth and `recordAuthFailure(remoteAddress)` on every 401; the returned delay (if any) is awaited before the 401 envelope is written. The composition root (`index.ts`) may later inject a shared instance if cross-handler visibility is wanted — no signature change required.
