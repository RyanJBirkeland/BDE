# IPC Handler Thinness Audit — April 14, 2026

## Overall Health
The codebase demonstrates *strong architectural discipline* around IPC handler thinness. Most handlers are genuine thin wrappers that unpack payloads, delegate to services, and return results. The split between handler and service logic is clean and intentional across the majority of the 20+ handler files examined. However, there are **6 findings** where business logic has leaked into handlers—mostly in handlers that predate the current architecture (agent-handlers, agent-manager-handlers, webhook-handlers) or in newer batch operations (sprint-batch-handlers). Most violations are easily remediable by extracting the logic into a shared service layer.

---

## F-t1-ipc-thin-1: Promotion Logic + Title Derivation in agents:promoteToReview
**Severity:** Medium
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/agent-handlers.ts:124–193`
**Evidence:** 
```typescript
// Verify the worktree has at least one commit beyond main
const { stdout } = await execFileAsync('git', ['rev-list', '--count', `origin/main..${agent.branch}`], ...)
const commitCount = parseInt(stdout.trim(), 10)
if (!Number.isFinite(commitCount) || commitCount === 0) {
  return { ok: false, error: 'Agent has not committed any work yet — nothing to promote' }
}

// Derive a title from the agent's task message (first non-blank line, capped)
const firstLine = agent.task.split('\n').find((l) => l.trim())?.trim() ?? 'Promoted adhoc agent'
const title = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine
```
**Impact:** Handlers should not contain validation logic (commit count checks) or data transformations (title truncation). When promotion rules change—e.g., minimum commit threshold, title casing convention—they must be updated in the handler instead of a centralized service. This violates the "handlers are thin" rule and couples the UI boundary to business rules.
**Recommendation:** Extract into a new `services/adhoc-promotion-service.ts` with a function like:
```typescript
export async function validateAndPreparePromotion(
  agent: AgentMeta,
  env: NodeJS.ProcessEnv
): Promise<{ valid: boolean; error?: string; title?: string; worktreePath?: string }>
```
Then the handler becomes a simple unpack-call-return wrapper.
**Effort:** S
**Confidence:** High

---

## F-t1-ipc-thin-2: Webhook Test Event Construction + HMAC Signing in webhook:test
**Severity:** Medium
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/webhook-handlers.ts:124–171`
**Evidence:**
```typescript
const testPayload = {
  event: 'webhook.test',
  timestamp: nowIso(),
  task: null
}
const body = JSON.stringify(testPayload)
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-BDE-Event': 'webhook.test',
  'X-BDE-Delivery': crypto.randomUUID()
}
if (webhook.secret) {
  const crypto = await import('crypto')
  const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
  headers['X-BDE-Signature'] = signature
}
const response = await fetch(webhook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })
if (!response.ok) throw new Error(...)
```
**Impact:** Webhook delivery logic—payload construction, HMAC signing, HTTP delivery, error handling—belongs in a service, not a handler. This couples the IPC boundary to webhook semantics. When retry logic, exponential backoff, or webhook versioning is added, it will bloat the handler further.
**Recommendation:** Extract into `services/webhook-delivery-service.ts`:
```typescript
export async function fireTestWebhook(webhook: Webhook): Promise<{ success: boolean; status: number }>
```
Handler becomes: `safeHandle('webhook:test', async (_e, { id }) => webhookService.fireTestWebhook(getWebhookById(id)))`
**Effort:** S
**Confidence:** High

---

## F-t1-ipc-thin-3: Git Commit Validation + Message Normalization in agent-manager:checkpoint
**Severity:** Medium
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/agent-manager-handlers.ts:55–98`
**Evidence:**
```typescript
await execFileAsync('git', ['add', '-A'], { cwd, encoding: 'utf-8' })
const { stdout: diff } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf-8' })
if (!diff.trim()) {
  return { ok: true, committed: false, error: 'Nothing to commit' }
}
const msg = (message && message.trim()) || 'checkpoint: user-requested snapshot'
await execFileAsync('git', ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
```
**Impact:** Checkpoint orchestration—staging, validation of staged changes, message normalization, commit execution—is business logic wrapped as IPC. When checkpoint rules evolve (e.g., require specific commit prefixes, enforce message length, auto-sign commits), the handler becomes a maintenance burden.
**Recommendation:** Extract into `services/checkpoint-service.ts`:
```typescript
export async function createCheckpoint(
  worktreePath: string,
  message?: string
): Promise<{ committed: boolean; error?: string }>
```
**Effort:** S
**Confidence:** High

---

## F-t1-ipc-thin-4: Spec Quality Validation Looped in sprint:batchUpdate Handler
**Severity:** Medium
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/sprint-batch-handlers.ts:59–81`
**Evidence:**
```typescript
if (filtered.status === 'queued') {
  const task = getTask(id)
  if (task) {
    try {
      const specText = (filtered.spec as string) ?? task.spec ?? null
      await validateTaskSpec({
        title: task.title,
        repo: task.repo,
        spec: specText,
        context: 'queue'
      })
    } catch (err) {
      results.push({ id, op: 'update', ok: false, error: ... })
      continue
    }
  }
}
```
**Impact:** This validation duplicates the logic in `sprint-local.ts:sprint:update` (lines 96–98). Batch handlers should call a shared service (e.g., `validateAndPrepareQueueTransition`) that encapsulates the spec-quality rule, rather than inline it. The duplication means the queuing business rule now lives in two places—a maintenance hazard.
**Recommendation:** Move the `if (filtered.status === 'queued')` block into a reusable service function that both `sprint-local.ts` and `sprint-batch-handlers.ts` call. This is partially addressed by `prepareQueueTransition` in `task-state-service.ts`, but the batch handler should use it consistently rather than duplicating.
**Effort:** M
**Confidence:** High

---

## F-t1-ipc-thin-5: Title Extraction and Markdown Parsing in planner-import Handler
**Severity:** Low
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/planner-import.ts:43–108`
**Evidence:**
```typescript
export function parsePlanMarkdown(markdown: string): ParsedPlan {
  const lines = markdown.split('\n')
  let epicName = 'Untitled Plan'
  const tasks: ParsedTask[] = []
  let inTasksSection = false
  let currentTask: ParsedTask | null = null
  for (const line of lines) {
    const h1Match = line.match(/^# (.+)$/)
    if (h1Match) { epicName = h1Match[1].trim(); continue }
    const h2Match = line.match(/^## (.+)$/)
    if (h2Match) { ... }
    const h3Match = line.match(/^### (.+)$/)
    if (h3Match && inTasksSection) { ... }
    if (currentTask) { ... }
  }
  tasks.forEach((t) => { t.spec = t.spec.trim() })
  return { epicName, tasks }
}
```
**Impact:** Markdown parsing is a data transformation that belongs in a service, not a handler file. While this is a minor violation (the function is exported and somewhat testable), it mixes transport concerns (IPC) with document parsing. It also makes the function harder to test in isolation—any test must import from the handler module.
**Recommendation:** Move `parsePlanMarkdown` and `importPlanFile` to a new `services/plan-import-service.ts`. Handler then calls it cleanly:
```typescript
safeHandle('planner:import', async (_e, repo: string) => {
  const filePath = await pickFile(...)
  const markdown = await readFile(filePath, 'utf-8')
  return planImportService.importPlanFile(markdown, { repo })
})
```
**Effort:** S
**Confidence:** Medium

---

## F-t1-ipc-thin-6: GitHub API Security Validation Rules in Handler-Level Functions
**Severity:** Low
**Category:** IPC Handler Thinness
**Location:** `src/main/handlers/git-handlers.ts:48–138`
**Evidence:**
```typescript
function getConfiguredRepos(): Set<string> { ... }
function extractRepoFromPath(path: string): { owner: string; repo: string } | null { ... }
function validatePatchBody(body: string | undefined): boolean { ... }
function isGitHubRequestAllowed(method: string, path: string, body?: string): boolean { ... }
```
These four helper functions contain GitHub API authorization logic and are tightly scoped to `git-handlers.ts`, making them hard to reuse or test independently.

**Impact:** GitHub API policy—what endpoints are allowed, what fields can be patched, which repos are trusted—is scattered across handler-level functions. If another handler needs to proxy GitHub API calls (e.g., `review.ts`), it cannot easily reuse this logic. This violates DRY and makes the policy centralization harder to audit.

**Recommendation:** Extract into `services/github-policy-service.ts`:
```typescript
export class GitHubPolicyService {
  constructor(repos: RepoConfig[]) { ... }
  isRequestAllowed(method: string, path: string, body?: string): boolean { ... }
  getConfiguredRepos(): Set<string> { ... }
}
```
Then handlers instantiate it at startup and call methods. This allows policy changes (e.g., blocking DELETE endpoints) to be made once.

**Effort:** M
**Confidence:** Medium

---

## Summary Table

| Finding | File | Severity | Type | Effort |
|---------|------|----------|------|--------|
| F-t1-ipc-thin-1 | agent-handlers.ts | Medium | Validation + Transform | S |
| F-t1-ipc-thin-2 | webhook-handlers.ts | Medium | Event Construction + HTTP | S |
| F-t1-ipc-thin-3 | agent-manager-handlers.ts | Medium | Git Orchestration | S |
| F-t1-ipc-thin-4 | sprint-batch-handlers.ts | Medium | Spec Validation (duplicated) | M |
| F-t1-ipc-thin-5 | planner-import.ts | Low | Markdown Parsing | S |
| F-t1-ipc-thin-6 | git-handlers.ts | Low | Policy Validation | M |

---

## Strengths
- **review.ts**: Excellent thin-wrapper pattern. Complex orchestration logic (git operations, diff parsing) is correctly delegated to `review-orchestration-service.ts`. Handler simply unpacks and calls.
- **sprint-local.ts**: Clean split. Task mutations are delegated to `sprint-service`. State transitions use `task-state-service`. Handlers focus on request validation + service dispatch.
- **synthesizer-handlers.ts**: Good fire-and-forget streaming pattern. Synthesis logic lives in `spec-synthesizer` service; handler manages stream lifecycle only.
- **config-handlers.ts**: Minimal and correct. Settings CRUD and validation are thin wrappers.
- **terminal-handlers.ts**: Appropriate state management (terminal ID tracking) in handler since it's process-local ephemeral state, not business logic.

---

## Recommendations (Priority Order)
1. **Extract adhoc-promotion-service** (F-t1-ipc-thin-1): Unblock future enhancements to promotion rules without touching handler.
2. **Extract webhook-delivery-service** (F-t1-ipc-thin-2): Prepare for retry/backoff logic that will inevitably be needed.
3. **Extract checkpoint-service** (F-t1-ipc-thin-3): Decouple agent snapshot orchestration from IPC boundary.
4. **Consolidate spec validation in sprint-batch-handlers** (F-t1-ipc-thin-4): Reuse `prepareQueueTransition` to eliminate duplication.
5. **Move plan-import-service** (F-t1-ipc-thin-5): Minor refactor; improves testability.
6. **Extract GitHubPolicyService** (F-t1-ipc-thin-6): Medium effort; enables policy reuse across handlers.

All six findings are **remediable without architectural changes** — they are tactical violations in otherwise sound design. No handler needs to be reorganized; only extractive refactoring is required.
