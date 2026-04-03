# Neon Design System Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the V2 neon design system so every primitive uses design tokens consistently — no hardcoded px, no raw rgba(), proper accessibility, and StatusBar aligned with the accent pattern.

**Architecture:** Add neon-specific semantic CSS variables for dim/muted text (the rgba values currently hardcoded). Replace all inline magic numbers with `tokens.space` and `tokens.size` references. Add `accent` prop to StatusBar. Fix NeonTooltip accessibility. Each task is one component — independent, parallelizable.

**Tech Stack:** React, TypeScript, CSS custom properties, Vitest + Testing Library

---

## File Map

| File                                                   | Action | Responsibility                                                                                |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `src/renderer/src/assets/neon.css`                     | Modify | Add `--neon-text`, `--neon-text-muted`, `--neon-text-dim`, `--neon-surface-dim` semantic vars |
| `src/renderer/src/design-system/tokens.ts`             | Modify | Add neon semantic text tokens                                                                 |
| `src/renderer/src/components/neon/types.ts`            | Modify | Export new neon semantic tokens type                                                          |
| `src/renderer/src/components/neon/NeonCard.tsx`        | Modify | Replace magic px with tokens                                                                  |
| `src/renderer/src/components/neon/StatCounter.tsx`     | Modify | Replace magic px + `#fff` with tokens                                                         |
| `src/renderer/src/components/neon/NeonBadge.tsx`       | Modify | Replace magic px with tokens                                                                  |
| `src/renderer/src/components/neon/ActivityFeed.tsx`    | Modify | Replace rgba() with CSS vars, px with tokens                                                  |
| `src/renderer/src/components/neon/NeonProgress.tsx`    | Modify | Replace rgba() + magic px with tokens                                                         |
| `src/renderer/src/components/neon/PipelineFlow.tsx`    | Modify | Replace rgba() + magic px with tokens                                                         |
| `src/renderer/src/components/neon/MiniChart.tsx`       | Modify | Replace rgba() + magic px with tokens                                                         |
| `src/renderer/src/components/neon/GlassPanel.tsx`      | Modify | Replace rgba() with CSS vars, px with tokens                                                  |
| `src/renderer/src/components/neon/CircuitPipeline.tsx` | Modify | Replace rgba() + magic px with tokens                                                         |
| `src/renderer/src/components/neon/StatusBar.tsx`       | Modify | Add `accent` prop, replace hardcoded purple + rgba()                                          |
| `src/renderer/src/components/neon/ScanlineOverlay.tsx` | Modify | Fix type hack, add `aria-hidden`                                                              |
| `src/renderer/src/components/neon/NeonTooltip.tsx`     | Modify | Add keyboard support + `aria-describedby`                                                     |
| `src/renderer/src/components/neon/ParticleField.tsx`   | Modify | Extract magic numbers to named constants                                                      |
| Tests (13 files in `__tests__/`)                       | Modify | Update tests for new props/behavior                                                           |

---

## Token Mapping Reference

Use this mapping when replacing hardcoded values in all tasks below:

### Spacing (inline `style` → `tokens.space`)

| Hardcoded | Token             | Semantic                                  |
| --------- | ----------------- | ----------------------------------------- |
| `'2px'`   | —                 | Keep as-is (sub-grid, borders)            |
| `'3px'`   | —                 | Keep as-is (bar gap)                      |
| `'4px'`   | `tokens.space[1]` | Tight gap                                 |
| `'6px'`   | `tokens.space[1]` | Use 4px (round down to grid)              |
| `'8px'`   | `tokens.space[2]` | Standard gap                              |
| `'10px'`  | `tokens.space[2]` | Use 8px (round down) or `tokens.space[3]` |
| `'12px'`  | `tokens.space[3]` | Standard padding                          |
| `'14px'`  | `tokens.space[3]` | Use 12px (round down to grid)             |
| `'16px'`  | `tokens.space[4]` | Section padding                           |
| `'20px'`  | `tokens.space[5]` | Large spacing                             |
| `'24px'`  | `tokens.space[6]` | Section gap                               |
| `'32px'`  | `tokens.space[8]` | Connector width                           |

### Font Sizes (inline `style` → `tokens.size`)

| Hardcoded         | Token                    | Usage                                     |
| ----------------- | ------------------------ | ----------------------------------------- |
| `'8px'`/`'9px'`   | `tokens.size.xs` (11px)  | Labels — note: rounds UP, visually larger |
| `'10px'`          | `tokens.size.xs` (11px)  | Badge text, suffixes                      |
| `'11px'`          | `tokens.size.xs`         | Fine print, timestamps                    |
| `'12px'`          | `tokens.size.sm`         | Secondary text                            |
| `'13px'`          | `tokens.size.md`         | Body                                      |
| `'14px'`          | `tokens.size.lg`         | Emphasis                                  |
| `'16px'`          | `tokens.size.xl`         | Section titles                            |
| `'18px'`/`'20px'` | `tokens.size.xxl`        | Icons, counts                             |
| `'22px'`          | `tokens.size.xxl` (20px) | Stat values — rounds DOWN 2px             |

### Colors (hardcoded → CSS var)

| Hardcoded                      | New CSS Variable                                           | Used for                            |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| `'#fff'`                       | `tokens.neon.text` → `var(--neon-text)`                    | High-emphasis text on neon surfaces |
| `'rgba(255, 255, 255, 0.6)'`   | `tokens.neon.textMuted` → `var(--neon-text-muted)`         | Event labels, secondary content     |
| `'rgba(255, 255, 255, 0.3)'`   | `tokens.neon.textDim` → `var(--neon-text-dim)`             | Timestamps, placeholders, arrows    |
| `'rgba(255, 255, 255, 0.06)'`  | `tokens.neon.surfaceDim` → `var(--neon-surface-dim)`       | Track backgrounds, subtle fills     |
| `'rgba(255, 255, 255, 0.1)'`   | `tokens.neon.surfaceSubtle` → `var(--neon-surface-subtle)` | Active-state inset highlights       |
| `'rgba(10, 0, 21, 0.4)'`–`0.6` | `tokens.neon.surfaceDeep` → `var(--neon-surface-deep)`     | Gradient endpoints                  |

---

## Task 1: Add Neon Semantic CSS Variables

**Files:**

- Modify: `src/renderer/src/assets/neon.css` (add vars in `:root` block)
- Modify: `src/renderer/src/design-system/tokens.ts` (add to `neon` object)

- [ ] **Step 1: Add CSS variables to neon.css**

Find the `:root` block in `neon.css` where `--neon-cyan`, `--neon-pink`, etc. are defined. Add these semantic variables at the end of that block:

```css
/* Semantic text/surface colors for neon components */
--neon-text: #ffffff;
--neon-text-muted: rgba(255, 255, 255, 0.6);
--neon-text-dim: rgba(255, 255, 255, 0.3);
--neon-surface-dim: rgba(255, 255, 255, 0.06);
--neon-surface-subtle: rgba(255, 255, 255, 0.1);
--neon-surface-deep: rgba(10, 0, 21, 0.5);
```

- [ ] **Step 2: Add light theme overrides**

Find the light theme override section in `neon.css` (where `--neon-cyan` gets lighter values). Add:

```css
--neon-text: #1a1a2e;
--neon-text-muted: rgba(26, 26, 46, 0.6);
--neon-text-dim: rgba(26, 26, 46, 0.3);
--neon-surface-dim: rgba(0, 0, 0, 0.04);
--neon-surface-subtle: rgba(0, 0, 0, 0.08);
--neon-surface-deep: rgba(200, 200, 220, 0.3);
```

- [ ] **Step 3: Add tokens to tokens.ts**

In `src/renderer/src/design-system/tokens.ts`, add to the `neon` object after the existing properties:

```ts
    text: 'var(--neon-text)',
    textMuted: 'var(--neon-text-muted)',
    textDim: 'var(--neon-text-dim)',
    surfaceDim: 'var(--neon-surface-dim)',
    surfaceSubtle: 'var(--neon-surface-subtle)',
    surfaceDeep: 'var(--neon-surface-deep)',
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/ryan/projects/BDE && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (new properties are additive)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/neon.css src/renderer/src/design-system/tokens.ts
git commit -m "feat: add neon semantic text/surface CSS variables to design system"
```

---

## Task 2: Remediate NeonCard

**Files:**

- Modify: `src/renderer/src/components/neon/NeonCard.tsx`
- Modify: `src/renderer/src/components/neon/__tests__/NeonCard.test.tsx`

- [ ] **Step 1: Write failing test for token usage**

Add to `__tests__/NeonCard.test.tsx`:

```tsx
it('uses token-based spacing for header', () => {
  const { container } = render(
    <NeonCard accent="cyan" title="Test">
      Body
    </NeonCard>
  )
  const header = container.querySelector('.neon-card > div:first-child') as HTMLElement
  // tokens.space[3] = 12px, tokens.space[2] = 8px
  expect(header.style.padding).toBe('8px 12px')
  expect(header.style.gap).toBe('8px')
})

it('uses semantic neon surface for gradient endpoint', () => {
  const { container } = render(<NeonCard accent="cyan">Body</NeonCard>)
  const card = container.firstChild as HTMLElement
  expect(card.style.background).toContain('var(--neon-surface-deep)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonCard.test.tsx 2>&1 | tail -20`
Expected: FAIL — header padding is `10px 14px`, gap is `6px`

- [ ] **Step 3: Update NeonCard.tsx**

Replace the component with token-based values:

```tsx
import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonCardProps {
  accent?: NeonAccent
  title?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

export function NeonCard({
  accent = 'purple',
  title,
  icon,
  action,
  children,
  className = '',
  style
}: NeonCardProps) {
  const cardStyle: React.CSSProperties = {
    '--card-accent': neonVar(accent, 'color'),
    '--card-accent-border': neonVar(accent, 'border'),
    '--card-accent-surface': neonVar(accent, 'surface'),
    '--card-accent-glow': neonVar(accent, 'glow'),
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.neon.surfaceDeep})`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    borderRadius: tokens.radius.xl,
    backdropFilter: 'var(--neon-glass-blur)',
    WebkitBackdropFilter: 'var(--neon-glass-blur)',
    boxShadow: `var(--neon-glass-shadow), var(--neon-glass-edge)`,
    padding: title ? '0' : tokens.space[3],
    overflow: 'hidden',
    transition: `box-shadow ${tokens.transition.base}, transform ${tokens.transition.base}`,
    ...style
  } as React.CSSProperties

  return (
    <div className={`neon-card ${className}`.trim()} style={cardStyle}>
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            padding: `${tokens.space[2]} ${tokens.space[3]}`,
            borderBottom: `1px solid ${neonVar(accent, 'border')}`
          }}
        >
          {icon && <span style={{ color: neonVar(accent, 'color'), display: 'flex' }}>{icon}</span>}
          <span
            style={{
              color: neonVar(accent, 'color'),
              fontSize: tokens.size.xs,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: 600
            }}
          >
            {title}
          </span>
          {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
        </div>
      )}
      <div style={{ padding: title ? tokens.space[3] : '0' }}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonCard.test.tsx 2>&1 | tail -20`
Expected: All PASS. Update any assertions in existing tests that check for old hardcoded values (e.g., old border-radius `14px` → now `12px` from `tokens.radius.xl`).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/NeonCard.tsx src/renderer/src/components/neon/__tests__/NeonCard.test.tsx
git commit -m "refactor: NeonCard uses design tokens for spacing, sizing, and colors"
```

---

## Task 3: Remediate StatCounter

**Files:**

- Modify: `src/renderer/src/components/neon/StatCounter.tsx`
- Modify: `src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `__tests__/StatCounter.test.tsx`:

```tsx
it('uses neon text token for value color', () => {
  const { container } = render(<StatCounter label="Tasks" value={42} accent="cyan" />)
  const valueEl = container.querySelector('span') as HTMLElement
  // Find the span with the large value
  const spans = container.querySelectorAll('span')
  const valueSpan = Array.from(spans).find((s) => s.textContent === '42') as HTMLElement
  expect(valueSpan.style.color).toBe('var(--neon-text)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/StatCounter.test.tsx 2>&1 | tail -20`
Expected: FAIL — color is `#fff`

- [ ] **Step 3: Update StatCounter.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface StatCounterProps {
  label: string
  value: number | string
  accent: NeonAccent
  suffix?: string
  trend?: {
    direction: 'up' | 'down'
    label: string
  }
  icon?: React.ReactNode
}

export function StatCounter({ label, value, accent, suffix, trend, icon }: StatCounterProps) {
  return (
    <div
      style={{
        background: neonVar(accent, 'surface'),
        border: `1px solid ${neonVar(accent, 'border')}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space[3]
      }}
    >
      <div
        data-role="stat-label"
        style={{
          color: neonVar(accent, 'color'),
          fontSize: tokens.size.xs,
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[1]
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: tokens.space[1],
          marginTop: tokens.space[1]
        }}
      >
        <span
          style={{
            color: tokens.neon.text,
            fontSize: tokens.size.xxl,
            fontWeight: 800,
            textShadow: neonVar(accent, 'glow')
          }}
        >
          {value}
        </span>
        {suffix && (
          <span
            style={{
              color: neonVar(accent, 'color'),
              fontSize: tokens.size.xs,
              opacity: 0.6
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {trend && (
        <div
          style={{
            color: trend.direction === 'down' ? 'var(--neon-cyan)' : 'var(--neon-red)',
            fontSize: tokens.size.xs,
            marginTop: tokens.space[1],
            opacity: 0.7
          }}
        >
          {trend.direction === 'down' ? '↓' : '↑'} {trend.label}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/StatCounter.test.tsx 2>&1 | tail -20`
Expected: All PASS. Update existing assertions that check for old px values.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/StatCounter.tsx src/renderer/src/components/neon/__tests__/StatCounter.test.tsx
git commit -m "refactor: StatCounter uses design tokens for all spacing and sizing"
```

---

## Task 4: Remediate NeonBadge

**Files:**

- Modify: `src/renderer/src/components/neon/NeonBadge.tsx`

- [ ] **Step 1: Update NeonBadge.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonBadgeProps {
  accent: NeonAccent
  label: string
  pulse?: boolean
}

export function NeonBadge({ accent, label, pulse = false }: NeonBadgeProps) {
  return (
    <span
      className={pulse ? 'neon-pulse' : ''}
      style={
        {
          color: neonVar(accent, 'color'),
          background: neonVar(accent, 'surface'),
          border: `1px solid ${neonVar(accent, 'border')}`,
          borderRadius: tokens.radius.full,
          padding: `2px ${tokens.space[2]}`,
          fontSize: tokens.size.xs,
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: tokens.space[1],
          '--pulse-shadow-min': `0 0 6px ${neonVar(accent, 'border')}`,
          '--pulse-shadow-max': `0 0 16px ${neonVar(accent, 'border')}`,
          animation: pulse ? 'neon-pulse 3s ease-in-out infinite' : undefined
        } as React.CSSProperties
      }
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx 2>&1 | tail -20`
Expected: PASS. Update assertions checking old `10px` font size → `11px`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/NeonBadge.tsx src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx
git commit -m "refactor: NeonBadge uses design tokens for spacing and sizing"
```

---

## Task 5: Remediate ActivityFeed

**Files:**

- Modify: `src/renderer/src/components/neon/ActivityFeed.tsx`
- Modify: `src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `__tests__/ActivityFeed.test.tsx`:

```tsx
it('uses neon text tokens instead of hardcoded rgba', () => {
  const events = [
    { id: '1', label: 'Deploy', accent: 'cyan' as const, timestamp: Date.now() - 5000 }
  ]
  const { container } = render(<ActivityFeed events={events} />)
  const label = container.querySelector('span') as HTMLElement
  expect(label.style.color).toBe('var(--neon-text-muted)')
})

it('uses neon text dim for empty state', () => {
  const { container } = render(<ActivityFeed events={[]} />)
  const empty = container.firstChild as HTMLElement
  expect(empty.style.color).toBe('var(--neon-text-dim)')
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx 2>&1 | tail -20`
Expected: FAIL — color is `rgba(255, 255, 255, 0.6)`

- [ ] **Step 3: Update ActivityFeed.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface FeedEvent {
  id: string
  label: string
  accent: NeonAccent
  timestamp: number
}

interface ActivityFeedProps {
  events: FeedEvent[]
  maxItems?: number
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ActivityFeed({ events, maxItems }: ActivityFeedProps) {
  const displayed = maxItems ? events.slice(0, maxItems) : events

  if (displayed.length === 0) {
    return (
      <div
        style={{
          color: tokens.neon.textDim,
          fontSize: tokens.size.xs,
          padding: `${tokens.space[3]} 0`
        }}
      >
        No recent activity
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
      {displayed.map((event) => (
        <div
          key={event.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1]
          }}
        >
          <div
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: neonVar(event.accent, 'color'),
              boxShadow: neonVar(event.accent, 'glow'),
              flexShrink: 0
            }}
          />
          <span
            style={{
              color: tokens.neon.textMuted,
              fontSize: tokens.size.xs,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {event.label}
          </span>
          <span
            style={{
              color: tokens.neon.textDim,
              fontSize: tokens.size.xs,
              flexShrink: 0
            }}
          >
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/ActivityFeed.tsx src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx
git commit -m "refactor: ActivityFeed uses neon semantic tokens, removes hardcoded rgba"
```

---

## Task 6: Remediate NeonProgress

**Files:**

- Modify: `src/renderer/src/components/neon/NeonProgress.tsx`

- [ ] **Step 1: Update NeonProgress.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonProgressProps {
  value: number
  accent: NeonAccent
  label?: string
}

export function NeonProgress({ value, accent, label }: NeonProgressProps) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div>
      {label && (
        <div
          style={{
            color: neonVar(accent, 'color'),
            fontSize: tokens.size.xs,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: tokens.space[1],
            fontWeight: 600
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          height: '4px',
          background: tokens.neon.surfaceDim,
          borderRadius: '2px',
          overflow: 'hidden'
        }}
      >
        <div
          data-role="progress-fill"
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: `linear-gradient(90deg, ${neonVar(accent, 'color')}, var(--neon-blue))`,
            borderRadius: '2px',
            boxShadow: neonVar(accent, 'glow'),
            transition: 'width 300ms ease'
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/NeonProgress.tsx
git commit -m "refactor: NeonProgress uses design tokens for sizing and surface colors"
```

---

## Task 7: Remediate PipelineFlow

**Files:**

- Modify: `src/renderer/src/components/neon/PipelineFlow.tsx`

- [ ] **Step 1: Update PipelineFlow.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface PipelineStage {
  label: string
  count: number
  accent: NeonAccent
}

interface PipelineFlowProps {
  stages: PipelineStage[]
}

export function PipelineFlow({ stages }: PipelineFlowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1], flexWrap: 'wrap' }}>
      {stages.map((stage, i) => (
        <div
          key={stage.label}
          style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}
        >
          <div
            style={{
              background: neonVar(stage.accent, 'surface'),
              border: `1px solid ${neonVar(stage.accent, 'border')}`,
              borderRadius: tokens.radius.md,
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              color: neonVar(stage.accent, 'color'),
              fontSize: tokens.size.xs,
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            {stage.label}: {stage.count}
          </div>
          {i < stages.length - 1 && (
            <span
              data-role="pipeline-arrow"
              style={{
                color: tokens.neon.textDim,
                fontSize: tokens.size.lg
              }}
            >
              →
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/PipelineFlow.tsx
git commit -m "refactor: PipelineFlow uses design tokens for spacing, sizing, and colors"
```

---

## Task 8: Remediate MiniChart

**Files:**

- Modify: `src/renderer/src/components/neon/MiniChart.tsx`

- [ ] **Step 1: Update MiniChart.tsx**

```tsx
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface ChartBar {
  value: number
  accent?: NeonAccent
  label?: string
}

interface MiniChartProps {
  data: ChartBar[]
  height?: number
}

export function MiniChart({ data, height = 80 }: MiniChartProps) {
  if (data.length === 0) {
    return (
      <div
        style={{
          color: tokens.neon.textDim,
          fontSize: tokens.size.xs,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        No data
      </div>
    )
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1)

  return (
    <div
      style={{
        display: 'flex',
        gap: '3px',
        alignItems: 'flex-end',
        height
      }}
    >
      {data.map((bar, i) => {
        const accent = bar.accent ?? 'purple'
        const pct = Math.round((bar.value / maxValue) * 100)
        return (
          <div
            key={i}
            data-role="chart-bar"
            title={bar.label ?? `${bar.value}`}
            style={{
              flex: 1,
              height: `${pct}%`,
              background: `linear-gradient(to top, ${neonVar(accent, 'color')}, transparent)`,
              borderRadius: '3px 3px 0 0',
              minHeight: '2px',
              transition: 'height 300ms ease'
            }}
          />
        )
      })}
    </div>
  )
}
```

Note: `3px` gap and `2px` minHeight are sub-grid pixel values — keep as-is.

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/MiniChart.test.tsx 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/MiniChart.tsx
git commit -m "refactor: MiniChart uses design tokens for text colors and sizing"
```

---

## Task 9: Remediate GlassPanel

**Files:**

- Modify: `src/renderer/src/components/neon/GlassPanel.tsx`

- [ ] **Step 1: Update GlassPanel.tsx**

Replace hardcoded `rgba()` fallbacks with neon tokens:

```tsx
import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface GlassPanelProps {
  accent?: NeonAccent
  blur?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

const BLUR_MAP = {
  sm: 'blur(8px) saturate(180%)',
  md: 'blur(16px) saturate(180%)',
  lg: 'blur(40px) saturate(180%)'
}

export function GlassPanel({
  accent,
  blur = 'md',
  children,
  className = '',
  style
}: GlassPanelProps) {
  const borderVal = accent ? neonVar(accent, 'border') : tokens.neon.surfaceDim
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={{
        backdropFilter: BLUR_MAP[blur],
        WebkitBackdropFilter: BLUR_MAP[blur],
        background: accent
          ? `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.neon.surfaceDeep})`
          : tokens.neon.surfaceDeep,
        border: `1px solid ${borderVal}`,
        borderRadius: tokens.radius.xl,
        boxShadow: 'var(--neon-glass-shadow), var(--neon-glass-edge)',
        ...style
      }}
    >
      {children}
    </div>
  )
}
```

Note: removed duplicate `borderColor` property that was redundant with `border`.

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx 2>&1 | tail -20`
Expected: PASS. May need to update assertion for `borderRadius` (old `14px` → `12px`).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/GlassPanel.tsx src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx
git commit -m "refactor: GlassPanel uses design tokens, removes duplicate border property"
```

---

## Task 10: Remediate CircuitPipeline

**Files:**

- Modify: `src/renderer/src/components/neon/CircuitPipeline.tsx`

- [ ] **Step 1: Update CircuitPipeline.tsx**

This component is large. Only replace the hardcoded values — don't restructure. Key changes:

1. Add `import { tokens } from '../../design-system/tokens';`
2. Replace `borderRadius: '12px'` → `borderRadius: tokens.radius.xl`
3. Replace `gap: '24px'` → `gap: tokens.space[6]`
4. Replace `gap: '16px'` → `gap: tokens.space[4]`
5. Replace `padding: compact ? '12px' : '16px'` → `padding: compact ? tokens.space[3] : tokens.space[4]`
6. Replace `gap: '4px'` → `gap: tokens.space[1]`
7. Replace `fontSize: compact ? '8px' : '9px'` → `fontSize: tokens.size.xs`
8. Replace `fontSize: compact ? '16px' : '20px'` → `fontSize: compact ? tokens.size.xl : tokens.size.xxl`
9. Replace `fontSize: compact ? '14px' : '18px'` → `fontSize: compact ? tokens.size.lg : tokens.size.xxl`
10. Replace `rgba(255, 255, 255, 0.1)` → `${tokens.neon.surfaceSubtle}` (active node inset highlight)
11. Replace `rgba(255, 255, 255, 0.05)` → `${tokens.neon.surfaceDim}` (inactive node inset highlight)
12. Replace `rgba(10, 0, 21, 0.4)` → `${tokens.neon.surfaceDeep}`

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/CircuitPipeline.test.tsx 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/CircuitPipeline.tsx
git commit -m "refactor: CircuitPipeline uses design tokens for spacing, sizing, and surfaces"
```

---

## Task 11: Remediate StatusBar — Add Accent Prop

**Files:**

- Modify: `src/renderer/src/components/neon/StatusBar.tsx`
- Modify: `src/renderer/src/components/neon/__tests__/StatusBar.test.tsx`

- [ ] **Step 1: Write failing test for accent prop**

Add to `__tests__/StatusBar.test.tsx`:

```tsx
it('accepts accent prop for title color', () => {
  const { container } = render(<StatusBar title="Test" status="ok" accent="cyan" />)
  const titleSpan = screen.getByText('Test')
  expect(titleSpan.style.color).toBe('var(--neon-cyan)')
})

it('defaults accent to purple', () => {
  render(<StatusBar title="Test" status="ok" />)
  const titleSpan = screen.getByText('Test')
  expect(titleSpan.style.color).toBe('var(--neon-purple)')
})

it('uses neon border token for bottom border', () => {
  const { container } = render(<StatusBar title="Test" status="ok" accent="cyan" />)
  const bar = container.firstChild as HTMLElement
  expect(bar.style.borderBottom).toContain('var(--neon-cyan-border)')
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/StatusBar.test.tsx 2>&1 | tail -20`
Expected: FAIL — no `accent` prop exists

- [ ] **Step 3: Update StatusBar.tsx**

```tsx
import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface StatusBarProps {
  title: string
  status: 'ok' | 'error' | 'warning'
  accent?: NeonAccent
  children?: ReactNode
}

const STATUS_COLORS = {
  ok: 'var(--neon-cyan)',
  error: 'var(--neon-red)',
  warning: 'var(--neon-orange)'
} as const

const STATUS_GLOWS = {
  ok: '0 0 8px var(--neon-cyan)',
  error: '0 0 8px var(--neon-red)',
  warning: '0 0 8px var(--neon-orange)'
} as const

export function StatusBar({ title, status, accent = 'purple', children }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]} ${tokens.space[4]}`,
        borderBottom: `1px solid ${neonVar(accent, 'border')}`
      }}
    >
      <div
        data-role="status-dot"
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: STATUS_COLORS[status],
          boxShadow: STATUS_GLOWS[status],
          animation: 'neon-breathe 2s ease-in-out infinite'
        }}
      />
      <span
        style={{
          color: neonVar(accent, 'color'),
          fontSize: tokens.size.xs,
          textTransform: 'uppercase',
          letterSpacing: '2px',
          fontWeight: 600
        }}
      >
        {title}
      </span>
      {children && (
        <span
          style={{
            marginLeft: 'auto',
            color: tokens.neon.textDim,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.code
          }}
        >
          {children}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update existing tests**

The existing test `'uses red dot for error status'` should still pass. Update any assertions checking `'11px'` font sizes or old `'8px 16px'` padding values.

- [ ] **Step 5: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/StatusBar.test.tsx 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 6: Update StatusBar consumers**

Search for `<StatusBar` usage across the codebase. If any consumer passes unexpected props, update them. The `accent` prop is optional with a default, so existing call sites won't break.

Run: `cd /Users/ryan/projects/BDE && grep -rn '<StatusBar' src/renderer/src/ --include='*.tsx' | head -20`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/neon/StatusBar.tsx src/renderer/src/components/neon/__tests__/StatusBar.test.tsx
git commit -m "feat: StatusBar accepts accent prop, uses design tokens for spacing and colors"
```

---

## Task 12: Fix ScanlineOverlay Type Hack

**Files:**

- Modify: `src/renderer/src/components/neon/ScanlineOverlay.tsx`

- [ ] **Step 1: Update ScanlineOverlay.tsx**

Fix the `as unknown as number` type hack by making `opacity` a CSS string when using a var:

```tsx
interface ScanlineOverlayProps {
  opacity?: number
}

export function ScanlineOverlay({ opacity }: ScanlineOverlayProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.03) 2px, rgba(255, 255, 255, 0.03) 4px)',
        backgroundSize: '100% 200px',
        opacity: opacity ?? undefined,
        animation: 'neon-scanline var(--neon-scanline-speed) linear infinite',
        zIndex: 0
      }}
      className="neon-scanline-overlay"
    />
  )
}
```

Then add to `neon.css` near the scanline keyframe:

```css
.neon-scanline-overlay {
  opacity: var(--neon-scanline-opacity);
}
```

This way: when `opacity` prop is passed it's a real number that overrides the CSS, and when it's `undefined` the CSS class provides the fallback. No type hack needed.

Note: the scanline gradient `rgba(255, 255, 255, 0.03)` is kept as-is — it's a unique decorative value (0.03 opacity) that doesn't map to any semantic token. Replacing it with `surfaceDim` (0.06) would double the scanline visibility.

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx 2>&1 | tail -20`
Expected: PASS. Note: `aria-hidden="true"` was already present.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/ScanlineOverlay.tsx src/renderer/src/assets/neon.css
git commit -m "fix: ScanlineOverlay removes type hack, uses CSS class for default opacity"
```

---

## Task 13: Fix NeonTooltip Accessibility

**Files:**

- Modify: `src/renderer/src/components/neon/NeonTooltip.tsx`
- Modify: `src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx`

- [ ] **Step 1: Write failing test for keyboard accessibility**

Add to `__tests__/NeonTooltip.test.tsx`:

```tsx
it('shows tooltip on focus and hides on blur', async () => {
  const { container } = render(
    <NeonTooltip label="Help text">
      <button>Hover me</button>
    </NeonTooltip>
  )
  const trigger = container.firstChild as HTMLElement

  // Focus should trigger tooltip
  fireEvent.focus(trigger)
  await waitFor(
    () => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    },
    { timeout: 1000 }
  )

  // Blur should hide tooltip
  fireEvent.blur(trigger)
  await waitFor(() => {
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

it('links tooltip to trigger via aria-describedby', async () => {
  const { container } = render(
    <NeonTooltip label="Help text">
      <button>Hover me</button>
    </NeonTooltip>
  )
  const trigger = container.firstChild as HTMLElement
  fireEvent.mouseEnter(trigger)
  await waitFor(
    () => {
      const tooltip = screen.getByRole('tooltip')
      expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id)
    },
    { timeout: 1000 }
  )
})

it('hides tooltip on Escape key', async () => {
  const { container } = render(
    <NeonTooltip label="Help text">
      <button>Hover me</button>
    </NeonTooltip>
  )
  const trigger = container.firstChild as HTMLElement
  fireEvent.mouseEnter(trigger)
  await waitFor(
    () => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    },
    { timeout: 1000 }
  )

  fireEvent.keyDown(trigger, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx 2>&1 | tail -20`
Expected: FAIL — no focus/blur handlers, no aria-describedby

- [ ] **Step 3: Update NeonTooltip.tsx**

```tsx
import { useState, useRef, useCallback, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface NeonTooltipProps {
  label: string
  shortcut?: string
  delay?: number
  children: ReactNode
}

export function NeonTooltip({ label, shortcut, delay = 300, children }: NeonTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.top + rect.height / 2 - 14,
        left: rect.right + 8
      })
    }
  }, [])

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      updatePosition()
      setVisible(true)
    }, delay)
  }, [delay, updatePosition])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    },
    [hide]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleKeyDown}
        aria-describedby={visible ? tooltipId : undefined}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            id={tooltipId}
            className="neon-tooltip"
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {label}
            {shortcut && <span className="neon-tooltip__shortcut">{shortcut}</span>}
          </div>,
          document.body
        )}
    </>
  )
}
```

Key changes:

- `useId()` generates stable tooltip ID
- `onFocus`/`onBlur` mirror mouse enter/leave
- `onKeyDown` handles Escape
- `aria-describedby` links trigger → tooltip when visible

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/NeonTooltip.tsx src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx
git commit -m "fix: NeonTooltip adds keyboard support, aria-describedby, and Escape dismiss"
```

---

## Task 14: Remediate ParticleField — Named Constants

**Files:**

- Modify: `src/renderer/src/components/neon/ParticleField.tsx`

- [ ] **Step 1: Update ParticleField.tsx**

Extract magic numbers to named constants:

```tsx
import { useMemo } from 'react'
import { NEON_ACCENTS, neonVar } from './types'

interface ParticleFieldProps {
  density?: number
}

const DRIFT_ANIMATIONS = ['neon-particle-drift-1', 'neon-particle-drift-2', 'neon-particle-drift-3']
const DURATION_BASE_S = 20
const DURATION_RANGE_S = 20
const DELAY_RANGE_S = -30
const SIZE_MIN_PX = 2
const SIZE_RANGE_PX = 2
const TOP_OFFSET_PCT = 20
const TOP_RANGE_PCT = 80

export function ParticleField({ density = 18 }: ParticleFieldProps) {
  const particles = useMemo(() => {
    return Array.from({ length: density }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${TOP_OFFSET_PCT + Math.random() * TOP_RANGE_PCT}%`,
      accent: NEON_ACCENTS[i % NEON_ACCENTS.length],
      duration: `${DURATION_BASE_S + Math.random() * DURATION_RANGE_S}s`,
      delay: `${Math.random() * DELAY_RANGE_S}s`,
      animation: DRIFT_ANIMATIONS[i % DRIFT_ANIMATIONS.length],
      size: `${SIZE_MIN_PX + Math.random() * SIZE_RANGE_PX}px`
    }))
  }, [density])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0
      }}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          data-role="particle"
          style={{
            position: 'absolute',
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: neonVar(p.accent, 'color'),
            boxShadow: neonVar(p.accent, 'glow'),
            animation: `${p.animation} ${p.duration} ease-in-out ${p.delay} infinite`,
            willChange: 'transform'
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/__tests__/ParticleField.test.tsx 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/neon/ParticleField.tsx
git commit -m "refactor: ParticleField extracts magic numbers to named constants"
```

---

## Task 15: Full Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full neon test suite**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/neon/ 2>&1 | tail -30`
Expected: All 13 test files pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/ryan/projects/BDE && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Run full test suite with coverage**

Run: `cd /Users/ryan/projects/BDE && npm run test:coverage 2>&1 | tail -30`
Expected: All tests pass, coverage thresholds met (72% stmts, 66% branches, 70% functions, 74% lines)

- [ ] **Step 4: Final commit**

If any test fixes were needed during verification:

```bash
git add -u
git commit -m "fix: update test assertions for design token migration"
```
