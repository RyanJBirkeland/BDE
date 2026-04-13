# Implementation Plan: Agent Memory & Context Efficiency

**Spec:** `docs/superpowers/specs/2026-04-09-agent-memory-efficiency-design.md`
**Branch:** `feat/agent-memory-efficiency`
**Worktree:** `~/worktrees/BDE/feat-agent-memory-efficiency`

---

## Overview

Two independent improvements:

- **Part A:** Task scratchpad — pipeline agents persist progress notes across retries/revisions
- **Part B:** Selective user memory pre-loading — only inject memory files relevant to the task spec

The parts are independent but both touch `prompt-composer.ts`. Implement sequentially.

---

## Step 1 — Add `BDE_TASK_MEMORY_DIR` to paths.ts

**File:** `src/main/paths.ts`

Add after the existing `BDE_MEMORY_DIR` line:

```typescript
export const BDE_TASK_MEMORY_DIR = join(BDE_MEMORY_DIR, 'tasks')
```

No tests needed — it's a constant. This unlocks imports in all subsequent steps.

---

## Step 2 — Implement `selectUserMemory` (Part B)

**New file:** `src/main/agent-system/memory/select-user-memory.ts`

```typescript
import { basename } from 'node:path'
import { getUserMemory, type UserMemoryResult } from './user-memory'

const STOP_WORDS = new Set([
  'the',
  'this',
  'that',
  'with',
  'from',
  'have',
  'will',
  'your',
  'they',
  'been',
  'were',
  'when',
  'what',
  'which',
  'their',
  'there',
  'about',
  'into',
  'more',
  'also',
  'each',
  'should',
  'must',
  'only',
  'both'
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((tok) => tok.length >= 4 && !STOP_WORDS.has(tok))
  )
}

function isGlobalFile(relativePath: string): boolean {
  const name = basename(relativePath)
  return name.startsWith('global') || name.startsWith('_global')
}

/**
 * Synchronous. Calls getUserMemory() then filters by keyword relevance against
 * the task spec. Replaces unconditional getUserMemory() for pipeline agents.
 *
 * Files are included if:
 *  - Their basename starts with 'global' or '_global', OR
 *  - At least one keyword from the task spec appears in the file content
 */
export function selectUserMemory(taskSpec: string): UserMemoryResult {
  const all = getUserMemory()
  if (all.fileCount === 0) return all

  const keywords = extractKeywords(taskSpec)
  if (keywords.size === 0) return all // no keywords → include everything

  // Parse sections back out (they were joined with '\n\n---\n\n')
  const sections = all.content.split('\n\n---\n\n')

  const kept: string[] = []
  let totalBytes = 0

  for (const section of sections) {
    // Extract relative path from '### relativePath' header
    const headerMatch = section.match(/^### (.+)/)
    if (!headerMatch) continue
    const relativePath = headerMatch[1].trim()

    if (isGlobalFile(relativePath)) {
      kept.push(section)
      totalBytes += Buffer.byteLength(section, 'utf-8')
      continue
    }

    const lower = section.toLowerCase()
    const hasMatch = [...keywords].some((kw) => lower.includes(kw))
    if (hasMatch) {
      kept.push(section)
      totalBytes += Buffer.byteLength(section, 'utf-8')
    }
  }

  return {
    content: kept.join('\n\n---\n\n'),
    totalBytes,
    fileCount: kept.length
  }
}
```

**New test file:** `src/main/agent-system/memory/__tests__/select-user-memory.test.ts`

Tests must cover:

- File with matching keyword → included
- File with zero keyword overlap → excluded
- Global-named file (`global_rules.md`, `_global_api.md`) → always included
- Empty task spec → all files included (keywords.size === 0 branch)
- Empty memory → returns empty result early
- Path with subdirectory (`subdir/global_rules.md`) → basename match works

Run: `npx vitest run src/main/agent-system/memory/__tests__/select-user-memory.test.ts`

---

## Step 3 — Re-export from memory index

**File:** `src/main/agent-system/memory/index.ts`

Add export:

```typescript
export { selectUserMemory } from './select-user-memory'
```

---

## Step 4 — Update `prompt-composer.ts` (both parts)

**File:** `src/main/agent-manager/prompt-composer.ts`

### 4a — Extend `BuildPromptInput`

Add to the interface:

```typescript
taskId?: string          // pipeline only — used to build scratchpad path
priorScratchpad?: string // content of progress.md from prior attempt (empty string if none)
```

### 4b — Add `buildScratchpadSection` helper (pure string formatter, no fs)

```typescript
import { join } from 'node:path'
import { BDE_TASK_MEMORY_DIR } from '../paths'

function buildScratchpadSection(taskId: string): string {
  const scratchpadPath = join(BDE_TASK_MEMORY_DIR, taskId)
  return `\n\n## Task Scratchpad

You have a persistent scratchpad at: \`${scratchpadPath}/\`

Rules:
- CHECK IT FIRST: Before starting any work, run \`ls "${scratchpadPath}"\` and if \`progress.md\` exists, read it to recover prior context
- WRITE AS YOU GO: After each meaningful step, append to \`progress.md\`
- WRITE BEFORE EXIT: Before finishing, write a completion summary to \`progress.md\`

What to record:
- What you tried and whether it worked
- Key decisions and why you made them
- Current state if exiting mid-task
- Specific errors with their resolutions

This scratchpad survives retries and revision requests. Write for your future self.`
}
```

### 4c — Inject sections in order for pipeline agents

In `buildAgentPrompt`, for pipeline agents, inject in this order **before** the task spec:

1. If `priorScratchpad` is non-empty:

```typescript
prompt += '\n\n## Prior Attempt Context\n\n'
prompt += priorScratchpad
```

2. Scratchpad instructions (always, for pipeline agents with a taskId):

```typescript
if (taskId) {
  prompt += buildScratchpadSection(taskId)
}
```

3. Then the existing `## Task Specification` section (unchanged)

4. Then `buildRetryContext` (existing — unchanged, stays after the spec)

### 4d — Use `selectUserMemory` for pipeline agents

Replace the unconditional `getUserMemory()` call:

```typescript
// Before:
const userMem = getUserMemory()

// After:
const userMem =
  agentType === 'pipeline' && taskContent ? selectUserMemory(taskContent) : getUserMemory()
```

Add import: `import { selectUserMemory } from '../agent-system/memory'`

### 4e — Update tests

**File:** `src/main/agent-manager/__tests__/prompt-composer.test.ts`

Add tests:

- Pipeline prompt with `priorScratchpad: 'prior notes'` → prompt includes `## Prior Attempt Context` before `## Task Specification`
- Pipeline prompt with `taskId: 'abc123'` → prompt includes `## Task Scratchpad` with the correct path
- Pipeline prompt with `taskContent` set and user memory active → `selectUserMemory` is called (spy or snapshot test)
- Non-pipeline agent (assistant) → `getUserMemory` still used unconditionally

Run: `npx vitest run src/main/agent-manager/__tests__/prompt-composer.test.ts`

---

## Step 5 — Wire scratchpad into `run-agent.ts`

**File:** `src/main/agent-manager/run-agent.ts`

### 5a — Add imports

```typescript
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BDE_TASK_MEMORY_DIR } from '../paths'
```

(Note: `join` and `readFile` may already be imported — check and deduplicate.)

### 5b — Before the `buildAgentPrompt` call (~line 254)

```typescript
// Create task scratchpad directory (idempotent)
const scratchpadDir = join(BDE_TASK_MEMORY_DIR, task.id)
mkdirSync(scratchpadDir, { recursive: true })

// Read prior scratchpad content if present
let priorScratchpad = ''
try {
  priorScratchpad = readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
} catch {
  // Expected on first run — no prior scratchpad
}
```

### 5c — Pass new params to `buildAgentPrompt`

Add to the existing call:

```typescript
const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent,
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled,
  retryCount: task.retry_count ?? 0,
  previousNotes: task.notes ?? undefined,
  maxRuntimeMs: task.max_runtime_ms ?? undefined,
  upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
  crossRepoContract: task.cross_repo_contract ?? undefined,
  repoName: task.repo,
  taskId: task.id, // NEW
  priorScratchpad // NEW
})
```

### 5d — Update `run-agent.test.ts`

**File:** `src/main/agent-manager/__tests__/run-agent.test.ts`

Add tests (mock `fs` module):

- `mkdirSync` is called with `join(BDE_TASK_MEMORY_DIR, taskId)` and `{ recursive: true }`
- When `progress.md` exists: `readFileSync` returns content, `priorScratchpad` is passed to `buildAgentPrompt` spy
- When `progress.md` absent (ENOENT): `priorScratchpad` is `''` passed to `buildAgentPrompt`

Run: `npx vitest run src/main/agent-manager/__tests__/run-agent.test.ts`

---

## Step 6 — Add scratchpad cleanup on discard

**File:** `src/main/handlers/review.ts`

In the `review:discard` handler (around line 404), after the existing worktree and branch cleanup, add:

```typescript
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { BDE_TASK_MEMORY_DIR } from '../paths'

// Clean up task scratchpad
try {
  rmSync(join(BDE_TASK_MEMORY_DIR, taskId), { recursive: true, force: true })
} catch {
  /* best-effort */
}
```

No new tests required — the handler is already tested in the existing review handler test suite; the cleanup is best-effort and side-effect-free on first run.

---

## Step 7 — Full verification

```bash
cd ~/worktrees/BDE/feat-agent-memory-efficiency
npm install
npm run typecheck    # zero errors
npm run test:coverage  # all pass, coverage thresholds met
npm run lint         # zero errors
```

Fix any issues before committing.

---

## Step 8 — Commit and push

```bash
git add -A
git commit -m "feat: task scratchpad + selective user memory pre-loading for pipeline agents"
git push origin feat/agent-memory-efficiency
git ls-remote origin refs/heads/feat/agent-memory-efficiency  # verify push
```

---

## Step 9 — Open PR

```bash
gh pr create \
  --title "feat: agent memory efficiency — task scratchpad + selective pre-loading" \
  --body "..." \
  --base main \
  --head feat/agent-memory-efficiency
```

PR body must include:

- Summary of both changes (A: scratchpad, B: selective pre-loading)
- Files changed list
- How to test manually

---

## Implementation Notes

- `selectUserMemory` is synchronous — it calls the already-synchronous `getUserMemory()` and filters in memory. No fs calls added.
- `buildScratchpadSection` has no fs imports — pure string formatting only.
- `mkdirSync` (sync) is used in `run-agent.ts` because that section is already synchronous setup code before the async spawn.
- `readFileSync` is used for the same reason — it's a single small file read in startup path, not a loop.
- Do not change the behavior of `getUserMemory` itself — it is used unchanged by non-pipeline agents and the Settings > Memory UI.
- The `progress.md` filename is a convention documented in the agent prompt. Agents are free to create other files in the scratchpad directory, but `progress.md` is the one that gets pre-read at spawn.
