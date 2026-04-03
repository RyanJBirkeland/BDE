# Neon Ops Deck — BDE UI Overhaul Design Spec

**Date**: 2026-03-24
**Status**: Approved
**Scope**: Dashboard first, design system rolls out to all views incrementally

## Overview

Transform BDE from its current minimal dark theme into a **Neon Cyberpunk Command Center** aesthetic. Deep indigo-black backgrounds, full rainbow neon accents with glows, heavy glassmorphism, and maximum animation (particles, scanlines, animated gradients). The dashboard becomes an "Ops Deck" — a 3-column data-dense operations console.

The overhaul is built as a **V2 primitive component system** — low coupling, high cohesion. Every visual concept is a reusable primitive. Views compose primitives. Updating the look across the entire app means changing one place.

## Design Decisions

| Decision            | Choice                  | Rationale                                               |
| ------------------- | ----------------------- | ------------------------------------------------------- |
| Aesthetic           | Neon Cyberpunk          | Bold, dramatic, unapologetically flashy                 |
| Animation intensity | Full send               | Particles, scanlines, pulsing glows, animated gradients |
| Dashboard layout    | Ops Deck (3-column)     | Most data-dense, real operations console feel           |
| Color palette       | Full rainbow neon       | Every accent gets neon treatment — max vibrancy         |
| Architecture        | V2 primitive components | Low coupling, high cohesion, single point of update     |

## Section 1: Design System — Neon Rainbow Palette

### Base Atmosphere

- Background shifts from `#0A0A0A` to `#0a0015` (deep indigo-black)
- Ambient radial gradients on page background (subtle purple/cyan glow pools)
- Scanline overlay at 2-3% opacity for texture

### Neon Accent Palette

6 colors, each with 4 variants:

| Name        | Hex       | Usage                          |
| ----------- | --------- | ------------------------------ |
| Neon Cyan   | `#00ffc8` | Agents, success, "live" states |
| Neon Pink   | `#ff64c8` | Tasks, counts, highlights      |
| Neon Blue   | `#64c8ff` | PRs, links, info states        |
| Neon Purple | `#bf5af2` | Headers, borders, structural   |
| Neon Orange | `#ffb432` | Cost, warnings, attention      |
| Neon Red    | `#ff3264` | Errors, failures, danger       |

Each color gets 4 CSS custom property variants:

```css
--neon-cyan: #00ffc8;
--neon-cyan-glow: 0 0 12px rgba(0, 255, 200, 0.5);
--neon-cyan-surface: rgba(0, 255, 200, 0.08);
--neon-cyan-border: rgba(0, 255, 200, 0.25);
```

### Glass Card Treatment

All cards get:

- `backdrop-filter: blur(16px) saturate(180%)`
- Gradient tint background from the card's accent color
- 1px neon-tinted border
- `inset 0 1px 0 rgba(255, 255, 255, 0.06)` top edge highlight (visionOS-style)
- Multi-layer shadow: depth shadow + accent glow + inner edge

### Light Theme

Neon colors desaturate to vibrant-but-readable pastels. Glass becomes frosted white. Handled in rollout phase, not dashboard MVP.

### Integration with Existing Tokens

V2 tokens live alongside existing `--bde-*` tokens — no breaking changes. Existing components continue to work. New primitives reference V2 tokens. Gradual migration path: views adopt V2 primitives one at a time.

## Section 2: V2 Primitive Component Architecture

### Layer 1 — CSS Token Layer

Extensions to `tokens.ts` and `base.css`:

- `--neon-*` custom properties (6 colors × 4 variants = 24 properties)
- `--glass-*` properties (blur levels, saturation, tint opacities)
- `--atmosphere-*` properties (background gradients, scanline opacity, particle density)

### Layer 2 — Primitive Components

New directory: `src/renderer/src/components/neon/`

| Primitive         | Purpose                                          | Key Props                                     |
| ----------------- | ------------------------------------------------ | --------------------------------------------- |
| `NeonCard`        | Glass card with neon-tinted border               | `accent`, `children`, `className`             |
| `StatCounter`     | Big number + label + optional trend              | `label`, `value`, `accent`, `trend?`, `icon?` |
| `NeonBadge`       | Status pill with glow                            | `accent`, `label`, `pulse?`                   |
| `GlassPanel`      | Full glass surface with blur                     | `blur?`, `accent?`, `children`                |
| `ActivityFeed`    | Scrolling event list with dot indicators         | `events`, `maxItems?`                         |
| `NeonProgress`    | Gradient progress bar with glow                  | `value`, `accent`, `label?`                   |
| `PipelineFlow`    | Horizontal status pipeline (CSS animated dashes) | `stages`                                      |
| `MiniChart`       | Vertical bar chart with neon gradients           | `data`, `accent?`                             |
| `StatusBar`       | Top bar with system indicator dot + title        | `title`, `status`, `children?`                |
| `ScanlineOverlay` | Animated CSS scanline texture                    | `opacity?`                                    |
| `ParticleField`   | Floating particle background (CSS-only)          | `density?`, `accent?`                         |

**Accent type**: All primitives share a `NeonAccent` union type:

```typescript
type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'
```

This maps to the corresponding `--neon-{accent}` CSS custom properties. No arbitrary CSS colors — keeps the palette cohesive.

**Composition rule**: Views never write raw glass/glow CSS. They import primitives and compose. The primitives own the visual treatment.

### Layer 3 — Animation Primitives

Extensions to existing `src/renderer/src/lib/motion.ts`:

| Animation        | Type             | Description                                        |
| ---------------- | ---------------- | -------------------------------------------------- |
| `neonPulse`      | CSS `@keyframes` | Glow oscillation for borders/shadows (3s cycle)    |
| `scanlineScroll` | CSS `@keyframes` | Horizontal scanline movement (30s cycle)           |
| `gradientShift`  | CSS `@keyframes` | Animated `background-position` rotation (8s cycle) |
| `particleDrift`  | CSS `@keyframes` | Floating particle paths (20-40s randomized cycles) |

All animations respect `prefers-reduced-motion` via existing `useReducedMotion()` hook.

## Section 3: Dashboard Layout — The Ops Deck

### Grid Structure

```
┌─────────────────────────────────────────────────────────┐
│ StatusBar: ● BDE Command Center                  SYS.OK │
├────────────┬─────────────────────────┬──────────────────┤
│            │                         │                  │
│ StatCounter│   GlassPanel            │  ActivityFeed    │
│ (Agents)   │   ┌─ PipelineFlow ──┐   │  ┌────────────┐ │
│ ─────────  │   │queued→active→rev│   │  │● fix-auth  │ │
│ StatCounter│   └─────────────────┘   │  │● add-tests │ │
│ (Tasks)    │                         │  │● PR #42    │ │
│ ─────────  │   MiniChart             │  └────────────┘ │
│ StatCounter│   ┌─────────────────┐   │  ──────────────  │
│ (PRs)      │   │ █ █ █ █ █ █ █ █│   │  NeonCard       │
│ ─────────  │   │ █ █ █ █ █ █ █ █│   │  (Cost 24h)     │
│ StatCounter│   └─────────────────┘   │  $4.20          │
│ (Done)     │   completions/hr        │  ↓12% vs yday   │
│            │                         │                  │
├────────────┴─────────────────────────┴──────────────────┤
│ ScanlineOverlay + ParticleField (full page, behind)     │
└─────────────────────────────────────────────────────────┘
```

### Grid CSS

```css
grid-template-columns: 200px 1fr 240px;
```

**Responsive collapse** (below 900px): Stats move to horizontal hero bar on top, layout becomes single-column.

### Left Column — Stats Stack

4 `StatCounter` primitives stacked vertically:

- **Agents** (cyan) — live agent count
- **Tasks** (pink) — active task count
- **PRs** (blue) — open PR count
- **Done** (cyan) — completed today count

### Center Column — Main Stage

- `PipelineFlow` at top — task status pipeline (queued → active → review → done) with animated arrows and glowing stage badges
- `MiniChart` below — completions per hour over last 24h, each bar a different neon color

### Right Column — Feed + Cost

- `ActivityFeed` (top, flex-grows) — live stream of agent events, PR updates, task completions. Colored glow dot per entry type. Auto-scrolls, newest at top.
- `NeonCard` with cost summary (bottom, pinned) — big number + trend indicator

### Background Layer

- `ScanlineOverlay` — 2% opacity, full page, behind content
- `ParticleField` — sparse floating neon dots, CSS-only, behind content
- Ambient radial gradient pools on page `background`

### Data Sources

Most data sources already exist. Two new IPC channels are needed:

| Widget          | Source                                                        | New IPC?                            |
| --------------- | ------------------------------------------------------------- | ----------------------------------- |
| Stats (counts)  | `sprintTasks` Zustand store, grouped by status                | No                                  |
| Pipeline stages | Same store, counts per status bucket                          | No                                  |
| MiniChart       | `agent_runs` table — new query with hourly GROUP BY bucketing | **Yes**: `agent:completionsPerHour` |
| ActivityFeed    | `agent_events` table — needs renderer access                  | **Yes**: `agent:recentEvents`       |
| Cost            | `costData` Zustand store                                      | No                                  |

**New IPC channels required:**

- `agent:completionsPerHour` — queries `agent_runs` table, groups by hour bucket over last 24h, returns `{ hour: string, count: number }[]`
- `agent:recentEvents` — queries `agent_events` table for latest N events, returns typed event list. Also subscribes to PR poller `pr:listUpdated` broadcasts for PR-related feed items.

## Section 4: Animation & Effects Spec

### Ambient Effects (always on)

**Scanline overlay:**

- `repeating-linear-gradient` horizontal lines
- Scrolling upward via `@keyframes` at ~30s per full cycle
- 2% opacity — texture, not distraction

**Particle field:**

- 15-20 small dots (2-4px) via absolutely positioned `<div>`s
- Randomized `@keyframes` paths over 20-40s cycles
- `animation-delay` offsets for staggered motion
- Neon-colored with matching `box-shadow` glow

**Ambient gradient pools:**

- 2-3 `radial-gradient` blobs on page background
- Slowly shift position via `@keyframes` (60s+ cycles)
- Very subtle — mood setter, not content competitor

### Interactive Effects

| Trigger                | Effect                                         | Timing                   |
| ---------------------- | ---------------------------------------------- | ------------------------ |
| Card hover             | Border glow 6px→16px, `scale(1.01)`            | 150ms ease               |
| StatCounter hover      | `text-shadow` brightens, glow pulses once      | 150ms + 300ms pulse      |
| PipelineFlow arrows    | Animated `stroke-dashoffset` cycling           | Continuous               |
| ActivityFeed new entry | `slideLeft` entrance (existing motion variant) | Spring, snappy           |
| MiniChart mount        | Bars grow from 0 height, staggered springs     | Existing stagger pattern |

### Persistent Animations

| Element               | Animation                           | Cycle                 |
| --------------------- | ----------------------------------- | --------------------- |
| StatCounter borders   | Glow oscillation (6px↔12px shadow)  | 3s, each offset ~0.5s |
| Pipeline active stage | Brighter pulse than inactive stages | 2s                    |
| StatusBar dot         | Breathing opacity (0.6→1.0)         | 2s                    |
| NeonCard borders      | Gradient angle rotation             | 8s                    |

### Reduced Motion Behavior

When `prefers-reduced-motion: reduce`:

- Glows stay on but don't animate
- Particles hidden
- Scanlines hidden
- Hover effects keep glow change, drop scale transform
- Gradient shifts stop (static angle)
- StatusBar dot stays solid

### Performance Budget

- Zero `requestAnimationFrame` loops
- Zero JS-driven animation ticks
- All CSS `@keyframes` or Framer Motion springs
- GPU-composited properties preferred (`transform`, `opacity`). Exception: `PipelineFlow` uses CSS `stroke-dashoffset` animation for arrow flow — lightweight and acceptable.
- Heaviest element: ParticleField at ~20 DOM elements with `will-change: transform`

## File Locations

| What                          | Where                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| V2 CSS tokens                 | `src/renderer/src/assets/base.css` (new `/* V2 Neon */` section)    |
| V2 TS tokens                  | `src/renderer/src/design-system/tokens.ts` (new `neon` namespace)   |
| Primitive components          | `src/renderer/src/components/neon/` (new directory)                 |
| Neon CSS (keyframes, classes) | `src/renderer/src/assets/neon.css` (new file)                       |
| Animation extensions          | `src/renderer/src/lib/motion.ts` (extend existing)                  |
| Dashboard view                | `src/renderer/src/views/DashboardView.tsx` (rewrite)                |
| Dashboard components          | `src/renderer/src/components/dashboard/` (rewrite using primitives) |

## Rollout Strategy

1. **Phase 1 — Foundation**: V2 tokens + neon CSS + primitive components. No views change yet.
2. **Phase 2 — Dashboard**: Rewrite DashboardView as Ops Deck using V2 primitives. This is the proof-of-concept.
3. **Phase 3 — Propagation**: Roll out primitives to other views one at a time (Agents → Sprint → PR Station → etc). Each view is an independent PR.
4. **Phase 4 — Polish**: Light theme adaptation, edge cases, performance profiling, reduced motion QA.

## Non-Goals

- No canvas/WebGL — CSS-only effects
- No new npm packages — Framer Motion already in deps
- Two new IPC channels needed (`agent:completionsPerHour`, `agent:recentEvents`) — minimal data plumbing
- No light theme in Phase 1-2 — addressed in Phase 4
