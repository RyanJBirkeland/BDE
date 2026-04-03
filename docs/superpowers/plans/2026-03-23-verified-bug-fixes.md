# Verified Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 verified bugs spanning agent_run_id persistence, git push error handling, swallowed errors, auth-guard safety, raw SQL leaks, and priority default mismatch.

**Architecture:** All fixes are isolated, single-file changes (except Task 1 which touches agent-manager + its test). Each task is independently shippable. TDD approach — write failing test first, then fix.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Supabase client, Electron IPC

**Ref:** Bugs verified on 2026-03-23 against current `main` (post PR #328).

---

### Task 1: Persist agent_run_id after agent spawn (FC-S1)

**Context:** AgentManager creates `agentRunId` (line 188) and stores it in the in-memory `ActiveAgent` object, but never calls `updateTask()` to persist it to Supabase. After app restart, LogDrawer can't find the agent's log because the link is missing.

**Files:**

- Modify: `src/main/agent-manager/index.ts:200-202`
- Test: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

In `index.test.ts`, add a test that asserts `updateTask` is called with `agent_run_id` after a successful spawn:

```typescript
it('persists agent_run_id to task after spawn', async () => {
  // Use existing test helpers to trigger a drain cycle with a queued task
  // After the agent spawns, assert:
  expect(mockUpdateTask).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ agent_run_id: expect.any(String) })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- --grep "persists agent_run_id"`
Expected: FAIL — `updateTask` is never called with `agent_run_id`

- [ ] **Step 3: Implement the fix**

In `src/main/agent-manager/index.ts`, after line 201 (`activeAgents.set(task.id, agent)`), add:

```typescript
// Persist agent_run_id so LogDrawer can find logs after restart
await updateTask(task.id, { agent_run_id: agentRunId }).catch((err) =>
  logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- --grep "persists agent_run_id"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run test:main`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: persist agent_run_id to sprint task after spawn (FC-S1)"
```

---

### Task 2: Fix gitPush() silent failure regression (FC-S2)

**Context:** `gitPush()` in `git.ts` was converted from sync to async but the error path needs verification. Node's `util.promisify(execFile)` DOES reject on non-zero exit, so the function throws — but the error message is a raw Node error, not a descriptive git-push-specific message. The agent-manager's `completion.ts` calls `execFile` directly (not `gitPush()`), so this mainly affects future callers.

**Files:**

- Modify: `src/main/git.ts:89-96`

- [ ] **Step 1: Verify current behavior**

Read `src/main/git.ts` imports to confirm which `execFileAsync` is used. Node's `promisify(execFile)` rejects with an error that includes `stderr` — the function does throw on failure. However, add explicit error wrapping for clarity.

- [ ] **Step 2: Add descriptive error wrapping**

Replace lines 89-96:

```typescript
export async function gitPush(cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['push'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    return (stdout + stderr).trim() || 'Pushed successfully'
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`git push failed in ${cwd}: ${msg}`)
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/git.ts
git commit -m "fix: add descriptive error wrapping to gitPush (FC-S2)"
```

---

### Task 3: Log pruneLoop errors instead of swallowing

**Context:** In `agent-manager/index.ts:464`, `pruneLoop().catch(() => {})` silently swallows errors. This is inconsistent — `orphanLoop()` on line 463 was fixed in PR #328 to log, but `pruneLoop()` was missed.

**Files:**

- Modify: `src/main/agent-manager/index.ts:464`

- [ ] **Step 1: Apply the one-line fix**

Change line 464 from:

```typescript
pruneTimer = setInterval(() => {
  pruneLoop().catch(() => {})
}, WORKTREE_PRUNE_INTERVAL_MS)
```

to:

```typescript
pruneTimer = setInterval(() => {
  pruneLoop().catch((err) => logger.warn(`[agent-manager] Prune loop error: ${err}`))
}, WORKTREE_PRUNE_INTERVAL_MS)
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "fix: log pruneLoop errors instead of swallowing"
```

---

### Task 4: Fix auth-guard non-null assertion on expiresAt

**Context:** `auth-guard.ts:78` uses `oauth.expiresAt!` (non-null assertion) on an optional field. If `expiresAt` is undefined, `parseInt(undefined, 10)` returns `NaN`, `new Date(NaN)` is Invalid Date, and `new Date() >= invalidDate` is `false` — meaning a missing expiry appears valid.

**Files:**

- Modify: `src/main/auth-guard.ts:78`
- Test: `src/main/auth-guard.test.ts`

- [ ] **Step 1: Write the failing test**

In `auth-guard.test.ts`, add a test for missing `expiresAt`. Import the `CredentialStore` type:

```typescript
import { checkAuthStatus } from './auth-guard'
import type { CredentialStore } from './auth-guard'

it('reports tokenExpired when expiresAt is missing', async () => {
  const store: CredentialStore = {
    readToken: async () => ({ claudeAiOauth: { accessToken: 'tok' } }),
    detectCli: () => true
  }
  const status = await checkAuthStatus(store)
  expect(status.tokenExpired).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- --grep "expiresAt is missing"`
Expected: FAIL — currently returns `tokenExpired: false`

- [ ] **Step 3: Implement the fix**

Replace lines 78-79 in `auth-guard.ts` with:

```typescript
if (!oauth.expiresAt) {
  return { cliFound, tokenFound: true, tokenExpired: true }
}
const expiresMs = parseInt(oauth.expiresAt, 10)
if (Number.isNaN(expiresMs)) {
  return { cliFound, tokenFound: true, tokenExpired: true }
}
const expiresAt = new Date(expiresMs)
const tokenExpired = new Date() >= expiresAt
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- --grep "expiresAt is missing"`
Expected: PASS

- [ ] **Step 5: Run full auth-guard tests**

Run: `npm run test:main -- auth-guard`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/main/auth-guard.ts src/main/auth-guard.test.ts
git commit -m "fix: handle missing/invalid expiresAt in auth-guard"
```

---

### Task 5: Move raw SQL from cost-handlers to data layer

**Context:** `cost-handlers.ts:6-16,60-66` contains raw SQL (`GET_AGENT_HISTORY_SQL`) and a direct `getDb().prepare()` call. This should go through the data layer. BDE uses a two-layer pattern: `src/main/data/cost-queries.ts` (functions take `db: Database.Database` param) and `src/main/cost-queries.ts` (thin wrapper that injects `getDb()`). The handler imports from the wrapper. Note: the SQL JOINs `sprint_tasks` which is no longer local (Supabase) — use NULL placeholders.

**Important:** `AgentCostRecord` already exists in `src/shared/types.ts` — import it, don't redefine.

**Files:**

- Modify: `src/main/data/cost-queries.ts` (add `getAgentHistory` with `db` param)
- Modify: `src/main/cost-queries.ts` (add wrapper that injects `getDb()`)
- Modify: `src/main/handlers/cost-handlers.ts` (replace raw SQL with wrapper call)

- [ ] **Step 1: Add `getAgentHistory` to data/cost-queries.ts**

Move the SQL, `AgentCostRow` interface, and `rowToRecord` mapping from cost-handlers. The function takes `db` as first param (matching the existing pattern in this file):

```typescript
import type { AgentCostRecord } from '../../shared/types'

interface AgentCostRow {
  id: string
  model: string | null
  started_at: string
  finished_at: string | null
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  cache_read: number | null
  cache_create: number | null
  duration_ms: number | null
  num_turns: number | null
  title: string | null
  pr_url: string | null
  repo: string | null
}

const GET_AGENT_HISTORY_SQL = `
  SELECT ar.id, ar.model, ar.started_at, ar.finished_at,
         ar.cost_usd, ar.tokens_in, ar.tokens_out,
         ar.cache_read, ar.cache_create, ar.duration_ms, ar.num_turns,
         NULL AS title, NULL AS pr_url, NULL AS repo
  FROM agent_runs ar
  WHERE ar.finished_at IS NOT NULL
  ORDER BY ar.started_at DESC
  LIMIT ? OFFSET ?
`

function rowToRecord(row: AgentCostRow): AgentCostRecord {
  return {
    id: row.id,
    model: row.model,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    cacheRead: row.cache_read,
    cacheCreate: row.cache_create,
    durationMs: row.duration_ms,
    numTurns: row.num_turns,
    taskTitle: row.title,
    prUrl: row.pr_url,
    repo: row.repo
  }
}

export function getAgentHistory(db: Database.Database, limit = 100, offset = 0): AgentCostRecord[] {
  const rows = db.prepare(GET_AGENT_HISTORY_SQL).all(limit, offset) as AgentCostRow[]
  return rows.map(rowToRecord)
}
```

- [ ] **Step 2: Add wrapper to src/main/cost-queries.ts**

Add the `getAgentHistory` wrapper alongside the existing wrappers:

```typescript
import {
  getCostSummary as _getCostSummary,
  getRecentAgentRunsWithCost as _getRecentAgentRunsWithCost,
  getAgentHistory as _getAgentHistory
} from './data/cost-queries'
import type { AgentCostRecord } from '../shared/types'

// ... existing wrappers ...

export function getAgentHistory(limit = 100, offset = 0): AgentCostRecord[] {
  return _getAgentHistory(getDb(), limit, offset)
}
```

- [ ] **Step 3: Simplify cost-handlers.ts**

Remove the SQL string, `AgentCostRow` interface, `rowToRecord` function, and `getDb` import. Import `getAgentHistory` from the wrapper:

```typescript
import { safeHandle } from '../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost, getAgentHistory } from '../cost-queries'

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary())
  safeHandle('cost:agentRuns', (_e, args: { limit?: number }) =>
    getRecentAgentRunsWithCost(args.limit ?? 20)
  )
  safeHandle('cost:getAgentHistory', (_e, args?: { limit?: number; offset?: number }) => {
    return getAgentHistory(args?.limit ?? 100, args?.offset ?? 0)
  })
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/data/cost-queries.ts src/main/cost-queries.ts src/main/handlers/cost-handlers.ts
git commit -m "refactor: move raw SQL from cost-handlers to data layer"
```

---

### Task 6: Use data layer for sprint:readLog handler

**Context:** `sprint-local.ts:195-197` uses inline `db.prepare('SELECT log_path, status FROM agent_runs WHERE id = ?')` when a data layer function `getAgentLogPath()` already exists in `data/agent-queries.ts:184-192`. The existing function only returns `log_path` — we need `status` too, so add a small extension.

**Files:**

- Modify: `src/main/data/agent-queries.ts` (add `getAgentLogInfo`)
- Modify: `src/main/handlers/sprint-local.ts:193-197`

- [ ] **Step 1: Add `getAgentLogInfo` to agent-queries.ts**

```typescript
export function getAgentLogInfo(
  db: Database.Database,
  id: string
): { logPath: string; status: string } | null {
  const row = db.prepare('SELECT log_path, status FROM agent_runs WHERE id = ?').get(id) as
    | { log_path: string; status: string }
    | undefined
  if (!row?.log_path) return null
  return { logPath: row.log_path, status: row.status }
}
```

- [ ] **Step 2: Update sprint-local.ts handler**

Replace the inline SQL with the data layer call:

```typescript
import { getAgentLogInfo } from '../data/agent-queries'

// In the handler:
const info = getAgentLogInfo(getDb(), agentId)
if (!info) return { content: '', status: 'unknown', nextByte: fromByte }
// Use info.logPath and info.status instead of agent.log_path and agent.status
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/data/agent-queries.ts src/main/handlers/sprint-local.ts
git commit -m "refactor: use data layer for sprint:readLog agent lookup"
```

---

### Task 7: Fix priority default mismatch

**Context:** `TicketEditor.tsx:39` defaults priority to `3`, but `db.ts:140` defaults to `1`. Since tickets are now created via Supabase (not local SQLite), the DB default doesn't directly apply — but the inconsistency is confusing and `1` is the correct semantic default (highest priority).

**Files:**

- Modify: `src/renderer/src/components/sprint/TicketEditor.tsx:39`

- [ ] **Step 1: Align the default**

Change line 39 in `TicketEditor.tsx` from:

```typescript
priority: priority ?? 3,
```

to:

```typescript
priority: priority ?? 1,
```

- [ ] **Step 2: Run typecheck and renderer tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/sprint/TicketEditor.tsx
git commit -m "fix: align TicketEditor default priority with DB schema (3 -> 1)"
```

---

## Summary

| Task | Bug                                | Risk                                                  | Est.  |
| ---- | ---------------------------------- | ----------------------------------------------------- | ----- |
| 1    | agent_run_id not persisted (FC-S1) | Low — additive, no behavior change for existing flows | 5 min |
| 2    | gitPush() error wrapping (FC-S2)   | Low — function may not be called currently            | 3 min |
| 3    | pruneLoop swallowed error          | Trivial — one-line consistency fix                    | 1 min |
| 4    | auth-guard non-null assertion      | Low — defensive, fails closed                         | 5 min |
| 5    | Raw SQL in cost-handlers           | Low — moves existing code, no behavior change         | 5 min |
| 6    | Raw SQL in sprint-local            | Low — uses existing data layer pattern                | 3 min |
| 7    | Priority default mismatch          | Trivial — constant change                             | 1 min |

**Total estimated: ~25 minutes**

All tasks are independent and can be executed in parallel by separate agents, or sequentially in a single session.
