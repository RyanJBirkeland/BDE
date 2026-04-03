# Neon Ops Deck UI Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BDE's dashboard into a neon cyberpunk "Ops Deck" command center with a reusable V2 primitive component system.

**Architecture:** V2 design tokens (CSS custom properties + TS exports) extend the existing system without breaking changes. 11 primitive components in `src/renderer/src/components/neon/` compose all visual treatments. Dashboard rewritten as 3-column Ops Deck layout. Two new IPC channels provide agent completions/hour and recent events data.

**Tech Stack:** React, TypeScript, CSS custom properties, Framer Motion, Zustand, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-24-neon-ops-deck-ui-overhaul-design.md`

---

## File Map

### New Files

| File                                                                        | Responsibility                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/renderer/src/assets/neon.css`                                          | V2 neon CSS tokens, keyframe animations, utility classes             |
| `src/renderer/src/components/neon/types.ts`                                 | Shared `NeonAccent` type + accent-to-CSS-var mapping                 |
| `src/renderer/src/components/neon/NeonCard.tsx`                             | Glass card with neon-tinted border                                   |
| `src/renderer/src/components/neon/StatCounter.tsx`                          | Big number + label + trend indicator                                 |
| `src/renderer/src/components/neon/NeonBadge.tsx`                            | Status pill with glow                                                |
| `src/renderer/src/components/neon/GlassPanel.tsx`                           | Full glass surface with configurable blur                            |
| `src/renderer/src/components/neon/ActivityFeed.tsx`                         | Scrolling event list with colored dot indicators                     |
| `src/renderer/src/components/neon/NeonProgress.tsx`                         | Gradient progress bar with glow                                      |
| `src/renderer/src/components/neon/PipelineFlow.tsx`                         | Horizontal status pipeline with animated arrows                      |
| `src/renderer/src/components/neon/MiniChart.tsx`                            | Vertical bar chart with neon gradients                               |
| `src/renderer/src/components/neon/StatusBar.tsx`                            | Top bar with system indicator dot + title                            |
| `src/renderer/src/components/neon/ScanlineOverlay.tsx`                      | Animated scanline texture overlay                                    |
| `src/renderer/src/components/neon/ParticleField.tsx`                        | Floating particle background (CSS-only)                              |
| `src/renderer/src/components/neon/index.ts`                                 | Barrel export for all primitives                                     |
| `src/renderer/src/components/neon/__tests__/NeonCard.test.tsx`              | Tests for NeonCard                                                   |
| `src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`           | Tests for StatCounter                                                |
| `src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx`             | Tests for NeonBadge                                                  |
| `src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx`            | Tests for GlassPanel                                                 |
| `src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`          | Tests for ActivityFeed                                               |
| `src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx`          | Tests for NeonProgress                                               |
| `src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx`          | Tests for PipelineFlow                                               |
| `src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`             | Tests for MiniChart                                                  |
| `src/renderer/src/components/neon/__tests__/StatusBar.test.tsx`             | Tests for StatusBar                                                  |
| `src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx`       | Tests for ScanlineOverlay                                            |
| `src/renderer/src/components/neon/__tests__/ParticleField.test.tsx`         | Tests for ParticleField                                              |
| `src/main/handlers/dashboard-handlers.ts`                                   | IPC handlers for `agent:completionsPerHour` and `agent:recentEvents` |
| `src/main/handlers/__tests__/dashboard-handlers.test.ts`                    | Tests for dashboard IPC handlers                                     |
| `src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx` | Tests for rewritten dashboard                                        |

### Modified Files

| File                                          | Change                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `src/renderer/src/design-system/tokens.ts`    | Add `neon` namespace with accent colors + variants                    |
| `src/renderer/src/lib/motion.ts`              | Add neon animation variants (neonPulse timing configs)                |
| `src/shared/ipc-channels.ts`                  | Add `agent:completionsPerHour` and `agent:recentEvents` channel types |
| `src/preload/index.ts`                        | Expose new IPC channels on `window.api`                               |
| `src/main/index.ts`                           | Register `dashboardHandlers`                                          |
| `src/renderer/src/views/DashboardView.tsx`    | Rewrite with Ops Deck layout using V2 primitives                      |
| `src/renderer/src/App.tsx` or main CSS import | Import `neon.css`                                                     |

---

## Task 1: V2 Neon CSS Tokens & Keyframe Animations

**Files:**

- Create: `src/renderer/src/assets/neon.css`
- No test file (CSS-only, validated visually + by component tests later)

- [ ] **Step 1: Create the neon CSS file with token variables**

```css
/* src/renderer/src/assets/neon.css */
/* ═══════════════════════════════════════════════════════
   V2 Neon Design System — CSS Tokens & Animations
   ═══════════════════════════════════════════════════════ */

/* ── Neon Accent Palette ── */
:root {
  /* Cyan — agents, success, live states */
  --neon-cyan: #00ffc8;
  --neon-cyan-glow: 0 0 12px rgba(0, 255, 200, 0.5);
  --neon-cyan-surface: rgba(0, 255, 200, 0.08);
  --neon-cyan-border: rgba(0, 255, 200, 0.25);

  /* Pink — tasks, counts, highlights */
  --neon-pink: #ff64c8;
  --neon-pink-glow: 0 0 12px rgba(255, 100, 200, 0.5);
  --neon-pink-surface: rgba(255, 100, 200, 0.08);
  --neon-pink-border: rgba(255, 100, 200, 0.25);

  /* Blue — PRs, links, info */
  --neon-blue: #64c8ff;
  --neon-blue-glow: 0 0 12px rgba(100, 200, 255, 0.5);
  --neon-blue-surface: rgba(100, 200, 255, 0.08);
  --neon-blue-border: rgba(100, 200, 255, 0.25);

  /* Purple — headers, borders, structural */
  --neon-purple: #bf5af2;
  --neon-purple-glow: 0 0 12px rgba(191, 90, 242, 0.5);
  --neon-purple-surface: rgba(191, 90, 242, 0.08);
  --neon-purple-border: rgba(191, 90, 242, 0.25);

  /* Orange — cost, warnings */
  --neon-orange: #ffb432;
  --neon-orange-glow: 0 0 12px rgba(255, 180, 50, 0.5);
  --neon-orange-surface: rgba(255, 180, 50, 0.08);
  --neon-orange-border: rgba(255, 180, 50, 0.25);

  /* Red — errors, failures, danger */
  --neon-red: #ff3264;
  --neon-red-glow: 0 0 12px rgba(255, 50, 100, 0.5);
  --neon-red-surface: rgba(255, 50, 100, 0.08);
  --neon-red-border: rgba(255, 50, 100, 0.25);

  /* ── Atmosphere ── */
  --neon-bg: #0a0015;
  --neon-bg-gradient:
    radial-gradient(ellipse at 30% 20%, rgba(138, 43, 226, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(0, 200, 255, 0.08) 0%, transparent 50%);

  /* ── Glass ── */
  --neon-glass-blur: blur(16px) saturate(180%);
  --neon-glass-edge: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --neon-glass-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);

  /* ── Scanline ── */
  --neon-scanline-opacity: 0.02;
  --neon-scanline-speed: 30s;

  /* ── Particle ── */
  --neon-particle-count: 18;
  --neon-particle-size: 3px;
}

/* ── Light theme overrides ── */
html.theme-light {
  --neon-cyan: #00b894;
  --neon-cyan-glow: 0 0 8px rgba(0, 184, 148, 0.3);
  --neon-cyan-surface: rgba(0, 184, 148, 0.08);
  --neon-cyan-border: rgba(0, 184, 148, 0.2);

  --neon-pink: #e84393;
  --neon-pink-glow: 0 0 8px rgba(232, 67, 147, 0.3);
  --neon-pink-surface: rgba(232, 67, 147, 0.08);
  --neon-pink-border: rgba(232, 67, 147, 0.2);

  --neon-blue: #0984e3;
  --neon-blue-glow: 0 0 8px rgba(9, 132, 227, 0.3);
  --neon-blue-surface: rgba(9, 132, 227, 0.08);
  --neon-blue-border: rgba(9, 132, 227, 0.2);

  --neon-purple: #a855f7;
  --neon-purple-glow: 0 0 8px rgba(168, 85, 247, 0.3);
  --neon-purple-surface: rgba(168, 85, 247, 0.08);
  --neon-purple-border: rgba(168, 85, 247, 0.2);

  --neon-orange: #e17055;
  --neon-orange-glow: 0 0 8px rgba(225, 112, 85, 0.3);
  --neon-orange-surface: rgba(225, 112, 85, 0.08);
  --neon-orange-border: rgba(225, 112, 85, 0.2);

  --neon-red: #d63031;
  --neon-red-glow: 0 0 8px rgba(214, 48, 49, 0.3);
  --neon-red-surface: rgba(214, 48, 49, 0.08);
  --neon-red-border: rgba(214, 48, 49, 0.2);

  --neon-bg: #f8f7fc;
  --neon-bg-gradient:
    radial-gradient(ellipse at 30% 20%, rgba(168, 85, 247, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(9, 132, 227, 0.04) 0%, transparent 50%);

  --neon-glass-blur: blur(16px) saturate(120%);
  --neon-glass-edge: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  --neon-glass-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);

  --neon-scanline-opacity: 0;
  --neon-particle-count: 0;
}

/* ═══════════════════════════════════════════════════════
   Keyframe Animations
   ═══════════════════════════════════════════════════════ */

@keyframes neon-pulse {
  0%,
  100% {
    box-shadow: var(--pulse-shadow-min);
  }
  50% {
    box-shadow: var(--pulse-shadow-max);
  }
}

@keyframes neon-breathe {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

@keyframes neon-scanline {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 0 -200px;
  }
}

@keyframes neon-gradient-rotate {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

@keyframes neon-particle-drift-1 {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  90% {
    opacity: 0.6;
  }
  100% {
    transform: translate(120px, -180px) scale(0.5);
    opacity: 0;
  }
}

@keyframes neon-particle-drift-2 {
  0% {
    transform: translate(0, 0) scale(0.8);
    opacity: 0;
  }
  10% {
    opacity: 0.5;
  }
  90% {
    opacity: 0.5;
  }
  100% {
    transform: translate(-100px, -220px) scale(0.3);
    opacity: 0;
  }
}

@keyframes neon-particle-drift-3 {
  0% {
    transform: translate(0, 0) scale(1.2);
    opacity: 0;
  }
  10% {
    opacity: 0.4;
  }
  90% {
    opacity: 0.4;
  }
  100% {
    transform: translate(80px, -160px) scale(0.6);
    opacity: 0;
  }
}

@keyframes neon-dash-flow {
  0% {
    stroke-dashoffset: 20;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

@keyframes neon-ambient-shift {
  0% {
    background-position: 0% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  * {
    --neon-scanline-opacity: 0 !important;
    --neon-particle-count: 0 !important;
  }

  .neon-pulse,
  .neon-breathe,
  .neon-gradient-rotate {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Import neon.css in the app**

In `src/renderer/src/App.tsx`, add the import alongside other CSS imports (look for the existing `import './assets/base.css'` or similar):

```typescript
import './assets/neon.css'
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/neon.css src/renderer/src/App.tsx
git commit -m "feat: add V2 neon CSS tokens and keyframe animations"
```

---

## Task 2: Shared Types & Token Extensions

**Files:**

- Create: `src/renderer/src/components/neon/types.ts`
- Modify: `src/renderer/src/design-system/tokens.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/renderer/src/components/neon/types.ts

export type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'

/** Maps a NeonAccent name to its CSS custom property values */
export function neonVar(
  accent: NeonAccent,
  variant: 'color' | 'glow' | 'surface' | 'border'
): string {
  const varMap = {
    color: `var(--neon-${accent})`,
    glow: `var(--neon-${accent}-glow)`,
    surface: `var(--neon-${accent}-surface)`,
    border: `var(--neon-${accent}-border)`
  }
  return varMap[variant]
}

/** All accent names for iteration */
export const NEON_ACCENTS: NeonAccent[] = ['cyan', 'pink', 'blue', 'purple', 'orange', 'red']
```

- [ ] **Step 2: Add neon namespace to tokens.ts**

Open `src/renderer/src/design-system/tokens.ts` and add a `neon` section to the exported `tokens` object. Add it after the existing `transition` section:

```typescript
  neon: {
    cyan: 'var(--neon-cyan)',
    pink: 'var(--neon-pink)',
    blue: 'var(--neon-blue)',
    purple: 'var(--neon-purple)',
    orange: 'var(--neon-orange)',
    red: 'var(--neon-red)',
    bg: 'var(--neon-bg)',
    glassBg: 'var(--neon-glass-blur)',
    glassEdge: 'var(--neon-glass-edge)',
    glassShadow: 'var(--neon-glass-shadow)',
  },
```

- [ ] **Step 3: Add motion extensions to motion.ts**

Open `src/renderer/src/lib/motion.ts` and add neon-specific animation configs after the existing `VARIANTS` export:

```typescript
/** Neon animation timing configs for use with CSS animation-duration */
export const NEON_TIMING = {
  pulse: '3s',
  breathe: '2s',
  scanline: '30s',
  gradientRotate: '8s',
  particleDrift: { min: 20, max: 40 } // seconds, randomized per particle
} as const
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/neon/types.ts src/renderer/src/design-system/tokens.ts src/renderer/src/lib/motion.ts
git commit -m "feat: add NeonAccent types, token extensions, and neon timing configs"
```

---

## Task 3: NeonCard Primitive

**Files:**

- Create: `src/renderer/src/components/neon/NeonCard.tsx`
- Create: `src/renderer/src/components/neon/__tests__/NeonCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/src/components/neon/__tests__/NeonCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonCard } from '../NeonCard'

describe('NeonCard', () => {
  it('renders children', () => {
    render(<NeonCard accent="cyan">Hello Neon</NeonCard>)
    expect(screen.getByText('Hello Neon')).toBeInTheDocument()
  })

  it('applies accent-based CSS variables via style', () => {
    const { container } = render(<NeonCard accent="pink">Content</NeonCard>)
    const card = container.firstChild as HTMLElement
    expect(card.style.getPropertyValue('--card-accent')).toBe('var(--neon-pink)')
    expect(card.style.getPropertyValue('--card-accent-border')).toBe('var(--neon-pink-border)')
    expect(card.style.getPropertyValue('--card-accent-surface')).toBe('var(--neon-pink-surface)')
  })

  it('applies custom className', () => {
    const { container } = render(
      <NeonCard accent="blue" className="custom">
        X
      </NeonCard>
    )
    expect(container.firstChild).toHaveClass('neon-card', 'custom')
  })

  it('renders with header when title is provided', () => {
    render(
      <NeonCard accent="purple" title="Status" icon={<span data-testid="icon">I</span>}>
        Body
      </NeonCard>
    )
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('defaults accent to purple when not specified', () => {
    const { container } = render(<NeonCard>Default</NeonCard>)
    const card = container.firstChild as HTMLElement
    expect(card.style.getPropertyValue('--card-accent')).toBe('var(--neon-purple)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement NeonCard**

```tsx
// src/renderer/src/components/neon/NeonCard.tsx
import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'

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
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, rgba(10, 0, 21, 0.6))`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    borderRadius: '14px',
    backdropFilter: 'var(--neon-glass-blur)',
    WebkitBackdropFilter: 'var(--neon-glass-blur)',
    boxShadow: `var(--neon-glass-shadow), var(--neon-glass-edge)`,
    padding: title ? '0' : '14px',
    overflow: 'hidden',
    transition: 'box-shadow 150ms ease, transform 150ms ease',
    ...style
  } as React.CSSProperties

  return (
    <div className={`neon-card ${className}`.trim()} style={cardStyle}>
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 14px',
            borderBottom: `1px solid ${neonVar(accent, 'border')}`
          }}
        >
          {icon && <span style={{ color: neonVar(accent, 'color'), display: 'flex' }}>{icon}</span>}
          <span
            style={{
              color: neonVar(accent, 'color'),
              fontSize: '10px',
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
      <div style={{ padding: title ? '14px' : '0' }}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/NeonCard.tsx src/renderer/src/components/neon/__tests__/NeonCard.test.tsx
git commit -m "feat: add NeonCard primitive component"
```

---

## Task 4: StatCounter Primitive

**Files:**

- Create: `src/renderer/src/components/neon/StatCounter.tsx`
- Create: `src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/src/components/neon/__tests__/StatCounter.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatCounter } from '../StatCounter'

describe('StatCounter', () => {
  it('renders label and value', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders trend when provided', () => {
    render(
      <StatCounter
        label="Cost"
        value="$4.20"
        accent="orange"
        trend={{ direction: 'down', label: '12% vs yesterday' }}
      />
    )
    expect(screen.getByText(/12% vs yesterday/)).toBeInTheDocument()
  })

  it('renders suffix text', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" suffix="live" />)
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('applies accent color to label', () => {
    const { container } = render(<StatCounter label="Tasks" value={17} accent="pink" />)
    const label = container.querySelector('[data-role="stat-label"]') as HTMLElement
    expect(label.style.color).toBe('var(--neon-pink)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement StatCounter**

```tsx
// src/renderer/src/components/neon/StatCounter.tsx
import { type NeonAccent, neonVar } from './types'

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
        borderRadius: '10px',
        padding: '12px'
      }}
    >
      <div
        data-role="stat-label"
        style={{
          color: neonVar(accent, 'color'),
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '4px',
          marginTop: '4px'
        }}
      >
        <span
          style={{
            color: '#fff',
            fontSize: '22px',
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
              fontSize: '10px',
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
            fontSize: '10px',
            marginTop: '4px',
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/StatCounter.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/StatCounter.tsx src/renderer/src/components/neon/__tests__/StatCounter.test.tsx
git commit -m "feat: add StatCounter primitive component"
```

---

## Task 5: NeonBadge + GlassPanel + NeonProgress Primitives

**Files:**

- Create: `src/renderer/src/components/neon/NeonBadge.tsx`
- Create: `src/renderer/src/components/neon/GlassPanel.tsx`
- Create: `src/renderer/src/components/neon/NeonProgress.tsx`
- Create: `src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx`
- Create: `src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx`
- Create: `src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx`

- [ ] **Step 1: Write failing tests for NeonBadge**

```tsx
// src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonBadge } from '../NeonBadge'

describe('NeonBadge', () => {
  it('renders label text', () => {
    render(<NeonBadge accent="cyan" label="active" />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('applies accent color styling', () => {
    const { container } = render(<NeonBadge accent="pink" label="queued" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.style.color).toBe('var(--neon-pink)')
    expect(badge.style.background).toContain('var(--neon-pink-surface)')
  })

  it('adds pulse class when pulse prop is true', () => {
    const { container } = render(<NeonBadge accent="cyan" label="live" pulse />)
    expect(container.firstChild).toHaveClass('neon-pulse')
  })
})
```

- [ ] **Step 2: Write failing tests for GlassPanel**

```tsx
// src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GlassPanel } from '../GlassPanel'

describe('GlassPanel', () => {
  it('renders children', () => {
    render(<GlassPanel>Panel content</GlassPanel>)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('applies glass backdrop-filter', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.backdropFilter).toBeTruthy()
  })

  it('applies accent when provided', () => {
    const { container } = render(<GlassPanel accent="purple">X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.borderColor).toBe('var(--neon-purple-border)')
  })
})
```

- [ ] **Step 3: Write failing tests for NeonProgress**

```tsx
// src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonProgress } from '../NeonProgress'

describe('NeonProgress', () => {
  it('renders with correct width percentage', () => {
    const { container } = render(<NeonProgress value={65} accent="cyan" />)
    const bar = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    expect(bar.style.width).toBe('65%')
  })

  it('renders label when provided', () => {
    render(<NeonProgress value={50} accent="pink" label="Sprint Progress" />)
    expect(screen.getByText('Sprint Progress')).toBeInTheDocument()
  })

  it('clamps value between 0 and 100', () => {
    const { container } = render(<NeonProgress value={150} accent="blue" />)
    const bar = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })
})
```

- [ ] **Step 4: Run all three test files to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx`
Expected: FAIL

- [ ] **Step 5: Implement NeonBadge**

```tsx
// src/renderer/src/components/neon/NeonBadge.tsx
import { type NeonAccent, neonVar } from './types'

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
          borderRadius: '20px',
          padding: '2px 10px',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase' as const,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
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

- [ ] **Step 6: Implement GlassPanel**

```tsx
// src/renderer/src/components/neon/GlassPanel.tsx
import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'

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
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={{
        backdropFilter: BLUR_MAP[blur],
        WebkitBackdropFilter: BLUR_MAP[blur],
        background: accent
          ? `linear-gradient(135deg, ${neonVar(accent, 'surface')}, rgba(10, 0, 21, 0.4))`
          : 'rgba(20, 10, 40, 0.4)',
        border: `1px solid ${accent ? neonVar(accent, 'border') : 'rgba(255, 255, 255, 0.08)'}`,
        borderColor: accent ? neonVar(accent, 'border') : 'rgba(255, 255, 255, 0.08)',
        borderRadius: '14px',
        boxShadow: 'var(--neon-glass-shadow), var(--neon-glass-edge)',
        ...style
      }}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 7: Implement NeonProgress**

```tsx
// src/renderer/src/components/neon/NeonProgress.tsx
import { type NeonAccent, neonVar } from './types'

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
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: '6px',
            fontWeight: 600
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          height: '4px',
          background: 'rgba(255, 255, 255, 0.06)',
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

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/neon/NeonBadge.tsx src/renderer/src/components/neon/GlassPanel.tsx src/renderer/src/components/neon/NeonProgress.tsx src/renderer/src/components/neon/__tests__/NeonBadge.test.tsx src/renderer/src/components/neon/__tests__/GlassPanel.test.tsx src/renderer/src/components/neon/__tests__/NeonProgress.test.tsx
git commit -m "feat: add NeonBadge, GlassPanel, and NeonProgress primitives"
```

---

## Task 6: ActivityFeed Primitive

**Files:**

- Create: `src/renderer/src/components/neon/ActivityFeed.tsx`
- Create: `src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ActivityFeed, type FeedEvent } from '../ActivityFeed'

const mockEvents: FeedEvent[] = [
  { id: '1', label: 'fix-auth pushing', accent: 'cyan', timestamp: Date.now() - 2000 },
  { id: '2', label: 'add-tests done ✓', accent: 'pink', timestamp: Date.now() - 60000 },
  { id: '3', label: 'PR #42 merged', accent: 'blue', timestamp: Date.now() - 180000 }
]

describe('ActivityFeed', () => {
  it('renders all events', () => {
    render(<ActivityFeed events={mockEvents} />)
    expect(screen.getByText('fix-auth pushing')).toBeInTheDocument()
    expect(screen.getByText('add-tests done ✓')).toBeInTheDocument()
    expect(screen.getByText('PR #42 merged')).toBeInTheDocument()
  })

  it('limits display to maxItems', () => {
    render(<ActivityFeed events={mockEvents} maxItems={2} />)
    expect(screen.getByText('fix-auth pushing')).toBeInTheDocument()
    expect(screen.getByText('add-tests done ✓')).toBeInTheDocument()
    expect(screen.queryByText('PR #42 merged')).not.toBeInTheDocument()
  })

  it('shows relative timestamps', () => {
    render(<ActivityFeed events={mockEvents} />)
    expect(screen.getByText('2s ago')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<ActivityFeed events={[]} />)
    expect(screen.getByText('No recent activity')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement ActivityFeed**

```tsx
// src/renderer/src/components/neon/ActivityFeed.tsx
import { type NeonAccent, neonVar } from './types'

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
  if (seconds < 5) return 'just now'
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
      <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '11px', padding: '12px 0' }}>
        No recent activity
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {displayed.map((event) => (
        <div
          key={event.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
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
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '11px',
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
              color: 'rgba(255, 255, 255, 0.3)',
              fontSize: '9px',
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/ActivityFeed.tsx src/renderer/src/components/neon/__tests__/ActivityFeed.test.tsx
git commit -m "feat: add ActivityFeed primitive component"
```

---

## Task 7: PipelineFlow + MiniChart Primitives

**Files:**

- Create: `src/renderer/src/components/neon/PipelineFlow.tsx`
- Create: `src/renderer/src/components/neon/MiniChart.tsx`
- Create: `src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx`
- Create: `src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`

- [ ] **Step 1: Write failing tests for PipelineFlow**

```tsx
// src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PipelineFlow, type PipelineStage } from '../PipelineFlow'

const stages: PipelineStage[] = [
  { label: 'queued', count: 4, accent: 'orange' },
  { label: 'active', count: 3, accent: 'cyan' },
  { label: 'review', count: 2, accent: 'blue' }
]

describe('PipelineFlow', () => {
  it('renders all stage labels and counts', () => {
    render(<PipelineFlow stages={stages} />)
    expect(screen.getByText('queued: 4')).toBeInTheDocument()
    expect(screen.getByText('active: 3')).toBeInTheDocument()
    expect(screen.getByText('review: 2')).toBeInTheDocument()
  })

  it('renders arrow separators between stages', () => {
    const { container } = render(<PipelineFlow stages={stages} />)
    const arrows = container.querySelectorAll('[data-role="pipeline-arrow"]')
    expect(arrows).toHaveLength(2) // n-1 arrows
  })
})
```

- [ ] **Step 2: Write failing tests for MiniChart**

```tsx
// src/renderer/src/components/neon/__tests__/MiniChart.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MiniChart, type ChartBar } from '../MiniChart'

const data: ChartBar[] = [
  { value: 70, accent: 'cyan' },
  { value: 45, accent: 'pink' },
  { value: 85, accent: 'blue' },
  { value: 30, accent: 'orange' }
]

describe('MiniChart', () => {
  it('renders correct number of bars', () => {
    const { container } = render(<MiniChart data={data} />)
    const bars = container.querySelectorAll('[data-role="chart-bar"]')
    expect(bars).toHaveLength(4)
  })

  it('normalizes bar heights relative to max value', () => {
    const { container } = render(<MiniChart data={data} />)
    const bars = container.querySelectorAll('[data-role="chart-bar"]') as NodeListOf<HTMLElement>
    // Max is 85, so 85 should be 100%
    expect(bars[2].style.height).toBe('100%')
    // 30 should be ~35%
    expect(bars[3].style.height).toBe('35%')
  })

  it('renders empty state when no data', () => {
    const { container } = render(<MiniChart data={[]} />)
    expect(container.textContent).toContain('No data')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement PipelineFlow**

```tsx
// src/renderer/src/components/neon/PipelineFlow.tsx
import { type NeonAccent, neonVar } from './types'

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
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {stages.map((stage, i) => (
        <div key={stage.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              background: neonVar(stage.accent, 'surface'),
              border: `1px solid ${neonVar(stage.accent, 'border')}`,
              borderRadius: '6px',
              padding: '4px 10px',
              color: neonVar(stage.accent, 'color'),
              fontSize: '11px',
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
                color: 'rgba(255, 255, 255, 0.2)',
                fontSize: '14px'
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

- [ ] **Step 5: Implement MiniChart**

```tsx
// src/renderer/src/components/neon/MiniChart.tsx
import { type NeonAccent, neonVar } from './types'

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
          color: 'rgba(255, 255, 255, 0.3)',
          fontSize: '11px',
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

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx src/renderer/src/components/neon/__tests__/MiniChart.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/neon/PipelineFlow.tsx src/renderer/src/components/neon/MiniChart.tsx src/renderer/src/components/neon/__tests__/PipelineFlow.test.tsx src/renderer/src/components/neon/__tests__/MiniChart.test.tsx
git commit -m "feat: add PipelineFlow and MiniChart primitive components"
```

---

## Task 8: StatusBar + ScanlineOverlay + ParticleField Primitives

**Files:**

- Create: `src/renderer/src/components/neon/StatusBar.tsx`
- Create: `src/renderer/src/components/neon/ScanlineOverlay.tsx`
- Create: `src/renderer/src/components/neon/ParticleField.tsx`
- Create: `src/renderer/src/components/neon/__tests__/StatusBar.test.tsx`
- Create: `src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx`
- Create: `src/renderer/src/components/neon/__tests__/ParticleField.test.tsx`

- [ ] **Step 1: Write failing tests for StatusBar**

```tsx
// src/renderer/src/components/neon/__tests__/StatusBar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusBar } from '../StatusBar'

describe('StatusBar', () => {
  it('renders title', () => {
    render(<StatusBar title="BDE Command Center" status="ok" />)
    expect(screen.getByText('BDE Command Center')).toBeInTheDocument()
  })

  it('renders status indicator dot', () => {
    const { container } = render(<StatusBar title="Test" status="ok" />)
    const dot = container.querySelector('[data-role="status-dot"]')
    expect(dot).toBeInTheDocument()
  })

  it('renders children in right slot', () => {
    render(
      <StatusBar title="Test" status="ok">
        <span>SYS.OK</span>
      </StatusBar>
    )
    expect(screen.getByText('SYS.OK')).toBeInTheDocument()
  })

  it('uses red dot for error status', () => {
    const { container } = render(<StatusBar title="Test" status="error" />)
    const dot = container.querySelector('[data-role="status-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--neon-red)')
  })
})
```

- [ ] **Step 2: Write failing tests for ScanlineOverlay**

```tsx
// src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ScanlineOverlay } from '../ScanlineOverlay'

describe('ScanlineOverlay', () => {
  it('renders with pointer-events none', () => {
    const { container } = render(<ScanlineOverlay />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.pointerEvents).toBe('none')
  })

  it('renders with absolute positioning', () => {
    const { container } = render(<ScanlineOverlay />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.position).toBe('absolute')
  })
})
```

- [ ] **Step 3: Write failing tests for ParticleField**

```tsx
// src/renderer/src/components/neon/__tests__/ParticleField.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ParticleField } from '../ParticleField'

describe('ParticleField', () => {
  it('renders particles', () => {
    const { container } = render(<ParticleField density={5} />)
    const particles = container.querySelectorAll('[data-role="particle"]')
    expect(particles).toHaveLength(5)
  })

  it('renders with pointer-events none', () => {
    const { container } = render(<ParticleField />)
    const field = container.firstChild as HTMLElement
    expect(field.style.pointerEvents).toBe('none')
  })

  it('defaults to 18 particles', () => {
    const { container } = render(<ParticleField />)
    const particles = container.querySelectorAll('[data-role="particle"]')
    expect(particles).toHaveLength(18)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/StatusBar.test.tsx src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx src/renderer/src/components/neon/__tests__/ParticleField.test.tsx`
Expected: FAIL

- [ ] **Step 5: Implement StatusBar**

```tsx
// src/renderer/src/components/neon/StatusBar.tsx
import { type ReactNode } from 'react'

interface StatusBarProps {
  title: string
  status: 'ok' | 'error' | 'warning'
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

export function StatusBar({ title, status, children }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        borderBottom: '1px solid var(--neon-purple-border)'
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
          color: 'var(--neon-purple)',
          fontSize: '11px',
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
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '10px',
            fontFamily: 'var(--font-code)'
          }}
        >
          {children}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Implement ScanlineOverlay**

```tsx
// src/renderer/src/components/neon/ScanlineOverlay.tsx

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
        opacity: opacity ?? ('var(--neon-scanline-opacity)' as unknown as number),
        animation: 'neon-scanline var(--neon-scanline-speed) linear infinite',
        zIndex: 0
      }}
    />
  )
}
```

- [ ] **Step 7: Implement ParticleField**

```tsx
// src/renderer/src/components/neon/ParticleField.tsx
import { useMemo } from 'react'
import { NEON_ACCENTS, neonVar } from './types'

interface ParticleFieldProps {
  density?: number
}

const DRIFT_ANIMATIONS = ['neon-particle-drift-1', 'neon-particle-drift-2', 'neon-particle-drift-3']

export function ParticleField({ density = 18 }: ParticleFieldProps) {
  const particles = useMemo(() => {
    return Array.from({ length: density }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${20 + Math.random() * 80}%`,
      accent: NEON_ACCENTS[i % NEON_ACCENTS.length],
      duration: `${20 + Math.random() * 20}s`,
      delay: `${Math.random() * -30}s`,
      animation: DRIFT_ANIMATIONS[i % DRIFT_ANIMATIONS.length],
      size: `${2 + Math.random() * 2}px`
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

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/StatusBar.test.tsx src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx src/renderer/src/components/neon/__tests__/ParticleField.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/neon/StatusBar.tsx src/renderer/src/components/neon/ScanlineOverlay.tsx src/renderer/src/components/neon/ParticleField.tsx src/renderer/src/components/neon/__tests__/StatusBar.test.tsx src/renderer/src/components/neon/__tests__/ScanlineOverlay.test.tsx src/renderer/src/components/neon/__tests__/ParticleField.test.tsx
git commit -m "feat: add StatusBar, ScanlineOverlay, and ParticleField primitives"
```

---

## Task 9: Barrel Export

**Files:**

- Create: `src/renderer/src/components/neon/index.ts`

- [ ] **Step 1: Create the barrel export**

```typescript
// src/renderer/src/components/neon/index.ts
export { NeonCard } from './NeonCard'
export { StatCounter } from './StatCounter'
export { NeonBadge } from './NeonBadge'
export { GlassPanel } from './GlassPanel'
export { ActivityFeed, type FeedEvent } from './ActivityFeed'
export { NeonProgress } from './NeonProgress'
export { PipelineFlow, type PipelineStage } from './PipelineFlow'
export { MiniChart, type ChartBar } from './MiniChart'
export { StatusBar } from './StatusBar'
export { ScanlineOverlay } from './ScanlineOverlay'
export { ParticleField } from './ParticleField'
export { type NeonAccent, neonVar, NEON_ACCENTS } from './types'
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/neon/index.ts
git commit -m "feat: add neon primitives barrel export"
```

---

## Task 10: Dashboard IPC Channels

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/handlers/dashboard-handlers.ts`
- Create: `src/main/handlers/__tests__/dashboard-handlers.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing test for dashboard handlers**

```typescript
// src/main/handlers/__tests__/dashboard-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

// Mock db
const mockAll = vi.fn()
const mockDb = { prepare: vi.fn(() => ({ all: mockAll })) }
vi.mock('../../db', () => ({ getDb: () => mockDb }))

describe('dashboard-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('completionsPerHour query', () => {
    it('returns hourly bucketed completion data', async () => {
      // Import after mocks are set up
      const { getCompletionsPerHour } = await import('../dashboard-handlers')

      mockAll.mockReturnValue([
        { hour: '2026-03-24T10:00:00', count: 5 },
        { hour: '2026-03-24T11:00:00', count: 3 }
      ])

      const result = getCompletionsPerHour()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ hour: '2026-03-24T10:00:00', count: 5 })
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('GROUP BY'))
    })
  })

  describe('recentEvents query', () => {
    it('returns recent agent events', async () => {
      const { getRecentEvents } = await import('../dashboard-handlers')

      mockAll.mockReturnValue([
        {
          id: 1,
          agent_id: 'a1',
          event_type: 'status_change',
          payload: '{"status":"done"}',
          timestamp: 1000
        }
      ])

      const result = getRecentEvents(20)
      expect(result).toHaveLength(1)
      expect(result[0].agent_id).toBe('a1')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/handlers/__tests__/dashboard-handlers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add channel types to ipc-channels.ts**

Open `src/shared/ipc-channels.ts` and add these channel definitions. Find the existing channel interface pattern and add:

Add a new `DashboardChannels` interface following the existing domain pattern. Each domain has its own typed interface. Place it near the other channel interfaces:

```typescript
// Add these types near the other type/interface definitions in ipc-channels.ts

export interface CompletionBucket {
  hour: string
  count: number
}

export interface DashboardEvent {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
}

export interface DashboardChannels {
  'agent:completionsPerHour': { args: []; result: CompletionBucket[] }
  'agent:recentEvents': { args: [limit?: number]; result: DashboardEvent[] }
}
```

Then add `DashboardChannels` to the composite `IpcChannelMap` intersection type on line 448:

```typescript
export type IpcChannelMap = SettingsChannels & GitChannels & ... & DashboardChannels;
```

- [ ] **Step 4: Implement dashboard-handlers.ts**

```typescript
// src/main/handlers/dashboard-handlers.ts
import { getDb } from '../db'
import { safeHandle } from '../ipc-utils'

export function getCompletionsPerHour() {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT
      strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime') AS hour,
      COUNT(*) AS count
    FROM agent_runs
    WHERE finished_at IS NOT NULL
      AND finished_at > (strftime('%s', 'now', '-24 hours') * 1000)
    GROUP BY hour
    ORDER BY hour ASC
  `
    )
    .all() as { hour: string; count: number }[]
  return rows
}

export function getRecentEvents(limit: number = 20) {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT id, agent_id, event_type, payload, timestamp
    FROM agent_events
    ORDER BY timestamp DESC
    LIMIT ?
  `
    )
    .all(limit) as {
    id: number
    agent_id: string
    event_type: string
    payload: string
    timestamp: number
  }[]
  return rows
}

export function registerDashboardHandlers(): void {
  safeHandle('agent:completionsPerHour', async () => {
    return getCompletionsPerHour()
  })

  safeHandle('agent:recentEvents', async (_e: unknown, limit?: number) => {
    return getRecentEvents(limit)
  })
}
```

**Note:** Check `src/main/handlers/` for how `safeHandle` is imported — it may be in `helpers.ts` or similar. Match the existing pattern.

- [ ] **Step 5: Expose channels in preload**

Open `src/preload/index.ts` and add the new channels to the `window.api` bridge object. Find the existing pattern and add:

Use `typedInvoke` (not raw `ipcRenderer.invoke`) to match the existing pattern. Find where other domain namespaces are defined and add:

```typescript
dashboard: {
  completionsPerHour: () => typedInvoke('agent:completionsPerHour'),
  recentEvents: (limit?: number) => typedInvoke('agent:recentEvents', limit),
},
```

- [ ] **Step 6: Register handlers in main/index.ts**

Open `src/main/index.ts`. Import and call the registration function alongside existing handlers:

```typescript
import { registerDashboardHandlers } from './handlers/dashboard-handlers'
// ... then inside the whenReady block:
registerDashboardHandlers()
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/handlers/__tests__/dashboard-handlers.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/handlers/dashboard-handlers.ts src/main/handlers/__tests__/dashboard-handlers.test.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: add agent:completionsPerHour and agent:recentEvents IPC channels"
```

---

## Task 11: Dashboard Rewrite — Ops Deck Layout

**Files:**

- Modify: `src/renderer/src/views/DashboardView.tsx` (full rewrite)
- Create: `src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx`

- [ ] **Step 1: Write failing tests for the new dashboard**

```tsx
// src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.api
vi.stubGlobal('window', {
  ...window,
  api: {
    dashboard: {
      completionsPerHour: vi.fn().mockResolvedValue([]),
      recentEvents: vi.fn().mockResolvedValue([])
    },
    getPrList: vi.fn().mockResolvedValue([])
  }
})

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>
  },
  useReducedMotion: () => false
}))

// Mock stores
vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: any) =>
    sel({
      tasks: [
        { id: '1', title: 'Fix auth', status: 'active', repo: 'BDE' },
        { id: '2', title: 'Add tests', status: 'queued', repo: 'BDE' },
        { id: '3', title: 'Deploy', status: 'done', repo: 'BDE', completed_at: Date.now() },
        { id: '4', title: 'Review', status: 'blocked', repo: 'BDE' }
      ]
    })
  )
}))

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: any) =>
    sel({
      totalCost: 4.2
    })
  )
}))

describe('DashboardView (Ops Deck)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the status bar with command center title', async () => {
    const { default: DashboardView } = await import('../../../views/DashboardView')
    render(<DashboardView />)
    expect(screen.getByText('BDE Command Center')).toBeInTheDocument()
  })

  it('renders stat counters for each metric', async () => {
    const { default: DashboardView } = await import('../../../views/DashboardView')
    render(<DashboardView />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('PRs')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders pipeline flow section', async () => {
    const { default: DashboardView } = await import('../../../views/DashboardView')
    render(<DashboardView />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('renders cost card', async () => {
    const { default: DashboardView } = await import('../../../views/DashboardView')
    render(<DashboardView />)
    expect(screen.getByText(/Cost/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx`
Expected: FAIL — dashboard doesn't have Ops Deck structure yet

- [ ] **Step 3: Rewrite DashboardView.tsx**

Replace `src/renderer/src/views/DashboardView.tsx` entirely:

```tsx
// src/renderer/src/views/DashboardView.tsx
import { useEffect, useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import {
  StatusBar,
  StatCounter,
  NeonCard,
  GlassPanel,
  PipelineFlow,
  MiniChart,
  ActivityFeed,
  NeonProgress,
  ScanlineOverlay,
  ParticleField,
  type FeedEvent,
  type PipelineStage,
  type ChartBar
} from '../components/neon'
import { Activity, GitPullRequest, CheckCircle, DollarSign, Zap } from 'lucide-react'

export default function DashboardView() {
  const reduced = useReducedMotion()
  const tasks = useSprintTasks((s) => s.tasks)
  const totalCost = useCostDataStore((s) => s.totalCost)

  const [chartData, setChartData] = useState<ChartBar[]>([])
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([])
  const [prCount, setPrCount] = useState(0)

  // Derived stats
  const stats = useMemo(() => {
    const active = tasks.filter((t) => t.status === 'active').length
    const queued = tasks.filter((t) => t.status === 'queued').length
    const blocked = tasks.filter((t) => t.status === 'blocked').length
    const done = tasks.filter((t) => t.status === 'done').length
    return { active, queued, blocked, done }
  }, [tasks])

  // Pipeline stages
  const pipelineStages: PipelineStage[] = useMemo(
    () => [
      { label: 'queued', count: stats.queued, accent: 'orange' },
      { label: 'active', count: stats.active, accent: 'cyan' },
      { label: 'blocked', count: stats.blocked, accent: 'red' },
      { label: 'done', count: stats.done, accent: 'blue' }
    ],
    [stats]
  )

  // Fetch chart data
  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      .completionsPerHour()
      .then((data) => {
        if (cancelled) return
        const accents: Array<'cyan' | 'pink' | 'blue' | 'orange' | 'purple'> = [
          'cyan',
          'pink',
          'blue',
          'orange',
          'purple'
        ]
        setChartData(
          data.map((d, i) => ({
            value: d.count,
            accent: accents[i % accents.length],
            label: d.hour
          }))
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch events
  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      .recentEvents(30)
      .then((events) => {
        if (cancelled) return
        setFeedEvents(
          events.map((e) => ({
            id: String(e.id),
            label: `${e.event_type}: ${e.agent_id}`,
            accent:
              e.event_type === 'error'
                ? ('red' as const)
                : e.event_type === 'complete'
                  ? ('cyan' as const)
                  : ('purple' as const),
            timestamp: e.timestamp
          }))
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch PR count
  useEffect(() => {
    let cancelled = false
    window.api
      .getPrList()
      .then((prs) => {
        if (cancelled) return
        setPrCount(Array.isArray(prs) ? prs.length : 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  return (
    <motion.div
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={transition}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--neon-bg)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Background effects */}
      {!reduced && <ScanlineOverlay />}
      {!reduced && <ParticleField />}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--neon-bg-gradient)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Content (above effects) */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%'
        }}
      >
        <StatusBar title="BDE Command Center" status="ok">
          SYS.OK
        </StatusBar>

        {/* 3-column Ops Deck grid */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '200px 1fr 240px',
            gap: '12px',
            padding: '12px',
            overflow: 'auto'
          }}
        >
          {/* Left: Stats Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <StatCounter
              label="Agents"
              value={stats.active}
              accent="cyan"
              suffix="live"
              icon={<Zap size={10} />}
            />
            <StatCounter
              label="Tasks"
              value={stats.queued + stats.active}
              accent="pink"
              icon={<Activity size={10} />}
            />
            <StatCounter
              label="PRs"
              value={prCount}
              accent="blue"
              icon={<GitPullRequest size={10} />}
            />
            <StatCounter
              label="Done"
              value={stats.done}
              accent="cyan"
              icon={<CheckCircle size={10} />}
            />
          </div>

          {/* Center: Main Stage */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <NeonCard accent="purple" title="Pipeline" icon={<Activity size={12} />}>
              <PipelineFlow stages={pipelineStages} />
            </NeonCard>

            <NeonCard
              accent="purple"
              title="Completions / Hour"
              icon={<Zap size={12} />}
              style={{ flex: 1 }}
            >
              <MiniChart data={chartData} height={120} />
              <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '9px', marginTop: '6px' }}>
                last 24 hours
              </div>
            </NeonCard>
          </div>

          {/* Right: Feed + Cost */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <NeonCard accent="purple" title="Feed" style={{ flex: 1, minHeight: 0 }}>
              <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                <ActivityFeed events={feedEvents} />
              </div>
            </NeonCard>

            <NeonCard accent="orange" title="Cost 24h" icon={<DollarSign size={12} />}>
              <div
                style={{
                  color: '#fff',
                  fontSize: '24px',
                  fontWeight: 800,
                  textShadow: 'var(--neon-orange-glow)'
                }}
              >
                ${totalCost.toFixed(2)}
              </div>
            </NeonCard>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS (no regressions from the rewrite)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/views/DashboardView.tsx src/renderer/src/components/dashboard/__tests__/OpsDeckDashboard.test.tsx
git commit -m "feat: rewrite dashboard as Neon Ops Deck command center"
```

---

## Task 12: Final Integration & Cleanup

**Files:**

- Review all modified files for consistency

- [ ] **Step 1: Run full test suite**

Run: `npm test && npm run test:main`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (or fix any lint issues)

- [ ] **Step 4: Verify old dashboard tests still pass**

The old `DashboardCard.tsx`, `ActiveTasksCard.tsx`, etc. remain in `src/renderer/src/components/dashboard/`. They are no longer imported by `DashboardView.tsx` but their tests should still pass independently. Check for any existing tests in `src/renderer/src/components/dashboard/__tests__/` that reference the old DashboardView structure — these may need updating or removal if they import the default export from DashboardView. Do NOT delete the old component files — they can be removed in a later cleanup PR after the Ops Deck is validated.

**Important:** The PR list call in DashboardView (`window.api.getPrList()`) must match the actual preload API surface. Check `src/preload/index.ts` for the exact function name — it may be `getPrList`, `pr.getList`, or similar. Match whatever the preload exposes.

- [ ] **Step 5: Commit any lint/type fixes**

```bash
git add -u
git commit -m "chore: fix lint and type issues from neon ops deck integration"
```

- [ ] **Step 6: Create PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: Neon Ops Deck dashboard overhaul" --body "$(cat <<'EOF'
## Summary
- V2 neon design system: 6-color rainbow palette with glow/surface/border variants
- 11 reusable primitive components in `src/renderer/src/components/neon/`
- Dashboard rewritten as 3-column Ops Deck command center
- Ambient effects: scanline overlay, particle field, gradient atmosphere
- 2 new IPC channels for agent completions and recent events

## Screenshots
[Add screenshots of the new Ops Deck dashboard here]

## Test plan
- [ ] All existing tests pass (`npm test && npm run test:main`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] New neon primitive tests pass
- [ ] Dashboard renders with all 3 columns
- [ ] Ambient effects visible (scanlines, particles)
- [ ] Stat counters show correct values from sprint tasks
- [ ] Pipeline flow shows task status distribution
- [ ] Activity feed shows recent agent events
- [ ] Cost card shows total from cost store
- [ ] Reduced motion: effects disabled, layout intact
- [ ] Light theme: neon colors adapt (desaturated pastels)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
