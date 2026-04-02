# Agents View UX — Phases 2-4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 20 remaining UX audit findings for the BDE Agents view — improving console quality, layout polish, and efficiency/memory management.

**Architecture:** Nearly all changes are renderer-only. Console search adds a filter bar to AgentConsole. Tool summaries replace raw JSON with human-readable descriptions. Sidebar cards get status icons. Events store gains LRU eviction. Layout improvements use CSS-only changes where possible. **Exception:** History pagination (#25) may require adding `offset` param to the `agents:list` IPC handler in the main process — if not feasible, fall back to client-side pagination over the fetched list.

**Tech Stack:** React, TypeScript, CSS (agents-neon.css), Zustand, @tanstack/react-virtual, lucide-react, Vitest + React Testing Library

**Prior art:**
- Phase 1 (PR #592): Critical + high fixes already merged
- Dashboard UX: PRs #584-591 (all merged, all 32 findings resolved)
- Audit source: `docs/superpowers/audits/team-3-agents-terminal.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/renderer/src/components/agents/ConsoleSearchBar.tsx` | Search/filter bar for console events with match highlighting |
| `src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx` | Tests for ConsoleSearchBar |
| `src/renderer/src/lib/tool-summaries.ts` | Human-readable tool summary formatter |
| `src/renderer/src/lib/__tests__/tool-summaries.test.ts` | Tests for tool-summaries |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/components/agents/AgentConsole.tsx` | Add search bar, event cap banner, empty state variants |
| `src/renderer/src/components/agents/ConsoleLine.tsx` | Tool summaries, "show full" toggle for 300px cap |
| `src/renderer/src/components/agents/CommandBar.tsx` | Disabled state styling, steering echo |
| `src/renderer/src/components/agents/AgentCard.tsx` | Status icons (CheckCircle/XCircle/Loader), done/cancelled labels |
| `src/renderer/src/components/agents/AgentList.tsx` | Scroll-into-view on selection, resizable sidebar prep |
| `src/renderer/src/components/agents/LiveActivityStrip.tsx` | Pill accents reflect status not index |
| `src/renderer/src/components/agents/ConsoleHeader.tsx` | Running cost estimate |
| `src/renderer/src/stores/agentEvents.ts` | LRU eviction, cap notification flag, history pagination |
| `src/renderer/src/stores/agentHistory.ts` | Pagination support (offset/limit) |
| `src/renderer/src/views/AgentsView.tsx` | Collapsible Zone 3, min-width, repo selector dropdown, /retry feedback |
| `src/renderer/src/assets/agents-neon.css` | All new CSS classes |
| `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx` | Updated tests |
| `src/renderer/src/components/agents/__tests__/AgentCard.test.tsx` | Updated tests |
| `src/renderer/src/views/__tests__/AgentsView.test.tsx` | Updated tests |

---

## Phase 2: Console Quality

### Task 1: Command Bar Disabled State + /retry Feedback

**Findings:** #21 (command bar disabled state) + #8 (/retry silent fail feedback)

When an agent isn't running, the command bar prompt `>` stays styled as if active — confusing. Also, `/retry` on adhoc agents silently does nothing because they have no `sprintTaskId`.

**Files:**
- Modify: `src/renderer/src/components/agents/CommandBar.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Modify: `src/renderer/src/views/AgentsView.tsx` (handleCommand for /retry)
- Test: `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx`

- [ ] **Step 1: Write failing test for disabled command bar visual state**

In `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx`, add:

```tsx
it('applies disabled class to command bar when agent is not running', () => {
  // Set up agent with status 'done'
  useAgentHistoryStore.setState({
    agents: [{ ...mockAgent, status: 'done' }]
  })
  render(<AgentConsole agentId="test-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
  const bar = document.querySelector('.command-bar')
  expect(bar).toHaveClass('command-bar--disabled')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: FAIL — `.command-bar--disabled` class not present

- [ ] **Step 3: Add disabled class to CommandBar**

In `CommandBar.tsx`, add a `className` that includes `--disabled` when the `disabled` prop is true:

```tsx
<div className={`command-bar${disabled ? ' command-bar--disabled' : ''}`} style={{ position: 'relative' }}>
```

- [ ] **Step 4: Add CSS for disabled state**

In `agents-neon.css`, after the existing `.command-bar` rules:

```css
.command-bar--disabled {
  opacity: 0.5;
}

.command-bar--disabled .command-bar__prompt {
  color: var(--neon-text-dim);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Add /retry feedback for adhoc agents**

In `AgentsView.tsx`, update the `/retry` handler to show feedback when the agent has no `sprintTaskId`:

```tsx
case '/retry':
  if (selectedAgent.sprintTaskId) {
    try {
      await window.api.sprint.update(selectedAgent.sprintTaskId, { status: 'queued' })
      toast.success('Task re-queued')
    } catch (err) {
      toast.error(`Retry failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  } else {
    toast.warning('Adhoc agents cannot be retried — spawn a new agent instead')
  }
  break
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/agents/CommandBar.tsx src/renderer/src/views/AgentsView.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx
git commit -m "fix: command bar disabled state + /retry adhoc feedback (#21, #8)"
```

---

### Task 2: Empty State Context (Loading vs Empty vs Failed)

**Finding:** #23 — Console shows generic "No events available" for all empty states. Users can't tell if events are loading, the agent has no events yet, or fetching failed.

**Files:**
- Modify: `src/renderer/src/components/agents/AgentConsole.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx`

- [ ] **Step 1: Write failing tests for empty state variants**

```tsx
it('shows loading state when events are empty and agent is running', () => {
  useAgentHistoryStore.setState({
    agents: [{ ...mockAgent, status: 'running' }]
  })
  useAgentEventsStore.setState({ events: {} })
  render(<AgentConsole agentId="test-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
  expect(screen.getByText(/waiting for agent output/i)).toBeInTheDocument()
})

it('shows empty state when agent is done with no events', () => {
  useAgentHistoryStore.setState({
    agents: [{ ...mockAgent, status: 'done' }]
  })
  useAgentEventsStore.setState({ events: {} })
  render(<AgentConsole agentId="test-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
  expect(screen.getByText(/no events recorded/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: FAIL — both show "No events available"

- [ ] **Step 3: Implement contextual empty states in AgentConsole**

In `AgentConsole.tsx`, replace the generic empty state block (the `blocks.length === 0` branch around line 109):

```tsx
{blocks.length === 0 && (
  <div className="console-empty-state">
    {agent.status === 'running' ? (
      <>
        <Loader size={16} className="console-empty-state__spinner" />
        <span>Waiting for agent output…</span>
      </>
    ) : (
      <span>No events recorded for this agent</span>
    )}
  </div>
)}
```

Add `Loader` to the lucide-react import.

- [ ] **Step 4: Add CSS for empty state**

```css
.console-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--neon-text-dim);
  font-size: 13px;
  font-family: var(--bde-font-code);
}

.console-empty-state__spinner {
  animation: spin 1.5s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/AgentConsole.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx
git commit -m "fix: contextual empty states in agent console (#23)"
```

---

### Task 3: Event Cap Notification

**Finding:** #5 — When an agent generates 2000+ events, oldest events are silently evicted. Users don't know they're missing early output.

**Files:**
- Modify: `src/renderer/src/stores/agentEvents.ts`
- Modify: `src/renderer/src/components/agents/AgentConsole.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx`

- [ ] **Step 1: Write failing test for cap notification**

```tsx
it('shows event cap banner when events were evicted', () => {
  useAgentHistoryStore.setState({
    agents: [{ ...mockAgent, status: 'running' }]
  })
  // Set evicted flag
  useAgentEventsStore.setState({
    events: { 'test-1': Array(100).fill(mockTextEvent) },
    evictedAgents: { 'test-1': true }
  })
  render(<AgentConsole agentId="test-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
  expect(screen.getByText(/older events were trimmed/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: FAIL — no `evictedAgents` in store

- [ ] **Step 3: Add eviction tracking to agentEvents store**

In `src/renderer/src/stores/agentEvents.ts`, add `evictedAgents` to the state:

```ts
interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  evictedAgents: Record<string, boolean>
  init: () => () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}

export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},
  evictedAgents: {},

  init() {
    return window.api.agentEvents.onEvent(({ agentId, event }) => {
      set((state) => {
        const existing = state.events[agentId] ?? []
        const updated = [...existing, event]
        const evicted = updated.length > MAX_EVENTS_PER_AGENT
        return {
          events: {
            ...state.events,
            [agentId]: evicted
              ? updated.slice(-MAX_EVENTS_PER_AGENT)
              : updated
          },
          evictedAgents: evicted
            ? { ...state.evictedAgents, [agentId]: true }
            : state.evictedAgents
        }
      })
    })
  },

  async loadHistory(agentId: string) {
    const history = await window.api.agentEvents.getHistory(agentId)
    const evicted = history.length > MAX_EVENTS_PER_AGENT
    set((state) => ({
      events: {
        ...state.events,
        [agentId]: evicted ? history.slice(-MAX_EVENTS_PER_AGENT) : history
      },
      evictedAgents: evicted
        ? { ...state.evictedAgents, [agentId]: true }
        : state.evictedAgents
    }))
  },

  clear(agentId: string) {
    set((state) => {
      const nextEvents = { ...state.events }
      const nextEvicted = { ...state.evictedAgents }
      delete nextEvents[agentId]
      delete nextEvicted[agentId]
      return { events: nextEvents, evictedAgents: nextEvicted }
    })
  }
}))
```

- [ ] **Step 4: Add cap banner to AgentConsole**

In `AgentConsole.tsx`, read the eviction flag and render a banner above the console body:

```tsx
const evicted = useAgentEventsStore((s) => s.evictedAgents[agentId] ?? false)

// In the JSX, before the console-body div:
{evicted && (
  <div className="console-cap-banner">
    Older events were trimmed (showing last 2,000)
  </div>
)}
```

- [ ] **Step 5: Add CSS for cap banner**

```css
.console-cap-banner {
  padding: 4px 12px;
  background: var(--neon-orange-surface);
  border-bottom: 1px solid var(--neon-orange-border);
  color: var(--neon-orange);
  font-size: 11px;
  font-family: var(--bde-font-code);
  text-align: center;
  flex-shrink: 0;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/agentEvents.ts src/renderer/src/components/agents/AgentConsole.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx
git commit -m "feat: event cap notification banner when events evicted (#5)"
```

---

### Task 4: Status Icons in Sidebar Cards + Done/Cancelled Labels

**Findings:** #12 (success/fail icons instead of 6px dots) + #18 (done/cancelled status labels)

Currently AgentCard shows a tiny 6px dot that's hard to distinguish. Replace with Lucide icons and add a text label for terminal statuses.

**Files:**
- Modify: `src/renderer/src/components/agents/AgentCard.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/components/agents/__tests__/AgentCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('renders CheckCircle icon for done agents', () => {
  render(<AgentCard agent={{ ...mockAgent, status: 'done' }} selected={false} onClick={vi.fn()} />)
  expect(document.querySelector('[aria-label="Done"]')).toBeInTheDocument()
})

it('renders XCircle icon for failed agents', () => {
  render(<AgentCard agent={{ ...mockAgent, status: 'failed' }} selected={false} onClick={vi.fn()} />)
  expect(document.querySelector('[aria-label="Failed"]')).toBeInTheDocument()
})

it('shows status label for done agents', () => {
  render(<AgentCard agent={{ ...mockAgent, status: 'done' }} selected={false} onClick={vi.fn()} />)
  expect(screen.getByText('Done')).toBeInTheDocument()
})

it('shows status label for cancelled agents', () => {
  render(<AgentCard agent={{ ...mockAgent, status: 'cancelled' }} selected={false} onClick={vi.fn()} />)
  expect(screen.getByText('Cancelled')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentCard.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Replace status dot with icons in AgentCard**

In `AgentCard.tsx`, add imports and replace the status dot `<span>`:

```tsx
import { Bot, Cpu, Clock, X, CheckCircle, XCircle, Loader, Ban } from 'lucide-react'

// Replace the 6px status dot span with:
function StatusIndicator({ status, accent }: { status: string; accent: NeonAccent }) {
  const color = `var(--neon-${accent})`
  const size = 14
  switch (status) {
    case 'running':
      return <Loader size={size} color={color} className="agent-card__status-spinner" aria-label="Running" />
    case 'done':
      return <CheckCircle size={size} color={color} aria-label="Done" />
    case 'failed':
      return <XCircle size={size} color={color} aria-label="Failed" />
    case 'cancelled':
      return <Ban size={size} color={color} aria-label="Cancelled" />
    default:
      return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
  }
}
```

Use it in the card JSX replacing the `<span>` dot:

```tsx
<StatusIndicator status={agent.status} accent={accent} />
```

Add a status label in the bottom row for terminal statuses:

```tsx
{/* Bottom row: meta info */}
<div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], paddingLeft: 14 }}>
  <SourceIcon size={10} color={tokens.color.textDim} />
  <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>{agent.model}</span>
  <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
  <Clock size={10} color={neonVar(accent, 'color')} />
  <span style={{ fontSize: tokens.size.xs, color: neonVar(accent, 'color') }}>
    {formatDuration(agent.startedAt, agent.finishedAt)}
  </span>
  {(agent.status === 'done' || agent.status === 'cancelled' || agent.status === 'failed') && (
    <>
      <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
      <span style={{ fontSize: tokens.size.xs, color: neonVar(accent, 'color'), fontWeight: 600 }}>
        {agent.status === 'done' ? 'Done' : agent.status === 'cancelled' ? 'Cancelled' : 'Failed'}
      </span>
    </>
  )}
</div>
```

- [ ] **Step 4: Add CSS for spinning loader**

```css
.agent-card__status-spinner {
  animation: spin 1.5s linear infinite;
  flex-shrink: 0;
}
```

(Reuse the `@keyframes spin` from Task 2, or add it here if Task 2 hasn't been completed yet.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentCard.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/AgentCard.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentCard.test.tsx
git commit -m "feat: status icons and labels in agent sidebar cards (#12, #18)"
```

---

### Task 5: Steering Message Visual Echo

**Finding:** #11 — When a user sends a steering message via the command bar, there's no immediate visual confirmation in the console. The user_message event only appears after the backend echoes it, which can feel laggy.

**Files:**
- Modify: `src/renderer/src/components/agents/CommandBar.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('shows optimistic user message after sending', () => {
  useAgentHistoryStore.setState({
    agents: [{ ...mockAgent, status: 'running' }]
  })
  const onSteer = vi.fn()
  render(<AgentConsole agentId="test-1" onSteer={onSteer} onCommand={vi.fn()} />)

  const input = screen.getByLabelText('Agent command input')
  fireEvent.change(input, { target: { value: 'hello agent' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  // The sent message should show as pending
  expect(screen.getByText('hello agent')).toBeInTheDocument()
  expect(document.querySelector('.console-line--pending')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add pending message state to AgentConsole**

In `AgentConsole.tsx`, add state for optimistic messages and inject them into the blocks array:

```tsx
const [pendingMessages, setPendingMessages] = useState<string[]>([])

const handleSteer = useCallback((message: string) => {
  setPendingMessages((prev) => [...prev, message])
  onSteer(message)
}, [onSteer])

// Clear pending when a real user_message arrives
useEffect(() => {
  if (events.length > 0 && pendingMessages.length > 0) {
    const lastEvent = events[events.length - 1]
    if (lastEvent.type === 'agent:user_message') {
      setPendingMessages((prev) => prev.slice(1))
    }
  }
}, [events, pendingMessages.length])

// Append pending messages to blocks
const allBlocks = useMemo(() => {
  if (pendingMessages.length === 0) return blocks
  const pending: ChatBlock[] = pendingMessages.map((text) => ({
    type: 'user_message' as const,
    text,
    timestamp: Date.now(),
    _pending: true
  }))
  return [...blocks, ...pending]
}, [blocks, pendingMessages])
```

**Note:** The `_pending` flag is a render-time marker. Add it to the ChatBlock type if needed, or use a wrapper. The simpler approach: just track pending count and add a CSS class to the last N user_message ConsoleLine items.

Alternative simpler approach — add the pending class inside ConsoleLine:

Pass `pending?: boolean` as a prop to `ConsoleLine`. In `AgentConsole`, for the last `pendingMessages.length` items that are user_messages, pass `pending={true}`.

For simplicity, just add a `console-line--pending` class for visual echo:

```css
.console-line--pending {
  opacity: 0.6;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/AgentConsole.tsx src/renderer/src/components/agents/ConsoleLine.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx
git commit -m "feat: optimistic steering message echo in console (#11)"
```

---

### Task 6: Console Search/Filter

**Finding:** #9 — This is the biggest Phase 2 feature. For long agent sessions (500+ events), users need to search console output. Add a search bar with text matching and match highlighting.

**Files:**
- Create: `src/renderer/src/components/agents/ConsoleSearchBar.tsx`
- Create: `src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx`
- Modify: `src/renderer/src/components/agents/AgentConsole.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`

- [ ] **Step 1: Write failing tests for ConsoleSearchBar**

Create `src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ConsoleSearchBar } from '../ConsoleSearchBar'

describe('ConsoleSearchBar', () => {
  it('renders search input', () => {
    render(<ConsoleSearchBar onSearch={vi.fn()} onClose={vi.fn()} matchCount={0} activeMatch={0} onNext={vi.fn()} onPrev={vi.fn()} />)
    expect(screen.getByPlaceholderText('Search console…')).toBeInTheDocument()
  })

  it('calls onSearch when typing', () => {
    const onSearch = vi.fn()
    render(<ConsoleSearchBar onSearch={onSearch} onClose={vi.fn()} matchCount={0} activeMatch={0} onNext={vi.fn()} onPrev={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search console…'), { target: { value: 'error' } })
    expect(onSearch).toHaveBeenCalledWith('error')
  })

  it('shows match count', () => {
    render(<ConsoleSearchBar onSearch={vi.fn()} onClose={vi.fn()} matchCount={5} activeMatch={2} onNext={vi.fn()} onPrev={vi.fn()} />)
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(<ConsoleSearchBar onSearch={vi.fn()} onClose={onClose} matchCount={0} activeMatch={0} onNext={vi.fn()} onPrev={vi.fn()} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Search console…'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx --reporter=verbose`
Expected: FAIL — file not found

- [ ] **Step 3: Implement ConsoleSearchBar**

Create `src/renderer/src/components/agents/ConsoleSearchBar.tsx`:

```tsx
import { useRef, useEffect } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'

interface ConsoleSearchBarProps {
  onSearch: (query: string) => void
  onClose: () => void
  matchCount: number
  activeMatch: number
  onNext: () => void
  onPrev: () => void
}

export function ConsoleSearchBar({
  onSearch,
  onClose,
  matchCount,
  activeMatch,
  onNext,
  onPrev
}: ConsoleSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      e.shiftKey ? onPrev() : onNext()
    }
  }

  return (
    <div className="console-search-bar">
      <Search size={12} className="console-search-bar__icon" />
      <input
        ref={inputRef}
        type="text"
        className="console-search-bar__input"
        placeholder="Search console…"
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search console"
      />
      {matchCount > 0 && (
        <span className="console-search-bar__count">
          {activeMatch + 1} of {matchCount}
        </span>
      )}
      <button className="console-search-bar__btn" onClick={onPrev} aria-label="Previous match" disabled={matchCount === 0}>
        <ChevronUp size={14} />
      </button>
      <button className="console-search-bar__btn" onClick={onNext} aria-label="Next match" disabled={matchCount === 0}>
        <ChevronDown size={14} />
      </button>
      <button className="console-search-bar__btn" onClick={onClose} aria-label="Close search">
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add CSS for search bar**

In `agents-neon.css`:

```css
/* ── Console Search Bar ── */
.console-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: var(--neon-surface-dim);
  border-bottom: 1px solid var(--neon-purple-border);
  flex-shrink: 0;
}

.console-search-bar__icon {
  color: var(--neon-text-dim);
  flex-shrink: 0;
}

.console-search-bar__input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--neon-text);
  font-family: var(--bde-font-code);
  font-size: 12px;
  outline: none;
}

.console-search-bar__input::placeholder {
  color: var(--neon-text-dim);
}

.console-search-bar__count {
  font-size: 10px;
  color: var(--neon-text-dim);
  font-family: var(--bde-font-code);
  flex-shrink: 0;
}

.console-search-bar__btn {
  background: transparent;
  border: none;
  color: var(--neon-text-dim);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.console-search-bar__btn:hover:not(:disabled) {
  color: var(--neon-text);
  background: var(--neon-surface-subtle);
}

.console-search-bar__btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* Highlight matching lines */
.console-line--search-match {
  background: var(--neon-orange-surface);
}

.console-line--search-active {
  background: var(--neon-orange-surface);
  border-left: 3px solid var(--neon-orange);
  padding-left: 9px;
}
```

- [ ] **Step 6: Integrate search into AgentConsole**

In `AgentConsole.tsx`, add search state and wire up ConsoleSearchBar:

```tsx
import { ConsoleSearchBar } from './ConsoleSearchBar'

// Inside AgentConsole component:
const [searchOpen, setSearchOpen] = useState(false)
const [searchQuery, setSearchQuery] = useState('')
const [activeMatchIndex, setActiveMatchIndex] = useState(0)

// Compute matches: indices of blocks that contain the search text
const searchMatches = useMemo(() => {
  if (!searchQuery) return []
  const lower = searchQuery.toLowerCase()
  const matches: number[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const text = 'text' in b ? b.text : 'message' in b ? b.message : 'summary' in b ? b.summary : ''
    if (text && text.toLowerCase().includes(lower)) {
      matches.push(i)
    }
  }
  return matches
}, [blocks, searchQuery])

// Keyboard shortcut: Cmd+F to open search
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])

const handleSearchNext = () => {
  if (searchMatches.length === 0) return
  const next = (activeMatchIndex + 1) % searchMatches.length
  setActiveMatchIndex(next)
  virtualizer.scrollToIndex(searchMatches[next], { align: 'center' })
}

const handleSearchPrev = () => {
  if (searchMatches.length === 0) return
  const prev = (activeMatchIndex - 1 + searchMatches.length) % searchMatches.length
  setActiveMatchIndex(prev)
  virtualizer.scrollToIndex(searchMatches[prev], { align: 'center' })
}

const handleSearchClose = () => {
  setSearchOpen(false)
  setSearchQuery('')
  setActiveMatchIndex(0)
}
```

In the JSX, add the search bar below the ConsoleHeader and pass match CSS classes to ConsoleLine:

```tsx
{searchOpen && (
  <ConsoleSearchBar
    onSearch={(q) => { setSearchQuery(q); setActiveMatchIndex(0) }}
    onClose={handleSearchClose}
    matchCount={searchMatches.length}
    activeMatch={activeMatchIndex}
    onNext={handleSearchNext}
    onPrev={handleSearchPrev}
  />
)}
```

For ConsoleLine, add an optional `searchHighlight` prop:

```tsx
<ConsoleLine
  block={blocks[virtualRow.index]}
  onPlaygroundClick={setPlaygroundBlock}
  searchHighlight={
    searchMatches.includes(virtualRow.index)
      ? (virtualRow.index === searchMatches[activeMatchIndex] ? 'active' : 'match')
      : undefined
  }
/>
```

In `ConsoleLine.tsx`, accept and apply the prop:

```tsx
interface ConsoleLineProps {
  block: ChatBlock
  onPlaygroundClick?: (block: { filename: string; html: string; sizeBytes: number }) => void
  searchHighlight?: 'match' | 'active'
}

// At the top of the component, compute the className modifier:
const highlightClass = searchHighlight === 'active'
  ? ' console-line--search-active'
  : searchHighlight === 'match'
    ? ' console-line--search-match'
    : ''

// Apply to each returned div by appending highlightClass to className
```

- [ ] **Step 7: Write integration test for search in console**

```tsx
it('opens search with Cmd+F and highlights matches', async () => {
  // Setup with text events containing searchable content
  useAgentHistoryStore.setState({ agents: [{ ...mockAgent, status: 'done' }] })
  useAgentEventsStore.setState({
    events: { 'test-1': [
      { type: 'agent:text', text: 'Found error in file', timestamp: 1 },
      { type: 'agent:text', text: 'Fixed the bug', timestamp: 2 },
      { type: 'agent:text', text: 'Another error here', timestamp: 3 }
    ]}
  })
  render(<AgentConsole agentId="test-1" onSteer={vi.fn()} onCommand={vi.fn()} />)

  // Trigger Cmd+F
  fireEvent.keyDown(window, { key: 'f', metaKey: true })
  expect(screen.getByPlaceholderText('Search console…')).toBeInTheDocument()
})
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/agents/ConsoleSearchBar.tsx src/renderer/src/components/agents/__tests__/ConsoleSearchBar.test.tsx src/renderer/src/components/agents/AgentConsole.tsx src/renderer/src/components/agents/ConsoleLine.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx
git commit -m "feat: console search/filter with Cmd+F and match navigation (#9)"
```

---

### Task 7: Tool-Specific Summaries

**Finding:** #22 — Tool calls show raw JSON when expanded. Replace with human-readable summaries that surface the most useful information (file paths, commands, patterns).

**Files:**
- Create: `src/renderer/src/lib/tool-summaries.ts`
- Create: `src/renderer/src/lib/__tests__/tool-summaries.test.ts`
- Modify: `src/renderer/src/components/agents/ConsoleLine.tsx`

- [ ] **Step 1: Write failing tests for tool summaries**

Create `src/renderer/src/lib/__tests__/tool-summaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatToolSummary } from '../tool-summaries'

describe('formatToolSummary', () => {
  it('summarizes Bash tool with command', () => {
    expect(formatToolSummary('Bash', { command: 'npm test' })).toBe('npm test')
  })

  it('truncates long Bash commands', () => {
    const long = 'a'.repeat(200)
    const result = formatToolSummary('Bash', { command: long })
    expect(result.length).toBeLessThanOrEqual(103) // 100 + '…'
  })

  it('summarizes Read tool with file path', () => {
    expect(formatToolSummary('Read', { file_path: '/src/main/index.ts' })).toBe('/src/main/index.ts')
  })

  it('summarizes Read with offset/limit', () => {
    expect(formatToolSummary('Read', { file_path: '/src/main/index.ts', offset: 10, limit: 50 }))
      .toBe('/src/main/index.ts:10-60')
  })

  it('summarizes Edit tool', () => {
    expect(formatToolSummary('Edit', { file_path: '/src/app.tsx', old_string: 'foo', new_string: 'bar' }))
      .toBe('/src/app.tsx — replace "foo" → "bar"')
  })

  it('truncates long edit strings', () => {
    const result = formatToolSummary('Edit', { file_path: '/f.ts', old_string: 'a'.repeat(100), new_string: 'b'.repeat(100) })
    expect(result).toContain('…')
  })

  it('summarizes Write tool', () => {
    expect(formatToolSummary('Write', { file_path: '/new-file.ts', content: 'x'.repeat(500) }))
      .toBe('/new-file.ts (500 chars)')
  })

  it('summarizes Grep tool', () => {
    expect(formatToolSummary('Grep', { pattern: 'TODO', path: '/src' })).toBe('pattern "TODO" in /src')
  })

  it('summarizes Glob tool', () => {
    expect(formatToolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('summarizes Agent tool', () => {
    expect(formatToolSummary('Agent', { prompt: 'Find all test files' })).toBe('Find all test files')
  })

  it('returns null for unknown tools', () => {
    expect(formatToolSummary('UnknownTool', { foo: 'bar' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/__tests__/tool-summaries.test.ts --reporter=verbose`
Expected: FAIL — file not found

- [ ] **Step 3: Implement tool-summaries.ts**

Create `src/renderer/src/lib/tool-summaries.ts`:

```ts
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function formatToolSummary(tool: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const inp = input as Record<string, unknown>

  switch (tool) {
    case 'Bash': {
      const cmd = inp.command
      return typeof cmd === 'string' ? truncate(cmd, 100) : null
    }
    case 'Read': {
      const fp = inp.file_path
      if (typeof fp !== 'string') return null
      const offset = typeof inp.offset === 'number' ? inp.offset : null
      const limit = typeof inp.limit === 'number' ? inp.limit : null
      if (offset != null && limit != null) return `${fp}:${offset}-${offset + limit}`
      return fp
    }
    case 'Edit': {
      const fp = inp.file_path
      const old = inp.old_string
      const nw = inp.new_string
      if (typeof fp !== 'string') return null
      if (typeof old === 'string' && typeof nw === 'string') {
        return `${fp} — replace "${truncate(old, 30)}" → "${truncate(nw, 30)}"`
      }
      return fp
    }
    case 'Write': {
      const fp = inp.file_path
      const content = inp.content
      if (typeof fp !== 'string') return null
      if (typeof content === 'string') return `${fp} (${content.length} chars)`
      return fp
    }
    case 'Grep': {
      const pattern = inp.pattern
      const path = inp.path
      if (typeof pattern !== 'string') return null
      return `pattern "${truncate(pattern, 40)}"${typeof path === 'string' ? ` in ${path}` : ''}`
    }
    case 'Glob': {
      const pattern = inp.pattern
      return typeof pattern === 'string' ? pattern : null
    }
    case 'Agent': {
      const prompt = inp.prompt
      return typeof prompt === 'string' ? truncate(prompt, 80) : null
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/__tests__/tool-summaries.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Integrate into ConsoleLine**

In `ConsoleLine.tsx`, import and use `formatToolSummary` to replace raw JSON display for tool_call and tool_pair expanded views:

```tsx
import { formatToolSummary } from '../../lib/tool-summaries'

// In the tool_call and tool_pair expanded sections, show a summary line above raw JSON:
{expanded && block.input !== undefined && (
  <div className="console-line__detail">
    {(() => {
      const summary = formatToolSummary(block.tool, block.input)
      return summary ? (
        <div className="console-line__tool-summary">{summary}</div>
      ) : null
    })()}
    <div className="console-line__detail-label">Input</div>
    <pre className="console-line__json">
      <code>{JSON.stringify(block.input, null, 2)}</code>
    </pre>
  </div>
)}
```

- [ ] **Step 6: Add CSS for tool summary**

```css
.console-line__tool-summary {
  font-size: 12px;
  color: var(--neon-text);
  font-family: var(--bde-font-code);
  padding: 4px 0;
  border-bottom: 1px solid var(--neon-purple-border);
  margin-bottom: 4px;
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run src/renderer/src/lib/__tests__/tool-summaries.test.ts src/renderer/src/components/agents/__tests__/ --reporter=verbose`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/tool-summaries.ts src/renderer/src/lib/__tests__/tool-summaries.test.ts src/renderer/src/components/agents/ConsoleLine.tsx src/renderer/src/assets/agents-neon.css
git commit -m "feat: human-readable tool summaries in console (#22)"
```

---

## Phase 3: Layout + Polish

### Task 8: Layout Improvements (min-width, collapsible chart, scroll-into-view, pill accents, completion card wrapping)

**Findings:** #6, #13, #17, #19, #24

This task bundles 5 CSS/layout findings that are each small and interdependent.

**Files:**
- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/components/agents/AgentList.tsx`
- Modify: `src/renderer/src/components/agents/LiveActivityStrip.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/views/__tests__/AgentsView.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// In AgentsView.test.tsx:
it('renders collapsible Zone 3 chart with toggle', () => {
  render(<AgentsView />)
  const toggle = screen.getByLabelText(/toggle activity chart/i)
  expect(toggle).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add min-width enforcement (#6)**

In `AgentsView.tsx`, add `minWidth` to the root container:

```tsx
<motion.div
  style={{
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minWidth: 600,
    background: 'var(--neon-bg)'
  }}
```

- [ ] **Step 4: Make Zone 3 chart collapsible (#13)**

In `AgentsView.tsx`, add collapse state and toggle:

```tsx
const [chartCollapsed, setChartCollapsed] = useState(false)

// Replace the Zone 3 div with:
<div style={{ padding: chartCollapsed ? '0 12px 4px' : '0 12px 12px' }}>
  <button
    onClick={() => setChartCollapsed((v) => !v)}
    className="console-header__action-btn"
    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0', fontSize: '10px', color: 'var(--neon-text-dim)' }}
    aria-label="Toggle activity chart"
  >
    <ChevronRight
      size={12}
      style={{ transform: chartCollapsed ? undefined : 'rotate(90deg)', transition: 'transform 150ms ease' }}
    />
    <span>Activity</span>
  </button>
  {!chartCollapsed && (
    <NeonCard accent="cyan" title="Agent Activity — Last 6 Hours" icon={<Activity size={12} />}>
      <MiniChart data={activityChartData} height={80} />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--neon-text-dim)', fontSize: '9px', marginTop: '4px', fontFamily: 'var(--bde-font-code)' }}>
        {activityChartData.length > 0 && (
          <>
            <span>{activityChartData[0].label}</span>
            <span>{activityChartData[activityChartData.length - 1].label}</span>
          </>
        )}
      </div>
    </NeonCard>
  )}
</div>
```

Add `ChevronRight` to imports.

- [ ] **Step 5: Add scroll-into-view on selection (#17)**

In `AgentList.tsx`, add a ref callback that scrolls the selected card into view:

```tsx
// In the AgentCard rendering (inside each group's .map):
<AgentCard
  key={a.id}
  agent={a}
  selected={a.id === selectedId}
  onClick={() => onSelect(a.id)}
  onKill={onKill}
  ref={a.id === selectedId ? scrollRef : undefined}
/>
```

Since AgentCard is a function component wrapping a `<button>`, we need to use a callback ref approach in AgentList instead:

```tsx
const selectedRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (selectedId && selectedRef.current) {
    selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}, [selectedId])

// Wrap each AgentCard in a div with ref when selected:
{groups.running.map((a) => (
  <div key={a.id} ref={a.id === selectedId ? selectedRef : undefined}>
    <AgentCard
      agent={a}
      selected={a.id === selectedId}
      onClick={() => onSelect(a.id)}
      onKill={onKill}
    />
  </div>
))}
```

Apply the same pattern to all three groups (running, recent, history).

- [ ] **Step 6: Fix pill accents to reflect status not index (#19)**

In `LiveActivityStrip.tsx`, replace the index-based accent:

```tsx
// OLD:
const getAccent = (index: number): NeonAccent => {
  return NEON_ACCENTS[index % NEON_ACCENTS.length]
}

// NEW:
const STATUS_PILL_ACCENTS: Record<string, NeonAccent> = {
  running: 'cyan',
  done: 'purple',
  failed: 'red',
  cancelled: 'orange'
}

// In usage:
<AgentPill
  key={agent.id}
  agent={agent}
  currentAction={getLatestAction(agent.id)}
  accent={STATUS_PILL_ACCENTS[agent.status] ?? 'cyan'}
  onClick={() => onSelectAgent(agent.id)}
/>
```

- [ ] **Step 7: Fix completion card grid wrapping (#24)**

In `agents-neon.css`, update `.console-completion-card__stats` to wrap on narrow viewports:

```css
.console-completion-card__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 12px;
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx src/renderer/src/components/agents/__tests__/ --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx src/renderer/src/components/agents/AgentList.tsx src/renderer/src/components/agents/LiveActivityStrip.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/views/__tests__/AgentsView.test.tsx
git commit -m "feat: layout polish — min-width, collapsible chart, scroll-into-view, pill accents, card wrapping (#6, #13, #17, #19, #24)"
```

---

### Task 9: Resizable Sidebar

**Finding:** #16 — The sidebar is fixed at 220px. Make it resizable using CSS `resize: horizontal` or a drag handle.

**Files:**
- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: `src/renderer/src/views/__tests__/AgentsView.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('renders sidebar with resize handle', () => {
  render(<AgentsView />)
  expect(document.querySelector('.agents-sidebar')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add CSS resize to sidebar**

In `AgentsView.tsx`, add a className to the sidebar div:

```tsx
<div className="agents-sidebar">
```

In `agents-neon.css`:

```css
.agents-sidebar {
  width: 220px;
  min-width: 180px;
  max-width: 400px;
  border-right: 1px solid var(--neon-purple-border);
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--neon-purple-surface, rgba(138,43,226,0.04)), var(--neon-surface-deep, rgba(10,0,21,0.4)));
  resize: horizontal;
  overflow: hidden;
}
```

Remove the inline `style` on the sidebar div since the CSS class now covers it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/views/__tests__/AgentsView.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx src/renderer/src/assets/agents-neon.css src/renderer/src/views/__tests__/AgentsView.test.tsx
git commit -m "feat: resizable agents sidebar (#16)"
```

---

## Phase 4: Efficiency + Memory

### Task 10: Running Cost Estimate, Show Full Toggle, History Pagination, LRU Eviction

**Findings:** #10, #14, #15, #20, #25

These are the final 5 findings — efficiency and memory improvements.

**Files:**
- Modify: `src/renderer/src/components/agents/ConsoleHeader.tsx` (#10 running cost)
- Modify: `src/renderer/src/components/agents/ConsoleLine.tsx` (#20 show full toggle)
- Modify: `src/renderer/src/stores/agentEvents.ts` (#14 LRU eviction)
- Modify: `src/renderer/src/stores/agentHistory.ts` (#25 pagination)
- Modify: `src/renderer/src/components/agents/AgentList.tsx` (#15 repo selector, #25 load more)
- Modify: `src/renderer/src/assets/agents-neon.css`
- Test: Various test files

- [ ] **Step 1: Write failing test for running cost estimate**

```tsx
// In a ConsoleHeader test file:
it('shows running cost estimate based on token usage', () => {
  const events = [
    { type: 'agent:tool_result', tool: 'Bash', timestamp: Date.now() },
    // Events don't directly carry cost; cost comes from completed event
  ]
  render(<ConsoleHeader agent={{ ...mockAgent, status: 'running', costUsd: null }} events={events} />)
  // Running agents should show elapsed cost ticker or "Estimating…"
  expect(screen.getByText(/\$/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add running cost estimate to ConsoleHeader (#10)**

In `ConsoleHeader.tsx`, compute a running cost estimate based on token events. Since the SDK streams token counts in `agent:completed` only, for running agents estimate based on event count and model:

```tsx
// Rough estimate: ~$0.001 per event (tool call + result pair) for Sonnet
// This is a UX affordance, not an accounting tool
const estimatedCost = useMemo(() => {
  if (agent.status !== 'running') return null
  if (costUsd != null) return null // Already have actual cost
  const eventCount = events.length
  const perEventCost = agent.model.toLowerCase().includes('opus') ? 0.003 : 0.001
  return eventCount * perEventCost
}, [agent.status, agent.model, events.length, costUsd])

// In the meta section:
<div className="console-header__meta">
  <span>{duration}</span>
  {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
  {estimatedCost != null && (
    <span className="console-header__cost-estimate" title="Estimated based on event count">
      ~${estimatedCost.toFixed(2)}
    </span>
  )}
</div>
```

CSS:
```css
.console-header__cost-estimate {
  color: var(--neon-orange);
  font-style: italic;
}
```

- [ ] **Step 4: Add "show full" toggle for expanded content (#20)**

In `ConsoleLine.tsx`, the `.console-line__expanded-content` has `max-height: 300px`. Add a "Show full" button when content overflows:

```tsx
// For the thinking block expanded content:
{expanded && block.text && (
  <ExpandableContent text={block.text} />
)}
```

Create a small `ExpandableContent` sub-component within ConsoleLine.tsx:

```tsx
function ExpandableContent({ text }: { text: string }) {
  const [showFull, setShowFull] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    if (ref.current) {
      setOverflows(ref.current.scrollHeight > ref.current.clientHeight)
    }
  }, [text])

  return (
    <div>
      <div
        ref={ref}
        className="console-line__expanded-content"
        style={showFull ? { maxHeight: 'none' } : undefined}
      >
        {text}
      </div>
      {overflows && !showFull && (
        <button
          className="console-line__show-full"
          onClick={(e) => { e.stopPropagation(); setShowFull(true) }}
        >
          Show full
        </button>
      )}
    </div>
  )
}
```

CSS:
```css
.console-line__show-full {
  display: block;
  margin: 4px 0 0 24px;
  padding: 2px 8px;
  background: var(--neon-purple-surface);
  border: 1px solid var(--neon-purple-border);
  border-radius: 4px;
  color: var(--neon-purple);
  font-size: 10px;
  font-family: var(--bde-font-code);
  cursor: pointer;
}

.console-line__show-full:hover {
  background: var(--neon-surface-dim);
}
```

- [ ] **Step 5: Add LRU eviction for events store (#14)**

In `agentEvents.ts`, evict the least-recently-accessed agent's events when total agent count exceeds a threshold. This prevents memory growth when cycling through many agents:

```ts
const MAX_AGENTS_IN_MEMORY = 20

// In the loadHistory method, after setting events:
set((state) => {
  const agentIds = Object.keys(state.events)
  if (agentIds.length <= MAX_AGENTS_IN_MEMORY) return state

  // Evict oldest agents (keep the most recently loaded)
  // Simple approach: evict first keys beyond limit
  const nextEvents = { ...state.events }
  const nextEvicted = { ...state.evictedAgents }
  const toEvict = agentIds.slice(0, agentIds.length - MAX_AGENTS_IN_MEMORY)
  for (const id of toEvict) {
    delete nextEvents[id]
    delete nextEvicted[id]
  }
  return { events: nextEvents, evictedAgents: nextEvicted }
})
```

Better approach: track access order in an array:

```ts
interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  evictedAgents: Record<string, boolean>
  accessOrder: string[]  // Most recent at end
  init: () => () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}
```

On `loadHistory` and on `init` (when receiving events), move the agentId to end of `accessOrder`. When `accessOrder.length > MAX_AGENTS_IN_MEMORY`, evict from the front.

- [ ] **Step 6: Add history pagination (#25)**

In `agentHistory.ts`, add `hasMore` and `loadMore` to support paginated agent list:

```ts
interface AgentHistoryState {
  agents: AgentMeta[]
  selectedId: string | null
  loading: boolean
  fetchError: string | null
  hasMore: boolean
  fetchAgents: () => Promise<void>
  loadMore: () => Promise<void>
  selectAgent: (id: string | null) => void
}
```

`fetchAgents` loads the first 30. `loadMore` loads the next 30 with offset. In `AgentList.tsx`, render a "Load more" button at the bottom of the history group when `hasMore` is true.

**Note:** This depends on the IPC `agents:list` supporting offset/limit params. Check the main process handler. If it doesn't support pagination yet, add `offset` and `limit` params:

```ts
// In agentHistory.ts:
async loadMore() {
  const current = get().agents.length
  const more = await window.api.getAgentHistory({ limit: 30, offset: current })
  set((state) => ({
    agents: [...state.agents, ...more],
    hasMore: more.length === 30
  }))
}
```

In `AgentList.tsx`, at the bottom of the history group:

```tsx
{hasMore && (
  <button
    className="agent-list__load-more"
    onClick={onLoadMore}
  >
    Load more agents…
  </button>
)}
```

CSS:
```css
.agent-list__load-more {
  display: block;
  width: 100%;
  padding: 8px;
  background: none;
  border: none;
  border-top: 1px solid var(--neon-purple-border);
  color: var(--neon-purple);
  font-size: 11px;
  font-family: var(--bde-font-code);
  cursor: pointer;
  text-align: center;
}

.agent-list__load-more:hover {
  background: var(--neon-purple-surface);
}
```

- [ ] **Step 7: Add repo selector dropdown (#15)**

In `AgentList.tsx`, replace the current single-input search with a filter that includes a repo dropdown. The simplest approach: add a repo filter chip row above the search input.

```tsx
// Extract unique repos from agents:
const repos = useMemo(() => {
  const set = new Set(agents.map(a => a.repo))
  return Array.from(set).sort()
}, [agents])

const [repoFilter, setRepoFilter] = useState<string | null>(null)

// Add to filtered logic:
const filtered = useMemo(() => {
  let list = agents
  if (repoFilter) {
    list = list.filter(a => a.repo === repoFilter)
  }
  if (!searchText) return list
  const lower = searchText.toLowerCase()
  return list.filter(
    (a) =>
      a.task.toLowerCase().includes(lower) ||
      a.repo.toLowerCase().includes(lower) ||
      a.model.toLowerCase().includes(lower)
  )
}, [agents, searchText, repoFilter])
```

Render repo chips above the agent groups:

```tsx
{repos.length > 1 && (
  <div className="agent-list__repo-chips">
    <button
      className={`agent-list__repo-chip${repoFilter === null ? ' agent-list__repo-chip--active' : ''}`}
      onClick={() => setRepoFilter(null)}
    >
      All
    </button>
    {repos.map(repo => (
      <button
        key={repo}
        className={`agent-list__repo-chip${repoFilter === repo ? ' agent-list__repo-chip--active' : ''}`}
        onClick={() => setRepoFilter(repoFilter === repo ? null : repo)}
      >
        {repo}
      </button>
    ))}
  </div>
)}
```

CSS:
```css
.agent-list__repo-chips {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  overflow-x: auto;
  flex-shrink: 0;
}

.agent-list__repo-chip {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--neon-purple-border);
  background: transparent;
  color: var(--neon-text-dim);
  font-size: 10px;
  font-family: var(--bde-font-code);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.agent-list__repo-chip:hover {
  background: var(--neon-purple-surface);
  color: var(--neon-text);
}

.agent-list__repo-chip--active {
  background: var(--neon-purple-surface);
  border-color: var(--neon-purple);
  color: var(--neon-purple);
}
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ src/renderer/src/views/__tests__/AgentsView.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/agents/ConsoleHeader.tsx src/renderer/src/components/agents/ConsoleLine.tsx src/renderer/src/stores/agentEvents.ts src/renderer/src/stores/agentHistory.ts src/renderer/src/components/agents/AgentList.tsx src/renderer/src/assets/agents-neon.css
git commit -m "feat: efficiency improvements — cost estimate, show full, LRU eviction, pagination, repo filter (#10, #14, #15, #20, #25)"
```

---

## PR Strategy

Create one PR per phase:

1. **PR: Agents Phase 2 — Console Quality** (Tasks 1-7)
   - Command bar disabled state + /retry feedback
   - Empty state context
   - Event cap notification
   - Status icons in sidebar cards
   - Steering message echo
   - Console search/filter
   - Tool-specific summaries

2. **PR: Agents Phase 3 — Layout + Polish** (Tasks 8-9)
   - Min-width, collapsible chart, scroll-into-view, pill accents, card wrapping
   - Resizable sidebar

3. **PR: Agents Phase 4 — Efficiency + Memory** (Task 10)
   - Running cost estimate, show full toggle, LRU eviction, history pagination, repo selector

Each PR should include:
- All test files for the phase
- Screenshot/ASCII art of each changed UI surface
- `npm run typecheck && npm test` passing before PR creation

---

## Finding → Task Cross-Reference

| Finding | Description | Task | Phase |
|---------|------------|------|-------|
| #5 | Event cap notification | 3 | 2 |
| #8 | /retry silent fail feedback | 1 | 2 |
| #9 | Console search/filter | 6 | 2 |
| #11 | Steering message echo | 5 | 2 |
| #12 | Status icons in sidebar | 4 | 2 |
| #18 | Done/cancelled labels | 4 | 2 |
| #21 | Command bar disabled state | 1 | 2 |
| #22 | Tool-specific summaries | 7 | 2 |
| #23 | Empty state context | 2 | 2 |
| #6 | Minimum width enforcement | 8 | 3 |
| #13 | Collapsible Zone 3 chart | 8 | 3 |
| #16 | Resizable sidebar | 9 | 3 |
| #17 | Scroll-into-view on selection | 8 | 3 |
| #19 | Pill accents reflect status | 8 | 3 |
| #24 | Completion card wrapping | 8 | 3 |
| #10 | Running cost estimate | 10 | 4 |
| #14 | LRU eviction for events | 10 | 4 |
| #15 | Repo selector dropdown | 10 | 4 |
| #20 | Show full for expanded content | 10 | 4 |
| #25 | History pagination | 10 | 4 |
