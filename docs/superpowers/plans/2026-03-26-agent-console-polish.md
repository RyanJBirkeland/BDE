# Agent Console Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the agent console detail panel with markdown rendering, tool-specific icons, rich completion card, and text grouping.

**Architecture:** Four focused changes to the agent console rendering pipeline. Text grouping happens in `pair-events.ts` (data layer). Markdown rendering is a new utility. Tool icons and completion card are `ConsoleLine.tsx` changes. All styling uses neon CSS classes.

**Tech Stack:** React, TypeScript, Vitest, CSS custom properties (`var(--neon-*)`)

**Spec:** `docs/superpowers/specs/2026-03-26-agent-console-polish-design.md`

---

### Task 1: Add CSS classes for all four features

**Files:**

- Modify: `src/renderer/src/assets/agents-neon.css` (append at end, before reduced-motion section)

- [ ] **Step 1: Add markdown rendering CSS classes**

Append before the `/* ── Reduced Motion Overrides ── */` section:

```css
/* ── Markdown Rendering in Agent Text ── */
.console-md-bold {
  font-weight: 700;
  color: var(--neon-text);
}

.console-md-code {
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}

.console-md-heading {
  font-weight: 700;
  color: var(--neon-text);
  font-size: 13px;
  display: block;
  margin-top: 4px;
}
```

- [ ] **Step 2: Add tool icon CSS classes**

```css
/* ── Tool-Specific Icons ── */
.console-tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 10px;
  flex-shrink: 0;
  font-weight: 700;
  font-family: var(--bde-font-code);
}

.console-tool-icon--bash {
  background: var(--neon-orange-surface);
  color: var(--neon-orange);
}
.console-tool-icon--read {
  background: var(--neon-blue-surface);
  color: var(--neon-blue);
}
.console-tool-icon--edit,
.console-tool-icon--write {
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
}
.console-tool-icon--grep {
  background: var(--neon-purple-surface);
  color: var(--neon-purple);
}
.console-tool-icon--glob {
  background: var(--neon-orange-surface);
  color: var(--neon-orange);
}
.console-tool-icon--agent {
  background: var(--neon-pink-surface);
  color: var(--neon-pink);
}
.console-tool-icon--default {
  background: var(--neon-blue-surface);
  color: var(--neon-blue);
}
```

- [ ] **Step 3: Add completion card CSS classes**

```css
/* ── Completion Summary Card ── */
.console-completion-card {
  margin: 12px;
  padding: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--neon-cyan-surface) 0%, var(--neon-surface-deep) 100%);
  border: 1px solid var(--neon-cyan-border);
  font-family: var(--bde-font-code);
}

.console-completion-card--failed {
  background: linear-gradient(135deg, var(--neon-red-surface) 0%, var(--neon-surface-deep) 100%);
  border-color: var(--neon-red-border);
}

.console-completion-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 700;
  font-size: 13px;
}

.console-completion-card__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.console-completion-card__stat {
  text-align: center;
}

.console-completion-card__stat-value {
  font-size: 18px;
  font-weight: 700;
  font-family: var(--bde-font-code);
}

.console-completion-card__stat-label {
  font-size: 10px;
  color: var(--neon-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}
```

- [ ] **Step 4: Add grouped text and utility CSS classes**

```css
/* ── Grouped Text Blocks ── */
.console-line__content--grouped {
  border-left: 2px solid var(--neon-cyan-border);
  padding-left: 8px;
}

/* ── Console Badge ── */
.console-badge {
  display: inline-block;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  flex-shrink: 0;
  font-weight: 600;
  font-family: var(--bde-font-code);
}

.console-badge--success {
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
}

.console-badge--danger {
  background: var(--neon-red-surface);
  color: var(--neon-red);
}

.console-badge--purple {
  background: var(--neon-purple-surface);
  color: var(--neon-purple);
}

/* ── Expanded Content ── */
.console-line__expanded-content {
  padding-left: 24px;
  font-family: var(--bde-font-code);
  font-size: 12px;
  color: var(--neon-text-muted);
  white-space: pre-wrap;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

.console-line__detail {
  padding-left: 24px;
}

.console-line__detail-group {
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.console-line__detail-label {
  font-size: 10px;
  color: var(--neon-text-dim);
  margin-bottom: 4px;
}

.console-line__json {
  margin: 0;
  padding: 8px;
  background: var(--neon-surface-dim);
  border-radius: 4px;
  font-size: 11px;
  font-family: var(--bde-font-code);
  color: var(--neon-text-muted);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/agents-neon.css
git commit -m "feat(agents): add neon CSS classes for console polish"
```

---

### Task 2: Add consecutive text merging to pairEvents

**Files:**

- Modify: `src/renderer/src/lib/pair-events.ts`
- Modify: `src/renderer/src/lib/__tests__/pair-events.test.ts`

- [ ] **Step 1: Write failing tests for text merging**

Add these tests to `src/renderer/src/lib/__tests__/pair-events.test.ts`:

```typescript
it('merges consecutive text blocks into single block', () => {
  const events: AgentEvent[] = [
    { type: 'agent:text', text: 'First line', timestamp: 3000 },
    { type: 'agent:text', text: 'Second line', timestamp: 3100 },
    { type: 'agent:text', text: 'Third line', timestamp: 3200 }
  ]

  const blocks = pairEvents(events)

  expect(blocks).toHaveLength(1)
  expect(blocks[0]).toEqual({
    type: 'text',
    text: 'First line\nSecond line\nThird line',
    timestamp: 3000
  })
})

it('does not merge text blocks separated by other event types', () => {
  const events: AgentEvent[] = [
    { type: 'agent:text', text: 'Before', timestamp: 3000 },
    { type: 'agent:tool_call', tool: 'Bash', summary: 'Run ls', timestamp: 3100 },
    { type: 'agent:text', text: 'After', timestamp: 3200 }
  ]

  const blocks = pairEvents(events)

  expect(blocks).toHaveLength(3)
  expect(blocks[0]).toEqual({ type: 'text', text: 'Before', timestamp: 3000 })
  expect(blocks[2]).toEqual({ type: 'text', text: 'After', timestamp: 3200 })
})

it('preserves single text block without modification', () => {
  const events: AgentEvent[] = [{ type: 'agent:text', text: 'Only one', timestamp: 3000 }]

  const blocks = pairEvents(events)

  expect(blocks).toHaveLength(1)
  expect(blocks[0]).toEqual({ type: 'text', text: 'Only one', timestamp: 3000 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib/__tests__/pair-events.test.ts`
Expected: The "merges consecutive text blocks" test FAILS (currently produces 3 blocks, not 1). The other two should pass since they match current behavior.

- [ ] **Step 3: Add merge pass to pairEvents**

In `src/renderer/src/lib/pair-events.ts`, replace the final `return blocks` with a merge pass:

```typescript
// Merge consecutive text blocks into single grouped blocks
const merged: ChatBlock[] = []
for (const block of blocks) {
  const prev = merged[merged.length - 1]
  if (block.type === 'text' && prev?.type === 'text') {
    prev.text += '\n' + block.text
  } else {
    merged.push(block)
  }
}

return merged
```

- [ ] **Step 4: Update the existing "passes text events through" test**

The existing test (around line 67) asserts `blocks.length === 2` for two consecutive text events. After the merge pass, this will be 1 block. Update it:

```typescript
it('merges consecutive text events into single text block', () => {
  const events: AgentEvent[] = [
    { type: 'agent:text', text: 'Hello from agent', timestamp: 3000 },
    { type: 'agent:text', text: 'Another message', timestamp: 3100 }
  ]

  const blocks = pairEvents(events)

  expect(blocks).toHaveLength(1)
  expect(blocks[0]).toEqual({
    type: 'text',
    text: 'Hello from agent\nAnother message',
    timestamp: 3000
  })
})
```

Also update the "interleaves stderr with other event types" test — it has a text event between stderr events. After merging, block count stays the same (no consecutive texts), but verify it still passes.

- [ ] **Step 5: Run all pair-events tests**

Run: `npx vitest run src/renderer/src/lib/__tests__/pair-events.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/pair-events.ts src/renderer/src/lib/__tests__/pair-events.test.ts
git commit -m "feat(agents): merge consecutive text blocks in pairEvents"
```

---

### Task 3: Create renderAgentMarkdown utility

**Files:**

- Create: `src/renderer/src/lib/render-agent-markdown.tsx`
- Create: `src/renderer/src/lib/__tests__/render-agent-markdown.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/lib/__tests__/render-agent-markdown.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderAgentMarkdown } from '../render-agent-markdown'

describe('renderAgentMarkdown', () => {
  it('renders plain text unchanged', () => {
    render(<>{renderAgentMarkdown('Hello world')}</>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders **bold** text as strong element', () => {
    const { container } = render(<>{renderAgentMarkdown('This is **important** text')}</>)
    const strong = container.querySelector('.console-md-bold')
    expect(strong).toBeInTheDocument()
    expect(strong?.textContent).toBe('important')
  })

  it('renders `code` as code element', () => {
    const { container } = render(<>{renderAgentMarkdown('Run `npm install` first')}</>)
    const code = container.querySelector('.console-md-code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toBe('npm install')
  })

  it('renders ## heading as block heading', () => {
    const { container } = render(<>{renderAgentMarkdown('## Step 5: Verify')}</>)
    const heading = container.querySelector('.console-md-heading')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Step 5: Verify')
  })

  it('handles mixed markdown', () => {
    const { container } = render(
      <>{renderAgentMarkdown('✅ **Step 4 PASSED**: Run `npm test` to verify')}</>
    )
    expect(container.querySelector('.console-md-bold')?.textContent).toBe('Step 4 PASSED')
    expect(container.querySelector('.console-md-code')?.textContent).toBe('npm test')
  })

  it('returns empty fragment for empty string', () => {
    const { container } = render(<>{renderAgentMarkdown('')}</>)
    expect(container.textContent).toBe('')
  })

  it('preserves text without markdown unchanged', () => {
    render(<>{renderAgentMarkdown('No special formatting here')}</>)
    expect(screen.getByText('No special formatting here')).toBeInTheDocument()
  })

  it('handles heading mid-text (only at line start)', () => {
    const { container } = render(<>{renderAgentMarkdown('Result\n## Next Step\nDo the thing')}</>)
    const heading = container.querySelector('.console-md-heading')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Next Step')
  })

  it('does not render script tags as HTML', () => {
    const { container } = render(<>{renderAgentMarkdown('<script>alert("xss")</script>')}</>)
    expect(container.querySelector('script')).toBeNull()
    // React auto-escapes, so script tag text appears as literal text
    expect(container.textContent).toContain('<script>')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib/__tests__/render-agent-markdown.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement renderAgentMarkdown**

Create `src/renderer/src/lib/render-agent-markdown.tsx`:

```tsx
/**
 * render-agent-markdown.tsx — Lightweight markdown-to-JSX for agent console text.
 * Returns React elements (not HTML strings) to prevent XSS by design.
 * Handles: **bold**, `code`, ## headings. Unicode emojis pass through natively.
 */
import React from 'react'

/** Process inline markdown: **bold** and `code` */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match **bold** or `code` — bold first to avoid conflicts
  const regex = /\*\*(.+?)\*\*|`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) {
      // **bold**
      parts.push(
        <strong key={match.index} className="console-md-bold">
          {match[1]}
        </strong>
      )
    } else if (match[2] !== undefined) {
      // `code`
      parts.push(
        <code key={match.index} className="console-md-code">
          {match[2]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

/** Render agent text with lightweight markdown support */
export function renderAgentMarkdown(text: string): React.ReactNode {
  if (!text) return null

  // Split by newlines to handle line-start headings
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ## heading (line-start only, supports ## and ###)
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/)
    if (headingMatch) {
      elements.push(
        <span key={`h-${i}`} className="console-md-heading">
          {renderInlineMarkdown(headingMatch[1])}
        </span>
      )
      continue
    }

    // Regular line with inline markdown
    if (i > 0) {
      elements.push('\n')
    }
    elements.push(<React.Fragment key={`l-${i}`}>{renderInlineMarkdown(line)}</React.Fragment>)
  }

  return <>{elements}</>
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/lib/__tests__/render-agent-markdown.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/render-agent-markdown.tsx src/renderer/src/lib/__tests__/render-agent-markdown.test.tsx
git commit -m "feat(agents): add lightweight markdown renderer for agent console text"
```

---

### Task 4: Update ConsoleLine with tool icons, markdown, completion card, and CSS migration

This is the main integration task. It modifies `ConsoleLine.tsx` to:

1. Use CSS classes instead of inline styles (per CLAUDE.md neon convention)
2. Render agent text through `renderAgentMarkdown()`
3. Add tool-specific icons with colored prefixes
4. Replace `completed` line with rich card
5. Apply grouped text styling

**Files:**

- Modify: `src/renderer/src/components/agents/ConsoleLine.tsx`
- Modify: `src/renderer/src/components/agents/__tests__/ConsoleLine.test.tsx`

- [ ] **Step 1: Write new tests for tool icons, markdown, completion card**

Add to `src/renderer/src/components/agents/__tests__/ConsoleLine.test.tsx`:

```tsx
// Tool icon tests
it('renders Bash tool_pair with orange tool icon', () => {
  const block: ChatBlock = {
    type: 'tool_pair',
    tool: 'Bash',
    summary: 'Running ls',
    input: { command: 'ls' },
    result: { success: true, summary: 'Output', output: 'file.txt' },
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  const icon = container.querySelector('.console-tool-icon--bash')
  expect(icon).toBeInTheDocument()
  expect(icon?.textContent).toBe('$')
})

it('renders Read tool_call with blue tool icon', () => {
  const block: ChatBlock = {
    type: 'tool_call',
    tool: 'Read',
    summary: 'Reading file',
    input: { path: 'file.txt' },
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  const icon = container.querySelector('.console-tool-icon--read')
  expect(icon).toBeInTheDocument()
  expect(icon?.textContent).toBe('R')
})

it('renders unknown tool with default icon', () => {
  const block: ChatBlock = {
    type: 'tool_call',
    tool: 'CustomTool',
    summary: 'Doing something',
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  const icon = container.querySelector('.console-tool-icon--default')
  expect(icon).toBeInTheDocument()
})

// Markdown rendering in text blocks
it('renders markdown in text blocks', () => {
  const block: ChatBlock = {
    type: 'text',
    text: '✅ **Step 1 PASSED**: Run `npm test`',
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  expect(container.querySelector('.console-md-bold')?.textContent).toBe('Step 1 PASSED')
  expect(container.querySelector('.console-md-code')?.textContent).toBe('npm test')
})

// Grouped text styling
it('applies grouped styling to multi-line text blocks', () => {
  const block: ChatBlock = {
    type: 'text',
    text: 'Line one\nLine two',
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  expect(container.querySelector('.console-line__content--grouped')).toBeInTheDocument()
})

it('does not apply grouped styling to single-line text', () => {
  const block: ChatBlock = {
    type: 'text',
    text: 'Just one line',
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  expect(container.querySelector('.console-line__content--grouped')).not.toBeInTheDocument()
})

// Completion card tests
it('renders completion card with stats for successful completion', () => {
  const block: ChatBlock = {
    type: 'completed',
    exitCode: 0,
    costUsd: 0.48,
    tokensIn: 142000,
    tokensOut: 8200,
    durationMs: 314000,
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  expect(container.querySelector('.console-completion-card')).toBeInTheDocument()
  expect(container.querySelector('.console-completion-card--failed')).not.toBeInTheDocument()
  expect(screen.getByText(/completed successfully/)).toBeInTheDocument()
  expect(screen.getByText('$0.48')).toBeInTheDocument()
  expect(screen.getByText('142K')).toBeInTheDocument()
  expect(screen.getByText('8.2K')).toBeInTheDocument()
  expect(screen.getByText('5m 14s')).toBeInTheDocument()
})

it('renders failed completion card with exit code', () => {
  const block: ChatBlock = {
    type: 'completed',
    exitCode: 1,
    costUsd: 1.22,
    tokensIn: 380000,
    tokensOut: 24000,
    durationMs: 723000,
    timestamp: Date.now()
  }
  const { container } = render(<ConsoleLine block={block} />)
  expect(container.querySelector('.console-completion-card--failed')).toBeInTheDocument()
  expect(screen.getByText(/failed/i)).toBeInTheDocument()
  expect(screen.getByText(/exit code 1/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Remove the old completed test**

Remove the existing completed test (lines 46-59 that check for `[done]` text and the old `$0.0234.*1500 tokens.*12.35s` format). It is replaced by the two completion card tests above.

- [ ] **Step 3: Run tests to verify new tests fail**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ConsoleLine.test.tsx`
Expected: New tests FAIL (no tool icons, no completion card, no markdown classes yet)

- [ ] **Step 4: Rewrite ConsoleLine.tsx**

Replace the full contents of `src/renderer/src/components/agents/ConsoleLine.tsx` with the new implementation that:

- Removes all inline style objects (`lineStyle`, `prefixStyle`, `contentStyle`, `timestampStyle`, `badgeStyle`, `jsonBlockStyle`)
- Uses CSS classes: `console-line`, `console-prefix`, `console-prefix--agent`, `console-line__content`, `console-line__timestamp`, `console-line--collapsible`, `console-line--expanded`, `console-line__chevron`, `console-badge`, `console-line__detail`, `console-line__json`, etc.
- Adds `getToolMeta()` helper for tool icon lookup
- Adds `formatDuration()` and `formatTokenCount()` helpers
- Imports and uses `renderAgentMarkdown()` in the `text` case
- Replaces `completed` with the completion card
- Adds tool icons to `tool_call` and `tool_pair`
- Applies `.console-line__content--grouped` class when `block.text.includes('\n')`

Full implementation in spec code block above (Task 4, Step 3 in the spec). Key structural points:

**Tool icon helper:**

```tsx
const TOOL_MAP: Record<string, ToolMeta> = {
  bash: { letter: '$', iconClass: 'console-tool-icon--bash' },
  read: { letter: 'R', iconClass: 'console-tool-icon--read' },
  edit: { letter: 'E', iconClass: 'console-tool-icon--edit' },
  write: { letter: 'W', iconClass: 'console-tool-icon--write' },
  grep: { letter: 'G', iconClass: 'console-tool-icon--grep' },
  glob: { letter: 'G', iconClass: 'console-tool-icon--glob' },
  agent: { letter: 'A', iconClass: 'console-tool-icon--agent' }
}

function getToolMeta(toolName: string): ToolMeta {
  return (
    TOOL_MAP[toolName.toLowerCase()] ?? { letter: '•', iconClass: 'console-tool-icon--default' }
  )
}
```

**Format helpers:**

```tsx
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}
```

**Completion card (replaces old `completed` case):**

```tsx
case 'completed': {
  const success = block.exitCode === 0
  return (
    <div
      className={`console-completion-card${success ? '' : ' console-completion-card--failed'}`}
      data-testid="console-line-completed"
    >
      <div className="console-completion-card__header">
        <span style={{ color: success ? 'var(--neon-cyan)' : 'var(--neon-red)' }}>
          {success ? '✓' : '✗'}
        </span>
        <span style={{ color: success ? 'var(--neon-cyan)' : 'var(--neon-red)' }}>
          {success ? 'Agent completed successfully' : `Agent failed (exit code ${block.exitCode})`}
        </span>
      </div>
      <div className="console-completion-card__stats">
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value" style={{ color: 'var(--neon-cyan)' }}>
            {formatDuration(block.durationMs)}
          </div>
          <div className="console-completion-card__stat-label">Duration</div>
        </div>
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value"
            style={{ color: success ? 'var(--neon-cyan)' : 'var(--neon-red)' }}>
            ${block.costUsd.toFixed(2)}
          </div>
          <div className="console-completion-card__stat-label">Cost</div>
        </div>
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value" style={{ color: 'var(--neon-purple)' }}>
            {formatTokenCount(block.tokensIn)}
          </div>
          <div className="console-completion-card__stat-label">Tokens In</div>
        </div>
        <div className="console-completion-card__stat">
          <div className="console-completion-card__stat-value" style={{ color: 'var(--neon-orange)' }}>
            {formatTokenCount(block.tokensOut)}
          </div>
          <div className="console-completion-card__stat-label">Tokens Out</div>
        </div>
      </div>
    </div>
  )
}
```

**Note on collapsible button styles:** The `<button>` elements inside thinking/tool_call/tool_pair still use inline styles for `display: 'flex'`, `background: 'none'`, `border: 'none'`, etc. — this is intentional since these are reset styles for the native button element, not theme styles.

- [ ] **Step 5: Run ConsoleLine tests**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/ConsoleLine.test.tsx`
Expected: All tests PASS

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/agents/ConsoleLine.tsx src/renderer/src/components/agents/__tests__/ConsoleLine.test.tsx src/renderer/src/assets/agents-neon.css
git commit -m "feat(agents): polish console with tool icons, markdown, completion card, CSS migration"
```

---

### Task 5: Verify typecheck and coverage

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors

- [ ] **Step 2: Run coverage**

Run: `npm run test:coverage`
Expected: PASS — thresholds met (72% stmts, 66% branches, 70% functions, 74% lines)

- [ ] **Step 3: Visual verification**

Run: `npm run dev`
Navigate to Agents view, select an agent with history. Verify:

- Agent text shows bold/code/heading formatting
- Tool calls show colored icons (Bash=`$` orange, Read=R blue, etc.)
- Completion shows a card with 4 stats, not a single `[done]` line
- Consecutive agent text blocks are merged with left border
- All existing functionality still works (expand/collapse, timestamps, command bar)

- [ ] **Step 4: Final commit if any fixes needed**

If any adjustments were needed during visual verification, commit them:

```bash
git add -A
git commit -m "fix(agents): polish adjustments from visual verification"
```
