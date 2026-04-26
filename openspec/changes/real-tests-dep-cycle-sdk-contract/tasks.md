## 1. dependency-graph integration tests

- [x] 1.1 Create `src/main/services/__tests__/dependency-graph.test.ts` — import `validateDependencyGraph`, `DependencyGraph`, `createDependencyIndex` directly from `../../services/dependency-graph` (no mocks)
- [x] 1.2 Add test: linear chain A → B → C returns `{ valid: true }` from `validateDependencyGraph`
- [x] 1.3 Add test: empty proposed deps returns `{ valid: true }` from `validateDependencyGraph`
- [x] 1.4 Add test: self-cycle A → A returns `{ valid: false, cycle: ['A', 'A'] }`
- [x] 1.5 Add test: two-node cycle A → B → A returns `{ valid: false }` with `cycle` containing both A and B
- [x] 1.6 Add test: deep three-node cycle A → B → C → A returns `{ valid: false }` with `cycle` containing A
- [x] 1.7 Add test: diamond shape (A→B, A→C, B→D, C→D) returns `{ valid: true }`
- [x] 1.8 Add test: unknown dep id returns `{ valid: false }` with `error` field containing the missing id
- [x] 1.9 Add test: `DependencyGraph.update()` — build graph with T→A (done), call `update('T', [{ id: 'B', type: 'hard' }])`, assert `areDependenciesSatisfied` reflects new dep B (active → not satisfied)
- [x] 1.10 Add test: `DependencyGraph.update('T', null)` removes T from A's dependents set (getDependents returns empty for A)
- [x] 1.11 Run `npm test` and confirm new file passes with zero failures

## 2. SDK wire-protocol contract tests

- [x] 2.1 Create `src/main/agent-manager/__tests__/spawn-sdk-contract.test.ts` — import `spawnViaSdk` from `../spawn-sdk` directly; do NOT use `vi.mock('@anthropic-ai/claude-agent-sdk')`
- [x] 2.2 Add module mocks for env/path utilities only: `vi.mock('../../env-utils', ...)`, `vi.mock('../resolve-node', ...)`, `vi.mock('../paths', ...)`, `vi.mock('../worktree-isolation-hook', ...)`
- [x] 2.3 Write `makeMockSdk(messages)` helper — returns an object with a `query()` method that yields the given `SDKWireMessage[]` values from a real async generator; no `vi.fn()` for the generator itself
- [x] 2.4 Add test: session_id extracted from first system message — stream `[{ type: 'system', session_id: 'real-abc' }, { type: 'exit_code', exit_code: 0 }]`, consume messages, assert `handle.sessionId === 'real-abc'`
- [x] 2.5 Add test: sessionId stays as UUID fallback when no message has session_id — stream `[{ type: 'exit_code', exit_code: 0 }]`, assert `handle.sessionId` matches UUID regex
- [x] 2.6 Add test: sessionId NOT overwritten by second message — stream `[{ type: 'system', session_id: 'first' }, { type: 'system', session_id: 'second' }]`, consume both, assert `handle.sessionId === 'first'`
- [x] 2.7 Add test: `abort()` sets `AbortController.signal.aborted` — capture the AbortController by having `makeMockSdk` accept and expose it, or spy on `AbortController.prototype.abort`; call `handle.abort()`, assert `aborted === true`
- [x] 2.8 Add test: `steer()` returns `{ delivered: false, error: 'SDK mode does not support steering' }`
- [x] 2.9 Add test: rate-limit message `{ type: 'system', subtype: 'rate_limit' }` appears in collected messages from `handle.messages`
- [x] 2.10 Add test: non-object message (number `42`) passes through `handle.messages` without throwing
- [x] 2.11 Run `npm test` and confirm new file passes with zero failures; verify `sdk-message-protocol.ts` is not mocked anywhere in the file
