# auth-rate-limit

**Layer:** mcp-server
**Source:** `src/main/mcp-server/auth-rate-limit.ts`

## Purpose
Progressive-delay rate limit for consecutive 401s on the MCP server. The
bearer token is 256-bit random so brute-force is infeasible, but a
misconfigured client in a tight loop — or a probing attacker — can still
spam `~/.bde/bde.log` and burn CPU on every rejection. This module tracks
failed auth attempts per remote address and returns a delay (0 ≤ N ≤
5000 ms) the caller applies before writing the 401.

## Public API
- `createAuthRateLimit(options?)` — returns an `AuthRateLimit` handle. `options` accepts `{ logger?: Logger; now?: () => number }` (the clock is injectable for deterministic tests).
- `AuthRateLimit.recordAuthFailure(remoteAddress)` — records a 401 and returns the delay (ms) the caller should apply before responding. Triggers a one-shot `logger.warn({event:'mcp.auth.brute-force-suspected',…})` when the threshold is first reached.
- `AuthRateLimit.recordAuthSuccess(remoteAddress)` — clears the counter for a remote address (recovering client isn't permanently penalized).
- `AuthRateLimit.size()` — introspection hook; number of tracked remote addresses.
- `computeDelayMs(failureCount)` — pure delay schedule; exported for tests.
- Constants: `BRUTE_FORCE_THRESHOLD` (10), `WINDOW_MS` (60_000), `INITIAL_DELAY_MS` (200), `MAX_DELAY_MS` (5_000).

## Key Dependencies
- `../logger` — `Logger` type for the optional warn hook.

## Wire-up note
As of Phase 4, the module + tests are landed. The call sites in
`transport.ts` (invoke on every 401, invoke `recordAuthSuccess` on 200)
are pending — the transport file is owned by a different agent this phase
and the call-site glue is scheduled for Phase 5 alongside T-42 (auth
failure structured logging).
