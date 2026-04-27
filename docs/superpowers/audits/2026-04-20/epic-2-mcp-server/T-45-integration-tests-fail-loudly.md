# T-45 · Make MCP integration tests fail loudly when preconditions are absent

**Severity:** P0 · **Audit lens:** testing

## Context

`src/main/mcp-server/mcp-server.integration.test.ts:65` contains `if (!fleetConfigured) { console.warn(...); return }`. When the `fleet` repo is not configured in settings (which is the default on a clean CI checkout), the test silently passes without running any assertions. `src/main/mcp-server/parity.integration.test.ts:61` has the same pattern via `it.runIf(hasFleetRepo)`. This violates F.I.R.S.T. 'Self-validating' — a green check does not prove round-trip works. An audit found the test was silently skipping on CI.

## Files to Change

- `src/main/mcp-server/mcp-server.integration.test.ts` (line 65 — remove early return)
- `src/main/mcp-server/parity.integration.test.ts` (line 61 — remove `it.runIf` skip)
- `src/main/mcp-server/test-setup.ts` (new or existing) — seed a `fleet` repo config in a temp DB

## Implementation

Option A (preferred): seed the repo in test setup so the precondition is always met.

Create or extend `src/main/mcp-server/test-setup.ts` with a `seedFleetRepo(db)` helper that inserts a `repos` setting via `setSettingJson`:

```ts
export function seedFleetRepo(db: Database.Database): void {
  setSettingJson(db, 'repos', [
    {
      name: 'fleet',
      localPath: process.cwd(),
      githubOwner: 'test',
      githubRepo: 'fleet',
      color: '#00ff88'
    }
  ])
}
```

In both integration test files, call `seedFleetRepo(db)` inside `beforeAll` (or the existing setup hook) using the same in-memory or temp DB the tests already spin up. Remove the `if (!fleetConfigured) return` at line 65 and the `it.runIf(hasFleetRepo)` at line 61.

Option B (if seeding is genuinely infeasible for a specific test): replace the silent `return` with `throw new Error('Integration test precondition failed: fleet repo missing from settings')`. The test then fails loudly rather than pretending success. Use this only if the test needs a real, user-configured repo with remote access — in which case it is not an integration test, it's a manual smoke test, and should move to `e2e/`.

Audit the whole file for other silent-skip patterns (`if (!x) return`, `it.skipIf`, `test.skip`). Apply the same fix.

## How to Test

```bash
npm run typecheck
npm run test:main -- mcp-server.integration
npm run test:main -- parity.integration
npm run lint
```

Sanity: run the full suite on a clean checkout (no `repos` in settings) and confirm these tests run and pass (not skip).

## Acceptance

- Neither integration test silently no-ops on missing preconditions.
- A `seedFleetRepo` (or equivalent) helper exists and is called from setup.
- `it.runIf(hasFleetRepo)` and `if (!fleetConfigured) return` patterns removed.
- Both tests run and pass on a fresh checkout.
- Full suite green.
