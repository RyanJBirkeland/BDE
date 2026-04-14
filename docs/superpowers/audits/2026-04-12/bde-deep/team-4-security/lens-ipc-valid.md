# IPC Input Validation Audit Report
**Date:** 2026-04-12  
**Scope:** BDE Main Process IPC Handlers  
**Auditor:** Claude Security Team (Team 4)

## Executive Summary

BDE demonstrates strong defensive practices across its IPC layer. All handlers use the `safeHandle()` wrapper for standardized error logging, and path-based operations leverage path resolution and symlink normalization to prevent traversal attacks. Database operations use prepared statements exclusively, eliminating SQL injection risk at the query layer. However, this audit identified 6 issues ranging from critical (unvalidated grep injection) to medium (missing status transition validation and loose webhook URL acceptance) that warrant immediate attention.

---

## F-t4-ipc-valid-1: Grep Command Injection in Memory Search Handler
**Severity:** Critical  
**Category:** IPC Validation  
**Location:** `src/main/handlers/memory-search.ts:31`

**Evidence:**
```typescript
const { stdout } = await execFileAsync('grep', ['-rni', '--', query, '.'], {
  cwd: BDE_MEMORY_DIR,
  encoding: 'utf-8',
  maxBuffer: 5 * 1024 * 1024
})
```

The `memory:search` handler passes the user-supplied `query` string directly to grep as an argument. While `execFileAsync` avoids shell interpretation (good!), the grep pattern itself is not validated. A user can supply complex regex patterns that could cause DoS via catastrophic backtracking (e.g., `(a+)+b` on grep with -E flag not set, but still expensive patterns like `^(?:a|a)*$` repeated over large files).

**Impact:** 
- DoS: A crafted query pattern (e.g., nested quantifiers in basic regex) could cause grep to consume CPU/memory and hang the search
- Information disclosure: Patterns using grep's lookahead or alternation can infer content without direct access
- Memory exhaustion: Large result sets (maxBuffer is 5MB) could be triggered intentionally

**Recommendation:**
1. Validate query against a regex pattern allowlist (e.g., max length, no nested quantifiers)
2. Set a timeout on the grep execution (e.g., 5s)
3. Implement result pagination to avoid maxBuffer spikes

**Effort:** S  
**Confidence:** High

---

## F-t4-ipc-valid-2: Missing Status Transition Validation in sprint:update Handler
**Severity:** High  
**Category:** IPC Validation  
**Location:** `src/main/handlers/sprint-local.ts:85-135`

**Evidence:**
```typescript
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  // SP-6: Filter patch fields through UPDATE_ALLOWLIST
  const filteredPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (UPDATE_ALLOWLIST.has(key)) {
      filteredPatch[key] = value
    }
  }
  // ...
  if (patch.status === 'queued') {
    // Validate spec, etc.
  }
  // updateTask (service) handles notifySprintMutation internally
  const result = updateTask(id, patch)
```

The handler filters patch fields against an allowlist, but does NOT validate status transitions. A renderer can request an invalid state change (e.g., `done` → `active`, or `failed` → `queued`) which may bypass business logic if the data layer doesn't enforce the state machine. Shared module `task-state-machine.ts` exports `validateTransition()`, but the handler never calls it.

**Impact:**
- Bypass of intended task lifecycle (e.g., jumping states without proper cleanup)
- Tasks marked done prematurely without review
- Agent tasks marked active after completion

**Recommendation:**
1. Import `validateTransition` from `../../shared/task-state-machine`
2. If patch.status is set, call `validateTransition(task.status, patch.status)` and throw if invalid
3. Alternatively, ensure the data layer (`sprint-mutations.ts`) enforces validation and returns an error

**Effort:** S  
**Confidence:** High

---

## F-t4-ipc-valid-3: Webhook URL Not Validated Against Allowlist
**Severity:** High  
**Category:** IPC Validation  
**Location:** `src/main/handlers/webhook-handlers.ts:25-29`

**Evidence:**
```typescript
safeHandle(
  'webhook:create',
  async (_e, payload: { url: string; events: string[]; secret?: string }) => {
    const webhook = createWebhook(payload)
    logger.info(`Created webhook ${webhook.id} for ${payload.url}`)
    return webhook
  }
)
```

The handler accepts any URL string without validation. A renderer can register a webhook pointing to:
- Internal services (e.g., `http://localhost:8000`, `http://169.254.169.254` for cloud metadata)
- Private network addresses (e.g., `http://192.168.x.x`)
- File URLs (e.g., `file:///etc/passwd`)

When the webhook is triggered, BDE will make a POST request to this attacker-controlled URL, enabling SSRF attacks.

**Impact:**
- Server-Side Request Forgery (SSRF): Access to internal services, cloud metadata endpoints
- Information disclosure: Webhook payloads may contain task specs, repo names, or sensitive context
- Denial of Service: Slow/non-responsive endpoints block webhook delivery

**Recommendation:**
1. Implement URL parsing and validation:
   ```typescript
   const url = new URL(payload.url) // Throws if invalid
   if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only http/https allowed')
   if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') throw new Error('Localhost not allowed')
   // Reject RFC1918 ranges, 169.254.x.x, etc.
   ```
2. Consider an allowlist of known webhook services (GitHub, Slack, etc.)

**Effort:** M  
**Confidence:** High

---

## F-t4-ipc-valid-4: Unvalidated Array Length in batchImport Handler
**Severity:** Medium  
**Category:** IPC Validation  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:115-137`

**Evidence:**
```typescript
safeHandle(
  'sprint:batchImport',
  async (_e, tasks: Array<{ ... }>) => {
    const { batchImportTasks } = await import('../services/batch-import')
    const repo = createSprintTaskRepository()
    return batchImportTasks(tasks, repo)
  }
)
```

The handler accepts an unbounded array of tasks. A renderer can pass a very large array (e.g., 100k tasks) which will:
1. Consume memory during JSON deserialization
2. Trigger a loop that processes each task sequentially
3. Saturate the database with write operations

**Impact:**
- Denial of Service: Main process hangs during import, freezing UI
- Memory exhaustion: Unbounded array allocation

**Recommendation:**
1. Add array length validation: `if (tasks.length > 1000) throw new Error('Max 1000 tasks per import')`
2. Consider paginating the import or processing in batches

**Effort:** S  
**Confidence:** Medium

---

## F-t4-ipc-valid-5: Repository Parameter Not Validated in cloneRepo Handler
**Severity:** Medium  
**Category:** IPC Validation  
**Location:** `src/main/handlers/repo-discovery.ts:205-206`

**Evidence:**
```typescript
safeHandle('repos:clone', async (_e, owner: string, repo: string, destDir: string) => {
  cloneRepo(owner, repo, destDir)
})
```

The handler passes `owner` and `repo` strings directly to the git clone URL without validation:
```typescript
const url = `https://github.com/${owner}/${repo}.git`
const proc = spawn('git', ['clone', '--progress', url, target], { ... })
```

While `spawn()` avoids shell injection, the git URL is constructed from untrusted user input. An attacker can craft URLs like:
- `owner=user&repo=.` to create a path traversal (`https://github.com/user&repo=.`)
- `owner=../../../` to abuse URL parsing (though unlikely to succeed)

More seriously, there's no allowlist check. A renderer can clone any public repository from GitHub, not just configured ones.

**Impact:**
- Information disclosure: Clone any repository (source code exfiltration)
- Denial of Service: Clone very large repositories or spam git operations
- Potential for social engineering: User thinks they're cloning one repo, actually clones another

**Recommendation:**
1. Validate `owner` and `repo` against GitHub username/repo name patterns: `[a-zA-Z0-9_-]+`
2. Optional: Enforce an allowlist of trusted owners/repos from settings
3. Add a rate limit: Max 1 clone per minute per process

**Effort:** S  
**Confidence:** High

---

## F-t4-ipc-valid-6: AgentId Format Validation Incomplete in sprint:readLog Handler
**Severity:** Medium  
**Category:** IPC Validation  
**Location:** `src/main/handlers/sprint-local.ts:187-199`

**Evidence:**
```typescript
safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
  // Validate agentId to prevent path traversal (must be a valid UUID-like string)
  if (!agentId || typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error('Invalid agent ID format')
  }

  const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
  const info = getAgentLogInfo(getDb(), agentId)
  // ...
})
```

The agentId regex `/^[a-zA-Z0-9_-]+$/` allows any sequence of alphanumeric, underscore, and dash characters. While this prevents obvious path traversal (`../`), it doesn't validate that the agentId is actually a valid UUID or corresponds to an existing agent. A malicious renderer could:
- Construct high-entropy strings to probe for agent IDs
- Request logs for agents it shouldn't have access to
- Cause database queries for non-existent IDs repeatedly (DoS)

**Impact:**
- Information disclosure: Read log files for agents created by other users or external processes
- Denial of Service: Repeated queries for invalid agentIds

**Recommendation:**
1. Tighten the regex to match UUID format: `/^[a-f0-9-]{36}$/` (if UUIDs are the standard)
2. Before reading the log, call `getAgentLogInfo()` and verify the agent exists
3. Optional: Check that the current session/user has permission to read this agent's logs

**Effort:** S  
**Confidence:** Medium

---

## Additional Observations (Not Findings)

### Strengths
- **safeHandle() usage:** All IPC handlers are wrapped, ensuring consistent error logging
- **Prepared statements:** Database operations use parameterized queries (no SQL injection risk)
- **Path validation:** `validateRepoPath()`, `validateMemoryPath()`, `validateIdePath()` all normalize and check symlinks
- **Sanitization utilities:** `sanitize-depends-on.ts` validates dependency arrays at the schema level
- **GitHub API allowlist:** `git-handlers.ts` implements a regex-based allowlist for GitHub API endpoints

### Areas to Monitor
1. **Settings keys:** No validation on `settings:set` / `settings:setJson` key names. A renderer could write to any key. Consider adding a key allowlist (e.g., only allow keys matching `^[a-z0-9.]+$`).
2. **Template names:** `templates:save` accepts any string as `template.name`. Consider enforcing a format/length limit.
3. **Preload API surface:** The preload bridge exposes many operations (memory I/O, git, webhooks). Audit that all are necessary and protected.

---

## Summary Table

| Finding | Severity | Category | Handler | Recommendation |
|---------|----------|----------|---------|---|
| F-t4-ipc-valid-1 | Critical | Grep Injection | memory:search | Add timeout, regex validation |
| F-t4-ipc-valid-2 | High | Missing Status Validation | sprint:update | Call `validateTransition()` |
| F-t4-ipc-valid-3 | High | SSRF Risk | webhook:create | Validate URL against allowlist |
| F-t4-ipc-valid-4 | Medium | DoS via Array Size | sprint:batchImport | Enforce max length (1000) |
| F-t4-ipc-valid-5 | Medium | Missing Repo Allowlist | repos:clone | Validate owner/repo format |
| F-t4-ipc-valid-6 | Medium | Loose AgentId Validation | sprint:readLog | Tighten regex, check existence |

---

## Remediation Priority

**Immediate (P1):**
- F-t4-ipc-valid-1 (grep injection DoS)
- F-t4-ipc-valid-2 (status bypass)
- F-t4-ipc-valid-3 (SSRF)

**Short-term (P2):**
- F-t4-ipc-valid-4, F-t4-ipc-valid-5, F-t4-ipc-valid-6

**Total Effort Estimate:** 2–3 engineer-days

