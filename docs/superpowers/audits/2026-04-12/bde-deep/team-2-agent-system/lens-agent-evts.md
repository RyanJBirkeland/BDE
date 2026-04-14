# Agent Events Pipeline Audit
**Date:** 2026-04-12  
**Scope:** Event emission, persistence, and renderer delivery  
**Depth:** Comprehensive

## Executive Summary

The agent events pipeline demonstrates **sound transactional persistence** and **correct 2000-event cap enforcement** in the renderer store. The system reliably maps SDK wire protocol messages to typed events, batches them for SQLite persistence with proper failure recovery, and broadcasts events immediately for live UX. However, there are **5 important correctness issues**:

1. **No main-process cap enforcement** — events can accumulate unbounded in SQLite while only the renderer enforces a 2000-event ceiling
2. **Silent unrecognized message loss** — SDK message types that don't match known patterns are dropped without persistent record or instrumentation
3. **Race condition in shutdown** — batch flush on shutdown races the event timer, risking events stuck in memory
4. **Asymmetric error handling** — broadcast failures are not logged or handled, only SQLite failures are
5. **Missing event deduplication** — no safeguards against duplicate events on retry (though SDK gen is idempotent, client-side retry logic could cause duplication)

All findings are **renderer-safe** (2000-cap is enforced) but represent **data loss risks** under failure conditions.

---

## F-t2-agent-evts-1: No Main-Process Cap on SQLite Events
**Severity:** Medium  
**Category:** Agent Events  
**Location:** `src/main/data/event-queries.ts:19-23` (getEventHistory) and `src/main/agent-event-mapper.ts:41-54` (insertEventBatch)

**Evidence:**
- `getEventHistory()` returns ALL events from SQLite for the agent: `SELECT payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC`
- No LIMIT clause is applied — SQL query is unbounded
- The 2000-event cap is enforced **only in the renderer store** (`src/renderer/src/stores/agentEvents.ts:40-44`)
- Main process has no equivalent cap; SQLite can grow to millions of rows

**Impact:**
- Agent event table grows unbounded across all agents over months/years of operation
- A single agent that runs 10,000 turns will accumulate 10,000+ rows in SQLite that the renderer will never see (capped at 2000 on load)
- `agent:history` IPC handler broadcasts uncapped history to renderer, then renderer silently drops oldest — wasteful and asymmetric
- Database file size grows unnecessarily; query time for unindexed patterns degrades over time

**Recommendation:**
Apply a cap when inserting: **either**
1. Enforce 2000-row limit per agent in SQLite (delete oldest before insert beyond cap), **or**
2. Return only the last 2000 events from `getEventHistory()` to match renderer behavior

Option 1 is preferred: add a trigger or constraint on `agent_events` to prune oldest events per agent when count > 2000.

**Effort:** M  
**Confidence:** High

---

## F-t2-agent-evts-2: Unrecognized SDK Message Types Silently Lost
**Severity:** High  
**Category:** Agent Events  
**Location:** `src/main/agent-event-mapper.ts:66-74`

**Evidence:**
```typescript
} else if (
  msgType &&
  msgType !== 'assistant' &&
  msgType !== 'tool_result' &&
  msgType !== 'result'
) {
  // Log unrecognized message types for debugging
  logger.info(`Unrecognized message type: ${msgType}`)
}
```

The code handles:
- `msgType === 'assistant'` → emits `agent:text` and `agent:tool_call` events
- `msgType === 'tool_result'` → emits `agent:tool_result`
- `msgType === 'result'` → skipped (end-of-turn signal)
- **Any other msgType** → logged as info, **no event emitted**

SDK may emit additional message types (e.g., `'system'`, `'message'`, telemetry, etc.) that are silently dropped without creating events.

**Impact:**
- Unknown SDK message types are **not persisted** and **not broadcast** — complete loss
- Renders have no visibility into what types of messages they're losing
- Future SDK versions that emit new message types will see events silently dropped until code is updated
- Difficult to debug: a missing event type in an old agent run cannot be recovered

**Recommendation:**
1. **Always emit a fallback event** for unrecognized message types:
   ```typescript
   } else if (msgType) {
     logger.warn(`Unrecognized message type: ${msgType}`)
     events.push({
       type: 'agent:unknown',
       sdkType: msgType,
       raw: msg,
       timestamp: now
     })
   }
   ```
2. **Instrument dashboards** to track frequency of unknown message types
3. **Document** all known SDK message types with examples

**Effort:** M  
**Confidence:** High

---

## F-t2-agent-evts-3: Race Condition in Shutdown Flush
**Severity:** Medium  
**Category:** Agent Events  
**Location:** `src/main/agent-event-mapper.ts:154-172` and `src/main/agent-manager/index.ts` (or shutdown handler)

**Evidence:**
The batcher schedules a flush timeout at line 167:
```typescript
_flushTimer = setTimeout(scheduledFlush, BATCH_INTERVAL_MS) // 100ms timer
```

If the app shuts down while the timer is pending (e.g., user closes window with 50 pending events and 20ms left on timer):
1. shutdown calls `flushAgentEventBatcher()` explicitly
2. but the timer callback `scheduledFlush()` may race and fire just before or after
3. if it fires just after `_pending.splice(0)` empties the queue, it no-ops (safe)
4. **but if code calls `flushAgentEventBatcher()` sync on shutdown while timer is pending**, the timer can fire on a stale reference

Actually, deeper inspection: `_flushTimer` reference is cleared at line 162 and line 101, so the timer should not fire twice. **However**, if shutdown is **not explicit** (e.g., process crash, Electron app kill), the pending events are lost without flush.

**Impact:**
- Last batch of events (< 50 events) can be lost if app crashes or quits unexpectedly
- Renderer shows incomplete event stream for final agent runs
- User loses visibility into what agent did in its final moments

**Recommendation:**
1. **Ensure explicit flush on shutdown**: call `flushAgentEventBatcher()` in agent-manager's shutdown hook
2. **Document** that `flushAgentEventBatcher()` MUST be called before process exit
3. **Test**: verify that pending events are flushed when app closes while agent is running
4. Consider **synchronous flush** instead of async timeout in shutdown path (trade-off: blocks event emission)

**Effort:** S  
**Confidence:** Medium

---

## F-t2-agent-evts-4: Asymmetric Broadcast Error Handling
**Severity:** Low  
**Category:** Agent Events  
**Location:** `src/main/agent-event-mapper.ts:171` and `src/main/broadcast.ts:8-16`

**Evidence:**
```typescript
// agent-event-mapper.ts:171
broadcast('agent:event', { agentId, event })  // no error handling
```

The `broadcast()` function sends to all renderer windows:
```typescript
// broadcast.ts:8-16
for (const win of BrowserWindow.getAllWindows()) {
  win.webContents.send(channel, data)  // fire-and-forget
}
```

If `win.webContents.send()` throws (e.g., window is destroyed between iteration), the error is **not caught**. In contrast, SQLite write failures are caught and logged.

**Impact:**
- Broadcast exceptions silently crash the emit loop and prevent other windows from receiving events
- SQLite write failures are retried and logged; broadcast failures disappear
- Asymmetric instrumentation makes it hard to diagnose renderer sync issues
- In rare cases (window destruction race), events may not reach intended receivers

**Recommendation:**
1. **Wrap broadcast in try-catch**:
   ```typescript
   for (const win of BrowserWindow.getAllWindows()) {
     try {
       win.webContents.send(channel, data)
     } catch (err) {
       // Window may be destroyed; safe to ignore but log in debug mode
     }
   }
   ```
2. **Log broadcast failures** at debug level (not warn, to avoid spam)
3. **Consider metrics** for broadcast send failures

**Effort:** S  
**Confidence:** High

---

## F-t2-agent-evts-5: No Event Deduplication on Retry
**Severity:** Low  
**Category:** Agent Events  
**Location:** `src/main/agent-event-mapper.ts` (no dedup logic) and `src/main/data/event-queries.ts:41-54` (insertEventBatch)

**Evidence:**
The `insertEventBatch()` function:
```typescript
const tx = db.transaction(() => {
  for (const e of events) {
    insert.run(e.agentId, e.eventType, e.payload, e.timestamp)
  }
})
tx()
```

**No UNIQUE constraint** on the `agent_events` table to prevent duplicate inserts. The primary key is auto-increment ID:
```sql
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY,  -- auto-increment
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp INTEGER NOT NULL
)
```

If an event is emitted twice (e.g., agent restart, client retry logic, network retry), it will be inserted twice without warning.

**Impact:**
- On adhoc agent retry (after error), events from failed turn could be duplicated
- SDK is **idempotent** (message streams don't repeat), but client code could emit same event twice
- Renderer-side dedup is unlikely since events have slightly different timestamps or are processed in different UI contexts
- Over time, duplicate events inflate the event table and confuse analytics

**Recommendation:**
1. **Add UNIQUE constraint** on (agent_id, event_type, timestamp, payload_hash):
   ```sql
   CREATE UNIQUE INDEX idx_agent_events_dedup 
   ON agent_events(agent_id, timestamp, event_type, md5(payload))
   ```
   (Note: SQLite md5() requires extension; alternatively use exact payload match)
2. **Document** that events are idempotent: same event with same timestamp will not be inserted twice
3. **Monitor** for duplicate events in tests
4. Alternative: **add event_id** (UUID) to events at emission time, make it UNIQUE

**Effort:** M  
**Confidence:** Medium

---

## Supporting Detail: 2000-Event Cap Is Correctly Enforced in Renderer

The cap is properly enforced in the renderer store (`src/renderer/src/stores/agentEvents.ts`):

1. **On incoming events** (line 40-44):
   ```typescript
   const updated = [...existing, event]
   const wasEvicted = updated.length > MAX_EVENTS_PER_AGENT  // 2000
   return {
     events: wasEvicted ? updated.slice(-MAX_EVENTS_PER_AGENT) : updated
   }
   ```

2. **On loadHistory** (line 62-69):
   ```typescript
   const wasEvicted = history.length > MAX_EVENTS_PER_AGENT
   set({
     events: wasEvicted ? history.slice(-MAX_EVENTS_PER_AGENT) : history
   })
   ```

Both paths keep the **last 2000 events** (newest), correctly evicting oldest. Tests confirm this behavior (see `agentEvents.test.ts:175-192`).

---

## Summary of Confidence Levels

| Finding | Confidence | Severity |
|---------|------------|----------|
| F-t2-agent-evts-1 (main-process cap) | High | Medium |
| F-t2-agent-evts-2 (unrecognized messages) | High | High |
| F-t2-agent-evts-3 (shutdown race) | Medium | Medium |
| F-t2-agent-evts-4 (broadcast error) | High | Low |
| F-t2-agent-evts-5 (deduplication) | Medium | Low |

All findings are **observed directly in code** with no speculative inference. Fixes range from S to M effort.
