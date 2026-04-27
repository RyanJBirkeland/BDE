## 1. Production Code — message-consumer.ts

- [x] 1.1 Export `OAuthRefreshFailedError extends Error` from `message-consumer.ts` with a descriptive default message (e.g., `'OAuth refresh failed after auth error — stream aborted'`)
- [x] 1.2 Convert `handleOAuthRefresh` to `async`, remove the fire-and-forget comment, `await refreshOAuthTokenFromKeychain()`, and return `boolean` (`true` = token written, `false` = refresh failed or threw)
- [x] 1.3 In the `catch` block of `consumeMessages`, replace the synchronous `handleOAuthRefresh` call with `await handleOAuthRefresh(...)` and branch on its return value:
  - On `true`: call `onOAuthRefreshStart?.(Promise.resolve())`, flush the batcher, and return `{ exitCode, lastAgentOutput, pendingPlaygroundPaths }` (no `streamError`)
  - On `false`: call `handle.abort()`, emit `agent:error` event with `'Stream interrupted: OAuth refresh failed...'`, call `onOAuthRefreshStart?.(Promise.resolve())`, flush the batcher, and return `{ exitCode, lastAgentOutput, streamError: new OAuthRefreshFailedError(), pendingPlaygroundPaths }`
- [x] 1.4 Handle the case where `refreshOAuthTokenFromKeychain` throws inside `handleOAuthRefresh` — catch internally, log via `logError`, and return `false` so the caller always gets a `boolean`

## 2. Tests — message-consumer.test.ts

- [x] 2.1 Update `vi.mock('../../env-utils', ...)` to also expose a `refreshOAuthTokenFromKeychain` spy that can be configured per-test (default: `mockResolvedValue(true)`)
- [x] 2.2 Update the existing `'invalidates OAuth token on Invalid API key error'` test to also assert that `refreshOAuthTokenFromKeychain` was called and awaited (i.e., result returns before asserting the mock call)
- [x] 2.3 Add test: auth error + refresh succeeds (`refreshOAuthTokenFromKeychain` resolves `true`) → `result.streamError` is `undefined`
- [x] 2.4 Add test: auth error + refresh returns `false` → `result.streamError instanceof OAuthRefreshFailedError`, `handle.abort()` called, `emitAgentEvent` called with `agent:error`, `flushAgentEventBatcher` called
- [x] 2.5 Add test: auth error + refresh throws → same assertions as 2.4 (abort + `OAuthRefreshFailedError` + event)
- [x] 2.6 Add test: `onOAuthRefreshStart` callback is called on refresh success
- [x] 2.7 Add test: `onOAuthRefreshStart` callback is called on refresh failure
- [x] 2.8 Add test: `onOAuthRefreshStart` absent (undefined) on auth error — `consumeMessages` completes without throwing

## 3. Verification

- [x] 3.1 Run `npm run typecheck` — zero errors
- [x] 3.2 Run `npm test` — all tests pass (including new and updated message-consumer tests)
- [x] 3.3 Run `npm run lint` — zero errors
- [x] 3.4 Update `docs/modules/agent-manager/index.md` — add `OAuthRefreshFailedError` to the `message-consumer` row's Public API column
