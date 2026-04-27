# Completion Verification Rewrite — Implementation Plan (RC2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the commit-subject string match in the completion "tip-mismatch" guard with a branch-name–based task-id extraction, so that clean conventional commits (`fix(foo): ...`) on an agent branch are no longer falsely rejected.

**Architecture:** The completion flow in `src/main/agent-manager/completion.ts` currently accepts the branch tip only when its commit subject contains the task UUID, the task title verbatim, or the task id. Convention-following agents don't produce any of those in their subjects, so every successful run is rejected. The fix moves the authoritative task-id signal to the **branch name** (which always encodes `agent/t-<id>-...`), with commit-subject matching retained as a secondary fallback for forward compatibility.

**Tech Stack:** vitest, `node:child_process` (`git` CLI already in use by completion).

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 2.

---

### Task 1: Locate the current completion guard and document its decision points

- [ ] **Step 1: Read the current completion check**

Run:
```bash
grep -n "tip-mismatch\|extractTaskId\|branch tip\|does not reference this task\|Expected one of" src/main/agent-manager/completion.ts
```

Read the surrounding ~60 lines of context (roughly the `checkBranchTipMatchesTask` function — name may differ; find it by the log message pattern `Branch tip on agent/...`).

- [ ] **Step 2: Note the current "expected one of" candidates**

The existing code builds a set of acceptable strings. Based on wave-2 failure output, they are:
- The task's `agent_run_id` (UUID string)
- The task's `title` verbatim (e.g. "T-21 · Unit-test attachRendererLoadRetry")
- The task's `id` (e.g. "audit-20260420-t-21")

Record the exact variable names and acceptance set as comments in a scratch note — this is the behavior Task 3 replaces.

- [ ] **Step 3: Confirm the guard's inputs**

The function receives (at minimum): the `task` row and the agent's branch name. Verify this by reading the call site — search for how the guard is invoked:

```bash
grep -n "checkBranchTip\|tip-mismatch" src/main/agent-manager/*.ts
```

No code change in this task. Continue when you have the existing function's signature and the acceptance-set composition on paper.

- [ ] **Step 4: No commit**

Investigation-only step.

---

### Task 2: Create `extractTaskIdFromBranch` with tests

**Files:**
- Modify: `src/main/agent-manager/completion.ts` (add an exported helper)
- Modify: `src/main/agent-manager/completion.test.ts` (create the file if missing)

- [ ] **Step 1: Create (or extend) the test file with the extractor cases**

If `src/main/agent-manager/completion.test.ts` does not exist, create it. Otherwise append:

```typescript
import { describe, it, expect } from 'vitest'
import { extractTaskIdFromBranch } from '../completion'

describe('extractTaskIdFromBranch', () => {
  it('extracts the task id from a standard agent branch name', () => {
    // Task id: audit-20260420-t-11
    // Branch:  agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef
    // The prefix after `agent/t-` plus the task id suffix must align:
    // extractor returns the short task id ('t-11' or '11') that the caller
    // normalizes against the full task id.
    expect(
      extractTaskIdFromBranch('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef')
    ).toBe('11')
  })

  it('handles alphanumeric task ids', () => {
    expect(
      extractTaskIdFromBranch('agent/t-abc123-some-slugified-title-12345678')
    ).toBe('abc123')
  })

  it('handles multi-word task ids with embedded dashes', () => {
    // Some historical task ids are structured like 'audit-20260420-t-11'.
    // The branch encodes only the numeric/alpha suffix after `t-`; the
    // extractor returns that suffix only. Caller matches against the
    // task row's id by suffix-comparison.
    expect(
      extractTaskIdFromBranch('agent/t-20260420-audit-worktree-base-064f79ef')
    ).toBe('20260420')
  })

  it('returns null for a malformed branch name', () => {
    expect(extractTaskIdFromBranch('main')).toBeNull()
    expect(extractTaskIdFromBranch('feat/something')).toBeNull()
    expect(extractTaskIdFromBranch('agent/no-t-prefix-here-12345678')).toBeNull()
  })

  it('returns null when the group-hash suffix is missing', () => {
    // The 8-char hex suffix is how FLEET disambiguates same-name branches
    // across groups. Missing suffix = not an agent-generated branch.
    expect(extractTaskIdFromBranch('agent/t-11-pass-encoding-utf8-to-execfile')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:main -- completion`
Expected: FAIL — `extractTaskIdFromBranch is not defined`

- [ ] **Step 3: Implement `extractTaskIdFromBranch`**

Add to `src/main/agent-manager/completion.ts`:

```typescript
/**
 * Extract the task-id slug from a FLEET agent branch name.
 *
 * FLEET generates branches as `agent/t-<idSlug>-<titleSlug>-<groupHash>` where
 * `<groupHash>` is always 8 lowercase hex chars. Returns the `<idSlug>` part
 * (e.g. '11', 'abc123', '20260420') so callers can match it against the
 * task's full id by suffix.
 *
 * Returns null when the branch name does not match the expected shape —
 * callers should fall back to commit-subject matching or treat as
 * "no task linkage" per their policy.
 */
export function extractTaskIdFromBranch(branch: string): string | null {
  const match = /^agent\/t-([a-zA-Z0-9]+)-.+-[a-f0-9]{8}$/.exec(branch)
  return match ? match[1] : null
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- completion`
Expected: all 5 `extractTaskIdFromBranch` cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/completion.test.ts
git commit -m "feat(completion): add extractTaskIdFromBranch helper"
```

---

### Task 3: Add `branchMatchesTask` that uses extractor + suffix-compare

**Files:**
- Modify: `src/main/agent-manager/completion.ts`
- Modify: `src/main/agent-manager/completion.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `completion.test.ts`:

```typescript
import { branchMatchesTask } from '../completion'

describe('branchMatchesTask', () => {
  it('matches when branch id suffix matches the task id tail', () => {
    // Task id: audit-20260420-t-11 → tail 'audit-20260420-t-11' ends with 't-11'.
    // Branch:  agent/t-11-... → extractor returns '11' → normalized 't-11'.
    // Match succeeds.
    expect(
      branchMatchesTask('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef', 'audit-20260420-t-11')
    ).toBe(true)
  })

  it('matches numeric-only task ids', () => {
    expect(
      branchMatchesTask('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef', 't-11')
    ).toBe(true)
  })

  it('does not match when the ids differ', () => {
    expect(
      branchMatchesTask('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef', 'audit-20260420-t-22')
    ).toBe(false)
  })

  it('does not match a malformed branch', () => {
    expect(branchMatchesTask('main', 'audit-20260420-t-11')).toBe(false)
  })

  it('is case-insensitive on the id comparison', () => {
    expect(
      branchMatchesTask('agent/t-abc123-something-12345678', 'AUDIT-20260420-T-abc123')
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:main -- completion`
Expected: FAIL — `branchMatchesTask is not defined`

- [ ] **Step 3: Implement the matcher**

Add to `completion.ts`:

```typescript
/**
 * Check whether a branch name identifies a given task.
 *
 * Uses extractTaskIdFromBranch to pull the `<idSlug>` from the branch, then
 * checks that the task id ends with `t-<idSlug>` (case-insensitive). This
 * accepts both short ids ('t-11') and long ones ('audit-20260420-t-11').
 */
export function branchMatchesTask(branch: string, taskId: string): boolean {
  const slug = extractTaskIdFromBranch(branch)
  if (!slug) return false
  return taskId.toLowerCase().endsWith(`t-${slug.toLowerCase()}`)
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- completion`
Expected: all 5 `branchMatchesTask` cases PASS; previous tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/completion.test.ts
git commit -m "feat(completion): add branchMatchesTask using the branch-name extractor"
```

---

### Task 4: Wire `branchMatchesTask` into the tip check as primary signal

**Files:**
- Modify: `src/main/agent-manager/completion.ts` (the existing tip-match function)
- Modify: `src/main/agent-manager/completion.test.ts`

- [ ] **Step 1: Re-read the current guard function** (from Task 1)

Find the function that logs `Branch tip on <branch> does not reference this task` and builds the "Expected one of" set from UUID/title/task-id. That function is what this task rewrites.

- [ ] **Step 2: Write the integration-style tests first**

Append to `completion.test.ts` (mirror the existing call conventions in the file — if the tip-check takes a `task` row and a branch name, match that):

```typescript
// These tests exercise whatever the existing tip-check function is named.
// Replace `checkTipMatchesTask` below with the actual function name from
// completion.ts if it differs.

import { checkTipMatchesTask } from '../completion'

describe('checkTipMatchesTask — branch-name path (primary)', () => {
  const taskRow = {
    id: 'audit-20260420-t-11',
    title: 'T-11 · Pass {encoding:\'utf8\'} to execFile in auth-guard',
    agent_run_id: '82fa9f9a-6011-449f-b965-ec3ecd1c166e'
  }

  it('accepts when the branch name matches the task id, regardless of commit subject', () => {
    const result = checkTipMatchesTask(taskRow, {
      branch: 'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
      tipCommitSubject: 'fix(auth-guard): pass encoding to execFile — eliminate unsafe type casts'
    })
    expect(result.ok).toBe(true)
  })

  it('falls back to commit-subject match when the branch name does not parse', () => {
    const result = checkTipMatchesTask(taskRow, {
      branch: 'main',
      tipCommitSubject: 'fix for audit-20260420-t-11: pass encoding to execFile'
    })
    expect(result.ok).toBe(true)
  })

  it('rejects when neither branch nor subject match', () => {
    const result = checkTipMatchesTask(taskRow, {
      branch: 'agent/t-99-unrelated-work-abcdef12',
      tipCommitSubject: 'fix: unrelated work'
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tip-mismatch/)
  })

  it('rejects when the subject accidentally matches another taskʼs id but branch disagrees', () => {
    // Prevents a cross-task leak being accepted by subject alone when the
    // branch name is clearly wrong.
    const result = checkTipMatchesTask(taskRow, {
      branch: 'agent/t-99-something-else-abcdef12',
      tipCommitSubject: 'docs(audit): add 2026-04-20 install-readiness audit specs'
    })
    expect(result.ok).toBe(false)
  })
})
```

Adjust the function name and result shape to match what `completion.ts` currently exports. The essential acceptance criteria: branch-name match is primary, subject match is fallback, UUID match is dropped.

- [ ] **Step 3: Run tests to verify failures**

Run: `npm run test:main -- completion`
Expected: at least the first test FAILS (current implementation rejects conventional commits on a branch it should accept).

- [ ] **Step 4: Rewrite the tip-check function**

Edit the current function to use the new logic. The post-rewrite shape:

```typescript
import { branchMatchesTask } from './completion' // already in-file

// This name/signature must match the existing function's export name and
// call site. Keep those intact; only the body changes.
export function checkTipMatchesTask(
  task: { id: string; title: string; agent_run_id: string | null },
  branchInfo: { branch: string; tipCommitSubject: string }
): { ok: true } | { ok: false; reason: string } {
  // Primary: branch-name identifies the task.
  if (branchMatchesTask(branchInfo.branch, task.id)) {
    return { ok: true }
  }

  // Fallback: commit subject contains the task id or the exact title.
  const subject = branchInfo.tipCommitSubject
  const acceptable = [task.id, task.title].map((s) => s.toLowerCase())
  const subjectLower = subject.toLowerCase()
  if (acceptable.some((needle) => subjectLower.includes(needle))) {
    return { ok: true }
  }

  return {
    ok: false,
    reason:
      `tip-mismatch: Branch tip on ${branchInfo.branch} does not reference this task.` +
      ` Expected branch name to match task id ${task.id}, or the commit subject to mention the id or title.` +
      ` Actual subject: "${subject}".`
  }
}
```

Important:
- Do NOT change the function's import/export name — downstream callers (drain-loop.ts, task-terminal-service, etc.) still reference it.
- Do NOT delete the existing JSDoc; update it to describe the branch-first semantics.
- If the existing function's `reason` format is checked in a test, keep the prefix `tip-mismatch` so those tests still work (or update them).

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- completion`
Expected: all tests PASS.

- [ ] **Step 6: Run the full main-test suite**

Run: `npm run test:main`
Expected: all PASS. Pay attention to any failures in `agent-manager/__tests__/` or `handlers/__tests__/` — if they assert on the old `Expected one of: [<uuid>, <title>, <id>]` rejection message, update them to match the new reason text.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/completion.test.ts
git commit -m "fix(completion): accept branch-name task linkage as primary signal

Conventional commit subjects (fix(foo): ...) never contain the task id,
title, or UUID verbatim — the old 'expected one of' check produced
false-positive tip-mismatch failures for 100% of correctly-done agent
runs. Use the branch name as primary evidence (it always contains
'agent/t-<id>-...') and keep commit-subject matching as a forward-compat
fallback."
```

---

### Task 5: Replay wave-2 salvage cases against the new logic

**Files:**
- Modify: `src/main/agent-manager/completion.test.ts`

- [ ] **Step 1: Add a table-driven regression test for every wave-2 salvage case**

Append:

```typescript
describe('wave-2 salvage replay — all 6 cases pass', () => {
  const cases: Array<{
    taskId: string
    title: string
    branch: string
    subject: string
  }> = [
    {
      taskId: 'audit-20260420-t-11',
      title: 'T-11 · Pass {encoding:\'utf8\'} to execFile in auth-guard',
      branch: 'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
      subject: 'fix(auth-guard): pass encoding to execFile — eliminate unsafe type casts'
    },
    {
      taskId: 'audit-20260420-t-13',
      title: 'T-13 · Fix typo pruneTakeChangesInterval',
      branch: 'agent/t-13-fix-typo-prunetakechangesinterval-064f79ef',
      subject: 'fix(bootstrap): rename pruneTakeChangesInterval to pruneTaskChangesInterval'
    },
    {
      taskId: 'audit-20260420-t-17',
      title: 'T-17 · Guard user_version pragma cast in db.ts',
      branch: 'agent/t-17-guard-user-version-pragma-cast-in-d-29dddf16',
      subject: 'fix(db): guard user_version pragma cast — prevent silent migration failures'
    },
    {
      taskId: 'audit-20260420-t-44',
      title: 'T-44 · Remove unused defaultGetRepos from tools/meta.ts',
      branch: 'agent/t-44-remove-unused-defaultgetrepos-from--6beda6a3',
      subject: 'docs(mcp-server): update meta module docs — remove defaultGetRepos export'
    },
    {
      taskId: 'audit-20260420-t-46',
      title: 'T-46 · Drop as SprintTask cast from fakeTask builder',
      branch: 'agent/t-46-drop-as-sprinttask-cast-from-faketa-6beda6a3',
      subject: 'refactor(test): drop cast from fakeTask builder'
    },
    {
      taskId: 'audit-20260420-t-66',
      title: 'T-66 · Extract shared copyToClipboard helper',
      branch: 'agent/t-66-extract-shared-copytoclipboard-help-528349b6',
      subject: 'refactor(onboarding): extract shared copyToClipboard helper'
    }
  ]

  for (const c of cases) {
    it(`accepts ${c.taskId}`, () => {
      const result = checkTipMatchesTask(
        { id: c.taskId, title: c.title, agent_run_id: null },
        { branch: c.branch, tipCommitSubject: c.subject }
      )
      expect(result.ok).toBe(true)
    })
  }
})

describe('legitimate tip-mismatch is still rejected', () => {
  it('rejects a branch with zero new commits (nothing to ship)', () => {
    const result = checkTipMatchesTask(
      { id: 'audit-20260420-t-99', title: 'Test', agent_run_id: null },
      {
        // Branch name does not identify this task; subject is unrelated.
        branch: 'agent/t-99-something-else-abcdef12',
        tipCommitSubject: 'docs: unrelated commit on main'
      }
    )
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm run test:main -- completion`
Expected: all 6 salvage cases PASS; the legitimate rejection case PASSES.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent-manager/completion.test.ts
git commit -m "test(completion): replay wave-2 salvage cases — all 6 pass the new guard"
```

---

### Task 6: Update CLAUDE.md and the prompt composer to reflect the new convention

**Files:**
- Modify: `CLAUDE.md` (Pipeline Agent Spec Guidelines section)
- Check: `src/main/agent-manager/prompt-composer.ts` (no code change expected — just verify)

- [ ] **Step 1: Check whether prompt-composer instructs agents to include the task id in the commit subject**

Run:
```bash
grep -n "commit message\|task.id\|task id" src/main/agent-manager/prompt-composer*.ts src/main/agent-system/personality/pipeline-personality.ts
```

If the prompt currently tells agents to include the task id in the commit subject, note it. No prompt change is required (the completion guard accepts both primary and fallback), but a one-line note in the prompt explaining that the branch name already encodes the linkage helps agents write cleaner commits.

- [ ] **Step 2: Update CLAUDE.md's Pipeline Agent Spec Guidelines**

Open `CLAUDE.md` and find the "Pipeline Agent Spec Guidelines" section. Add a single bullet:

```markdown
- **Task linkage is derived from the branch name, not the commit subject.** FLEET generates each pipeline agent's branch as `agent/t-<id>-<slug>-<hash>` — the completion guard extracts the task id from the branch name. Agents follow the standard commit-message convention (`{type}({scope}): {what} — {why}`) and do not need to mention the task id in the subject. The guard retains a commit-subject fallback for non-standard branch names.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): explain that task linkage is derived from branch name"
```

---

### Task 7: Full-suite regression

- [ ] **Step 1: Run the complete verification chain**

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

Expected: all green. No new lint errors.

- [ ] **Step 2: Manual smoke test (optional but recommended)**

If you still have access to a recent agent branch (e.g. from the audit dogfood), verify the new guard would accept it:

```bash
# In a node REPL or a tiny test script:
# const { checkTipMatchesTask } = require('./out/main/agent-manager/completion.js')
# checkTipMatchesTask({ id: 'audit-20260420-t-99', title: 'X', agent_run_id: null },
#   { branch: 'agent/t-99-some-slug-abcdef12', tipCommitSubject: 'fix: ...' })
# → { ok: true }
```

If the packaged build isn't available, skip this step — the test suite already covers the logic.

- [ ] **Step 3: No additional commit**

Verification-only.

---

## Self-Review Notes

- **Spec coverage:** Spec § RC2 acceptance criteria map to Task 5 (replay all 6 wave-2 cases → PASS) and Task 4 (legitimate tip-mismatch rejection preserved).
- **Placeholders:** Task 1 step 2 says "record ... on paper" — that's investigation, not a coding placeholder. Task 4 step 2 says "adjust the function name to match what completion.ts currently exports" — this is a reading instruction. No "TBD" or "TODO" in the plan.
- **Type consistency:** `branchMatchesTask(branch, taskId)` signature is stable across tasks 2, 3, 4, 5. `extractTaskIdFromBranch(branch)` returns `string | null` consistently. The `checkTipMatchesTask` result shape (`{ ok: true } | { ok: false; reason: string }`) may differ from the existing code's shape — Task 4 step 4 calls out that the existing function's signature dictates the final shape. The test file should be adjusted to match; the assertions themselves (accept vs reject) do not depend on the result shape.
- **Deliberate scope limit:** The plan does not change how the completion guard handles tasks where the agent made zero commits on its branch — that's still a legitimate failure and should remain a failure. The fix is specifically for the "agent committed correctly but subject didn't match" false-positive.
