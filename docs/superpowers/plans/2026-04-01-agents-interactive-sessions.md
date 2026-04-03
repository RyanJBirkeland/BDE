# Agents Interactive Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Agents view Launchpad from a three-phase wizard into a single-screen interactive session launcher.

**Architecture:** Remove LaunchpadConfigure and LaunchpadReview. Collapse AgentLaunchpad into a thin wrapper that renders the simplified LaunchpadGrid directly. All spawns go through `spawnAdhocAgent` with `assistant: true` for interactive multi-turn sessions.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Electron IPC

**Spec:** `docs/superpowers/specs/2026-04-01-agents-interactive-sessions-design.md`

---

### Task 1: Add `assistant` flag to localAgents store

**Files:**

- Modify: `src/renderer/src/stores/localAgents.ts:35-38`
- Test: `src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx` (verified in Task 5)

- [ ] **Step 1: Update `spawnAgent` args type**

In `src/renderer/src/stores/localAgents.ts`, update the `spawnAgent` method signature to include `assistant`:

```typescript
spawnAgent: (args: { task: string; repoPath: string; model?: string; assistant?: boolean }) =>
  Promise<{ pid: number; logPath: string; id: string }>
```

- [ ] **Step 2: Pass `assistant` through to IPC**

In the same file, the `spawnAgent` implementation (line 75-98) already spreads `args` to `window.api.spawnLocalAgent(args)`. Since `SpawnLocalAgentArgs` in `src/shared/types.ts` already has `assistant?: boolean`, this flows through automatically. Verify by reading the call at line 78 — it should be `window.api.spawnLocalAgent(args)`. No change needed if it passes the full args object.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/localAgents.ts
git commit -m "feat: add assistant flag to localAgents spawnAgent type"
```

---

### Task 2: Remove `agent:spawnAssistant` IPC handler

Removing the dedicated assistant handler since all spawns now go through `local:spawnClaudeAgent` with `assistant: true`.

**Files:**

- Modify: `src/main/handlers/agent-handlers.ts:34-41`
- Modify: `src/shared/ipc-channels.ts:148` (remove `agent:spawnAssistant` entry)
- Modify: `src/preload/index.ts:65-66` (remove `spawnAssistant` bridge)
- Modify: `src/preload/index.d.ts:62-64` (remove type declaration)
- Modify: `src/main/handlers/__tests__/agent-handlers.test.ts:83` (remove channel assertion)
- Modify: `src/renderer/src/views/__tests__/AgentsView.test.tsx:94` (remove mock)
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx:105-125` (rewrite to use `spawnLocalAgent`)

- [ ] **Step 1: Remove handler from agent-handlers.ts**

Delete lines 34-41 in `src/main/handlers/agent-handlers.ts` (the `safeHandle('agent:spawnAssistant', ...)` block).

- [ ] **Step 2: Remove IPC channel type**

In `src/shared/ipc-channels.ts`, delete the `'agent:spawnAssistant'` entry (around line 148).

- [ ] **Step 3: Remove preload bridge**

In `src/preload/index.ts`, delete:

```typescript
spawnAssistant: (args: { repoPath: string; model?: string }) =>
  typedInvoke('agent:spawnAssistant', args),
```

In `src/preload/index.d.ts`, delete:

```typescript
spawnAssistant: (...args: IpcArgs<'agent:spawnAssistant'>) =>
  Promise<IpcResult<'agent:spawnAssistant'>>
```

- [ ] **Step 4: Update CommandPalette to use spawnLocalAgent**

In `src/renderer/src/components/layout/CommandPalette.tsx`, replace the `action-spawn-assistant` action (lines 105-125):

```typescript
{
  id: 'action-spawn-assistant',
  label: 'Launch BDE Assistant',
  category: 'action',
  hint: 'Interactive helper',
  action: async () => {
    onClose()
    try {
      const paths = await window.api.getRepoPaths()
      const repoPath = paths['BDE'] || paths[Object.keys(paths)[0]]
      if (!repoPath) {
        toast.error('No repo path found')
        return
      }
      await window.api.spawnLocalAgent({
        task: 'You are now ready to assist. Wait for the user\'s first message.',
        repoPath,
        assistant: true
      })
      toast.success('BDE Assistant spawned')
      setView('agents')
    } catch (err) {
      toast.error(`Failed to spawn assistant: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
},
```

- [ ] **Step 5: Update tests**

In `src/main/handlers/__tests__/agent-handlers.test.ts`:

- Remove `agent:spawnAssistant` from the `toContain` channel assertion (line 83)
- Delete the entire `describe('agent:spawnAssistant handler', ...)` test block (lines 294-334)

In `src/renderer/src/views/__tests__/AgentsView.test.tsx`, remove the `spawnAssistant` mock (line 94).

- [ ] **Step 6: Run tests**

Run: `npm test -- --reporter=verbose 2>&1 | tail -20`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove agent:spawnAssistant IPC, use spawnLocalAgent with assistant flag"
```

---

### Task 3: Clean up launchpad types and prompt-assembly

**Files:**

- Modify: `src/renderer/src/lib/launchpad-types.ts` (remove `RecentTask`, `RECENT_TASKS_KEY`, `RECENT_TASKS_LIMIT`)
- Modify: `src/renderer/src/lib/prompt-assembly.ts` (delete `migrateHistory`, keep `assemblePrompt`)

- [ ] **Step 1: Remove recents types from launchpad-types.ts**

In `src/renderer/src/lib/launchpad-types.ts`, delete:

- `RecentTask` interface (lines 59-71)
- `RECENT_TASKS_KEY` constant (line 74)
- `RECENT_TASKS_LIMIT` constant (line 77)

- [ ] **Step 2: Delete migrateHistory from prompt-assembly.ts**

In `src/renderer/src/lib/prompt-assembly.ts`:

- Delete the `migrateHistory` function (lines 36-63)
- Remove `RecentTask` from the import: change to `import type { PromptTemplate } from './launchpad-types'`

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: Pass (or show only errors from files we haven't updated yet — LaunchpadGrid/AgentLaunchpad, which we fix in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/launchpad-types.ts src/renderer/src/lib/prompt-assembly.ts
git commit -m "refactor: remove RecentTask type and migrateHistory, keep assemblePrompt"
```

---

### Task 4: Rewrite AgentLaunchpad and LaunchpadGrid

This is the main UI change. AgentLaunchpad becomes a thin wrapper. LaunchpadGrid becomes the single-screen launcher.

**Files:**

- Rewrite: `src/renderer/src/components/agents/AgentLaunchpad.tsx`
- Rewrite: `src/renderer/src/components/agents/LaunchpadGrid.tsx`
- Delete: `src/renderer/src/components/agents/LaunchpadConfigure.tsx`
- Delete: `src/renderer/src/components/agents/LaunchpadReview.tsx`

- [ ] **Step 1: Rewrite AgentLaunchpad.tsx**

Replace the entire file. The orchestrator no longer needs phase state, selected template, answers, or assembled prompt. It resolves repo paths, loads templates, and delegates to LaunchpadGrid with a spawn callback.

```typescript
import { useState, useCallback, useEffect } from 'react'
import '../../assets/agent-launchpad-neon.css'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { usePromptTemplatesStore } from '../../stores/promptTemplates'
import { toast } from '../../stores/toasts'
import { assemblePrompt } from '../../lib/prompt-assembly'
import type { PromptTemplate } from '../../lib/launchpad-types'
import { LaunchpadGrid } from './LaunchpadGrid'

interface AgentLaunchpadProps {
  onAgentSpawned: () => void
}

export function AgentLaunchpad({ onAgentSpawned }: AgentLaunchpadProps) {
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})

  const templates = usePromptTemplatesStore((s) => s.templates)
  const loadTemplates = usePromptTemplatesStore((s) => s.loadTemplates)
  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const spawning = useLocalAgentsStore((s) => s.isSpawning)

  useEffect(() => {
    loadTemplates()
    window.api.getRepoPaths().then(setRepoPaths).catch(() => {})
  }, [loadTemplates])

  const visibleTemplates = templates.filter((t) => !t.hidden)

  const handleSpawn = useCallback(
    async (prompt: string, repo: string, model: string) => {
      const repoPath = repoPaths[repo.toLowerCase()]
      if (!repoPath) {
        toast.error(`Repo path not found for "${repo}"`)
        return
      }
      try {
        await spawnAgent({ task: prompt, repoPath, model, assistant: true })
        fetchProcesses()
        toast.success('Session started')
        onAgentSpawned()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`Spawn failed: ${message}`)
      }
    },
    [repoPaths, spawnAgent, fetchProcesses, onAgentSpawned]
  )

  const handleTemplateSpawn = useCallback(
    (template: PromptTemplate, repo: string, model: string) => {
      const prompt = assemblePrompt(template, {})
      handleSpawn(prompt, repo, model)
    },
    [handleSpawn]
  )

  return (
    <LaunchpadGrid
      templates={visibleTemplates}
      onSelectTemplate={handleTemplateSpawn}
      onCustomPrompt={handleSpawn}
      spawning={spawning}
    />
  )
}
```

- [ ] **Step 2: Rewrite LaunchpadGrid.tsx**

Replace the entire file. Remove recents section. Reposition repo/model as muted defaults row. Chat-style input at bottom.

```typescript
import { useState, useCallback } from 'react'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { CLAUDE_MODELS } from '../../../../shared/models'
import type { PromptTemplate } from '../../lib/launchpad-types'
import type { NeonAccent } from '../neon/types'

interface LaunchpadGridProps {
  templates: PromptTemplate[]
  onSelectTemplate: (template: PromptTemplate, repo: string, model: string) => void
  onCustomPrompt: (prompt: string, repo: string, model: string) => void
  spawning: boolean
}

const ACCENT_VARS: Record<
  NeonAccent,
  { bg: string; border: string; color: string; glow: string; hover: string }
> = {
  cyan: {
    bg: 'rgba(0,255,255,0.06)',
    border: 'var(--neon-cyan-border)',
    color: 'var(--neon-cyan)',
    glow: 'rgba(0,255,255,0.15)',
    hover: 'rgba(0,255,255,0.3)'
  },
  pink: {
    bg: 'rgba(255,0,255,0.06)',
    border: 'var(--neon-pink-border)',
    color: 'var(--neon-pink)',
    glow: 'rgba(255,0,255,0.15)',
    hover: 'rgba(255,0,255,0.3)'
  },
  blue: {
    bg: 'rgba(100,100,255,0.06)',
    border: 'var(--neon-blue-border)',
    color: 'var(--neon-blue)',
    glow: 'rgba(100,100,255,0.15)',
    hover: 'rgba(100,100,255,0.3)'
  },
  purple: {
    bg: 'rgba(138,43,226,0.06)',
    border: 'var(--neon-purple-border)',
    color: 'var(--neon-purple)',
    glow: 'rgba(138,43,226,0.15)',
    hover: 'rgba(138,43,226,0.3)'
  },
  orange: {
    bg: 'rgba(255,165,0,0.06)',
    border: 'var(--neon-orange-border)',
    color: 'var(--neon-orange)',
    glow: 'rgba(255,165,0,0.15)',
    hover: 'rgba(255,165,0,0.3)'
  },
  red: {
    bg: 'rgba(255,80,80,0.06)',
    border: 'var(--neon-red-border)',
    color: 'var(--neon-red)',
    glow: 'rgba(255,80,80,0.15)',
    hover: 'rgba(255,80,80,0.3)'
  }
}

export function LaunchpadGrid({
  templates,
  onSelectTemplate,
  onCustomPrompt,
  spawning
}: LaunchpadGridProps) {
  const repos = useRepoOptions()
  const [prompt, setPrompt] = useState('')
  const [repo, setRepo] = useState(repos[0]?.label ?? '')
  const [model, setModel] = useState('sonnet')

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
        e.preventDefault()
        onCustomPrompt(prompt.trim(), repo, model)
      }
    },
    [prompt, repo, model, onCustomPrompt]
  )

  return (
    <div className="launchpad" data-testid="launchpad-grid">
      {/* Header */}
      <div className="launchpad__header">
        <div className="launchpad__header-dot" />
        <span className="launchpad__header-title">New Session</span>
      </div>

      {/* Quick Actions */}
      <div className="launchpad__section-label">Quick Actions</div>
      <div className="launchpad__tile-grid">
        {templates.map((t) => {
          const vars = ACCENT_VARS[t.accent]
          return (
            <button
              key={t.id}
              type="button"
              className="launchpad__tile"
              disabled={spawning}
              style={
                {
                  '--tile-bg': vars.bg,
                  '--tile-border': vars.border,
                  '--tile-color': vars.color,
                  '--tile-glow': vars.glow,
                  '--tile-hover-border': vars.hover
                } as React.CSSProperties
              }
              onClick={() => onSelectTemplate(t, repo, model)}
            >
              <div className="launchpad__tile-icon">{t.icon}</div>
              <div className="launchpad__tile-name">{t.name}</div>
              <div className="launchpad__tile-desc">{t.description}</div>
            </button>
          )
        })}
      </div>

      {/* Repo / Model defaults */}
      <div className="launchpad__defaults-row">
        <button
          type="button"
          className="launchpad__repo-chip"
          onClick={() => {
            const idx = repos.findIndex((r) => r.label === repo)
            setRepo(repos[(idx + 1) % repos.length]?.label ?? repos[0]?.label ?? '')
          }}
        >
          <div className="launchpad__repo-dot" />
          {repo} &#x25BE;
        </button>
        <div className="launchpad__model-pills">
          {CLAUDE_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`launchpad__model-pill ${model === m.id ? 'launchpad__model-pill--active' : ''}`}
              onClick={() => setModel(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input */}
      <div className="launchpad__prompt-bar">
        <textarea
          className="launchpad__prompt-input"
          placeholder="What would you like to work on?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={spawning}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Delete LaunchpadConfigure.tsx and LaunchpadReview.tsx**

```bash
rm src/renderer/src/components/agents/LaunchpadConfigure.tsx
rm src/renderer/src/components/agents/LaunchpadReview.tsx
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -30`
Expected: Pass (no references to deleted files remain).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rewrite Launchpad as single-screen interactive session launcher

Remove three-phase wizard (grid → configure → review). Quick action
tiles now spawn interactive sessions directly. Custom prompt input
styled as chat entry point."
```

---

### Task 5: Update tests

**Files:**

- Rewrite: `src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx`
- Rewrite: `src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx`
- Delete: `src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx`
- Delete: `src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx`

- [ ] **Step 1: Delete obsolete test files**

```bash
rm src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx
rm src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx
```

- [ ] **Step 2: Rewrite AgentLaunchpad.test.tsx**

Test the simplified orchestrator:

- Renders LaunchpadGrid with templates
- Spawns agent with `assistant: true` on custom prompt
- Spawns agent with template prompt on tile click (variables stripped)
- Shows error toast when repo path not found

Key mock setup: mock `usePromptTemplatesStore`, `useLocalAgentsStore`, `window.api.getRepoPaths`, `toast`. Set store state BEFORE `render()` (Zustand gotcha from CLAUDE.md).

- [ ] **Step 3: Rewrite LaunchpadGrid.test.tsx**

Test the simplified grid:

- Renders quick action tiles from templates
- Renders repo chip and model pills
- Renders chat input with placeholder "What would you like to work on?"
- Enter on input calls `onCustomPrompt` with prompt, repo, model
- Shift+Enter does NOT submit (allows multiline)
- Clicking tile calls `onSelectTemplate` with template, repo, model
- Tiles and textarea disabled when `spawning` is true
- No "Recent" section rendered

- [ ] **Step 4: Run tests**

Run: `npm test -- --reporter=verbose 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: update Launchpad tests for interactive session redesign"
```

---

### Task 6: Clean up CSS

**Files:**

- Modify: `src/renderer/src/assets/agent-launchpad-neon.css`

- [ ] **Step 1: Add `.launchpad__defaults-row` style**

Add to `agent-launchpad-neon.css`:

```css
.launchpad__defaults-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  opacity: 0.7;
}
```

- [ ] **Step 2: Remove unused CSS classes**

Delete all CSS rules with these prefixes from `agent-launchpad-neon.css`:

- `.launchpad__review*` (review screen)
- `.launchpad__chat*` (configure wizard chat)
- `.launchpad__recent*` (recent tasks list)
- `.launchpad__msg*` (chat messages)
- `.launchpad__choice*` (choice buttons)
- `.launchpad__spec*` (spec block)
- `.launchpad__param*` (param cards)
- `.launchpad__btn*` (ghost/spawn buttons)
- `.launchpad__back` (back button)

- [ ] **Step 3: Update prompt input for textarea**

The input changed from `<input>` to `<textarea>`. Update `.launchpad__prompt-input` if needed to support multi-row (add `resize: none; min-height: 48px;`).

- [ ] **Step 4: Run dev server and visually verify**

Run: `npm run dev`
Verify: Launchpad shows tiles, repo/model defaults, and chat input. No visual regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/agent-launchpad-neon.css
git commit -m "chore: clean up unused Launchpad CSS classes, add defaults-row"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: All pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -10`
Expected: Pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -10`
Expected: Pass (or only pre-existing warnings).

- [ ] **Step 4: Verify no dead imports**

Grep for any remaining references to deleted files/exports:

```bash
grep -r "LaunchpadConfigure\|LaunchpadReview\|migrateHistory\|RECENT_TASKS_KEY\|RECENT_TASKS_LIMIT\|RecentTask\|spawnAssistant" src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v __tests__
```

Expected: No results (or only the spec doc).

- [ ] **Step 5: Commit any fixes**

If any issues found, fix and commit:

```bash
git add -A
git commit -m "chore: clean up dead references from Launchpad simplification"
```
