# T-1 · Resolve `MAX_TURNS` 20→100 bump (tests, docs, CLAUDE.md)

**Severity:** P0 · **Audit lenses:** clean-code, testing, architecture, performance

## Context

`src/main/agent-manager/spawn-sdk.ts:18` has an uncommitted change raising `MAX_TURNS` from 20 to 100. This breaks two existing tests (`spawn-sdk.test.ts:89`, `sdk-adapter.test.ts:29`) that assert the constant equals 20. It also contradicts the JSDoc on lines 13–17 ("defense against runaway loops") and CLAUDE.md §"Agent spawning" which still documents `maxTurns: 20` as enforced for pipeline agents. As-is, this change fails CI. Either revert the bump or commit to 100 and update the supporting artifacts.

## Files to Change

- `src/main/agent-manager/spawn-sdk.ts` (line 18 — the constant itself, plus the JSDoc above it)
- `src/main/agent-manager/__tests__/spawn-sdk.test.ts` (line 89 — expected value)
- `src/main/agent-manager/__tests__/sdk-adapter.test.ts` (line 29 — expected value)
- `src/main/__tests__/run-agent-cleanup.test.ts` (line 67 — `vi.mock` literal `MAX_TURNS: 20`)
- `CLAUDE.md` (§"Agent spawning" reference to `maxTurns: 20`)

## Implementation

Decide on the final value (recommended: revert to 20 — there is no production justification for 100 visible in the diff). Apply the chosen value to `MAX_TURNS` and update the JSDoc to explain the rationale.

Update the three test files to match. For the `run-agent-cleanup.test.ts` mock, import the real constant from `../agent-manager/spawn-sdk` and re-export it in the mock rather than hardcoding a literal — this prevents the mock from masking future drift.

Update CLAUDE.md §"Agent spawning" to reflect the chosen value.

## How to Test

```bash
npm run typecheck
npm test -- spawn-sdk
npm run test:main -- sdk-adapter
npm run test:main -- run-agent-cleanup
npm test && npm run test:main
```

All four targeted test runs must pass. The full suite must pass.

## Acceptance

- `MAX_TURNS` has an explicit justification in its JSDoc that matches the chosen value.
- `spawn-sdk.test.ts`, `sdk-adapter.test.ts`, and `run-agent-cleanup.test.ts` pass with the chosen value.
- `run-agent-cleanup.test.ts` no longer hardcodes `MAX_TURNS: 20` — it imports or re-exports the real value so drift is caught.
- CLAUDE.md §"Agent spawning" matches.
- `npm run typecheck && npm test && npm run test:main && npm run lint` all green.
