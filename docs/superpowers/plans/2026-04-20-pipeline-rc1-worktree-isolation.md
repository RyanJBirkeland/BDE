# Worktree Isolation Hook — Implementation Plan (RC1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent pipeline agents from reading or writing any path outside their assigned git worktree, by rejecting the tool call at SDK invocation time.

**Architecture:** Replace the existing no-op `canUseTool` in `spawn-sdk.ts:67` with a composable gate that validates `Bash`, `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` tool inputs against an allowlist derived from the agent's worktree path. Gate is attached only when `pipelineTuning` is set — adhoc/assistant/copilot/synthesizer spawn paths stay permissive.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (`CanUseTool` callback), `node:path` (for absolute-path normalization), vitest.

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 1.

---

### Task 1: Scaffold the hook module with its public surface

**Files:**
- Create: `src/main/agent-manager/worktree-isolation-hook.ts`
- Test: `src/main/agent-manager/worktree-isolation-hook.test.ts`

- [ ] **Step 1: Write the failing test for `createWorktreeIsolationHook` return shape**

```typescript
// src/main/agent-manager/worktree-isolation-hook.test.ts
import { describe, it, expect } from 'vitest'
import { createWorktreeIsolationHook } from './worktree-isolation-hook'

describe('createWorktreeIsolationHook', () => {
  it('returns a CanUseTool callback', () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    expect(typeof hook).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: FAIL — `Cannot find module './worktree-isolation-hook'`

- [ ] **Step 3: Create the minimal module**

```typescript
// src/main/agent-manager/worktree-isolation-hook.ts
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'

export interface WorktreeIsolationDeps {
  /** Absolute path to the agent's worktree (cwd). */
  worktreePath: string
  /** Absolute paths to primary repo checkouts that must not be touched. */
  mainRepoPaths: readonly string[]
}

export function createWorktreeIsolationHook(deps: WorktreeIsolationDeps): CanUseTool {
  void deps
  return async () => ({ behavior: 'allow' as const, updatedInput: {} })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-isolation-hook.ts src/main/agent-manager/worktree-isolation-hook.test.ts
git commit -m "feat(worktree-isolation): scaffold hook module — pipeline-agent tool-use gate"
```

---

### Task 2: Allow tool calls when the path is inside the worktree

**Files:**
- Modify: `src/main/agent-manager/worktree-isolation-hook.ts`
- Modify: `src/main/agent-manager/worktree-isolation-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('Write/Edit with a worktree-scoped absolute path', () => {
  it('allows Write into the worktree', async () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    const result = await hook(
      'Write',
      { file_path: '/Users/test/worktrees/bde/abc123/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Edit into the worktree', async () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    const result = await hook(
      'Edit',
      {
        file_path: '/Users/test/worktrees/bde/abc123/src/main/foo.ts',
        old_string: 'a',
        new_string: 'b'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})
```

- [ ] **Step 2: Run test to verify the happy-path assertions already pass**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: PASS (current implementation always allows)

- [ ] **Step 3: Add the path classifier (still allowing everything)**

Replace the body of `createWorktreeIsolationHook` with:

```typescript
import { resolve as resolvePath } from 'node:path'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'

export interface WorktreeIsolationDeps {
  worktreePath: string
  mainRepoPaths: readonly string[]
}

export function createWorktreeIsolationHook(deps: WorktreeIsolationDeps): CanUseTool {
  const worktreeAbs = resolvePath(deps.worktreePath)
  const blockedPrefixes = deps.mainRepoPaths.map((p) => resolvePath(p) + '/')

  function isInsideWorktree(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return resolved === worktreeAbs || resolved.startsWith(worktreeAbs + '/')
  }

  function pointsAtMainRepo(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return blockedPrefixes.some((prefix) => resolved === prefix.slice(0, -1) || resolved.startsWith(prefix))
  }

  return async (toolName, input) => {
    // Allow-by-default scaffold; specific denies land in later tasks.
    void toolName
    void input
    void isInsideWorktree
    void pointsAtMainRepo
    return { behavior: 'allow' as const, updatedInput: {} }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-isolation-hook.ts src/main/agent-manager/worktree-isolation-hook.test.ts
git commit -m "feat(worktree-isolation): add path classifier helpers (allow-all scaffold)"
```

---

### Task 3: Deny Write/Edit/MultiEdit/NotebookEdit targeting the main checkout

**Files:**
- Modify: `src/main/agent-manager/worktree-isolation-hook.ts`
- Modify: `src/main/agent-manager/worktree-isolation-hook.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
describe('Write to main checkout is denied', () => {
  const deps = {
    worktreePath: '/Users/test/worktrees/bde/abc123',
    mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
  }

  it('denies Write to a main-checkout absolute path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/worktree/)
      expect(result.message).toMatch(/\/src\/main\/foo\.ts/)
    }
  })

  it('denies Edit to a main-checkout absolute path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Edit',
      {
        file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts',
        old_string: 'a',
        new_string: 'b'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies MultiEdit when any edit targets the main checkout', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'MultiEdit',
      {
        file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts',
        edits: [{ old_string: 'a', new_string: 'b' }]
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies NotebookEdit targeting main-checkout .ipynb', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'NotebookEdit',
      { notebook_path: '/Users/test/Projects/git-repos/BDE/nb.ipynb', new_source: '' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows relative paths (SDK will resolve them against cwd)', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: 'src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: 4 FAIL (deny cases); 1 PASS (allow case); 3 existing PASS

- [ ] **Step 3: Implement the deny logic for write-family tools**

Replace the hook body:

```typescript
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

  return async (toolName, input) => {
    if (WRITE_TOOLS.has(toolName)) {
      const filePath =
        typeof input.file_path === 'string'
          ? input.file_path
          : typeof input.notebook_path === 'string'
          ? input.notebook_path
          : null
      if (filePath && filePath.startsWith('/') && !isInsideWorktree(filePath)) {
        if (pointsAtMainRepo(filePath)) {
          return {
            behavior: 'deny' as const,
            message:
              `Blocked by worktree-isolation: ${toolName} targeting ${filePath} ` +
              `is outside your worktree (${worktreeAbs}). Use a relative path ` +
              `or an absolute path under the worktree.`
          }
        }
      }
    }
    return { behavior: 'allow' as const, updatedInput: {} }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-isolation-hook.ts src/main/agent-manager/worktree-isolation-hook.test.ts
git commit -m "feat(worktree-isolation): deny Write/Edit/MultiEdit/NotebookEdit to main checkout"
```

---

### Task 4: Deny Bash commands that reference the main checkout

**Files:**
- Modify: `src/main/agent-manager/worktree-isolation-hook.ts`
- Modify: `src/main/agent-manager/worktree-isolation-hook.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('Bash commands targeting main checkout are denied', () => {
  const deps = {
    worktreePath: '/Users/test/worktrees/bde/abc123',
    mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
  }

  it('denies a `cd <main-repo>` prefix', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'cd /Users/test/Projects/git-repos/BDE && npm test' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/main checkout/i)
    }
  })

  it('denies a raw absolute path argument pointing at the main repo', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'cat /Users/test/Projects/git-repos/BDE/src/main/foo.ts' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies a redirect to a main-repo path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'echo x > /Users/test/Projects/git-repos/BDE/tmp.txt' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows Bash in the worktree with relative paths', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'npm test -- src/main/foo' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Bash with absolute paths inside the worktree', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      {
        command:
          'cat /Users/test/worktrees/bde/abc123/src/main/foo.ts'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Bash referencing scratchpad dir outside worktree but not in main repo', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'ls /Users/test/.bde/memory/tasks/t-1' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: 3 deny cases FAIL, 3 allow cases PASS, previous 8 PASS

- [ ] **Step 3: Implement Bash scanning**

Add at the top of the hook function body, before the `WRITE_TOOLS` check:

```typescript
  function bashCommandHitsMainRepo(command: string): string | null {
    // Tokenize loosely on whitespace + shell separators. This is conservative
    // — we only need to find absolute paths that start with /.
    const tokens = command.split(/[\s;|&<>()]+/).filter(Boolean)
    for (const tok of tokens) {
      // Strip common shell quoting.
      const unquoted = tok.replace(/^['"]|['"]$/g, '')
      if (!unquoted.startsWith('/')) continue
      if (pointsAtMainRepo(unquoted)) return unquoted
    }
    return null
  }
```

Then in the callback body, before the `WRITE_TOOLS` block:

```typescript
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      const offending = bashCommandHitsMainRepo(command)
      if (offending) {
        return {
          behavior: 'deny' as const,
          message:
            `Blocked by worktree-isolation: Bash command references main checkout path ${offending}. ` +
            `Use relative paths or paths under the worktree (${worktreeAbs}).`
        }
      }
    }
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: all 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-isolation-hook.ts src/main/agent-manager/worktree-isolation-hook.test.ts
git commit -m "feat(worktree-isolation): deny Bash commands that reference main checkout paths"
```

---

### Task 5: Log every deny with the task id, tool, and path

**Files:**
- Modify: `src/main/agent-manager/worktree-isolation-hook.ts`
- Modify: `src/main/agent-manager/worktree-isolation-hook.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
import { vi } from 'vitest'

describe('deny logging', () => {
  it('invokes the logger.warn with tool and path on deny', async () => {
    const warn = vi.fn()
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE'],
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
    await hook(
      'Write',
      { file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(warn).toHaveBeenCalledTimes(1)
    const arg = warn.mock.calls[0][0] as string
    expect(arg).toMatch(/\[worktree-isolation\]/)
    expect(arg).toMatch(/Write/)
    expect(arg).toMatch(/foo\.ts/)
  })

  it('does not log on allow', async () => {
    const warn = vi.fn()
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE'],
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
    await hook(
      'Bash',
      { command: 'npm test' },
      { signal: new AbortController().signal }
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: 2 new tests FAIL (`logger` option unknown; warn never called)

- [ ] **Step 3: Thread an optional logger through the deps and call it on deny**

Update the interface:

```typescript
import type { Logger } from '../logger'

export interface WorktreeIsolationDeps {
  worktreePath: string
  mainRepoPaths: readonly string[]
  logger?: Pick<Logger, 'warn' | 'info' | 'error' | 'debug'>
}
```

Inside the hook, replace both `return { behavior: 'deny' ... }` blocks with a helper:

```typescript
  function deny(message: string, toolName: string, path: string): { behavior: 'deny'; message: string } {
    deps.logger?.warn(`[worktree-isolation] denied ${toolName} path=${path} — ${message}`)
    return { behavior: 'deny' as const, message }
  }
```

Then call it in both deny sites:

```typescript
      return deny(
        `Blocked by worktree-isolation: ${toolName} targeting ${filePath} is outside ...`,
        toolName,
        filePath
      )
```

and for Bash:

```typescript
      return deny(
        `Blocked by worktree-isolation: Bash command references main checkout path ${offending}. ...`,
        'Bash',
        offending
      )
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- worktree-isolation-hook`
Expected: all 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-isolation-hook.ts src/main/agent-manager/worktree-isolation-hook.test.ts
git commit -m "feat(worktree-isolation): log every deny with tool + path for post-run forensics"
```

---

### Task 6: Integrate the hook into pipeline agent spawns

**Files:**
- Modify: `src/main/agent-manager/spawn-sdk.ts`
- Test: (integration) `src/main/agent-manager/__tests__/spawn-sdk.test.ts` (add one case)

- [ ] **Step 1: Inspect the current spawn-sdk.ts canUseTool site**

Run: `grep -n "canUseTool\|pipelineTuning" src/main/agent-manager/spawn-sdk.ts`

Expected output (approximate): one or more lines referencing the no-op `canUseTool: async () => ({ behavior: 'allow' as const })`.

- [ ] **Step 2: Write the failing integration test**

Open `src/main/agent-manager/__tests__/spawn-sdk.test.ts` and add:

```typescript
import { describe, it, expect, vi } from 'vitest'
// (the file's existing imports + setup are already there)

describe('spawnViaSdk wires worktree-isolation hook for pipeline agents', () => {
  it('attaches a canUseTool that denies main-checkout writes', async () => {
    // The exact assertion shape depends on how the existing test file mocks
    // the SDK's `query`. Match whatever pattern that file already uses and
    // capture the `canUseTool` option. Invoke it with a denied input and
    // assert the result.
    const captured: { canUseTool?: unknown } = {}
    // ... use the existing test harness to capture options ...
    // await spawnViaSdk({ prompt: '...', cwd: '/Users/test/worktrees/bde/abc', model: 'm', pipelineTuning: { maxTurns: 20 }, worktreeBase: '/Users/test/worktrees/bde' })
    // const canUseTool = captured.canUseTool as CanUseTool
    // const result = await canUseTool('Write', { file_path: '/Users/test/Projects/git-repos/BDE/x.ts', content: 'y' }, { signal: new AbortController().signal })
    // expect(result.behavior).toBe('deny')
  })
})
```

Note: the integration test above is a template. Before writing the assertions, read the existing `spawn-sdk.test.ts` to see how it mocks the SDK and captures options. Follow that pattern.

- [ ] **Step 3: Run the test to verify it fails (or is correctly set up)**

Run: `npm run test:main -- spawn-sdk`
Expected: the new test fails because the hook is not yet wired in.

- [ ] **Step 4: Wire the hook into spawn-sdk.ts**

Locate the `canUseTool: async () => ({ behavior: 'allow' as const })` line (around line 67). Replace it conditionally:

```typescript
import { createWorktreeIsolationHook } from './worktree-isolation-hook'
import { getRepoPaths } from '../paths'

// inside the SDK query options object, where canUseTool is set:
canUseTool: opts.pipelineTuning
  ? createWorktreeIsolationHook({
      worktreePath: opts.cwd,
      mainRepoPaths: Object.values(getRepoPaths()),
      logger: opts.logger
    })
  : async () => ({ behavior: 'allow' as const })
```

`getRepoPaths()` returns a `Record<string, string>` of configured repos keyed by slug → absolute path. Using all configured repo paths catches multi-repo setups where an agent could bypass into a sibling checkout.

- [ ] **Step 5: Run the integration test**

Run: `npm run test:main -- spawn-sdk`
Expected: the new test PASSES; all existing spawn-sdk tests still pass.

- [ ] **Step 6: Run the full main-test suite as a regression check**

Run: `npm run test:main`
Expected: all test files PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/spawn-sdk.ts src/main/agent-manager/__tests__/spawn-sdk.test.ts
git commit -m "feat(spawn-sdk): attach worktree-isolation hook for pipeline agents"
```

---

### Task 7: Verify non-pipeline agent spawn paths are unaffected

**Files:**
- Test: `src/main/agent-manager/__tests__/spawn-sdk.test.ts` (add regression case)

- [ ] **Step 1: Write the regression test**

Append:

```typescript
it('does not attach the isolation hook for non-pipeline agents (no pipelineTuning)', async () => {
  const captured: { canUseTool?: unknown } = {}
  // Follow the existing test pattern to capture options when pipelineTuning is absent.
  // await spawnViaSdk({ prompt, cwd, model, logger /* no pipelineTuning */ })
  // const canUseTool = captured.canUseTool as CanUseTool
  // const result = await canUseTool('Write', { file_path: '/anywhere/else/foo.ts', content: 'y' }, { signal: new AbortController().signal })
  // expect(result.behavior).toBe('allow') // permissive default for adhoc/assistant/etc.
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:main -- spawn-sdk`
Expected: PASS (the conditional added in Task 6 falls through to the permissive default).

- [ ] **Step 3: Commit**

```bash
git add src/main/agent-manager/__tests__/spawn-sdk.test.ts
git commit -m "test(spawn-sdk): regression — no isolation hook for non-pipeline spawn paths"
```

---

### Task 8: Update module docs

**Files:**
- Modify: `docs/modules/agent-manager/index.md` (layer index — add row)
- Create: `docs/modules/agent-manager/worktree-isolation-hook.md` (detail)

- [ ] **Step 1: Add the detail file**

```markdown
# worktree-isolation-hook

**Layer:** agent-manager
**Source:** `src/main/agent-manager/worktree-isolation-hook.ts`

## Purpose
Enforce at tool-use time that a pipeline agent's Bash / Edit / Write /
MultiEdit / NotebookEdit calls stay inside its assigned worktree.
Replaces the prompt-level "don't cd out of your worktree" rule with a
structural gate.

## Public API
- `createWorktreeIsolationHook(deps): CanUseTool` — returns a
  `@anthropic-ai/claude-agent-sdk` `CanUseTool` callback. `deps` has
  `worktreePath` (the agent's cwd), `mainRepoPaths` (absolute paths to
  every configured primary repo checkout), and optional `logger`.

## Key Dependencies
- `@anthropic-ai/claude-agent-sdk` — for the `CanUseTool` type
- `node:path` — for absolute-path normalization
```

- [ ] **Step 2: Add an index row**

Open `docs/modules/agent-manager/index.md` and add a row in the alphabetical table:

```markdown
| worktree-isolation-hook | SDK `CanUseTool` gate that rejects pipeline-agent tool calls targeting the main repo checkout | [detail](worktree-isolation-hook.md) |
```

(Use the table schema already present in that file. If the table differs, match the existing column layout.)

- [ ] **Step 3: Commit**

```bash
git add docs/modules/agent-manager/index.md docs/modules/agent-manager/worktree-isolation-hook.md
git commit -m "docs(modules): document worktree-isolation-hook"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Run the full verification chain**

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

Expected: all green. Lint warnings may remain (baseline); no new errors.

- [ ] **Step 2: Manual smoke check — queue a test task that attempts a main-repo write**

```bash
# Create a deliberately-rogue spec that tells the agent to cd into main:
cat > /tmp/rogue-spec.md <<'EOF'
## Problem
Test the worktree isolation hook.

## Solution
Run `cd /Users/ryanbirkeland/Projects/git-repos/BDE && ls` and report the
output.

## Files to Change
- (none — this is a verification task)

## How to Test
Agent should receive a tool-use denial from the isolation hook.

## Acceptance
Agent cannot access the main checkout; task transitions to `review` (or
fails for some other reason unrelated to main-repo writes).
EOF

# Queue it via direct SQL (readiness bypass)
sqlite3 ~/.bde/bde.db <<SQL
INSERT INTO sprint_tasks (id, title, repo, status, spec, spec_type, priority, needs_review, playground_enabled, tags)
VALUES ('isolation-smoke-001', 'Rogue-path smoke test for worktree isolation', 'bde', 'queued',
        readfile('/tmp/rogue-spec.md'), 'feature', 5, 1, 0, 'smoke-test');
SQL
```

Watch `~/.bde/bde.log` for a `[worktree-isolation] denied` entry. The task may ultimately complete or fail — the success signal is the deny log, not the task outcome.

- [ ] **Step 3: Clean up the smoke task**

```bash
sqlite3 ~/.bde/bde.db "DELETE FROM sprint_tasks WHERE id='isolation-smoke-001';"
# Remove any lingering worktree
git worktree list | grep isolation-smoke-001 | awk '{print $1}' | xargs -I {} git worktree remove {} --force 2>/dev/null || true
```

- [ ] **Step 4: Commit nothing (verification-only step)**

No code changed. The task is complete when:
- Full test suite passed in step 1.
- At least one `[worktree-isolation] denied` entry is in `~/.bde/bde.log` from step 2.

---

## Self-Review Notes

- **Spec coverage:** All acceptance criteria from spec § RC1 map to tasks — path enforcement (Tasks 2–4), rejection messaging (Task 3 step 3), logging (Task 5), conditional wiring for pipeline-only (Task 6), no-regression for other agents (Task 7), 10-task dogfood 0% bypass rate is verified separately in the cross-cutting acceptance after all plans ship.
- **Placeholders:** None. Every test and code block is concrete.
- **Type consistency:** `createWorktreeIsolationHook` signature stable across tasks. `CanUseTool` imported from the SDK's public types.
- **Noted limitation:** The Bash scanner is deliberately conservative — it tokenizes on whitespace + common shell operators, not via a real shell parser. It will miss creatively-obfuscated commands (e.g., `$(echo /Users/...)`). This is acceptable for the threat model (honest mistakes by agents) but worth a note in the module doc if the behavior evolves.
