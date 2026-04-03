# PR Creation Retry + Branch-Only Surfacing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry PR creation with backoff when `gh pr create` fails, and surface "branch pushed, no PR" as a distinct visible state (`pr_status: 'branch_only'`) in the UI instead of silently orphaning the task.

**Architecture:** Add retry logic (3 attempts, 3s/8s backoff) to `createNewPr` in `completion.ts`. Introduce `'branch_only'` as a new `pr_status` value. When all retries exhaust, set `pr_status: 'branch_only'` with branch name in `notes`. The partition logic routes `branch_only` to `awaitingReview`. TaskPill shows an amber warning style; TaskDetailDrawer shows the branch name and a "Create PR" link to GitHub's `/pull/new/` URL.

**Tech Stack:** TypeScript, Vitest, React, CSS

---

### Task 1: Add `branch_only` to constants and types

**Files:**

- Modify: `src/shared/constants.ts:19-24`
- Modify: `src/shared/types.ts:44`

- [ ] **Step 1: Add `BRANCH_ONLY` to `PR_STATUS` in constants**

In `src/shared/constants.ts`, add the new value:

```typescript
export const PR_STATUS = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
  DRAFT: 'draft',
  BRANCH_ONLY: 'branch_only'
} as const
```

- [ ] **Step 2: Add `'branch_only'` to the `pr_status` type union in types**

In `src/shared/types.ts` line 44, update:

```typescript
pr_status: 'open' | 'merged' | 'closed' | 'draft' | 'branch_only' | null
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts src/shared/types.ts
git commit -m "feat: add branch_only pr_status constant and type"
```

---

### Task 2: Add retry logic to PR creation in `completion.ts`

**Files:**

- Modify: `src/main/agent-manager/completion.ts:140-181` (the `createNewPr` function)
- Modify: `src/main/agent-manager/completion.ts:317-330` (the PR result handler in `resolveSuccess`)

- [ ] **Step 1: Add a `sleep` helper and retry constants at the top of `completion.ts`**

After the existing imports, add:

```typescript
const PR_CREATE_MAX_ATTEMPTS = 3
const PR_CREATE_BACKOFF_MS = [3000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Wrap `createNewPr` internals with retry loop**

Replace the `createNewPr` function body with a retry loop. The function signature stays the same. The retry wraps only the `gh pr create` call (not the body generation):

```typescript
async function createNewPr(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  let prUrl: string | null = null
  let prNumber: number | null = null
  let lastError: unknown = null

  const body = await generatePrBody(worktreePath, branch)

  for (let attempt = 0; attempt < PR_CREATE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs =
        PR_CREATE_BACKOFF_MS[attempt - 1] ?? PR_CREATE_BACKOFF_MS[PR_CREATE_BACKOFF_MS.length - 1]
      logger.info(
        `[completion] Retrying PR creation for branch ${branch} (attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS}) after ${delayMs}ms`
      )
      await sleep(delayMs)
    }

    try {
      const { stdout: prOut } = await execFile(
        'gh',
        ['pr', 'create', '--title', title, '--body', body, '--head', branch, '--repo', ghRepo],
        { cwd: worktreePath, env: buildAgentEnv() }
      )
      const parsed = parsePrOutput(prOut)
      prUrl = parsed.prUrl
      prNumber = parsed.prNumber
      logger.info(`[completion] created new PR ${prUrl}`)
      return { prUrl, prNumber }
    } catch (err) {
      lastError = err
      const errMsg = String(err)

      // If PR creation failed because one already exists (race condition), fetch it immediately
      if (errMsg.includes('already exists') || errMsg.includes('pull request already exists')) {
        logger.info(
          `[completion] PR creation failed because one already exists, fetching existing PR`
        )
        const existing = await checkExistingPr(worktreePath, branch, logger)
        if (existing) {
          return { prUrl: existing.prUrl, prNumber: existing.prNumber }
        }
      }

      logger.warn(
        `[completion] gh pr create attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS} failed: ${err}`
      )
    }
  }

  logger.warn(
    `[completion] PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts for branch ${branch}: ${lastError}`
  )
  return { prUrl: null, prNumber: null }
}
```

- [ ] **Step 3: Update `resolveSuccess` to set `branch_only` when PR creation fails**

Replace the existing PR result handler block (the section after `findOrCreatePR` call, lines ~320-330) with:

```typescript
// 6. Update task with PR info (task stays active; SprintPrPoller handles done on merge)
try {
  if (prUrl !== null && prNumber !== null) {
    repo.updateTask(taskId, { pr_status: 'open', pr_url: prUrl, pr_number: prNumber })
  } else {
    // Branch pushed but PR creation exhausted retries — mark as branch_only
    // so the UI shows a "Create PR" link instead of silently orphaning
    repo.updateTask(taskId, {
      pr_status: 'branch_only',
      notes: `Branch ${branch} pushed to ${ghRepo} but PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts`
    })
    logger.warn(
      `[completion] Task ${taskId}: branch ${branch} pushed, PR creation failed — set pr_status=branch_only`
    )
  }
} catch (err) {
  logger.error(`[completion] Failed to update task ${taskId} with PR info: ${err}`)
}
```

- [ ] **Step 4: Export `PR_CREATE_MAX_ATTEMPTS` for use in tests**

Add to the exports at the bottom or use named export at the declaration:

```typescript
export { PR_CREATE_MAX_ATTEMPTS }
```

(Or just export it inline with the const declaration.)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion.ts
git commit -m "feat: retry PR creation with backoff and set branch_only on exhaustion"
```

---

### Task 3: Update completion tests

**Files:**

- Modify: `src/main/agent-manager/__tests__/completion.test.ts`

- [ ] **Step 1: Update the existing "gh pr create fails" test to verify `branch_only`**

The test at line 215 ("pushes branch and records notes when gh pr create fails") currently expects `notes` only. Update it to also expect `pr_status: 'branch_only'`. The mock sequence needs to account for retry attempts (3 total `gh pr create` calls):

```typescript
it('sets pr_status=branch_only when gh pr create fails after retries', async () => {
  let callIndex = 0
  const responses: Array<{ stdout?: string; error?: Error }> = [
    { stdout: 'agent/add-login-page\n' }, // git rev-parse
    { stdout: '' }, // git status --porcelain
    { stdout: '1\n' }, // git rev-list --count
    { stdout: '' }, // git push
    { stdout: '' }, // gh pr list (no existing PR)
    { stdout: '' }, // git log (generatePrBody)
    { stdout: '' }, // git diff --stat (generatePrBody)
    { error: new Error('gh: authentication error') }, // attempt 1 fails
    { error: new Error('gh: authentication error') }, // attempt 2 fails
    { error: new Error('gh: authentication error') } // attempt 3 fails
  ]
  getCustomMock().mockImplementation((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { stdout: '' }
    callIndex++
    if (resp.error) return Promise.reject(resp.error)
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
  })

  await resolveSuccess(opts, noopLogger)

  const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
  expect(patch.pr_status).toBe('branch_only')
  expect(patch.notes).toContain('Branch agent/add-login-page pushed but PR creation failed')
})
```

- [ ] **Step 2: Add test for successful retry on second attempt**

```typescript
it('retries PR creation and succeeds on second attempt', async () => {
  let callIndex = 0
  const responses: Array<{ stdout?: string; error?: Error }> = [
    { stdout: 'agent/add-login-page\n' }, // git rev-parse
    { stdout: '' }, // git status --porcelain
    { stdout: '1\n' }, // git rev-list --count
    { stdout: '' }, // git push
    { stdout: '' }, // gh pr list (no existing PR)
    { stdout: '' }, // git log (generatePrBody)
    { stdout: '' }, // git diff --stat (generatePrBody)
    { error: new Error('gh: rate limit') }, // attempt 1 fails
    { stdout: 'https://github.com/owner/repo/pull/50\n' } // attempt 2 succeeds
  ]
  getCustomMock().mockImplementation((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { stdout: '' }
    callIndex++
    if (resp.error) return Promise.reject(resp.error)
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
  })

  await resolveSuccess(opts, noopLogger)

  expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
    pr_status: 'open',
    pr_url: 'https://github.com/owner/repo/pull/50',
    pr_number: 50
  })
})
```

Note: These tests will be slow due to the backoff sleeps. Either use `vi.useFakeTimers()` or accept ~11s test time. Fake timers are recommended:

```typescript
// At the top of the retry tests:
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

// In each test, after calling resolveSuccess, advance timers:
const promise = resolveSuccess(opts, noopLogger)
await vi.advanceTimersByTimeAsync(3000) // first retry delay
await vi.advanceTimersByTimeAsync(8000) // second retry delay
await promise
```

- [ ] **Step 3: Run completion tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/completion.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/__tests__/completion.test.ts
git commit -m "test: add completion tests for PR creation retry and branch_only status"
```

---

### Task 4: Update partition logic for `branch_only`

**Files:**

- Modify: `src/renderer/src/lib/partitionSprintTasks.ts:47-52`
- Modify: `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test in `partitionSprintTasks.test.ts`:

```typescript
it('routes active task with pr_status=branch_only to awaitingReview', () => {
  const task = makeTask({ status: 'active', pr_status: 'branch_only' })
  const result = partitionSprintTasks([task])
  expect(result.awaitingReview).toContain(task)
  expect(result.inProgress).toHaveLength(0)
})
```

(Adapt `makeTask` to match the test file's existing factory pattern.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
Expected: FAIL — `branch_only` currently routes to `inProgress` (falls through to the else branch)

- [ ] **Step 3: Update partition logic**

In `partitionSprintTasks.ts`, update the `ACTIVE` case (lines 47-52):

```typescript
case TASK_STATUS.ACTIVE:
  if (task.pr_status === PR_STATUS.OPEN || task.pr_status === PR_STATUS.BRANCH_ONLY) {
    awaitingReview.push(task)
  } else {
    inProgress.push(task)
  }
  break
```

Import `PR_STATUS` is already imported. `BRANCH_ONLY` is the new constant added in Task 1.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/partitionSprintTasks.ts src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts
git commit -m "feat: route branch_only tasks to awaitingReview partition"
```

---

### Task 5: Update TaskPill styling for `branch_only`

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskPill.tsx:12-18`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css` (after line ~406)
- Modify: `src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`

- [ ] **Step 1: Write failing test for branch_only pill class**

In `TaskPill.test.tsx`, add:

```typescript
it('applies task-pill--branch-only class when pr_status is branch_only', () => {
  render(<TaskPill task={{ ...baseTask, status: 'active', pr_status: 'branch_only' }} selected={false} onClick={vi.fn()} />)
  const pill = screen.getByTestId('task-pill')
  expect(pill.className).toContain('task-pill--branch-only')
})
```

(Adapt `baseTask` to match the test file's existing fixture.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update `getStatusClass` in TaskPill.tsx**

```typescript
function getStatusClass(status: string, prStatus?: string | null): string {
  if (prStatus === 'branch_only') return 'task-pill--branch-only'
  if (status === 'active' && prStatus !== 'open') return 'task-pill--active'
  if (status === 'blocked') return 'task-pill--blocked'
  if ((status === 'active' || status === 'done') && prStatus === 'open') return 'task-pill--review'
  if (status === 'done') return 'task-pill--done'
  return ''
}
```

The `branch_only` check goes first — it should take precedence regardless of task status.

- [ ] **Step 4: Add CSS for `.task-pill--branch-only`**

In `src/renderer/src/assets/sprint-pipeline-neon.css`, after the `.task-pill--review` block (around line 406):

```css
.task-pill--branch-only {
  border-color: var(--neon-orange-border);
  background: var(--neon-orange-surface);
}

.task-pill--branch-only:hover {
  border-color: rgba(255, 159, 10, 0.5);
  box-shadow: 0 0 12px rgba(255, 159, 10, 0.15);
}
```

This uses the orange/amber treatment (same as `--blocked`) to signal "needs attention."

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/TaskPill.tsx src/renderer/src/assets/sprint-pipeline-neon.css src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
git commit -m "feat: add branch-only amber styling to TaskPill"
```

---

### Task 6: Update TaskDetailDrawer for `branch_only` state

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:205-213`
- Modify: `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`

- [ ] **Step 1: Write failing test for branch_only drawer display**

In `TaskDetailDrawer.test.tsx`, add:

```typescript
it('shows "Create PR" link when pr_status is branch_only', () => {
  const task = { ...baseTask, status: 'active', pr_status: 'branch_only', notes: 'Branch agent/fix-foo pushed but PR creation failed after 3 attempts' }
  render(<TaskDetailDrawer task={task} {...defaultHandlers} />)
  expect(screen.getByText(/branch pushed/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /create pr/i })).toBeInTheDocument()
})
```

(Adapt fixtures to match existing test patterns.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update the PR section in TaskDetailDrawer**

Replace the PR section (lines 205-213) with:

```tsx
{
  /* PR section */
}
{
  task.pr_url && task.pr_number && (
    <div className="task-drawer__field">
      <span className="task-drawer__label">PR</span>
      <span className="task-drawer__value">
        #{task.pr_number} ({task.pr_status ?? 'unknown'})
      </span>
    </div>
  )
}

{
  /* Branch-only: PR creation failed */
}
{
  task.pr_status === 'branch_only' && (
    <div className="task-drawer__branch-only">
      <span className="task-drawer__label">Branch pushed</span>
      <span className="task-drawer__value task-drawer__value--warning">
        PR creation failed after retries
      </span>
      {task.notes &&
        (() => {
          const match = task.notes.match(/Branch\s+(\S+)\s+pushed/)
          if (!match) return null
          const branch = match[1]
          return (
            <a
              className="task-drawer__btn task-drawer__btn--primary"
              href={`https://github.com/${task.repo}/pull/new/${branch}`}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: '8px', display: 'inline-block' }}
            >
              Create PR →
            </a>
          )
        })()}
    </div>
  )
}
```

Note: `task.repo` here is the short name (e.g., `"BDE"`), not the GitHub `owner/repo` format. The GitHub URL needs `owner/repo`. Check how the existing PR links are constructed — if `task.pr_url` contains the full GitHub URL, we may need to extract owner/repo from there. But for `branch_only`, there's no `pr_url`. We have two options:

**Option A:** Store the `ghRepo` (e.g., `RyanBirkeland/BDE`) in the notes alongside the branch name. Update the notes format in `completion.ts` to: `"Branch agent/fix-foo pushed to RyanBirkeland/BDE but PR creation failed after 3 attempts"`.

**Option B:** Use a lookup from the `repos` setting via IPC.

Option A is simpler. Update the notes format in Task 2 accordingly, and the regex to: `/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/` extracting `[branch, ghRepo]`.

Updated `completion.ts` notes line (in Task 2, Step 3):

```typescript
notes: `Branch ${branch} pushed to ${ghRepo} but PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts`
```

Updated drawer extraction:

```tsx
const match = task.notes.match(/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/)
if (!match) return null
const [, branch, ghRepo] = match
return (
  <a
    className="task-drawer__btn task-drawer__btn--primary"
    href={`https://github.com/${ghRepo}/pull/new/${branch}`}
    target="_blank"
    rel="noreferrer"
    style={{ marginTop: '8px', display: 'inline-block' }}
  >
    Create PR →
  </a>
)
```

- [ ] **Step 4: Add minimal CSS for the warning value**

In `sprint-pipeline-neon.css`, add:

```css
.task-drawer__value--warning {
  color: var(--neon-orange);
}

.task-drawer__branch-only {
  padding: 8px 0;
  border-top: 1px solid var(--neon-orange-border);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/assets/sprint-pipeline-neon.css src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
git commit -m "feat: show Create PR link in drawer for branch_only tasks"
```

---

### Task 7: Update orphan recovery to recognize `branch_only`

**Files:**

- Modify: `src/main/agent-manager/orphan-recovery.ts:17`
- Modify: `src/main/agent-manager/__tests__/orphan-recovery.test.ts`

- [ ] **Step 1: Write failing test**

Add a test that a task with `pr_status='branch_only'` and no `pr_url` is NOT requeued:

```typescript
it('does not requeue task with pr_status=branch_only (treated like has-PR)', async () => {
  const branchOnlyTask = makeTask('task-branch-only')
  branchOnlyTask.pr_status = 'branch_only'
  branchOnlyTask.pr_url = null // no pr_url, but has branch_only status
  getOrphanedTasksMock.mockReturnValue([branchOnlyTask])

  const count = await recoverOrphans(isAgentActiveMock, mockRepo, mockLogger)

  expect(count).toBe(0)
  // Should clear claimed_by but NOT requeue
  expect(mockRepo.updateTask).toHaveBeenCalledWith('task-branch-only', { claimed_by: null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/orphan-recovery.test.ts`
Expected: FAIL — currently the code checks `task.pr_url`, not `task.pr_status`

- [ ] **Step 3: Update orphan recovery guard**

In `orphan-recovery.ts`, update line 17 from:

```typescript
if (task.pr_url) {
```

to:

```typescript
if (task.pr_url || task.pr_status === 'branch_only') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/orphan-recovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/orphan-recovery.ts src/main/agent-manager/__tests__/orphan-recovery.test.ts
git commit -m "fix: prevent orphan recovery from requeuing branch_only tasks"
```

---

### Task 8: Run full test suite and verify

- [ ] **Step 1: Run renderer tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 2: Run main process tests**

Run: `npm run test:main`
Expected: All pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Final commit if any fixups needed, then push**

```bash
git push origin <branch>
```
