# TQ-S6: Renderer Test Gap Closure (Hooks + Services)

**Epic:** Testing & QA
**Priority:** P1
**Estimate:** Medium
**Type:** Unit Test

---

## Problem

The renderer has good coverage for stores (9/10) and UI primitives (7/7), but several integration-layer modules have no tests:

1. **`hooks/useUnifiedAgents.ts`** (181 LOC) — merges 4 data sources (sessions, subAgents, local processes, history agents) into one unified list. Contains complex timestamp normalization, status mapping, and staleness calculation. A bug here causes agents to appear in the wrong group, with wrong status, or to disappear entirely.

2. **`hooks/useTaskNotifications.ts`** (96 LOC) — fires desktop notifications when sessions become blocked or sprint tasks complete. Contains a hardcoded Supabase anon key (public, but should be tested for presence), polling logic, and a memory-only `seenDoneIds` cache.

3. **`services/git.ts`** (56 LOC), **`services/memory.ts`** (13 LOC), **`services/settings.ts`** (40 LOC) — thin wrappers around `window.api` IPC calls. Low complexity but untested. The `settings.ts` service has a `testConnection()` function that converts WebSocket URLs to HTTP and makes a fetch — this logic should be verified.

4. **`lib/github-api.ts`** (~60 LOC) — GitHub PR integration (list PRs, merge PRs). Uses fetch with Bearer token auth. Untested error handling (rate limits, auth failures, network errors).

---

## Test Plan

### useUnifiedAgents.test.ts

**File to create:** `src/renderer/src/hooks/__tests__/useUnifiedAgents.test.ts`

The hook is already tested at `stores/__tests__/unifiedAgents.test.ts`, but that file exists as a store test. Verify coverage and add missing cases:

#### Test Cases

```
✓ merges sessions into unified agent list with source: "gateway"
✓ merges subAgents with source: "gateway" and parentSessionId
✓ merges local processes with source: "local"
✓ merges history agents (non-running only) with source: "history"
✓ deduplicates agents that appear in multiple sources (same PID)
✓ safeTimestamp handles null → 0
✓ safeTimestamp handles undefined → 0
✓ safeTimestamp handles number → passthrough
✓ safeTimestamp handles ISO string → parsed timestamp
✓ normalizeStatus maps "completed" → "done"
✓ normalizeStatus maps "aborted" → "failed"
✓ normalizeStatus maps unknown string → "unknown"
✓ getStaleLevel returns "fresh" for < 1 hour old
✓ getStaleLevel returns "aging" for 1h-24h old
✓ getStaleLevel returns "stale" for 1d-7d old
✓ getStaleLevel returns "dead" for > 7d old
✓ truncateLabel truncates strings > 80 chars with ellipsis
✓ truncateLabel preserves strings ≤ 80 chars
✓ groupUnifiedAgents groups by status (active, recent, history)
✓ groupUnifiedAgents sorts each group by timestamp descending
```

### useTaskNotifications.test.ts

**File to create:** `src/renderer/src/hooks/__tests__/useTaskNotifications.test.ts`

#### Mocking Strategy

```ts
// Mock Notification API
const mockNotification = vi.fn()
Object.defineProperty(window, 'Notification', {
  value: vi.fn().mockImplementation((title, opts) => mockNotification(title, opts)),
  writable: true
})
Object.defineProperty(Notification, 'permission', { value: 'granted', writable: true })

// Mock fetch for Supabase polling
global.fetch = vi.fn()

// Mock window.api
window.api = { getSupabaseConfig: vi.fn().mockResolvedValue({ url: '...', anonKey: '...' }) }
```

#### Test Cases

```
✓ fires desktop notification when session becomes blocked (status: aborted + not running)
✓ does not fire notification for already-seen blocked sessions
✓ fires notification when sprint task completes
✓ does not fire duplicate notification for same task ID
✓ requests Notification.permission if not granted
✓ does not fire notifications when permission denied
✓ cleans up polling interval on unmount
✓ handles fetch errors gracefully (no crash)
```

### services/settings.test.ts

**File to create:** `src/renderer/src/services/__tests__/settings.test.ts`

#### Test Cases

```
✓ loadConfig calls window.api.getGatewayConfig
✓ saveConfig calls window.api.saveGatewayConfig with (url, token)
✓ testConnection converts ws:// to http:// for fetch
✓ testConnection converts wss:// to https:// for fetch
✓ testConnection returns true on successful response
✓ testConnection returns false on fetch error
✓ testConnection times out after 5 seconds
✓ getRepoPaths calls window.api.getRepoPaths
```

### lib/github-api.test.ts

**File to create:** `src/renderer/src/lib/__tests__/github-api.test.ts`

#### Test Cases

```
✓ listOpenPRs fetches from GitHub API with correct auth header
✓ listOpenPRs returns array of PR objects
✓ listOpenPRs throws on non-200 response
✓ listOpenPRs handles rate limit (403) with descriptive error
✓ mergePR sends PUT to correct merge endpoint
✓ mergePR returns merge result
✓ mergePR handles merge conflict (409) gracefully
```

---

## Files to Create

| File                                                            | Purpose                      | Estimated LOC |
| --------------------------------------------------------------- | ---------------------------- | ------------- |
| `src/renderer/src/hooks/__tests__/useUnifiedAgents.test.ts`     | Hook merge/group/stale logic | ~120          |
| `src/renderer/src/hooks/__tests__/useTaskNotifications.test.ts` | Notification lifecycle       | ~80           |
| `src/renderer/src/services/__tests__/settings.test.ts`          | Settings service wiring      | ~60           |
| `src/renderer/src/lib/__tests__/github-api.test.ts`             | GitHub API wrapper           | ~70           |

## Files to Modify

None — tests only.

---

## Implementation Notes

- **useUnifiedAgents may already be partially covered** by `stores/__tests__/unifiedAgents.test.ts`. Check existing coverage before duplicating. If the existing file already covers the pure functions (`safeTimestamp`, `normalizeStatus`, `getStaleLevel`), focus the new test on the hook's data merge behavior using `renderHook()`.
- **useTaskNotifications uses `renderHook()`** from `@testing-library/react` for testing React hooks.
- **Supabase polling in useTaskNotifications** — the hook fetches directly from Supabase (not through gateway). Mock `global.fetch` for this.
- **github-api.ts** — mock `global.fetch` and verify Authorization header includes the token.
- Services are thin wrappers — tests are quick but catch IPC wiring regressions.

## Acceptance Criteria

- [ ] All pure functions in useUnifiedAgents tested (safeTimestamp, normalizeStatus, getStaleLevel, truncateLabel)
- [ ] Hook data merge behavior verified with mock store data
- [ ] Desktop notification lifecycle tested (fire, dedup, permission, cleanup)
- [ ] Settings service URL conversion (ws:// → http://) tested
- [ ] GitHub API auth header and error handling tested
- [ ] All tests run via `npm test` (jsdom environment)
