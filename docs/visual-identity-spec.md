# BDE — Visual Identity Spec v2

## 1. Design Philosophy

BDE should feel like piloting a spacecraft designed by Jony Ive — every surface breathes with translucent depth, every interaction has weight and inertia, every glow communicates state without demanding attention. The aesthetic is **liquid obsidian**: deep blacks that aren't flat but _dimensional_, panels that float above each other like sheets of tinted sapphire glass, and accent colors that bloom outward as light rather than sitting static as paint. This is not a code editor with a dark theme — it is an instrument panel for someone who commands AI agents the way a pilot commands systems. Premium is communicated through restraint: whitespace, perfect alignment, and surfaces that respond to context with cinematic smoothness.

---

## 2. Color System Evolution

### 2.1 Core Palette

```css
:root {
  /* Backgrounds — deeper and more layered than v1 */
  --bg-void:      #050507;   /* absolute deepest layer, behind everything */
  --bg-base:      #0A0A0F;   /* primary app background — has a faint blue undertone */
  --bg-surface:   #111118;   /* first elevation surface (sidebar, panels) */
  --bg-card:      #16161F;   /* card / interactive element background */
  --bg-hover:     #1C1C27;   /* hover state for cards */
  --bg-active:    #222230;   /* active/pressed state */

  /* Borders — slightly cooler, hint of blue */
  --border:       #1E1E2A;   /* default dividers, panel edges */
  --border-light: #2A2A3A;   /* elevated element borders */
  --border-glow:  #3A3A52;   /* prominent borders on modals, popovers */

  /* Text — unchanged from v1, these were already good */
  --text-primary:   #F5F5F7;
  --text-secondary: #98989F;
  --text-muted:     #5C5C63;
  --text-ghost:     #3A3A42;  /* new: ultra-dim for watermarks, bg-labels */

  /* Accent — Feast green with expanded range */
  --accent:         #00D37F;
  --accent-bright:  #33EDAA;  /* hover, emphasis */
  --accent-dim:     #00A863;  /* pressed, secondary */
  --accent-subtle:  rgba(0, 211, 127, 0.08);  /* tint for backgrounds */
  --accent-muted:   rgba(0, 211, 127, 0.15);  /* selection, badge bg */
  --accent-glow:    rgba(0, 211, 127, 0.25);  /* box-shadow glow */
  --accent-flare:   rgba(0, 211, 127, 0.40);  /* intense glow, focus rings */

  /* Semantic — richer and more saturated */
  --color-running: #00D37F;
  --color-warning: #FFAA33;
  --color-error:   #FF453A;
  --color-info:    #5B9EFF;
  --color-ai:      #A78BFA;
  --color-queued:  #6C8EEF;
}
```

### 2.2 Named Gradient Palette

Each gradient is named and has a specific use case. All gradients are defined as CSS custom properties.

```css
:root {
  /* —————————————————————————
     ACCENT GRADIENTS — used for active state borders, buttons, badges
     ————————————————————————— */

  /* Aurora — primary brand gradient. Green to teal. Used on primary CTAs, active tab indicators */
  --gradient-aurora: linear-gradient(135deg, #00D37F 0%, #00B4D8 100%);

  /* Electric — high-energy blue-purple. Used for AI/agent-related accents, thinking state */
  --gradient-electric: linear-gradient(135deg, #6C8EEF 0%, #A78BFA 50%, #C084FC 100%);

  /* Solar — warm amber to orange. Used for warnings, cost indicators, token counters */
  --gradient-solar: linear-gradient(135deg, #FFAA33 0%, #FF6B35 100%);

  /* Ember — red to pink. Used for error states, destructive actions */
  --gradient-ember: linear-gradient(135deg, #FF453A 0%, #FF6B8A 100%);

  /* —————————————————————————
     SURFACE GRADIENTS — used for panel backgrounds, card fills
     ————————————————————————— */

  /* Frost — extremely subtle cool gradient for elevated glass panels */
  --gradient-frost: linear-gradient(
    180deg,
    rgba(90, 120, 200, 0.06) 0%,
    rgba(60, 60, 120, 0.02) 100%
  );

  /* Midnight — dark gradient for sidebar and deep panels */
  --gradient-midnight: linear-gradient(
    180deg,
    rgba(16, 16, 28, 0.95) 0%,
    rgba(8, 8, 16, 0.98) 100%
  );

  /* Horizon — subtle green-to-blue tint for the active session panel bg */
  --gradient-horizon: linear-gradient(
    160deg,
    rgba(0, 211, 127, 0.04) 0%,
    rgba(108, 142, 239, 0.03) 50%,
    rgba(10, 10, 15, 0.0) 100%
  );

  /* Shimmer — animated gradient for loading states and skeleton screens */
  --gradient-shimmer: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.0) 0%,
    rgba(255, 255, 255, 0.03) 50%,
    rgba(255, 255, 255, 0.0) 100%
  );
}
```

### 2.3 Gradient Border Technique

For accent-bordered elements (active session card, focused input, primary button), use a gradient border via background-clip:

```css
.gradient-border {
  position: relative;
  border-radius: 10px;
  background: var(--bg-card);
}

.gradient-border::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  padding: 1px;
  background: var(--gradient-aurora);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

### 2.4 Gradient Text

For headings, section titles, and emphasis spans:

```css
.text-gradient-aurora {
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.text-gradient-electric {
  background: var(--gradient-electric);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

Usage: Apply to the "BDE" logotype in the title bar, section headings on settings/onboarding, and the model name badge when the agent is actively reasoning.

---

## 3. Glass Morphism System

### 3.1 Glass Tokens

```css
:root {
  /* Blur intensities */
  --glass-blur-sm:    blur(8px);
  --glass-blur-md:    blur(16px);
  --glass-blur-lg:    blur(24px);
  --glass-blur-xl:    blur(40px);

  /* Saturation boost — makes colors behind the glass richer */
  --glass-saturate:   saturate(180%);

  /* Glass tints — the background-color of glass panels */
  --glass-tint-dark:   rgba(10, 10, 18, 0.75);     /* sidebar, nav */
  --glass-tint-mid:    rgba(16, 16, 26, 0.70);      /* cards, panels */
  --glass-tint-light:  rgba(22, 22, 34, 0.60);      /* popovers, modals */
  --glass-tint-ultra:  rgba(30, 30, 48, 0.50);      /* command palette, spotlight */
}
```

### 3.2 Glass Panel Classes

```css
/* Base glass — sidebar panels, session list, file tree */
.glass {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border: 1px solid var(--border);
}

/* Elevated glass — floating cards, active session detail, info popovers */
.glass-elevated {
  background: var(--glass-tint-mid);
  backdrop-filter: var(--glass-blur-lg) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur-lg) var(--glass-saturate);
  border: 1px solid var(--border-light);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.40),
    0 0 0 0.5px rgba(255, 255, 255, 0.05) inset;
}

/* Modal glass — command palette, dialogs, overlays */
.glass-modal {
  background: var(--glass-tint-light);
  backdrop-filter: var(--glass-blur-xl) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur-xl) var(--glass-saturate);
  border: 1px solid var(--border-glow);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.60),
    0 0 0 0.5px rgba(255, 255, 255, 0.08) inset,
    0 0 60px rgba(0, 211, 127, 0.03);
}

/* Frosted highlight — the subtle white inner edge that makes glass feel physical */
.glass-highlight {
  box-shadow:
    inset 0 0.5px 0 0 rgba(255, 255, 255, 0.06),
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.04);
}
```

### 3.3 Glass Inner Glow (visionOS-style)

Apple visionOS uses a very subtle top-edge light reflection on glass elements. Replicate this:

```css
.glass::after {
  content: '';
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  pointer-events: none;
}
```

---

## 4. Typography Upgrade

### 4.1 Font Stack

```css
:root {
  /* UI font — Inter for clean, geometric UI labels */
  --font-ui: 'Inter', 'SF Pro Display', system-ui, sans-serif;

  /* Mono font — JetBrains Mono for all code and data */
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace;

  /* Display font — for BDE logotype and large headings only */
  --font-display: 'Inter', 'SF Pro Display', system-ui, sans-serif;
}
```

### 4.2 Type Scale

```css
/* UI text — Inter */
--text-2xs:   10px / 14px;   /* status bar, timestamps, token counts */
--text-xs:    11px / 16px;   /* labels, badges, sidebar meta */
--text-sm:    13px / 20px;   /* default body, menu items, descriptions */
--text-base:  14px / 22px;   /* emphasized body, panel titles */
--text-lg:    16px / 24px;   /* section headings */
--text-xl:    20px / 28px;   /* page titles */
--text-2xl:   28px / 36px;   /* onboarding / splash headings */
--text-3xl:   36px / 44px;   /* hero text, marketing-style moments */

/* Mono text — JetBrains Mono (always -1px vs UI equivalent) */
--mono-2xs:   9px / 14px;    /* micro stats */
--mono-xs:    10px / 16px;   /* log lines, CLI output */
--mono-sm:    12px / 18px;   /* primary code / session feed */
--mono-base:  13px / 20px;   /* editor, expanded diffs */

/* Letter-spacing */
--tracking-tight:  -0.02em;  /* headings xl+ */
--tracking-normal:  0;       /* body text */
--tracking-wide:    0.06em;  /* "BDE" logotype, status labels */
--tracking-widest:  0.12em;  /* section divider labels */
```

### 4.3 Heading Treatments

```css
/* Section headings — uppercase, wide-tracked, gradient or muted */
.heading-section {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: var(--tracking-widest);
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Page titles — gradient text, tight tracking */
.heading-page {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Hero titles — onboarding, empty states */
.heading-hero {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #F5F5F7 0%, #98989F 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### 4.4 "BDE" Logotype

The "BDE" text in the title bar should be treated as a logomark:

```css
.logotype {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: var(--tracking-wide);
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 20px rgba(0, 211, 127, 0.3);
  /* Note: text-shadow won't render on clipped text — use a duplicate layer */
}

/* Glow layer behind logotype */
.logotype-glow {
  position: absolute;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: var(--tracking-wide);
  color: var(--accent);
  filter: blur(8px);
  opacity: 0.4;
  pointer-events: none;
  user-select: none;
}
```

---

## 5. Elevation System (4 Levels)

Inspired by visionOS and macOS layering. Each level adds blur, luminance, and shadow.

### Level 0 — Void (app background)

```css
.elevation-0 {
  background: var(--bg-void);
  /* No blur, no border, no shadow. This is the abyss. */
  /* Optional: radial gradient center glow */
  background:
    radial-gradient(
      ellipse 60% 40% at 50% 0%,
      rgba(0, 211, 127, 0.015) 0%,
      transparent 100%
    ),
    var(--bg-void);
}
```

### Level 1 — Base Surface (sidebars, panel backgrounds)

```css
.elevation-1 {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.20);
}
```

### Level 2 — Floating (cards, popovers, dropdown menus)

```css
.elevation-2 {
  background: var(--glass-tint-mid);
  backdrop-filter: var(--glass-blur-lg) var(--glass-saturate);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.35),
    0 0 0 0.5px rgba(255, 255, 255, 0.05) inset;
}
```

### Level 3 — Overlay (modals, command palette, dialogs)

```css
.elevation-3 {
  background: var(--glass-tint-light);
  backdrop-filter: var(--glass-blur-xl) var(--glass-saturate);
  border: 1px solid var(--border-glow);
  border-radius: 16px;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.55),
    0 8px 24px rgba(0, 0, 0, 0.25),
    0 0 0 0.5px rgba(255, 255, 255, 0.08) inset;
}

/* Overlay backdrop scrim */
.elevation-3-backdrop {
  background: rgba(0, 0, 0, 0.50);
  backdrop-filter: blur(8px) saturate(120%);
}
```

### Level 4 — Spotlight (toast notifications, critical alerts)

```css
.elevation-4 {
  background: var(--glass-tint-ultra);
  backdrop-filter: var(--glass-blur-xl) var(--glass-saturate);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 16px;
  box-shadow:
    0 32px 100px rgba(0, 0, 0, 0.60),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset,
    0 0 80px rgba(0, 211, 127, 0.05);
}
```

---

## 6. Glow Effects

### 6.1 Accent Glow (active states, running sessions)

```css
/* Subtle glow — applied to active/selected elements */
.glow-accent-sm {
  box-shadow:
    0 0 8px rgba(0, 211, 127, 0.15),
    0 0 0 1px rgba(0, 211, 127, 0.20);
}

/* Medium glow — focused inputs, primary buttons */
.glow-accent-md {
  box-shadow:
    0 0 16px rgba(0, 211, 127, 0.20),
    0 0 4px rgba(0, 211, 127, 0.30),
    0 0 0 1px rgba(0, 211, 127, 0.40);
}

/* Large glow — hero elements, running session card, active agent */
.glow-accent-lg {
  box-shadow:
    0 0 40px rgba(0, 211, 127, 0.15),
    0 0 16px rgba(0, 211, 127, 0.25),
    0 0 4px rgba(0, 211, 127, 0.35),
    0 0 0 1px rgba(0, 211, 127, 0.50);
}
```

### 6.2 Status Glows

```css
/* Each status color has its own glow for running indicators */
.glow-running { box-shadow: 0 0 12px rgba(0, 211, 127, 0.25), 0 0 0 1px rgba(0, 211, 127, 0.30); }
.glow-error   { box-shadow: 0 0 12px rgba(255, 69, 58, 0.25), 0 0 0 1px rgba(255, 69, 58, 0.30); }
.glow-warning { box-shadow: 0 0 12px rgba(255, 170, 51, 0.25), 0 0 0 1px rgba(255, 170, 51, 0.30); }
.glow-info    { box-shadow: 0 0 12px rgba(91, 158, 255, 0.25), 0 0 0 1px rgba(91, 158, 255, 0.30); }
.glow-ai      { box-shadow: 0 0 12px rgba(167, 139, 250, 0.25), 0 0 0 1px rgba(167, 139, 250, 0.30); }
```

### 6.3 Pulsing Glow (for "running" state)

```css
@keyframes pulse-glow {
  0%, 100% {
    box-shadow:
      0 0 8px rgba(0, 211, 127, 0.15),
      0 0 0 1px rgba(0, 211, 127, 0.20);
  }
  50% {
    box-shadow:
      0 0 20px rgba(0, 211, 127, 0.25),
      0 0 4px rgba(0, 211, 127, 0.35),
      0 0 0 1px rgba(0, 211, 127, 0.40);
  }
}

.glow-pulse {
  animation: pulse-glow 2.5s ease-in-out infinite;
}
```

### 6.4 Text Glow

```css
/* Heading glow — used sparingly on gradient text headings */
.text-glow-accent {
  text-shadow:
    0 0 20px rgba(0, 211, 127, 0.3),
    0 0 40px rgba(0, 211, 127, 0.1);
}

.text-glow-electric {
  text-shadow:
    0 0 20px rgba(108, 142, 239, 0.3),
    0 0 40px rgba(167, 139, 250, 0.1);
}
```

---

## 7. Motion Principles

### 7.1 Philosophy

Motion in BDE communicates **physics and hierarchy**, not decoration. Every animation should answer: _where did this come from, and how important is it?_ Premium motion is defined by three qualities:

- **Spring-based**: No linear or ease-in-out. Natural spring physics with configurable stiffness/damping.
- **Directional**: Elements enter from the direction they logically originate. Sidebar items slide from left. Notifications drop from top. Modals scale from center.
- **Layered timing**: Background elements settle first, foreground elements animate last. Creates depth.

### 7.2 Spring Presets

```ts
export const SPRINGS = {
  // Snappy — buttons, toggles, micro-interactions
  snappy: { type: 'spring', stiffness: 500, damping: 30, mass: 0.8 },

  // Default — most panel transitions, cards appearing
  default: { type: 'spring', stiffness: 350, damping: 28, mass: 1 },

  // Smooth — modals, page transitions, large layout shifts
  smooth: { type: 'spring', stiffness: 250, damping: 24, mass: 1.2 },

  // Gentle — background elements, aurora, ambient effects
  gentle: { type: 'spring', stiffness: 120, damping: 20, mass: 1.5 },

  // Bounce — celebratory moments (PR merged, session complete)
  bounce: { type: 'spring', stiffness: 400, damping: 15, mass: 0.6 },
} as const
```

### 7.3 Transition Presets

```ts
export const TRANSITIONS = {
  // Instant feedback — hover states, focus rings (no spring, just fast)
  instant: { duration: 0.1, ease: 'easeOut' },

  // Crossfade — content swaps, tab switches
  crossfade: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },

  // Layout — panel resize, sidebar collapse
  layout: { type: 'spring', stiffness: 300, damping: 30, mass: 1 },
} as const
```

### 7.4 Animation Variants (Framer Motion)

```ts
export const VARIANTS = {
  // Fade in — simplest entrance
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },

  // Slide up — cards, list items, feed lines
  slideUp: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },

  // Slide from left — sidebar items, nav entering
  slideLeft: {
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
  },

  // Scale in — modals, command palette, dialogs
  scaleIn: {
    initial: { opacity: 0, scale: 0.95, filter: 'blur(4px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.95, filter: 'blur(4px)' },
  },

  // Drop in — notifications, toasts (from top)
  dropIn: {
    initial: { opacity: 0, y: -20, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -10, scale: 0.97 },
  },

  // Stagger container — for lists of items
  staggerContainer: {
    animate: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
  },

  // Stagger child — individual items in a staggered list
  staggerChild: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
  },
}
```

### 7.5 Rules

1. **60fps or nothing.** Use `transform` and `opacity` exclusively for animated properties. Never animate `width`, `height`, `top`, `left`, or `border-radius` during motion.
2. **GPU-accelerated.** Apply `will-change: transform, opacity` to elements that will animate. Remove after animation completes.
3. **Reduce motion.** Respect `prefers-reduced-motion: reduce` — collapse all springs to instant crossfades.
4. **No animation > 400ms.** If a transition takes longer, the UI feels sluggish. Exception: ambient background effects (aurora, shimmer).
5. **Hover transitions: 150ms max.** Hover states must feel instant. Use `transition: all 0.15s ease-out` for CSS-driven hovers.
6. **Exit faster than enter.** Exit animations should be ~60% the duration of entrance animations. Users don't want to watch things leave.

---

## 8. Component-Specific Upgrades

### 8.1 Session Card (elevated from v1)

```tsx
<motion.button
  variants={VARIANTS.staggerChild}
  transition={SPRINGS.default}
  whileHover={{ scale: 1.008, transition: TRANSITIONS.instant }}
  whileTap={{ scale: 0.998 }}
  className={cn(
    'glass glass-highlight w-full text-left p-3 rounded-xl transition-colors',
    isSelected && 'gradient-border glow-accent-sm',
    isRunning && !isSelected && 'glow-pulse',
  )}
>
  {/* Content unchanged from v1 */}
</motion.button>
```

### 8.2 Command Palette (glass-modal tier)

```tsx
<motion.div
  className="glass-modal w-[580px] rounded-2xl overflow-hidden"
  variants={VARIANTS.scaleIn}
  transition={SPRINGS.smooth}
>
  {/* Top edge glow */}
  <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.12)] to-transparent" />

  <Command>
    <Command.Input
      className="font-mono text-sm bg-transparent border-b border-[--border] px-5 py-4 outline-none text-[--text-primary] placeholder:text-[--text-muted]"
    />
    <Command.List className="max-h-[400px] overflow-y-auto py-2" />
  </Command>
</motion.div>
```

### 8.3 Title Bar

```tsx
<div className="h-11 flex items-center px-4 gap-4 border-b border-[--border] select-none bg-[--glass-tint-dark] backdrop-blur-md">
  {/* Traffic lights */}
  {/* Logotype with glow */}
  <span className="relative">
    <span className="logotype-glow" aria-hidden>BDE</span>
    <span className="logotype">BDE</span>
  </span>

  {/* Gradient separator */}
  <div className="w-px h-4 bg-gradient-to-b from-transparent via-[--border-light] to-transparent" />

  {/* Counters — unchanged */}
</div>
```

### 8.4 Primary Button

```css
.btn-primary {
  background: var(--gradient-aurora);
  color: #050507;
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 20px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease-out;
  box-shadow: 0 0 16px rgba(0, 211, 127, 0.20);
}

.btn-primary:hover {
  box-shadow:
    0 0 24px rgba(0, 211, 127, 0.30),
    0 0 8px rgba(0, 211, 127, 0.40);
  filter: brightness(1.1);
}

.btn-primary:active {
  filter: brightness(0.95);
  transform: scale(0.98);
}
```

### 8.5 Ghost / Glass Button

```css
.btn-glass {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease-out;
  backdrop-filter: blur(8px);
}

.btn-glass:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--border-light);
  color: var(--text-primary);
}

.btn-glass:active {
  background: rgba(255, 255, 255, 0.06);
  transform: scale(0.98);
}
```

---

## 9. Reference Points

These are the north-star products/interfaces BDE should channel:

| Reference | What to take from it |
|-----------|---------------------|
| **Apple visionOS** | Glass panel layering, top-edge highlight, depth through blur intensity, shadow scaling per elevation |
| **Linear.app** | Keyboard-driven speed, subtle gradients in UI chrome, immaculate typography, command palette UX |
| **Raycast** | Snappy spring animations, frosted glass popover, smooth list transitions, how a tool feels _fast_ |
| **Arc Browser** | Sidebar glass morphism, gradient accents, how a dark UI can feel warm and alive, not cold |
| **Vercel Dashboard** | Restrained elegance, monospace as a design feature not a limitation, status indicators with glow |
| **Warp Terminal** | AI-native terminal aesthetic, how to make a dev tool feel premium, block-based interaction model |
| **Apple Music (macOS)** | Background gradient ambient effects reacting to content, smooth crossfade transitions |
| **Framer** | Canvas-feel precision, how overlapping translucent panels create richness without clutter |

### Mood Keywords

_Obsidian. Liquid glass. Aurora borealis under black ice. A cockpit at night — every light is meaningful, every surface whispers depth. Not cyberpunk — too noisy. Not minimalist — too sterile. Think: premium stealth._

---

## 10. Implementation Priority

1. **Glass system** — Convert all panels to glass morphism. Biggest visual impact.
2. **Elevation shadows** — Apply the 4-level shadow system. Creates instant depth.
3. **Gradient borders** — Active session card, focused inputs, command palette.
4. **Glow effects** — Running state pulse, accent glows on interactive elements.
5. **Typography** — Gradient text on logotype + headings, letter-spacing refinements.
6. **Spring motion** — Replace all tween animations with spring presets.
7. **Aurora / ambient effects** — Background gradients on the home view.
8. **Gradient buttons** — Primary CTA and special actions.
