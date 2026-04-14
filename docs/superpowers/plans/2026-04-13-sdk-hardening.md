# SDK Options Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce consistent, safe SDK call options across all agent types — add `maxTurns` to pipeline agents, add `maxBudgetUsd` to pipeline/adhoc agents, and make `settingSources` intentional (not accidental defaults).

**Architecture:** All changes are confined to SDK call sites in main process. No prompt content changes (that's the prompt-builder-fixes plan), no streaming changes (that's the streaming-reliability plan). Zero renderer changes.

**Tech Stack:** TypeScript, vitest, `@anthropic-ai/claude-agent-sdk`, BDE main process

---

## Baseline — Audit Findings Being Fixed

From audit `docs/superpowers/audits/2026-04-13/prompt-pipeline/team-3-sdk-usage/lens-sdk-opts.md`:
- F-t3-sdk-opts-1: Pipeline agent has no `maxTurns` — unbounded loops possible
- F-t3-sdk-opts-2: Pipeline loads `'project'` settings despite receiving conventions via prompt
- F-t3-sdk-opts-3: `settingSources` inconsistent across agent types — no intentional policy
- F-t3-sdk-opts-4: Pipeline has no `maxBudgetUsd` — unbounded cost on loops
- F-t3-sdk-opts-5: Reviewer loads project settings unnecessarily
- F-t3-sdk-opts-6: Adhoc agent missing `maxBudgetUsd`
- F-t3-sdk-opts-7: Spec quality validator loads project settings unnecessarily

**The policy being established:**
- Pipeline agents (autonomous): `settingSources: ['user', 'local']`, `maxTurns: 20`, `maxBudgetUsd: 2.0`
- Adhoc/assistant agents (interactive): `settingSources: []` (project CLAUDE.md already injected via prompt builder), no maxTurns (user controls), `maxBudgetUsd: 5.0`
- Copilot/synthesizer/reviewer (spec-drafting/opinion): `settingSources: []` — already correct for copilot/synthesizer; fix reviewer and validator

## File Structure

**Modified files (no new files):**
- `src/main/agent-manager/sdk-adapter.ts` — Add `maxTurns`, change `settingSources`, add `maxBudgetUsd`
- `src/main/adhoc-agent.ts` — Change `settingSources`, add `maxBudgetUsd`
- `src/main/services/review-service.ts` — Add `settingSources: []` to `runSdkOnce` call
- `src/main/services/spec-quality/validators/prescriptiveness-validator.ts` — Change `settingSources: []`

**Test files:**
- `src/main/agent-manager/__tests__/sdk-adapter.test.ts` — Add assertions for new options
- `src/main/agent-manager/__tests__/audit-fixes.test.ts` — Add `settingSources` policy tests

---

## Task 1: Pipeline Agent — Add `maxTurns` and Correct `settingSources`

**Files:**
- Modify: `src/main/agent-manager/sdk-adapter.ts`
- Test: `src/main/agent-manager/__tests__/sdk-adapter.test.ts`

- [ ] **Step 1: Read the existing sdk-adapter test to understand the spy pattern**

Read `src/main/agent-manager/__tests__/sdk-adapter.test.ts` before writing tests.

- [ ] **Step 2: Write failing tests**

Add to `src/main/agent-manager/__tests__/sdk-adapter.test.ts` (or `audit-fixes.test.ts` if sdk-adapter.test.ts doesn't have a spy on sdk.query):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// If the file doesn't already mock the SDK, add this:
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () { yield { type: 'exit_code', exit_code: 0 } }
  })
}))

import { spawnAgent } from '../sdk-adapter'
import * as sdk from '@anthropic-ai/claude-agent-sdk'

describe('pipeline agent SDK options', () => {
  beforeEach(() => {
    vi.mocked(sdk.query).mockClear()
  })

  it('passes maxTurns: 20 to SDK query', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(callArgs?.options?.maxTurns).toBe(20)
  })

  it('uses settingSources [user, local] — not project', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(callArgs?.options?.settingSources).toEqual(['user', 'local'])
    expect(callArgs?.options?.settingSources).not.toContain('project')
  })
})
```

Note: If the existing test file already has a different mock structure, adapt the test to use that pattern. The important assertions are `maxTurns === 20` and `settingSources` excludes `'project'`.

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/sdk-adapter.test.ts -t "pipeline agent SDK options" 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 4: Update `sdk-adapter.ts` — the `spawnViaSdk` function**

In `src/main/agent-manager/sdk-adapter.ts`, in the `spawnViaSdk` function, update the `sdk.query` call options:

```typescript
const queryResult = sdk.query({
  prompt: opts.prompt,
  options: {
    model: opts.model,
    cwd: opts.cwd,
    env: env as Record<string, string | undefined>,
    pathToClaudeCodeExecutable: getClaudeCliPath(),
    ...(token ? { apiKey: token } : {}),
    abortController,
    // Pipeline agents run in isolated worktrees and receive BDE conventions
    // via the composed prompt — loading CLAUDE.md via 'project' would double-inject
    // conventions and costs ~5-10KB extra per spawn. User hooks are kept ('user')
    // for permission settings; local overrides kept for dev convenience.
    settingSources: ['user', 'local'],
    // Cap turns to prevent runaway loops. 20 turns covers complex multi-file
    // refactors. Agents that legitimately need more should use a smaller,
    // focused spec. The watchdog provides a time ceiling independently.
    maxTurns: 20,
    // Pipeline agents are autonomous (no human at stdin) and run in
    // isolated worktrees. Auto-allow all tools to prevent hanging on
    // permission prompts. Safety comes from worktree isolation + PR review.
    canUseTool: async () => ({ behavior: 'allow' as const })
  }
})
```

- [ ] **Step 5: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/sdk-adapter.test.ts 2>&1 | tail -15
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
cd ~/worktrees/BDE/<branch>
git add src/main/agent-manager/sdk-adapter.ts src/main/agent-manager/__tests__/sdk-adapter.test.ts
git commit -m "fix: add maxTurns: 20 and settingSources: ['user', 'local'] to pipeline SDK calls"
```

---

## Task 2: Pipeline Agent — Add `maxBudgetUsd`

**Files:**
- Modify: `src/main/agent-manager/sdk-adapter.ts`
- Modify: `src/main/agent-manager/types.ts` (to check if AgentManagerConfig has a budget field)
- Test: `src/main/agent-manager/__tests__/sdk-adapter.test.ts`

- [ ] **Step 1: Check `types.ts` and `AgentManagerConfig` for existing budget field**

Read `src/main/agent-manager/types.ts` to see if there's a `maxBudgetUsd` or `maxCostUsd` field on the config or task.

The `RunAgentTask` interface in `run-agent.ts` already has `max_cost_usd?: number | null`. This is per-task. The SDK should use it if present, with a safe default.

- [ ] **Step 2: Write failing test**

Add to `src/main/agent-manager/__tests__/sdk-adapter.test.ts`:

```typescript
it('passes maxBudgetUsd to SDK query', async () => {
  await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })
  const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
  expect(typeof callArgs?.options?.maxBudgetUsd).toBe('number')
  expect(callArgs?.options?.maxBudgetUsd).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/sdk-adapter.test.ts -t "maxBudgetUsd" 2>&1 | tail -15
```

- [ ] **Step 4: Add `maxBudgetUsd` to `spawnAgent` options and `spawnViaSdk` call**

First, update the `spawnAgent` function signature to accept an optional `maxBudgetUsd`:

In `sdk-adapter.ts`, update `spawnAgent`:
```typescript
export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number   // add this
  logger?: Logger
}): Promise<AgentHandle> {
```

Pass it to `spawnViaSdk`:
```typescript
return spawnViaSdk(sdk, opts, env, token, opts.logger)
```

Update `spawnViaSdk` signature:
```typescript
function spawnViaSdk(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  opts: { prompt: string; cwd: string; model: string; maxBudgetUsd?: number },
  ...
```

In the `sdk.query` options, add:
```typescript
maxBudgetUsd: opts.maxBudgetUsd ?? 2.0,
```

Then update the `spawnWithTimeout` call in `run-agent.ts` to pass `max_cost_usd`:

In `run-agent.ts`, find where `spawnWithTimeout` is called (~line 499):
```typescript
// Current:
handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)

// Updated spawnWithTimeout to accept options:
```

Actually, `spawnWithTimeout` only accepts `prompt, cwd, model, logger`. To pass `maxBudgetUsd`, update its signature:

In `sdk-adapter.ts`:
```typescript
export async function spawnWithTimeout(
  prompt: string,
  cwd: string,
  model: string,
  logger: Logger,
  maxBudgetUsd?: number  // add this
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>(...)
  return await Promise.race([
    spawnAgent({ prompt, cwd, model, logger, maxBudgetUsd }),
    timeoutPromise
  ]).finally(() => clearTimeout(timer!))
}
```

In `run-agent.ts`, update the call:
```typescript
handle = await spawnWithTimeout(
  prompt,
  worktree.worktreePath,
  effectiveModel,
  logger,
  task.max_cost_usd ?? undefined
)
```

- [ ] **Step 5: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -20
```
Expected: zero errors

- [ ] **Step 6: Run tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/sdk-adapter.ts src/main/agent-manager/run-agent.ts src/main/agent-manager/__tests__/sdk-adapter.test.ts
git commit -m "fix: add maxBudgetUsd to pipeline agent SDK calls — default 2.0, overridable per task"
```

---

## Task 3: Adhoc Agent — Fix `settingSources` and Add `maxBudgetUsd`

**Files:**
- Modify: `src/main/adhoc-agent.ts`
- Test: `src/main/agent-manager/__tests__/audit-fixes.test.ts` (or add to existing adhoc test if one exists)

- [ ] **Step 1: Check for existing adhoc-agent tests**

```bash
ls ~/projects/BDE/src/main/__tests__/
```

If there's an `adhoc-agent.test.ts`, read it. Otherwise, add tests to `audit-fixes.test.ts`.

- [ ] **Step 2: Write test**

The adhoc agent builds `baseOptions` at line ~137. The test should verify the options passed to `sdk.query`. Since `adhoc-agent.ts` imports the SDK directly (not via `sdk-adapter.ts`), mock it directly:

```typescript
// In audit-fixes.test.ts or adhoc-agent.test.ts:
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () { yield { type: 'exit_code', exit_code: 0 } }
  })
}))

// Note: spawnAdhocAgent sets up a worktree which requires mocking setupWorktree.
// If this test is too complex to wire up, verify the change visually via TypeScript
// by reading the updated code and running typecheck + lint only.
```

If wiring the adhoc agent test is complex (it has many dependencies), skip the test and verify via typecheck + lint. The change is a one-line edit.

- [ ] **Step 3: Update `baseOptions` in `adhoc-agent.ts`**

Find the `baseOptions` object (~line 137):

```typescript
// Before:
const baseOptions = {
  model,
  cwd: worktreePath,
  env: env as Record<string, string>,
  pathToClaudeCodeExecutable: getClaudeCliPath(),
  settingSources: ['user' as const, 'project' as const, 'local' as const]
}

// After:
const baseOptions = {
  model,
  cwd: worktreePath,
  env: env as Record<string, string>,
  pathToClaudeCodeExecutable: getClaudeCliPath(),
  // Adhoc agents receive BDE conventions via buildAgentPrompt() — loading
  // CLAUDE.md via 'project' would double-inject conventions and cost ~5-10KB extra.
  // User hooks are omitted: adhoc agents run in their own worktree with their own
  // session and the user controls them interactively.
  settingSources: [] as const,
  // Hard cap on spend per interactive session. User-controlled agents can
  // rack up cost across many turns. This is a safety ceiling, not a target.
  maxBudgetUsd: 5.0
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -10
```
Expected: zero errors

- [ ] **Step 5: Run main process tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/adhoc-agent.ts
git commit -m "fix: adhoc agent — settingSources: [], add maxBudgetUsd: 5.0 per session ceiling"
```

---

## Task 4: Fix `settingSources` in Review Service and Validator

**Files:**
- Modify: `src/main/services/review-service.ts`
- Modify: `src/main/services/spec-quality/validators/prescriptiveness-validator.ts`

These are one-line changes each. No new tests needed — the behavior is functionally identical (settingSources: [] just skips CLAUDE.md loading, no other effect).

- [ ] **Step 1: Update `review-service.ts`**

Find the `runSdkOnce` call (~line 224):

```typescript
// Before:
raw = await runSdkOnce(prompt, {
  model: REVIEWER_MODEL,
  maxTurns: 1,
  tools: []
})

// After:
raw = await runSdkOnce(prompt, {
  model: REVIEWER_MODEL,
  maxTurns: 1,
  tools: [],
  // Reviewer generates opinions, not code. CLAUDE.md's implementation guidelines
  // are irrelevant and waste ~5-10KB per review call.
  settingSources: []
})
```

- [ ] **Step 2: Update `prescriptiveness-validator.ts`**

Find the `settingSources` line in `runSdkQuery` (~line 36):

```typescript
// Before:
settingSources: ['user', 'project', 'local'],

// After:
// Validation check — no implementation context needed. CLAUDE.md is irrelevant here.
settingSources: [],
```

- [ ] **Step 3: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -10
```
Expected: zero errors

- [ ] **Step 4: Run tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -15
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/services/review-service.ts src/main/services/spec-quality/validators/prescriptiveness-validator.ts
git commit -m "fix: settingSources: [] for reviewer and spec validator — CLAUDE.md irrelevant for opinion/validation calls"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -30
```
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -20
```
Expected: zero errors

- [ ] **Step 3: Run lint**

```bash
cd ~/projects/BDE && npm run lint 2>&1 | grep -E "^/" | head -20
```
Expected: zero errors

- [ ] **Step 4: Run renderer tests**

```bash
cd ~/projects/BDE && npm test 2>&1 | tail -20
```
Expected: all tests pass
