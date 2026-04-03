# Agent Launchpad — UI Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 4 UI components (LaunchpadGrid, LaunchpadConfigure, LaunchpadReview, AgentLaunchpad orchestrator), the CSS file, and integrate into AgentsView — replacing the SpawnModal.

**Architecture:** The AgentLaunchpad orchestrator manages a `phase` state ('grid' | 'configure' | 'review') and renders the corresponding sub-component. Each sub-component is a pure presentation component that receives data and callbacks as props. All styling lives in `agent-launchpad-neon.css` using `var(--neon-*)` CSS custom properties. The data layer (types, store, utilities) is built by the preceding plan.

**Tech Stack:** React, TypeScript, Zustand, Framer Motion, CSS custom properties, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-25-agent-launchpad-design.md`
**Depends on:** `docs/superpowers/plans/2026-03-25-agent-launchpad-data-layer.md` (must be complete)

---

## File Map

| File                                                                       | Action | Purpose                                                 |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `src/renderer/src/assets/agent-launchpad-neon.css`                         | Create | All launchpad styling — tiles, chat, review, animations |
| `src/renderer/src/components/agents/LaunchpadGrid.tsx`                     | Create | Tile grid + recents + prompt bar                        |
| `src/renderer/src/components/agents/LaunchpadConfigure.tsx`                | Create | Chat-style question flow                                |
| `src/renderer/src/components/agents/LaunchpadReview.tsx`                   | Create | Review prompt + params + spawn                          |
| `src/renderer/src/components/agents/AgentLaunchpad.tsx`                    | Create | Phase orchestrator component                            |
| `src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx`      | Create | Grid component tests                                    |
| `src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx` | Create | Configure flow tests                                    |
| `src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx`    | Create | Review component tests                                  |
| `src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx`     | Create | Orchestrator integration tests                          |
| `src/renderer/src/views/AgentsView.tsx`                                    | Modify | Replace SpawnModal with AgentLaunchpad                  |
| `src/renderer/src/components/agents/SpawnModal.tsx`                        | Delete | Replaced by AgentLaunchpad                              |
| `src/renderer/src/components/agents/__tests__/SpawnModal.test.tsx`         | Delete | Replaced by new tests                                   |

---

### Task 1: Create Launchpad CSS

**Files:**

- Create: `src/renderer/src/assets/agent-launchpad-neon.css`

- [ ] **Step 1: Create the CSS file**

Create the file `src/renderer/src/assets/agent-launchpad-neon.css` with this exact content:

```css
/* src/renderer/src/assets/agent-launchpad-neon.css */
/* ═══════════════════════════════════════════════════════
   Agent Launchpad — Tile Grid, Configure Chat, Review
   Uses var(--neon-*) tokens from neon.css
   ═══════════════════════════════════════════════════════ */

/* ── Launchpad Container ── */
.launchpad {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow-y: auto;
  background: var(--neon-bg);
}

.launchpad__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--neon-cyan-border);
}

.launchpad__header-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--neon-cyan);
  box-shadow: 0 0 10px var(--neon-cyan);
  animation: neon-breathe 2s ease-in-out infinite;
}

.launchpad__header-title {
  color: var(--neon-cyan);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 600;
}

.launchpad__back {
  background: none;
  border: none;
  color: var(--neon-text-dim);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition:
    color 150ms ease,
    background 150ms ease;
}

.launchpad__back:hover {
  color: var(--neon-cyan);
  background: var(--neon-cyan-surface);
}

/* ── Section Labels ── */
.launchpad__section-label {
  color: var(--neon-text-dim);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 600;
  margin-bottom: 8px;
}

/* ── Tile Grid ── */
.launchpad__tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.launchpad__tile {
  background: linear-gradient(135deg, var(--tile-bg), transparent);
  border: 1px solid var(--tile-border);
  border-radius: 12px;
  padding: 18px 14px;
  text-align: center;
  cursor: pointer;
  transition:
    transform 150ms ease,
    box-shadow 150ms ease,
    border-color 150ms ease;
  position: relative;
  overflow: hidden;
}

.launchpad__tile:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px var(--tile-glow);
  border-color: var(--tile-hover-border);
}

.launchpad__tile:active {
  transform: translateY(0);
}

.launchpad__tile-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.launchpad__tile-name {
  color: var(--tile-color);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.launchpad__tile-desc {
  color: var(--neon-text-dim);
  font-size: 10px;
  margin-top: 4px;
}

.launchpad__tile--add {
  border-style: dashed;
  border-color: var(--neon-surface-subtle);
}

.launchpad__tile--add:hover {
  border-color: var(--neon-text-dim);
}

.launchpad__tile--add .launchpad__tile-icon {
  color: var(--neon-text-dim);
}

.launchpad__tile--add .launchpad__tile-name {
  color: var(--neon-text-dim);
}

/* ── Recent List ── */
.launchpad__recent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 24px;
}

.launchpad__recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--neon-surface-dim);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

.launchpad__recent-item:hover {
  background: var(--neon-surface-subtle);
  border-color: var(--neon-surface-subtle);
}

.launchpad__recent-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--neon-text-dim);
  flex-shrink: 0;
}

.launchpad__recent-text {
  color: var(--neon-text-muted);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launchpad__recent-time {
  color: var(--neon-text-dim);
  font-size: 10px;
  flex-shrink: 0;
}

/* ── Bottom Prompt Bar ── */
.launchpad__prompt-bar {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--neon-surface-dim);
}

.launchpad__prompt-input {
  flex: 1;
  background: var(--neon-surface-dim);
  border: 1px solid var(--neon-surface-subtle);
  border-radius: 10px;
  padding: 12px 16px;
  color: var(--neon-text);
  font-size: 13px;
  outline: none;
  transition: border-color 200ms ease;
  font-family: inherit;
}

.launchpad__prompt-input::placeholder {
  color: var(--neon-text-dim);
}

.launchpad__prompt-input:focus {
  border-color: var(--neon-cyan-border);
}

/* ── Repo Chip ── */
.launchpad__repo-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--neon-text-dim);
  font-size: 11px;
  padding: 6px 10px;
  border: 1px solid var(--neon-surface-dim);
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  background: none;
  transition: border-color 150ms ease;
}

.launchpad__repo-chip:hover {
  border-color: var(--neon-surface-subtle);
}

.launchpad__repo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--neon-cyan);
  opacity: 0.5;
}

/* ── Model Pills ── */
.launchpad__model-pills {
  display: flex;
  gap: 3px;
}

.launchpad__model-pill {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
  border: 1px solid var(--neon-surface-dim);
  color: var(--neon-text-dim);
  background: var(--neon-surface-dim);
}

.launchpad__model-pill:hover {
  border-color: var(--neon-surface-subtle);
  color: var(--neon-text-muted);
}

.launchpad__model-pill--active {
  border-color: var(--neon-cyan-border);
  color: var(--neon-cyan);
  background: var(--neon-cyan-surface);
}

/* ── Configure Chat ── */
.launchpad__chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
}

.launchpad__chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--neon-cyan-border);
}

.launchpad__chat-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 8px;
  padding: 6px 12px;
}

.launchpad__chat-badge-icon {
  font-size: 16px;
}

.launchpad__chat-badge-name {
  color: var(--neon-cyan);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.launchpad__chat-step {
  margin-left: auto;
  color: var(--neon-text-dim);
  font-size: 10px;
}

.launchpad__chat-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
  overflow-y: auto;
}

/* ── Chat Message Bubbles ── */
.launchpad__msg {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.launchpad__msg--system {
  align-self: flex-start;
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  color: var(--neon-text-muted);
}

.launchpad__msg-label {
  color: var(--neon-cyan);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
  font-weight: 600;
}

.launchpad__msg--user {
  align-self: flex-end;
  background: var(--neon-purple-surface);
  border: 1px solid var(--neon-purple-border);
  color: var(--neon-text);
}

/* ── Choice Chips ── */
.launchpad__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.launchpad__choice {
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 11px;
  border: 1px solid var(--neon-cyan-border);
  color: var(--neon-cyan);
  cursor: pointer;
  transition: all 150ms ease;
  background: var(--neon-surface-dim);
}

.launchpad__choice:hover {
  background: var(--neon-cyan-surface);
}

.launchpad__choice--selected {
  background: var(--neon-cyan-surface);
  border-color: var(--neon-cyan);
  box-shadow: 0 0 8px var(--neon-cyan-glow);
}

/* ── Chat Input Bar ── */
.launchpad__chat-input-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--neon-surface-dim);
  margin-top: auto;
}

.launchpad__chat-input {
  flex: 1;
  background: var(--neon-surface-dim);
  border: 1px solid var(--neon-surface-subtle);
  border-radius: 10px;
  padding: 10px 14px;
  color: var(--neon-text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}

.launchpad__chat-input::placeholder {
  color: var(--neon-text-dim);
}

.launchpad__chat-input:focus {
  border-color: var(--neon-cyan-border);
}

.launchpad__chat-send {
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 8px;
  padding: 8px 14px;
  color: var(--neon-cyan);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
}

.launchpad__chat-send:hover {
  background: var(--neon-cyan-border);
}

.launchpad__chat-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Review Screen ── */
.launchpad__review {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
}

.launchpad__review-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--neon-cyan-border);
}

.launchpad__review-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--neon-cyan);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* ── Param Grid ── */
.launchpad__param-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.launchpad__param-card {
  background: var(--neon-surface-dim);
  border: 1px solid var(--neon-surface-subtle);
  border-radius: 10px;
  padding: 14px;
}

.launchpad__param-label {
  color: var(--neon-text-dim);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.launchpad__param-value {
  color: var(--neon-text-muted);
  font-size: 13px;
}

/* ── Spec Block ── */
.launchpad__spec-block {
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  position: relative;
}

.launchpad__spec-label {
  color: var(--neon-cyan);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 8px;
  font-weight: 600;
}

.launchpad__spec-content {
  color: var(--neon-text-muted);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.launchpad__spec-textarea {
  width: 100%;
  min-height: 200px;
  background: transparent;
  border: none;
  color: var(--neon-text-muted);
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  font-family: inherit;
}

.launchpad__spec-edit {
  position: absolute;
  top: 12px;
  right: 12px;
  color: var(--neon-text-dim);
  font-size: 10px;
  border: 1px solid var(--neon-surface-subtle);
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 150ms ease;
  background: none;
}

.launchpad__spec-edit:hover {
  color: var(--neon-cyan);
  border-color: var(--neon-cyan-border);
}

/* ── Review Actions ── */
.launchpad__review-actions {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--neon-surface-dim);
  justify-content: flex-end;
}

.launchpad__btn-ghost {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
  border: 1px solid var(--neon-surface-subtle);
  color: var(--neon-text-muted);
  background: transparent;
}

.launchpad__btn-ghost:hover {
  border-color: var(--neon-text-dim);
  color: var(--neon-text);
}

.launchpad__btn-spawn {
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 200ms ease;
  border: 1px solid var(--neon-cyan-border);
  color: var(--neon-cyan);
  background: linear-gradient(135deg, var(--neon-cyan-surface), var(--neon-surface-deep));
  text-transform: uppercase;
  letter-spacing: 1px;
  box-shadow: 0 0 20px var(--neon-cyan-glow);
}

.launchpad__btn-spawn:hover {
  box-shadow: 0 0 30px var(--neon-cyan-glow);
  background: linear-gradient(135deg, var(--neon-cyan-border), var(--neon-cyan-surface));
}

.launchpad__btn-spawn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  box-shadow: none;
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  .launchpad__tile:hover {
    transform: none;
  }

  .launchpad__header-dot {
    animation: none;
  }
}
```

- [ ] **Step 2: Verify the file is valid CSS**

Run: `wc -l src/renderer/src/assets/agent-launchpad-neon.css`

Expected: File exists, ~430 lines.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/agent-launchpad-neon.css
git commit -m "feat(launchpad): add neon CSS for tile grid, chat flow, and review screens"
```

---

### Task 2: Create LaunchpadGrid Component + Tests

**Files:**

- Create: `src/renderer/src/components/agents/LaunchpadGrid.tsx`
- Create: `src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchpadGrid } from '../LaunchpadGrid'
import { DEFAULT_TEMPLATES } from '../../../lib/default-templates'
import type { RecentTask } from '../../../lib/launchpad-types'

const mockRepos = [
  { label: 'BDE', owner: 'owner', color: '#fff' },
  { label: 'life-os', owner: 'owner', color: '#fff' }
]

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => mockRepos
}))

describe('LaunchpadGrid', () => {
  const onSelectTemplate = vi.fn()
  const onCustomPrompt = vi.fn()
  const onSelectRecent = vi.fn()

  const defaultProps = {
    templates: DEFAULT_TEMPLATES.filter((t) => !t.hidden),
    recents: [] as RecentTask[],
    onSelectTemplate,
    onCustomPrompt,
    onSelectRecent
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header with dot and title', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText(/New Agent Session/i)).toBeInTheDocument()
  })

  it('renders all visible template tiles', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText('Clean Code')).toBeInTheDocument()
    expect(screen.getByText('Fix Bug')).toBeInTheDocument()
    expect(screen.getByText('New Feature')).toBeInTheDocument()
  })

  it('renders the + Add tile', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText('Add Custom')).toBeInTheDocument()
  })

  it('calls onSelectTemplate when a tile is clicked', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    fireEvent.click(screen.getByText('Clean Code'))
    expect(onSelectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'builtin-clean-code' })
    )
  })

  it('renders recent tasks when provided', () => {
    const recents: RecentTask[] = [
      { prompt: 'Fix the login bug', repo: 'BDE', model: 'sonnet', timestamp: Date.now() - 3600000 }
    ]
    render(<LaunchpadGrid {...defaultProps} recents={recents} />)
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })

  it('calls onSelectRecent when a recent item is clicked', () => {
    const recents: RecentTask[] = [
      { prompt: 'Fix the login bug', repo: 'BDE', model: 'sonnet', timestamp: Date.now() }
    ]
    render(<LaunchpadGrid {...defaultProps} recents={recents} />)
    fireEvent.click(screen.getByText(/Fix the login bug/))
    expect(onSelectRecent).toHaveBeenCalledWith(recents[0])
  })

  it('renders prompt input', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByPlaceholderText(/describe a custom task/i)).toBeInTheDocument()
  })

  it('renders model pills with Sonnet active by default', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    const sonnet = screen.getByText('Sonnet')
    expect(sonnet).toBeInTheDocument()
    expect(sonnet.closest('button')).toHaveClass('launchpad__model-pill--active')
  })

  it('calls onCustomPrompt when Enter is pressed with text', async () => {
    const user = userEvent.setup()
    render(<LaunchpadGrid {...defaultProps} />)
    const input = screen.getByPlaceholderText(/describe a custom task/i)
    await user.type(input, 'Do something custom{Enter}')
    expect(onCustomPrompt).toHaveBeenCalledWith(
      'Do something custom',
      expect.any(String), // repo
      expect.any(String) // model
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx 2>&1 | tail -10`

Expected: FAIL — Cannot find module `../LaunchpadGrid`

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/agents/LaunchpadGrid.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { CLAUDE_MODELS } from '../../../../shared/models'
import type { PromptTemplate, RecentTask } from '../../lib/launchpad-types'
import type { NeonAccent } from '../neon/types'

interface LaunchpadGridProps {
  templates: PromptTemplate[]
  recents: RecentTask[]
  onSelectTemplate: (template: PromptTemplate) => void
  onCustomPrompt: (prompt: string, repo: string, model: string) => void
  onSelectRecent: (recent: RecentTask) => void
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

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function LaunchpadGrid({
  templates,
  recents,
  onSelectTemplate,
  onCustomPrompt,
  onSelectRecent
}: LaunchpadGridProps) {
  const repos = useRepoOptions()
  const [prompt, setPrompt] = useState('')
  const [repo, setRepo] = useState(repos[0]?.label ?? '')
  const [model, setModel] = useState('sonnet')

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && prompt.trim()) {
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
        <span className="launchpad__header-title">New Agent Session</span>
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
              style={
                {
                  '--tile-bg': vars.bg,
                  '--tile-border': vars.border,
                  '--tile-color': vars.color,
                  '--tile-glow': vars.glow,
                  '--tile-hover-border': vars.hover
                } as React.CSSProperties
              }
              onClick={() => onSelectTemplate(t)}
            >
              <div className="launchpad__tile-icon">{t.icon}</div>
              <div className="launchpad__tile-name">{t.name}</div>
              <div className="launchpad__tile-desc">{t.description}</div>
            </button>
          )
        })}
        <button type="button" className="launchpad__tile launchpad__tile--add">
          <div className="launchpad__tile-icon">+</div>
          <div className="launchpad__tile-name">Add Custom</div>
        </button>
      </div>

      {/* Recent */}
      {recents.length > 0 && (
        <>
          <div className="launchpad__section-label">Recent</div>
          <div className="launchpad__recent-list">
            {recents.map((r, i) => (
              <button
                key={`${r.timestamp}-${i}`}
                type="button"
                className="launchpad__recent-item"
                onClick={() => onSelectRecent(r)}
              >
                <div className="launchpad__recent-dot" />
                <span className="launchpad__recent-text">
                  {r.prompt.length > 80 ? `${r.prompt.slice(0, 80)}...` : r.prompt}
                </span>
                {r.timestamp > 0 && (
                  <span className="launchpad__recent-time">{formatRelativeTime(r.timestamp)}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Bottom Prompt Bar */}
      <div className="launchpad__prompt-bar">
        <input
          className="launchpad__prompt-input"
          placeholder="Or describe a custom task..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
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
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx 2>&1 | tail -15`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/LaunchpadGrid.tsx src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx
git commit -m "feat(launchpad): add LaunchpadGrid component with tile grid, recents, and prompt bar"
```

---

### Task 3: Create LaunchpadConfigure Component + Tests

**Files:**

- Create: `src/renderer/src/components/agents/LaunchpadConfigure.tsx`
- Create: `src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchpadConfigure } from '../LaunchpadConfigure'
import type { PromptTemplate } from '../../../lib/launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-template',
  name: 'Test Task',
  icon: '🧪',
  accent: 'cyan',
  description: 'Test',
  questions: [
    { id: 'scope', label: 'Pick a scope', type: 'choice', choices: ['All', 'Some', 'None'] },
    { id: 'detail', label: 'Describe in detail', type: 'text', required: true }
  ],
  promptTemplate: '{{scope}} — {{detail}}',
  order: 0
}

describe('LaunchpadConfigure', () => {
  const onComplete = vi.fn()
  const onBack = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders template badge with icon and name', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('🧪')).toBeInTheDocument()
    expect(screen.getByText('Test Task')).toBeInTheDocument()
  })

  it('shows the first question', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('Pick a scope')).toBeInTheDocument()
  })

  it('shows step counter', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument()
  })

  it('renders choice chips for choice questions', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Some')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('advances to next question when choice is clicked', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    fireEvent.click(screen.getByText('All'))
    // Should show the answer bubble and next question
    expect(screen.getByText('Describe in detail')).toBeInTheDocument()
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument()
  })

  it('calls onComplete with answers after last question', async () => {
    const user = userEvent.setup()
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)

    // Answer first question
    fireEvent.click(screen.getByText('All'))

    // Answer second question (text type) via input
    const input = screen.getByPlaceholderText(/Type an answer/i)
    await user.type(input, 'some detail{Enter}')

    expect(onComplete).toHaveBeenCalledWith({ scope: 'All', detail: 'some detail' })
  })

  it('calls onBack when back arrow is clicked', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    fireEvent.click(screen.getByTitle(/back/i))
    expect(onBack).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx 2>&1 | tail -10`

Expected: FAIL — Cannot find module

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/agents/LaunchpadConfigure.tsx`:

```tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import type { PromptTemplate } from '../../lib/launchpad-types'

interface LaunchpadConfigureProps {
  template: PromptTemplate
  onComplete: (answers: Record<string, string>) => void
  onBack: () => void
}

interface ChatMessage {
  type: 'system' | 'user'
  text: string
  questionId?: string
  choices?: string[]
  questionType?: 'choice' | 'text' | 'multi-choice'
}

export function LaunchpadConfigure({ template, onComplete, onBack }: LaunchpadConfigureProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentStep, setCurrentStep] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const totalSteps = template.questions.length

  // Initialize first question
  useEffect(() => {
    if (template.questions.length > 0) {
      const q = template.questions[0]
      setMessages([
        {
          type: 'system',
          text: q.label,
          questionId: q.id,
          choices: q.choices,
          questionType: q.type
        }
      ])
    }
  }, [template])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const advanceOrComplete = useCallback(
    (newAnswers: Record<string, string>, nextStep: number) => {
      if (nextStep >= totalSteps) {
        onComplete(newAnswers)
        return
      }

      const q = template.questions[nextStep]
      setMessages((prev) => [
        ...prev,
        {
          type: 'system',
          text: q.label,
          questionId: q.id,
          choices: q.choices,
          questionType: q.type
        }
      ])
      setCurrentStep(nextStep)
      setInputValue('')
      inputRef.current?.focus()
    },
    [template, totalSteps, onComplete]
  )

  const handleChoiceClick = useCallback(
    (choice: string) => {
      const q = template.questions[currentStep]
      const newAnswers = { ...answers, [q.id]: choice }
      setAnswers(newAnswers)
      setMessages((prev) => [...prev, { type: 'user', text: choice }])
      advanceOrComplete(newAnswers, currentStep + 1)
    },
    [answers, currentStep, template, advanceOrComplete]
  )

  const handleTextSubmit = useCallback(() => {
    const text = inputValue.trim()
    if (!text) return

    const q = template.questions[currentStep]
    const newAnswers = { ...answers, [q.id]: text }
    setAnswers(newAnswers)
    setMessages((prev) => [...prev, { type: 'user', text }])
    advanceOrComplete(newAnswers, currentStep + 1)
  }, [inputValue, answers, currentStep, template, advanceOrComplete])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleTextSubmit()
      }
    },
    [handleTextSubmit]
  )

  const currentQuestion = template.questions[currentStep]
  const isTextQuestion = currentQuestion?.type === 'text'

  return (
    <div className="launchpad" data-testid="launchpad-configure">
      <div className="launchpad__chat">
        {/* Header */}
        <div className="launchpad__chat-header">
          <button type="button" className="launchpad__back" onClick={onBack} title="Back to grid">
            &#x2190;
          </button>
          <div className="launchpad__chat-badge">
            <span className="launchpad__chat-badge-icon">{template.icon}</span>
            <span className="launchpad__chat-badge-name">{template.name}</span>
          </div>
          <span className="launchpad__chat-step">
            Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}
          </span>
        </div>

        {/* Messages */}
        <div className="launchpad__chat-messages">
          {messages.map((msg, i) =>
            msg.type === 'system' ? (
              <div key={i} className="launchpad__msg launchpad__msg--system">
                <div className="launchpad__msg-label">Agent Setup</div>
                {msg.text}
                {msg.choices && msg.questionId === currentQuestion?.id && (
                  <div className="launchpad__choices">
                    {msg.choices.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="launchpad__choice"
                        onClick={() => handleChoiceClick(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className="launchpad__msg launchpad__msg--user">
                {msg.text}
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="launchpad__chat-input-bar">
          <input
            ref={inputRef}
            className="launchpad__chat-input"
            placeholder={isTextQuestion ? 'Type an answer...' : 'Type an answer or pick above...'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="launchpad__chat-send"
            onClick={handleTextSubmit}
            disabled={!inputValue.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx 2>&1 | tail -15`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/LaunchpadConfigure.tsx src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx
git commit -m "feat(launchpad): add LaunchpadConfigure chat-style question flow component"
```

---

### Task 4: Create LaunchpadReview Component + Tests

**Files:**

- Create: `src/renderer/src/components/agents/LaunchpadReview.tsx`
- Create: `src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchpadReview } from '../LaunchpadReview'
import type { PromptTemplate } from '../../../lib/launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-1',
  name: 'Clean Code',
  icon: '🧹',
  accent: 'cyan',
  description: 'Audit',
  questions: [{ id: 'scope', label: 'Scope', type: 'choice', choices: ['All'] }],
  promptTemplate: 'Audit {{scope}}',
  order: 0
}

describe('LaunchpadReview', () => {
  const onSpawn = vi.fn()
  const onBack = vi.fn()
  const onSaveTemplate = vi.fn()

  const defaultProps = {
    template: mockTemplate,
    assembledPrompt: 'Audit All files in the repo',
    answers: { scope: 'All' },
    repo: 'BDE',
    model: 'sonnet',
    onSpawn,
    onBack,
    onSaveTemplate,
    spawning: false
  }

  beforeEach(() => vi.clearAllMocks())

  it('renders the review badge with template name', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText(/Clean Code/)).toBeInTheDocument()
  })

  it('renders param cards for repo and model', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText('BDE')).toBeInTheDocument()
    expect(screen.getByText(/Sonnet/i)).toBeInTheDocument()
  })

  it('renders the assembled prompt', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText(/Audit All files/)).toBeInTheDocument()
  })

  it('calls onSpawn when Spawn button is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Spawn/i))
    expect(onSpawn).toHaveBeenCalledWith('Audit All files in the repo')
  })

  it('calls onBack when Back button is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Back/i))
    expect(onBack).toHaveBeenCalled()
  })

  it('toggles edit mode on Edit click', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onSaveTemplate when Save as Template is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Save as Template/i))
    expect(onSaveTemplate).toHaveBeenCalled()
  })

  it('disables spawn button when spawning', () => {
    render(<LaunchpadReview {...defaultProps} spawning={true} />)
    const btn = screen.getByText(/Spawning/i).closest('button')
    expect(btn).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx 2>&1 | tail -10`

Expected: FAIL

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/agents/LaunchpadReview.tsx`:

```tsx
import { useState, useCallback } from 'react'
import type { PromptTemplate } from '../../lib/launchpad-types'

interface LaunchpadReviewProps {
  template: PromptTemplate | null
  assembledPrompt: string
  answers: Record<string, string>
  repo: string
  model: string
  onSpawn: (finalPrompt: string) => void
  onBack: () => void
  onSaveTemplate: () => void
  spawning: boolean
}

export function LaunchpadReview({
  template,
  assembledPrompt,
  answers,
  repo,
  model,
  onSpawn,
  onBack,
  onSaveTemplate,
  spawning
}: LaunchpadReviewProps) {
  const [editing, setEditing] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(assembledPrompt)

  const handleSpawn = useCallback(() => {
    onSpawn(editing ? editedPrompt : assembledPrompt)
  }, [editing, editedPrompt, assembledPrompt, onSpawn])

  // Build param cards from answers + repo + model
  const paramCards: { label: string; value: string }[] = [
    { label: 'Repository', value: repo },
    { label: 'Model', value: model.charAt(0).toUpperCase() + model.slice(1) },
    ...Object.entries(answers).map(([key, value]) => ({
      label: key.charAt(0).toUpperCase() + key.slice(1),
      value
    }))
  ]

  return (
    <div className="launchpad" data-testid="launchpad-review">
      <div className="launchpad__review">
        {/* Header */}
        <div className="launchpad__review-header">
          <button type="button" className="launchpad__back" onClick={onBack} title="Back">
            &#x2190;
          </button>
          <div className="launchpad__review-badge">
            {template && <span>{template.icon}</span>}
            Review{template ? ` — ${template.name}` : ''}
          </div>
        </div>

        {/* Param Grid */}
        <div className="launchpad__param-grid">
          {paramCards.map((p) => (
            <div key={p.label} className="launchpad__param-card">
              <div className="launchpad__param-label">{p.label}</div>
              <div className="launchpad__param-value">{p.value}</div>
            </div>
          ))}
        </div>

        {/* Spec Block */}
        <div className="launchpad__spec-block">
          <button
            type="button"
            className="launchpad__spec-edit"
            onClick={() => {
              if (!editing) setEditedPrompt(assembledPrompt)
              setEditing(!editing)
            }}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          <div className="launchpad__spec-label">Generated Prompt</div>
          {editing ? (
            <textarea
              className="launchpad__spec-textarea"
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
            />
          ) : (
            <div className="launchpad__spec-content">{assembledPrompt}</div>
          )}
        </div>

        {/* Actions */}
        <div className="launchpad__review-actions">
          <button type="button" className="launchpad__btn-ghost" onClick={onBack}>
            &#x2190; Back
          </button>
          <button type="button" className="launchpad__btn-ghost" onClick={onSaveTemplate}>
            Save as Template
          </button>
          <button
            type="button"
            className="launchpad__btn-spawn"
            onClick={handleSpawn}
            disabled={spawning}
          >
            {spawning ? 'Spawning...' : '\u26A1 Spawn Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx 2>&1 | tail -15`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/LaunchpadReview.tsx src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx
git commit -m "feat(launchpad): add LaunchpadReview component with param grid, editable prompt, and spawn"
```

---

### Task 5: Create AgentLaunchpad Orchestrator + Tests

**Files:**

- Create: `src/renderer/src/components/agents/AgentLaunchpad.tsx`
- Create: `src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSpawnAgent = vi.fn().mockResolvedValue({ pid: 1, logPath: '/tmp/log', id: 'agent-1' })
const mockFetchProcesses = vi.fn()
const mockGetRepoPaths = vi.fn().mockResolvedValue({ bde: '/Users/test/projects/BDE' })
const mockLoadTemplates = vi.fn()
const mockTemplates = [
  {
    id: 'builtin-clean-code',
    name: 'Clean Code',
    icon: '🧹',
    accent: 'cyan',
    description: 'Audit',
    questions: [{ id: 'scope', label: 'Pick scope', type: 'choice', choices: ['All', 'Some'] }],
    promptTemplate: 'Audit {{scope}}',
    order: 0,
    builtIn: true
  }
]

vi.mock('../../../stores/localAgents', () => ({
  useLocalAgentsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      spawnAgent: mockSpawnAgent,
      fetchProcesses: mockFetchProcesses,
      isSpawning: false
    })
  )
}))

vi.mock('../../../stores/promptTemplates', () => ({
  usePromptTemplatesStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      templates: mockTemplates,
      loading: false,
      loadTemplates: mockLoadTemplates
    })
  )
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [{ label: 'BDE', owner: 'owner', color: '#fff' }]
}))

Object.defineProperty(window, 'api', {
  value: {
    ...(window as unknown as { api: Record<string, unknown> }).api,
    getRepoPaths: mockGetRepoPaths,
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn(),
      delete: vi.fn()
    }
  },
  writable: true,
  configurable: true
})

import { AgentLaunchpad } from '../AgentLaunchpad'

describe('AgentLaunchpad', () => {
  const onAgentSpawned = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders the grid phase by default', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
  })

  it('transitions to configure phase when a tile is clicked', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    fireEvent.click(screen.getByText('Clean Code'))
    expect(screen.getByTestId('launchpad-configure')).toBeInTheDocument()
  })

  it('transitions to review phase when configure completes', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    // Click tile to enter configure
    fireEvent.click(screen.getByText('Clean Code'))
    // Answer the question
    fireEvent.click(screen.getByText('All'))
    // Should be on review now
    expect(screen.getByTestId('launchpad-review')).toBeInTheDocument()
  })

  it('spawns agent from review and calls onAgentSpawned', async () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    fireEvent.click(screen.getByText('Clean Code'))
    fireEvent.click(screen.getByText('All'))

    // Now on review — click spawn
    fireEvent.click(screen.getByText(/Spawn/i))

    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.stringContaining('Audit All') })
      )
    })
  })

  it('returns to grid when back is clicked from configure', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    fireEvent.click(screen.getByText('Clean Code'))
    fireEvent.click(screen.getByTitle(/back/i))
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx 2>&1 | tail -10`

Expected: FAIL

- [ ] **Step 3: Create the orchestrator component**

Create `src/renderer/src/components/agents/AgentLaunchpad.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react'
import '../../assets/agent-launchpad-neon.css'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { usePromptTemplatesStore } from '../../stores/promptTemplates'
import { toast } from '../../stores/toasts'
import { assemblePrompt } from '../../lib/prompt-assembly'
import { migrateHistory } from '../../lib/prompt-assembly'
import type { PromptTemplate, RecentTask } from '../../lib/launchpad-types'
import { RECENT_TASKS_KEY, RECENT_TASKS_LIMIT } from '../../lib/launchpad-types'
import { LaunchpadGrid } from './LaunchpadGrid'
import { LaunchpadConfigure } from './LaunchpadConfigure'
import { LaunchpadReview } from './LaunchpadReview'

type Phase = 'grid' | 'configure' | 'review'

interface AgentLaunchpadProps {
  onAgentSpawned: () => void
}

export function AgentLaunchpad({ onAgentSpawned }: AgentLaunchpadProps) {
  const [phase, setPhase] = useState<Phase>('grid')
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [assembledPromptText, setAssembledPromptText] = useState('')
  const [repo, setRepo] = useState('BDE')
  const [model, setModel] = useState('sonnet')
  const [recents, setRecents] = useState<RecentTask[]>([])
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})

  const templates = usePromptTemplatesStore((s) => s.templates)
  const loadTemplates = usePromptTemplatesStore((s) => s.loadTemplates)
  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const spawning = useLocalAgentsStore((s) => s.isSpawning)

  // Load templates and recents on mount
  useEffect(() => {
    loadTemplates()
    window.api
      .getRepoPaths()
      .then(setRepoPaths)
      .catch(() => {})

    try {
      const stored = localStorage.getItem(RECENT_TASKS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setRecents(migrateHistory(parsed))
      }
    } catch {
      /* ignore */
    }
  }, [loadTemplates])

  const visibleTemplates = templates.filter((t) => !t.hidden)

  const saveRecent = useCallback(
    (prompt: string) => {
      const entry: RecentTask = { prompt, repo, model, timestamp: Date.now() }
      const updated = [entry, ...recents.filter((r) => r.prompt !== prompt)].slice(
        0,
        RECENT_TASKS_LIMIT
      )
      setRecents(updated)
      localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(updated))
    },
    [recents, repo, model]
  )

  // ── Phase transitions ──

  const handleSelectTemplate = useCallback((template: PromptTemplate) => {
    setSelectedTemplate(template)
    setAnswers({})
    if (template.questions.length === 0) {
      // No questions — go straight to review
      setAssembledPromptText(assemblePrompt(template, {}))
      setPhase('review')
    } else {
      setPhase('configure')
    }
  }, [])

  const handleCustomPrompt = useCallback((prompt: string, repoName: string, modelId: string) => {
    setSelectedTemplate(null)
    setAnswers({})
    setAssembledPromptText(prompt)
    setRepo(repoName)
    setModel(modelId)
    setPhase('review')
  }, [])

  const handleSelectRecent = useCallback((recent: RecentTask) => {
    setSelectedTemplate(null)
    setAnswers({})
    setAssembledPromptText(recent.prompt)
    if (recent.repo) setRepo(recent.repo)
    if (recent.model) setModel(recent.model)
    setPhase('review')
  }, [])

  const handleConfigureComplete = useCallback(
    (configAnswers: Record<string, string>) => {
      setAnswers(configAnswers)
      if (selectedTemplate) {
        setAssembledPromptText(assemblePrompt(selectedTemplate, configAnswers))
      }
      setPhase('review')
    },
    [selectedTemplate]
  )

  const handleSpawn = useCallback(
    async (finalPrompt: string) => {
      const repoPath = repoPaths[repo.toLowerCase()]
      if (!repoPath) {
        toast.error(`Repo path not found for "${repo}"`)
        return
      }
      try {
        await spawnAgent({ task: finalPrompt, repoPath, model })
        saveRecent(finalPrompt)
        fetchProcesses()
        toast.success('Agent spawned')
        onAgentSpawned()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`Spawn failed: ${message}`)
      }
    },
    [repo, model, repoPaths, spawnAgent, fetchProcesses, saveRecent, onAgentSpawned]
  )

  const handleSaveTemplate = useCallback(() => {
    toast.info('Template saving coming soon')
  }, [])

  const handleBack = useCallback(() => {
    if (phase === 'review' && selectedTemplate && selectedTemplate.questions.length > 0) {
      setPhase('configure')
    } else {
      setPhase('grid')
      setSelectedTemplate(null)
      setAnswers({})
    }
  }, [phase, selectedTemplate])

  // ── Render ──

  switch (phase) {
    case 'grid':
      return (
        <LaunchpadGrid
          templates={visibleTemplates}
          recents={recents}
          onSelectTemplate={handleSelectTemplate}
          onCustomPrompt={handleCustomPrompt}
          onSelectRecent={handleSelectRecent}
        />
      )
    case 'configure':
      return selectedTemplate ? (
        <LaunchpadConfigure
          template={selectedTemplate}
          onComplete={handleConfigureComplete}
          onBack={handleBack}
        />
      ) : null
    case 'review':
      return (
        <LaunchpadReview
          template={selectedTemplate}
          assembledPrompt={assembledPromptText}
          answers={answers}
          repo={repo}
          model={model}
          onSpawn={handleSpawn}
          onBack={handleBack}
          onSaveTemplate={handleSaveTemplate}
          spawning={spawning}
        />
      )
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx 2>&1 | tail -15`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/AgentLaunchpad.tsx src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx
git commit -m "feat(launchpad): add AgentLaunchpad orchestrator with phase management"
```

---

### Task 6: Integrate into AgentsView + Delete SpawnModal

**Files:**

- Modify: `src/renderer/src/views/AgentsView.tsx`
- Delete: `src/renderer/src/components/agents/SpawnModal.tsx`
- Delete: `src/renderer/src/components/agents/__tests__/SpawnModal.test.tsx`

- [ ] **Step 1: Modify AgentsView.tsx**

Open `src/renderer/src/views/AgentsView.tsx` and make these exact changes:

1. **Remove import** — Delete the line: `import { SpawnModal } from '../components/agents/SpawnModal'`

2. **Add import** — Add: `import { AgentLaunchpad } from '../components/agents/AgentLaunchpad'`

3. **Replace `spawnOpen` state** — Change `const [spawnOpen, setSpawnOpen] = useState(false)` to `const [showLaunchpad, setShowLaunchpad] = useState(false)`

4. **Update the event listener** — Change the `bde:open-spawn-modal` handler from `setSpawnOpen(true)` to:

   ```tsx
   const handler = (): void => {
     setSelectedId(null)
     setShowLaunchpad(true)
   }
   ```

5. **Update the + button** — Change `onClick={() => setSpawnOpen(true)}` to:

   ```tsx
   onClick={() => {
     setSelectedId(null)
     setShowLaunchpad(true)
   }}
   ```

6. **Replace the console area** — Replace the section that renders `AgentConsole` or the empty state (lines 175-197 approximately) with:

   ```tsx
   <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
     {showLaunchpad || (!selectedAgent && agents.length === 0) ? (
       <AgentLaunchpad
         onAgentSpawned={() => {
           setShowLaunchpad(false)
           fetchAgents()
         }}
       />
     ) : selectedAgent ? (
       <AgentConsole agentId={selectedAgent.id} onSteer={handleSteer} onCommand={handleCommand} />
     ) : (
       <div
         style={{
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'center',
           height: '100%',
           color: 'rgba(255, 255, 255, 0.2)',
           fontSize: tokens.size.md,
           fontFamily: 'var(--bde-font-code)'
         }}
       >
         {'> Select an agent to view console.'}
       </div>
     )}
   </div>
   ```

7. **Delete the SpawnModal render** — Remove: `<SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />`

8. **Update handleSelectAgent** — When an agent is selected, hide the launchpad:

   ```tsx
   const handleSelectAgent = useCallback((id: string) => {
     setSelectedId(id)
     setShowLaunchpad(false)
   }, [])
   ```

9. **Update AgentList onSelect** — Change `onSelect={setSelectedId}` (around line 170) to `onSelect={handleSelectAgent}` so that selecting from the fleet sidebar also dismisses the launchpad.

- [ ] **Step 2: Delete SpawnModal files**

Run:

```bash
rm src/renderer/src/components/agents/SpawnModal.tsx
rm src/renderer/src/components/agents/__tests__/SpawnModal.test.tsx
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors. If there are errors about SpawnModal imports elsewhere, grep for them: `grep -rn 'SpawnModal' src/` and remove any remaining references.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/ 2>&1 | tail -20`

Expected: All tests pass. SpawnModal tests are gone, new launchpad tests pass.

- [ ] **Step 5: Commit**

```bash
git add -u
git add src/renderer/src/views/AgentsView.tsx
git commit -m "feat(launchpad): integrate AgentLaunchpad into AgentsView, remove SpawnModal"
```

---

### Task 7: Full UI Layer Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all new launchpad tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/LaunchpadGrid.test.tsx src/renderer/src/components/agents/__tests__/LaunchpadConfigure.test.tsx src/renderer/src/components/agents/__tests__/LaunchpadReview.test.tsx src/renderer/src/components/agents/__tests__/AgentLaunchpad.test.tsx 2>&1 | tail -15`

Expected: 4 test files, 29 tests, all PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Verify SpawnModal is fully removed**

Run: `grep -rn 'SpawnModal' src/ 2>&1`

Expected: No matches (or only in unrelated comment/doc references).

- [ ] **Step 4: Run full project test suite with coverage**

Run: `npm run test:coverage 2>&1 | tail -15`

Expected: All tests pass. Coverage thresholds met.

- [ ] **Step 5: Verify CSS file is imported**

Run: `grep -n 'agent-launchpad-neon' src/renderer/src/components/agents/AgentLaunchpad.tsx`

Expected: Shows the import line.

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix(launchpad): UI layer test and integration fixes"
```
