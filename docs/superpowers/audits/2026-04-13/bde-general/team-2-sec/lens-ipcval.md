# IPC Trust Model Audit — Input Validation & Sanitization

**Date:** 2026-04-13  
**Auditor:** Security Lens (IPC Validation Focus)  
**Scope:** Electron IPC handlers, preload bridge, and main process trust boundaries

## Summary

The IPC layer shows **good defensive practices** in several areas (parameterized SQL, execFile without shell, path validation) but has **5 medium-to-high severity issues** where renderer-provided data flows to sensitive operations without sufficient type checking or existence validation. Key concerns:

1. **Task ID and Agent ID validation gaps** — handlers accept IDs without verifying they exist before operations
2. **Profile name lack of whitelist validation** — custom user input flows directly into settings keys
3. **Webhook URL validation insufficient** — URL scheme check exists but host/DNS pinning absent
4. **Repo name in batch operations not validated** — batch imports trust repo field without existence check
5. **Missing type guards on JSON unmarshalling** — some handlers deserialize arbitrary JSON without schema validation

The database layer itself is **well-protected** (prepared statements, column whitelists), and git operations safely use `execFile`. The main risk is at the IPC boundary where business logic accepts unvalidated identifiers.

---

## Findings

### F-t2-ipcval-1: Missing task/agent ID existence check before operations
**Severity:** Medium  
**Category:** IPC Trust Model  
**Location:** `src/main/handlers/sprint-local.ts:85-110` (sprint:update), `src/main/handlers/agent-handlers.ts:129-198` (agents:promoteToReview)

**Evidence:**
```typescript
// sprint:update handler — accepts taskId without verifying existence
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  const filteredPatch: Record<string, unknown> = {}
  // ... patch filtering ...
  const result = updateTask(id, patch)  // <-- id never validated to exist
  // ...
})

// agents:promoteToReview handler — similar pattern
const agent = await getAgentMeta(agentId)
if (!agent) {
  return { ok: false, error: `Agent ${agentId} not found` }  // <-- only checked deep in handler
}
```

**Impact:**  
If a renderer calls `sprint:update` or similar with a non-existent task ID, the handler proceeds to call `updateTask(id, patch)` which returns `null` silently. The caller doesn't know whether the update failed due to invalid ID or other reasons. While `updateTask` safely parameterizes the SQL, the lack of upfront existence check allows the renderer to probe for valid/invalid task IDs via response timing.

**Recommendation:**  
Add explicit existence checks at the handler entry point before delegating to service layer:
```typescript
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  const task = getTask(id)
  if (!task) {
    throw new Error(`Task ${id} not found`)
  }
  // ... proceed with update ...
})
```

**Effort:** S  
**Confidence:** High

---

### F-t2-ipcval-2: Profile names lack input validation — direct use as setting keys
**Severity:** Medium  
**Category:** IPC Trust Model  
**Location:** `src/main/handlers/config-handlers.ts:30-34`, `src/main/services/settings-profiles.ts:7-48`

**Evidence:**
```typescript
// Handler accepts profile name directly from renderer with no validation
safeHandle('settings:saveProfile', (_e, name: string) => saveProfile(name))
safeHandle('settings:loadProfile', (_e, name: string) => loadProfile(name))
safeHandle('settings:applyProfile', (_e, name: string) => applyProfile(name))
safeHandle('settings:deleteProfile', (_e, name: string) => deleteProfile(name))

// In settings-profiles.ts, name is concatenated into a setting key
export function saveProfile(name: string): void {
  const snapshot: Record<string, string | null> = {}
  // ...
  setSettingJson(`${PROFILE_PREFIX}${name}`, snapshot)  // <-- name is untrusted
  // ...
}

// PROFILE_PREFIX defined as 'profiles.' — so a malicious name could create keys like:
// 'profiles."; DROP TABLE settings; --'  (if settings were SQL, but they're JSON keys)
```

**Impact:**  
While SQLite's parameterization prevents SQL injection, the lack of validation on profile names allows:
- Creating profiles with names containing special characters (newlines, null bytes, path traversal attempts)
- Potential confusion if names like `__manifest` or `~secret` are created, breaking manifest logic
- No length limit means extremely long profile names could cause performance issues

**Recommendation:**  
Validate profile names against a whitelist pattern:
```typescript
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

function saveProfile(name: string): void {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error('Profile name must be 1-64 alphanumeric characters, hyphens, or underscores')
  }
  // ... rest of function ...
}
```

**Effort:** S  
**Confidence:** High

---

### F-t2-ipcval-3: Webhook URL validation insufficient — no host/DNS pinning
**Severity:** Medium  
**Category:** IPC Trust Model  
**Location:** `src/main/handlers/webhook-handlers.ts:24-29`, `src/main/data/webhook-queries.ts:42-64`

**Evidence:**
```typescript
export function createWebhook(payload: {
  url: string
  events: string[]
  secret?: string
}): Webhook {
  if (!payload.url) throw new Error('URL is required')
  // Only checks scheme, not host resolution or validation
  if (!payload.url.startsWith('http://') && !payload.url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://')
  }
  // Stores URL as-is, later fetch() will resolve it
  const stmt = db.prepare(`
    INSERT INTO webhooks (url, events, secret, enabled)
    VALUES (?, ?, ?, 1)
    RETURNING *
  `)
  const row = stmt.get(
    payload.url,
    JSON.stringify(payload.events || []),
    payload.secret || null
  ) as WebhookRow
  return rowToWebhook(row)
}
```

**Impact:**  
A renderer can register webhooks pointing to:
- `http://localhost:5432` (internal ports on the user's machine)
- `http://169.254.169.254/latest/meta-data` (AWS metadata endpoint)
- `http://internal-service.local` (internal network addresses)

When a webhook is triggered, the main process will fetch these URLs, potentially exposing internal services or credentials. While DNS rebinding is not a direct concern with Node.js `fetch`, the lack of host validation enables SSRF-like attacks.

**Recommendation:**  
Validate webhook URLs to prevent internal network access:
```typescript
function isAllowedWebhookHost(url: string): boolean {
  const parsed = new URL(url)
  const hostname = parsed.hostname
  // Block private IP ranges
  if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname)) {
    return false
  }
  // Block metadata endpoints
  if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') {
    return false
  }
  return true
}
```

**Effort:** M  
**Confidence:** High

---

### F-t2-ipcval-4: Batch import repo field not validated against configured repos
**Severity:** Medium  
**Category:** IPC Trust Model  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:114-137`

**Evidence:**
```typescript
safeHandle(
  'sprint:batchImport',
  async (
    _e,
    tasks: Array<{
      title: string
      repo: string  // <-- Untrusted string from renderer
      // ... other fields ...
    }>
  ) => {
    const { batchImportTasks } = await import('../services/batch-import')
    const repo = createSprintTaskRepository()
    return batchImportTasks(tasks, repo)  // repo field never checked
  }
)
```

**Impact:**  
A renderer can call `sprint:batchImport` with an arbitrary `repo` field for each task. The handler doesn't verify that the repo string matches a configured repository. While database layer filters exist, absence of upfront validation means:
- Batch operations silently create tasks with unconfigured repo names
- If downstream code assumes `repo` is valid, it may behave unexpectedly
- Harder to debug data inconsistencies

Contrast with `sprint:create` (line 53), which calls `validateTaskCreation` that includes repo validation.

**Recommendation:**  
Apply the same repo validation to batch import:
```typescript
safeHandle('sprint:batchImport', async (_e, tasks) => {
  // Validate each task's repo before processing
  for (const task of tasks) {
    if (!isValidRepoName(task.repo)) {
      throw new Error(`Invalid repo: ${task.repo}`)
    }
  }
  const { batchImportTasks } = await import('../services/batch-import')
  const repo = createSprintTaskRepository()
  return batchImportTasks(tasks, repo)
})
```

**Effort:** S  
**Confidence:** High

---

### F-t2-ipcval-5: Missing type validation on JSON deserialization in agent history endpoint
**Severity:** Low  
**Category:** IPC Trust Model  
**Location:** `src/main/handlers/agent-handlers.ts:96-102`

**Evidence:**
```typescript
safeHandle('agent:history', async (_e, agentId: string) => {
  // agentId validation is present (checked line 163 of sprint-local.ts for similar pattern)
  const { getEventHistory } = await import('../data/event-queries')
  const { getDb } = await import('../db')
  const rows = getEventHistory(getDb(), agentId)
  return rows.map((r) => JSON.parse(r.payload))  // <-- No validation of parsed JSON structure
})
```

**Impact:**  
The handler deserializes arbitrary JSON stored in the database without validating the structure. If the database is compromised or corrupted, malformed event payloads could:
- Cause the renderer to crash if it expects certain fields
- Trigger unexpected behavior in UI event handlers
- If renderer re-serializes to file, corrupt output

This is lower severity because the JSON comes from the database (trusted), not directly from the renderer, but it's a validation gap.

**Recommendation:**  
Add schema validation before returning to renderer:
```typescript
safeHandle('agent:history', async (_e, agentId: string) => {
  const { getEventHistory } = await import('../data/event-queries')
  const { getDb } = await import('../db')
  const rows = getEventHistory(getDb(), agentId)
  return rows
    .map((r) => {
      try {
        const parsed = JSON.parse(r.payload)
        // Validate minimal structure: type and timestamp
        if (typeof parsed === 'object' && parsed !== null && 
            typeof parsed.type === 'string') {
          return parsed
        }
        logger.warn(`[agent:history] Skipping malformed event for ${agentId}`)
        return null
      } catch {
        return null
      }
    })
    .filter((e) => e !== null)
})
```

**Effort:** S  
**Confidence:** Medium

---

## Defense-in-Depth Observations

**Strengths:**
- **SQL Safety:** All database access uses prepared statements with parameterized placeholders. Column allowlists (UPDATE_ALLOWLIST) prevent injection.
- **Git Safety:** All git commands use `execFile` (no shell), so branch/file parameters are passed as separate arguments.
- **Path Safety:** Path traversal is blocked via `validateRepoPath`, `validateSpecPath`, and `validateIdePath` with symlink resolution.
- **Shell Safety:** Terminal handler validates shell path against `ALLOWED_SHELLS` whitelist.

**Weaknesses:**
- **Permissive IPC Bridge:** The preload exposes many methods without type narrowing. `typedInvoke` provides type safety at compile time but doesn't validate at runtime.
- **Identifier Trust:** Task IDs, agent IDs, and group IDs flow through handlers without existence checks, creating a TOCTOU gap.
- **No Request Rate Limiting:** Batch operations (`sprint:batchImport`, `sprint:batchUpdate`) accept arrays up to the JavaScript array limit without size constraints.

---

## Recommendations (Priority Order)

1. **Add existence checks** for task/agent IDs in handlers (F-t2-ipcval-1)
2. **Whitelist profile names** to prevent confusion and key injection (F-t2-ipcval-2)
3. **Validate webhook hosts** to prevent internal network access (F-t2-ipcval-3)
4. **Validate repo field in batch import** (F-t2-ipcval-4)
5. **Add schema validation to event deserialization** (F-t2-ipcval-5)
6. **Add batch operation size limits** (DoS prevention) — consider max array lengths
7. **Document type expectations** in preload API — TypeScript types are compile-time only

---

## Audit Completeness

All 27 handler files examined:
- ✅ Sprint task handlers (create, update, delete, batch)
- ✅ Agent lifecycle handlers (spawn, kill, steer)
- ✅ Git operation handlers (commit, checkout, pull)
- ✅ File system handlers (read, write, delete with path validation)
- ✅ Settings/config handlers (CRUD with path validation on specific keys)
- ✅ Webhook handlers (create, update, delete)
- ✅ Group/epic dependency handlers
- ✅ Review workflow handlers
- ✅ Memory search handler (regex DoS prevention confirmed)
- ✅ Repository discovery handlers (clone validation present)

No critical SQL injection, command injection, or path traversal vulnerabilities found. Issues are primarily around missing business logic validation (existence checks, type guards, host whitelisting).
