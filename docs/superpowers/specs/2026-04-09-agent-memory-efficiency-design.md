# Agent Memory & Context Efficiency

**Date:** 2026-04-09
**Status:** Approved
**Priority:** A (Agent Continuity) + B (Token Efficiency)

---

## Problem

BDE pipeline agents have two related memory problems:

1. **No continuity across attempts.** When an agent fails mid-task and is retried (or a user requests revision), the new agent starts with no knowledge of what the prior attempt did, what worked, or where it got stuck. This causes agents to repeat the same failed approaches and wastes time.

2. **Inefficient pre-loading.** All active user memory files are injected into every agent's context unconditionally. As the user accumulates more memory files, every agent pays the token cost regardless of relevance. A file about "API versioning strategy" has no business in a prompt for a CSS fix task.

---

## Goals

- Pipeline agents can persist and recover task-scoped context across retries and revision requests
- User memory files are selectively injected based on relevance to the task spec
- Zero new external dependencies, zero API calls at spawn time
- No changes to the adhoc/assistant/copilot/synthesizer agent paths

---

## Out of Scope

- Cross-session learning (C) — agents writing shared knowledge for future unrelated tasks
- Semantic/embedding-based retrieval — overkill for the current file set size
- Memory management UI changes — existing Settings > Memory UI is sufficient
- Scratchpad for adhoc/assistant agents — they lack stable task IDs

---

## Solution

### Part A: Task Scratchpad (Agent Continuity)

Each pipeline task gets an isolated scratchpad directory at:

```
~/.bde/memory/tasks/<taskId>/
```

**At spawn time** (in `run-agent.ts`, before calling `buildAgentPrompt`):

1. Create the directory if it doesn't exist (`mkdirSync(..., { recursive: true })`)
2. Read `progress.md` wrapped in try/catch — file-not-found is expected on first run and must not throw
3. Pass the content as `priorScratchpad` to `buildAgentPrompt` (empty string if not found)

**In the prompt** (injected by `buildAgentPrompt` for pipeline agents only):

```
## Task Scratchpad

You have a persistent scratchpad at: ~/.bde/memory/tasks/<taskId>/

Rules:
- CHECK IT FIRST: Before starting any work, read progress.md to recover prior context
- WRITE AS YOU GO: After each meaningful step, append to progress.md
- WRITE BEFORE EXIT: Before finishing, write a completion summary to progress.md

What to record:
- What you tried and whether it worked
- Key decisions and why you made them
- Current state if exiting mid-task
- Specific errors with their resolutions

This scratchpad survives retries and revision requests. The next agent on this
task will read it. Write for your future self.
```

If a prior scratchpad exists, it is also injected as:

```
## Prior Attempt Context

(content of progress.md from prior attempt)
```

This section appears BEFORE the task spec so the agent reads historical context before re-reading requirements.

**Scratchpad lifecycle:**

- Created at first spawn
- Preserved on failure (for retry/revision)
- Cleared on `discard` action in Code Review Station (worktree cleanup)
- Not cleaned on successful `done` — preserved for debugging and audit trail

### Part B: Selective User Memory Pre-loading (Token Efficiency)

Replace the unconditional `getUserMemory()` call in `buildAgentPrompt` with `selectUserMemory(taskSpec)` for pipeline agents. For non-pipeline agents, the existing unconditional load is retained (interactive agents benefit from full context).

**Function signature** (synchronous — must match `getUserMemory`'s sync contract so `buildAgentPrompt` stays a pure sync function):

```typescript
// src/main/agent-system/memory/select-user-memory.ts
export function selectUserMemory(taskSpec: string): UserMemoryResult
```

Internally calls `getUserMemory()` to load all active files, then scores and filters in-memory. No additional file I/O.

**Keyword scoring algorithm:**

```
1. Extract keywords from taskSpec:
   - Split on non-word characters
   - Lowercase all tokens
   - Filter: length < 4, common stop words (the, this, that, with, from, ...)
   - Result: Set<string> of meaningful terms

2. For each active user memory file:
   - Lowercase the file content
   - Count how many keywords appear in it
   - Score = count of matching keywords

3. Inclusion rules:
   - Always include: files whose BASENAME (not full path) matches `_global*.md` or `global*.md`
     (e.g., `subdir/global_rules.md` → basename `global_rules.md` → always included)
   - Include if score >= 1 (at least one keyword match)
   - Exclude if score == 0 (no overlap with task)

4. Log excluded files at debug level (for user visibility)
```

This is O(keywords × files), runs in <1ms for typical file sets (10-50 files, each <10KB), and requires no API calls.

**What doesn't change:**

- `getUserMemory()` itself is unchanged — it still loads all active files
- The Settings > Memory UI toggle behavior is unchanged
- Convention modules (IPC, testing, architecture) are always injected for BDE agents — they're small and always relevant

---

## Files to Change

### New

- `src/main/agent-system/memory/select-user-memory.ts` — keyword scoring function
- `src/main/agent-system/memory/__tests__/select-user-memory.test.ts` — unit tests

### Modified

- `src/main/paths.ts` — add `BDE_TASK_MEMORY_DIR = join(BDE_MEMORY_DIR, 'tasks')` constant
- `src/main/agent-system/memory/index.ts` — re-export `selectUserMemory`
- `src/main/agent-manager/prompt-composer.ts`:
  - Add `taskId?: string` and `priorScratchpad?: string` to `BuildPromptInput`
  - Add `buildScratchpadSection(taskId: string, scratchpadPath: string): string` — a **pure string formatter only**, no fs access, no imports from `fs`. All file I/O stays in `run-agent.ts`.
  - Inject sections for pipeline agents in this order: `priorScratchpad` → `taskSpec` → `retryContext` (scratchpad before spec so agent reads historical context first; retry summary stays last as it is today)
  - Use `selectUserMemory(taskContent)` instead of `getUserMemory()` for pipeline agents
- `src/main/agent-manager/run-agent.ts`:
  - Create `~/.bde/memory/tasks/<taskId>/` directory before spawning (`mkdirSync`)
  - Read `progress.md` in try/catch (first-run expects ENOENT)
  - Pass `taskId` and `priorScratchpad` to `buildAgentPrompt`
- `src/main/agent-manager/completion.ts`:
  - On `discard` action: `rmSync(join(BDE_TASK_MEMORY_DIR, taskId), { recursive: true, force: true })`
- `src/main/agent-manager/__tests__/prompt-composer.test.ts` — update for new `BuildPromptInput` fields; add test that pipeline prompt with `priorScratchpad` set injects `## Prior Attempt Context` section before `## Task Specification`; add test that `selectUserMemory` replaces `getUserMemory` for pipeline agents
- `src/main/agent-manager/__tests__/run-agent.test.ts` (create if not exists) — mock `fs.mkdirSync` and `fs.readFileSync`; assert directory is created at `join(BDE_TASK_MEMORY_DIR, taskId)`; assert `priorScratchpad` is passed to `buildAgentPrompt` when `progress.md` exists; assert empty string is passed when file is absent

---

## How to Test

### Selective pre-loading

```bash
# Unit test the scoring function
npx vitest run src/main/agent-system/memory/__tests__/select-user-memory.test.ts

# Verify pipeline agent prompt includes only relevant files
# (inspect buildAgentPrompt output for a pipeline agent with taskContent set)
```

### Task scratchpad

```bash
# Manually: queue a task, let it run, check the scratchpad was created
ls ~/.bde/memory/tasks/

# Verify prompt includes scratchpad section
# In run-agent.ts test: mock fs, verify priorScratchpad is read and passed
```

### Full CI

```bash
npm run typecheck && npm run test:coverage && npm run lint
```

---

## Non-Goals / Explicitly Not Doing

- Scratchpad cleanup on success — kept for audit trail
- Scratchpad size limits — progress.md is agent-authored prose, stays small in practice
- Embedding/semantic scoring — keyword matching is sufficient and free
- Shared memory between tasks — each task is isolated; cross-task sharing is out of scope
- UI for viewing task scratchpads — files are plaintext in `~/.bde/memory/tasks/`, readable directly
