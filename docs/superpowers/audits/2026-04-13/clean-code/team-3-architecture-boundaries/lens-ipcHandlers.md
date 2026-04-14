# IPC Handlers Quality Audit — 2026-04-13

## Executive Summary

The IPC handler layer in this Electron app demonstrates **strong architectural discipline overall**. Most handlers correctly follow the pattern: validate input → delegate to service → return result. However, several critical issues identified below indicate that some handlers have absorbed too much business logic or validation complexity, violating the thin-adapter principle.

**Key Strengths:**
- Consistent use of `safeHandle()` wrapper across all files
- Thin registration file (`registry.ts`) that delegates to handler modules
- Good separation of concerns (export, batch, local, retry, review handlers in separate files)
- Service layer is the source of truth for business logic
- Error handling wrapped in `safeHandle` for consistent logging

**Key Weaknesses:**
- 2 handlers contain domain object construction that should delegate to factories
- 1 handler multiplexes multiple distinct operations without clear boundaries
- 2 handlers embed substantial conditional business logic instead of delegating
- Validation rules embedded in handlers when they should be service-owned

---

## Findings

### F-t3-ipcHandlers-1: Complex Operational Validation Logic Embedded in Handler

**Severity:** High  
**Category:** Handler Contains Business Logic  
**Location:** `src/main/handlers/workbench.ts:88-232` (workbench:checkOperational handler)

**Evidence:**
```typescript
safeHandle('workbench:checkOperational', async (_e, input: { repo: string }) => {
  // Auth check — 3 branches, 3 different result shapes
  const authStatus = await checkAuthStatus()
  let authResult: { status: 'pass' | 'warn' | 'fail'; message: string }
  if (!authStatus.tokenFound) {
    authResult = { status: 'fail', message: 'No Claude subscription...' }
  } else if (authStatus.tokenExpired) {
    authResult = { status: 'fail', message: 'Claude subscription token expired...' }
  } else if (authStatus.expiresAt) {
    const hoursUntilExpiry = (authStatus.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntilExpiry < 1) {
      authResult = { status: 'warn', message: `Token expires in ${Math.round(hoursUntilExpiry * 60)} minutes` }
    } else {
      authResult = { status: 'pass', message: 'Authentication valid' }
    }
  }

  // Repo path check (case-insensitive logic)
  // Git clean check (shell invocation, error handling)
  // Conflict check (task querying + filtering logic)
  // Agent slots available check (concurrency calculation)
  
  // Returns 5-tuple of different check shapes
  return { auth: authResult, repoPath: repoPathResult, gitClean: gitCleanResult, ... }
})
```

**Impact:**
- Handler is 145 lines of conditional business logic that belongs in a service (`OperationalCheckService`)
- Validation of auth expiry (the `1 hour` threshold) is a business rule embedded in IPC layer
- Git clean check, conflict detection, and slots calculation are distinct concerns mixed in one handler
- Testing this handler requires mocking Electron, filesystem, and git — should be testable as pure logic
- Future changes to token expiry policy or conflict detection rules require handler changes

**Recommendation:**
Extract to a new service:
```typescript
// services/operational-check-service.ts
export interface OperationalCheckResult {
  auth: CheckField
  repoPath: CheckField
  gitClean: CheckField
  noConflict: CheckField
  slotsAvailable: CheckField
}

export async function checkOperational(
  repo: string,
  am?: AgentManager
): Promise<OperationalCheckResult>
```

Then the handler becomes:
```typescript
safeHandle('workbench:checkOperational', async (_e, input) => {
  return checkOperational(input.repo, am)
})
```

**Effort:** M  
**Confidence:** High

---

### F-t3-ipcHandlers-2: Domain Object Construction Inline Instead of Via Factory

**Severity:** High  
**Category:** Domain Object Construction Inline  
**Location:** `src/main/handlers/agent-handlers.ts:167-180` (agents:promoteToReview handler)

**Evidence:**
```typescript
safeHandle('agents:promoteToReview', async (_e, agentId: string): Promise<PromoteToReviewResult> => {
  try {
    // ... validations ...
    
    // Derive a title from agent message (business logic inline)
    const firstLine =
      agent.task
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? 'Promoted adhoc agent'
    const title = firstLine.length > 120 
      ? firstLine.slice(0, 117) + '...' 
      : firstLine

    // Construct task object inline using `createReviewTaskFromAdhoc`
    const task = createReviewTaskFromAdhoc({
      title,
      repo: agent.repo,
      spec: agent.task,
      worktreePath: agent.worktreePath,
      branch: agent.branch
    })

    if (!task) {
      return { ok: false, error: 'Failed to create review task — see logs' }
    }

    return { ok: true, taskId: task.id }
  } catch (err) { ... }
})
```

**Impact:**
- Handler contains title-derivation logic (truncation, first-line extraction) that should be a named function in the domain layer
- The title rule ("take first line, cap at 120 chars") is a business rule that may change but is embedded in IPC
- No separation between validation, transformation, and persistence — mixing concerns
- If another endpoint needs to promote tasks, the title logic must be duplicated or extracted later

**Recommendation:**
Create a factory/builder service:
```typescript
// services/review-task-factory.ts
export function buildReviewTaskFromAdhoc(agent: AgentMeta): ReviewTaskInput {
  const title = deriveTitle(agent.task) // Extracted to pure function
  return {
    title,
    repo: agent.repo,
    spec: agent.task,
    worktreePath: agent.worktreePath,
    branch: agent.branch
  }
}

// Pure function, testable without IPC/database
function deriveTitle(taskText: string): string {
  const firstLine = taskText.split('\n').find((l) => l.trim())?.trim() ?? 'Promoted adhoc agent'
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine
}
```

Then the handler:
```typescript
safeHandle('agents:promoteToReview', async (_e, agentId: string) => {
  const agent = await getAgentMeta(agentId)
  if (!agent) return { ok: false, error: `Agent ${agentId} not found` }
  // ... validations ...
  
  const reviewTaskInput = buildReviewTaskFromAdhoc(agent)
  const task = createReviewTaskFromAdhoc(reviewTaskInput)
  
  return task ? { ok: true, taskId: task.id } : { ok: false, error: 'Failed to create' }
})
```

**Effort:** M  
**Confidence:** High

---

### F-t3-ipcHandlers-3: Auto-Review Rule Evaluation Logic Embedded in Handler

**Severity:** High  
**Category:** Handler Contains Business Logic  
**Location:** `src/main/handlers/review.ts:240-322` (review:checkAutoReview handler)

**Evidence:**
```typescript
safeHandle('review:checkAutoReview', async (_e, payload) => {
  // Load settings
  const rules = getSettingJson<Array<{ id, name, enabled, conditions, action }>>(
    'autoReview.rules'
  )
  if (!rules || rules.length === 0) {
    return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
  }

  // Run git diff (shell invocation)
  const { stdout: numstatOut } = await execFileAsync(
    'git',
    ['diff', '--numstat', 'origin/main...HEAD'],
    { cwd: task.worktree_path, env }
  )

  // Parse numstat into structured data
  const files = numstatOut
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const filePath = parts.slice(2).join('\t')
      return { path: filePath, additions, deletions }
    })

  // Evaluate rules (delegates to service — this part is OK)
  const { evaluateAutoReviewRules } = await import('../services/auto-review')
  const result = evaluateAutoReviewRules(rules, files)

  return { shouldAutoMerge: result.action === 'auto-merge', ... }
})
```

**Impact:**
- Handler orchestrates: git invocation + numstat parsing + rule evaluation
- Numstat parsing (the `.split('\t')` loop) is domain logic for analyzing diffs — belongs in service
- Handler is responsible for 3 concerns: fetch rules, parse diff, evaluate rules
- Testing requires mocking git and file system to exercise the parsing logic
- If numstat parsing needs enhancement (e.g., handle binary files), it's buried in handler

**Recommendation:**
Extract to dedicated service:
```typescript
// services/auto-review-check-service.ts
export async function checkAutoReviewEligibility(
  taskId: string,
  taskRepo: ISprintTaskRepository
): Promise<{ shouldAutoMerge: boolean; shouldAutoApprove: boolean; matchedRule: string | null }>

// Pure function, testable without git
export function parseNumstat(stdout: string): Array<{ path: string; additions: number; deletions: number }>
```

Then handler becomes:
```typescript
safeHandle('review:checkAutoReview', async (_e, payload) => {
  return checkAutoReviewEligibility(payload.taskId, repo)
})
```

**Effort:** M  
**Confidence:** High

---

### F-t3-ipcHandlers-4: Workbench Repository Research Embeds Grep Logic

**Severity:** Medium  
**Category:** Handler Contains Business Logic  
**Location:** `src/main/handlers/workbench.ts:235-292` (workbench:researchRepo handler)

**Evidence:**
```typescript
safeHandle('workbench:researchRepo', async (_e, input: { query: string; repo: string }) => {
  const repoPath = getRepoPath(input.repo)
  if (!repoPath) { ... }

  try {
    // Shell invocation
    const { stdout } = await execFileAsync('grep', ['-rn', '-i', '--', query, '.'], {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024
    })

    // Parse grep output into structured format
    const lines = stdout.trim().split('\n').filter(Boolean)
    const fileMap = new Map<string, string[]>()

    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (!match) continue
      const [, file, lineNum, content] = match
      if (!fileMap.has(file)) {
        fileMap.set(file, [])
      }
      fileMap.get(file)!.push(`${lineNum}: ${content.trim()}`)
    }

    // Format results
    const filesSearched = Array.from(fileMap.keys()).slice(0, 10)
    const totalMatches = fileMap.size
    let content = `Found ${totalMatches} file(s) matching...`
    for (const file of filesSearched) {
      const matches = fileMap.get(file)!.slice(0, 3)
      content += `**${file}**\n${matches.join('\n')}\n\n`
    }

    return { content, filesSearched, totalMatches }
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 1) { ... }
    return { content: `No matches found...`, filesSearched: [], totalMatches: 0 }
  }
})
```

**Impact:**
- Handler contains regex parsing of grep output + structured result building
- The grep output format parsing is domain logic for search operations
- Error handling conflates "no matches" (code 1) with other errors — policy mixed into handler
- Testing requires subprocess mocking
- Future search enhancements (ripgrep instead of grep, file type filtering) require handler changes

**Recommendation:**
Extract to service:
```typescript
// services/repo-research-service.ts
export async function searchRepo(
  repoPath: string,
  query: string
): Promise<{ files: Array<{ path: string; matches: string[] }>; totalMatches: number }>

// Pure function, testable without shell
export function parseGrepOutput(
  stdout: string
): Map<string, string[]>
```

Then handler:
```typescript
safeHandle('workbench:researchRepo', async (_e, input) => {
  const repoPath = getRepoPath(input.repo)
  if (!repoPath) throw new Error(`Repo not configured: ${input.repo}`)
  
  const result = await searchRepo(repoPath, input.query)
  return formatSearchResult(result)
})
```

**Effort:** S  
**Confidence:** High

---

### F-t3-ipcHandlers-5: Sprint Batch Operations Duplicate Validation Logic

**Severity:** Medium  
**Category:** Handler Contains Business Logic  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:22-115` (sprint:batchUpdate handler)

**Evidence:**
```typescript
safeHandle('sprint:batchUpdate', async (_e, operations: Array<{ op: 'update' | 'delete'; id: string; patch?: Record<string, unknown> }>) => {
  const { GENERAL_PATCH_FIELDS } = await import('../../shared/types')
  const results: Array<{ id: string; op: 'update' | 'delete'; ok: boolean; error?: string }> = []

  for (const rawOp of operations) {
    const { id, op, patch } = rawOp
    if (!id || !op) {
      results.push({ id: id ?? 'unknown', op: op as 'update' | 'delete', ok: false, error: 'id and op are required' })
      continue
    }
    try {
      if (op === 'update') {
        if (!patch || typeof patch !== 'object') {
          results.push({ id, op: 'update', ok: false, error: 'patch object required for update' })
          continue
        }
        
        // Duplicate validation: filtering patch fields
        const filtered: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(patch)) {
          if (GENERAL_PATCH_FIELDS.has(k)) filtered[k] = v
        }
        if (Object.keys(filtered).length === 0) {
          results.push({ id, op: 'update', ok: false, error: 'No valid fields to update' })
          continue
        }

        // Duplicate queuing transition logic
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

        const updated = updateTask(id, filtered)
        // ... fire terminal callback ...
      } else if (op === 'delete') {
        deleteTask(id)
        results.push({ id, op: 'delete', ok: true })
      }
    } catch (err) {
      results.push({ id, op, ok: false, error: String(err) })
    }
  }

  return { results }
})
```

**Impact:**
- Batch handler re-implements patch field filtering that `sprint-local.ts` does individually
- The "queued status" validation (spec quality check) is duplicated between `sprint:update` and `sprint:batchUpdate`
- Handler is responsible for: field validation, status transition logic, batch coordination, error collection
- If the queuing rules change (e.g., new pre-queue checks), both handlers must be updated
- This is a classic "copy-paste handler" problem

**Recommendation:**
Extract batch operation coordination to a service:
```typescript
// services/batch-operation-service.ts
export async function executeBatchOperations(
  operations: Array<{ op: 'update' | 'delete'; id: string; patch?: Record<string, unknown> }>
): Promise<{ results: Array<{ id: string; op: string; ok: boolean; error?: string }> }>

// Reuse single-operation logic from existing services
```

Then both handlers can call a shared operation executor instead of duplicating the logic.

**Effort:** M  
**Confidence:** Medium

---

### F-t3-ipcHandlers-6: GitHub API Security Logic Embedded in Handler

**Severity:** Medium  
**Category:** Handler Contains Business Logic  
**Location:** `src/main/handlers/git-handlers.ts:94-137` (github:fetch handler)

**Evidence:**
```typescript
const GITHUB_API_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/user$/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls/ },
  // ...
  { method: 'PATCH', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+/ },
]

function isGitHubRequestAllowed(method: string, path: string, body?: string): boolean {
  const normalizedMethod = method.toUpperCase()

  const matchesPattern = GITHUB_API_ALLOWLIST.some(
    (entry) => entry.method === normalizedMethod && entry.pattern.test(path)
  )
  if (!matchesPattern) return false

  // PR-3: Validate repo is in configured repos
  const repoInfo = extractRepoFromPath(path)
  if (repoInfo) {
    const configuredRepos = getConfiguredRepos()
    const repoKey = `${repoInfo.owner}/${repoInfo.repo}`
    if (!configuredRepos.has(repoKey)) {
      logger.warn(`github:fetch rejected: repo ${repoKey} not in configured repos`)
      return false
    }
  }

  // PR-4: For PATCH requests, only allow title/body fields
  if (normalizedMethod === 'PATCH' && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(path)) {
    if (!validatePatchBody(body)) {
      logger.warn(`github:fetch rejected: PATCH body contains disallowed fields`)
      return false
    }
  }

  return true
}

safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
  // ... URL parsing ...
  
  const method = init?.method ?? 'GET'
  if (!isGitHubRequestAllowed(method, apiPath, init?.body)) {
    logger.warn(`github:fetch rejected: ${method} ${apiPath}`)
    return { ok: false, status: 0, body: { error: '...' }, linkNext: null }
  }

  // ... fetch and return ...
})
```

**Impact:**
- Security policy (allowlist patterns, repo validation, PATCH body restrictions) is embedded in handler
- If security rules need to change (e.g., add new GET endpoint, remove a PATCH operation), handler must change
- The allowlist and validation functions are handler-specific; hard to test outside of IPC context
- Policy rules and technical enforcement are mixed in one function
- No clear audit trail of _why_ certain endpoints are allowed

**Recommendation:**
Extract security policy to a dedicated service or configuration module:
```typescript
// services/github-security-policy.ts
export class GitHubSecurityPolicy {
  constructor(configuredRepos: Set<string>) { ... }
  
  validateRequest(method: string, path: string, body?: string): { allowed: boolean; reason?: string }
}

// config/github-allowlist.ts
export const GITHUB_API_ALLOWLIST = [
  { method: 'GET', pattern: /^\/user$/, reason: 'User profile lookup' },
  // ... with documentation
]
```

Then handler becomes:
```typescript
const policy = new GitHubSecurityPolicy(getConfiguredRepos())

safeHandle('github:fetch', async (_e, path, init) => {
  const validation = policy.validateRequest(init?.method ?? 'GET', apiPath, init?.body)
  if (!validation.allowed) {
    return { ok: false, status: 0, body: { error: validation.reason }, linkNext: null }
  }
  // ... fetch ...
})
```

**Effort:** M  
**Confidence:** Medium

---

### F-t3-ipcHandlers-7: Handler Multiplexes Distinct Operations (agents:promoteToReview Does Too Much)

**Severity:** Medium  
**Category:** Fat Handler  
**Location:** `src/main/handlers/agent-handlers.ts:126-195` (agents:promoteToReview handler)

**Evidence:**
The single `agents:promoteToReview` handler orchestrates:
1. Agent metadata lookup
2. Validation: worktree exists, has commits
3. Git commit count check via `execFileAsync('git', ['rev-list', '--count', ...])`
4. Business rule: derive a title from the agent's task
5. Domain object construction: create a review task
6. Logging and error handling

This is actually multiple distinct operations bundled into one handler:
- **Operation A:** Validate agent promotion eligibility
- **Operation B:** Derive human-readable title
- **Operation C:** Create review task
- **Operation D:** Return task ID

**Impact:**
- Handler is a microservice; should be split into: validation service + promotion service
- If eligibility rules change (e.g., require approval workflow), the handler changes
- Title derivation is a separate concern (UI transformation) mixed with persistence logic
- Testing requires multiple mocks; hard to unit test the business logic

**Recommendation:**
Consider splitting into:
```typescript
// services/agent-promotion-service.ts
export interface PromotionEligibility {
  eligible: boolean
  reason?: string
}

export async function checkPromotionEligibility(agent: AgentMeta): Promise<PromotionEligibility>

export async function promoteAgentToReview(agent: AgentMeta): Promise<SprintTask | null>

// services/agent-title-service.ts
export function deriveReviewTaskTitle(agentTask: string): string

// handlers/agent-handlers.ts
safeHandle('agents:promoteToReview', async (_e, agentId) => {
  const agent = await getAgentMeta(agentId)
  if (!agent) return { ok: false, error: `Agent not found: ${agentId}` }
  
  const eligibility = await checkPromotionEligibility(agent)
  if (!eligibility.eligible) {
    return { ok: false, error: eligibility.reason }
  }
  
  const task = await promoteAgentToReview(agent)
  return task ? { ok: true, taskId: task.id } : { ok: false, error: 'Promotion failed' }
})
```

**Effort:** M  
**Confidence:** Medium

---

### F-t3-ipcHandlers-8: Preload Surface Area Exposes Too Many Implementation Details

**Severity:** Low  
**Category:** Inconsistent Design  
**Location:** `src/preload/index.ts:1-100` (partial view)

**Evidence:**
The preload file exposes a very large API surface (100+ lines visible, likely 200+ total). While each individual handler is thin, the preload layer itself does not aggregate or provide semantic grouping. Examples of low-level exposure:

```typescript
// These are all at the top level of the API
api.gitStatus(cwd)          // Git operation A
api.gitDiff(cwd, file)      // Git operation B
api.gitStage(cwd, files)    // Git operation C
api.gitUnstage(cwd, files)  // Git operation D
api.gitCommit(message)      // Git operation E
api.gitPush(cwd)            // Git operation F
// ... 6 more git operations

// Settings scattered across namespace
api.settings.get(key)
api.settings.set(key, value)
api.settings.getJson(key)
api.settings.setJson(key, value)
api.settings.delete(key)
api.settings.saveProfile(name)
api.settings.loadProfile(name)
api.settings.applyProfile(name)
api.settings.listProfiles()
api.settings.deleteProfile(name)
```

**Impact:**
- Renderer can call 50+ distinct IPC channels directly — hard to reason about state coordination
- No semantic grouping of related operations (e.g., git history vs. git staging)
- Adding a new operation requires handler + IPC channel + preload entry — 3 places to change
- No facade to enforce operation ordering (e.g., "stage before commit")
- Large API surface increases the attack surface if security rules change

**Recommendation:**
Consider grouping related operations into semantic facades:
```typescript
// Suggested refactor (not urgent, low-priority):
api.git = {
  status: (cwd) => typedInvoke('git:status', cwd),
  diff: (cwd, file?) => typedInvoke('git:diff', cwd, file),
  staging: {
    stage: (cwd, files) => typedInvoke('git:stage', cwd, files),
    unstage: (cwd, files) => typedInvoke('git:unstage', cwd, files)
  },
  commits: {
    commit: (cwd, msg) => typedInvoke('git:commit', cwd, msg),
    push: (cwd) => typedInvoke('git:push', cwd)
  }
}
```

This is a **style issue** rather than a correctness issue; the handlers themselves are fine. Low priority.

**Effort:** L  
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Category | File | Issue Type |
|---------|----------|----------|------|-----------|
| F-t3-ipcHandlers-1 | High | Business Logic | workbench.ts:88-232 | Handler (145 lines) embeds operational validation |
| F-t3-ipcHandlers-2 | High | Domain Construction | agent-handlers.ts:167-180 | Title derivation + object construction inline |
| F-t3-ipcHandlers-3 | High | Business Logic | review.ts:240-322 | Git diff parsing + rule evaluation embedded |
| F-t3-ipcHandlers-4 | Medium | Business Logic | workbench.ts:235-292 | Grep output parsing in handler |
| F-t3-ipcHandlers-5 | Medium | Business Logic | sprint-batch-handlers.ts:22-115 | Duplicated validation logic (patch filtering, queuing rules) |
| F-t3-ipcHandlers-6 | Medium | Business Logic | git-handlers.ts:94-137 | Security policy embedded in handler |
| F-t3-ipcHandlers-7 | Medium | Fat Handler | agent-handlers.ts:126-195 | Single handler multiplexes validation + transformation + persistence |
| F-t3-ipcHandlers-8 | Low | Design | preload/index.ts | Large API surface lacks semantic grouping (style issue) |

---

## Prioritization Roadmap

**Phase 1 (Critical)** — Extract 3 High-severity findings:
1. Extract `OperationalCheckService` from workbench:checkOperational
2. Extract `ReviewTaskFactory` + title derivation from agents:promoteToReview
3. Extract `AutoReviewCheckService` + numstat parsing from review:checkAutoReview

**Phase 2 (Important)** — Extract 3 Medium-severity findings:
4. Extract `RepoSearchService` with grep parsing from workbench:researchRepo
5. Extract `BatchOperationService` to unify validation logic
6. Extract `GitHubSecurityPolicy` from git-handlers.ts

**Phase 3 (Nice-to-Have)** — Refactor preload API surface (low urgency)

---

## Positive Observations

**What's Working Well:**

1. **Consistent use of `safeHandle()` wrapper** — All handlers use the wrapper, enabling centralized error logging
2. **Thin registration file** (`registry.ts`) — Doesn't contain implementation; purely orchestrates registration
3. **Service layer ownership** — Business logic lives in `services/`, not handlers
4. **Clear IPC channel boundaries** — Each handler maps to a single, well-named channel
5. **Dependency injection** — Handlers receive dependencies (repo, terminalService, etc.) rather than globals
6. **Good error messages** — Handlers provide actionable error context to the renderer

These strengths make the refactoring work straightforward; the patterns are already established.

