# IntelliJ Professional Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pro Dark and Pro Light themes inspired by IntelliJ's New UI — muted palettes, compact density, zero neon effects — as two new entries in the existing 3-theme selector (expanding to 5).

**Architecture:** CSS variable override approach — add `html.theme-pro-dark` and `html.theme-pro-light` selector blocks to existing CSS files (`base.css`, `neon.css`, `design-system.css`), update the Zustand theme store to handle 5 themes, and expand the Settings UI selector.

**Tech Stack:** CSS custom properties, Zustand, React, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-intellij-pro-themes-design.md`

---

### Task 1: Theme Store — Expand to 5 Themes

**Files:**
- Modify: `src/renderer/src/stores/theme.ts`
- Modify: `src/renderer/src/stores/__tests__/theme.test.ts`

- [ ] **Step 1: Write failing tests for new themes**

Add tests to `theme.test.ts`:

```ts
it('setTheme to pro-dark updates state', () => {
  useThemeStore.getState().setTheme('pro-dark')
  expect(useThemeStore.getState().theme).toBe('pro-dark')
})

it('setTheme pro-dark adds theme-pro-dark class to document', () => {
  useThemeStore.getState().setTheme('pro-dark')
  expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  expect(document.documentElement.classList.contains('theme-light')).toBe(false)
})

it('setTheme to pro-light updates state', () => {
  useThemeStore.getState().setTheme('pro-light')
  expect(useThemeStore.getState().theme).toBe('pro-light')
})

it('setTheme pro-light adds theme-pro-light class to document', () => {
  useThemeStore.getState().setTheme('pro-light')
  expect(document.documentElement.classList.contains('theme-pro-light')).toBe(true)
})

it('setTheme pro-dark persists to localStorage', () => {
  useThemeStore.getState().setTheme('pro-dark')
  expect(localStorage.getItem('bde-theme')).toBe('pro-dark')
})

it('toggleTheme cycles warm to pro-dark', () => {
  useThemeStore.setState({ theme: 'warm' })
  useThemeStore.getState().toggleTheme()
  expect(useThemeStore.getState().theme).toBe('pro-dark')
})

it('toggleTheme cycles pro-dark to pro-light', () => {
  useThemeStore.setState({ theme: 'pro-dark' })
  useThemeStore.getState().toggleTheme()
  expect(useThemeStore.getState().theme).toBe('pro-light')
})

it('toggleTheme cycles pro-light to dark', () => {
  useThemeStore.setState({ theme: 'pro-light' })
  useThemeStore.getState().toggleTheme()
  expect(useThemeStore.getState().theme).toBe('dark')
})
```

Update `beforeEach` to also remove `'theme-pro-dark', 'theme-pro-light'` from classList.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/renderer/src/stores/__tests__/theme.test.ts`
Expected: FAIL — TypeScript errors on `'pro-dark'` and `'pro-light'` not assignable to `Theme`

- [ ] **Step 3: Update theme store**

In `theme.ts`:

1. Expand type: `type Theme = 'dark' | 'light' | 'warm' | 'pro-dark' | 'pro-light'`

2. Update `applyTheme()`:
```ts
function applyTheme(t: Theme): void {
  document.documentElement.classList.remove('theme-light', 'theme-warm', 'theme-pro-dark', 'theme-pro-light')
  if (t === 'light') document.documentElement.classList.add('theme-light')
  else if (t === 'warm') document.documentElement.classList.add('theme-warm')
  else if (t === 'pro-dark') document.documentElement.classList.add('theme-pro-dark')
  else if (t === 'pro-light') document.documentElement.classList.add('theme-pro-light')
}
```

3. Update `toggleTheme()` cycle:
```ts
const order: Theme[] = ['dark', 'light', 'warm', 'pro-dark', 'pro-light']
const idx = order.indexOf(s.theme)
const next = order[(idx + 1) % order.length]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/renderer/src/stores/__tests__/theme.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/theme.ts src/renderer/src/stores/__tests__/theme.test.ts
git commit -m "feat: expand theme store to support 5 themes (pro-dark, pro-light)"
```

---

### Task 2: CSS — Pro Dark Theme Variables

**Files:**
- Modify: `src/renderer/src/assets/base.css` (add `html.theme-pro-dark` block after `html.theme-warm`)
- Modify: `src/renderer/src/assets/neon.css` (add `html.theme-pro-dark` block after existing theme blocks)
- Modify: `src/renderer/src/assets/design-system.css` (add `html.theme-pro-dark` glass/elevation overrides)

- [ ] **Step 1: Add Pro Dark block to base.css**

Add after the `html.theme-warm` block (which ends around line 600). Use the exact color values from the spec:

```css
/* ── Pro Dark — IntelliJ-inspired professional theme ────── */
html.theme-pro-dark {
  /* Core palette */
  --bde-bg: #1e1f22;
  --bde-surface: #2b2d30;
  --bde-surface-high: #393b40;
  --bde-border: #393b40;
  --bde-border-hover: #4e5157;
  --bde-accent: #4a88c7;
  --bde-accent-dim: #3a6d9e;
  --bde-accent-hover: #5a9ad8;
  --bde-text: #bcbec4;
  --bde-text-muted: #8c8f94;
  --bde-text-dim: #6f737a;

  /* Semantic */
  --bde-danger: #db5c5c;
  --bde-warning: #e6a235;
  --bde-info: #4a88c7;
  --bde-success: #5fad65;

  /* Interaction states — solid, no transparency effects */
  --bde-hover: #2f3134;
  --bde-selected: #2d4566;
  --bde-overlay: rgba(0, 0, 0, 0.5);

  /* Shadows — subtle, no glow */
  --bde-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --bde-shadow-md: 0 2px 8px rgba(0, 0, 0, 0.25);
  --bde-shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.3);

  /* Gradients — disabled, solid fallbacks */
  --bde-gradient-aurora: none;
  --bde-gradient-electric: none;
  --bde-gradient-solar: none;
  --bde-gradient-ember: none;

  /* Compact density */
  --bde-space-1: 3px;
  --bde-space-2: 6px;
  --bde-space-3: 8px;
  --bde-space-4: 12px;
  --bde-space-5: 14px;
  --bde-space-6: 18px;
  --bde-space-7: 22px;
  --bde-space-8: 28px;
  --bde-size-2xs: 9px;
  --bde-size-xs: 10px;
  --bde-size-sm: 11px;
  --bde-size-base: 12px;
  --bde-size-lg: 13px;
  --bde-size-xl: 15px;
  --bde-size-xxl: 18px;
  --bde-radius-sm: 3px;
  --bde-radius-md: 4px;
  --bde-radius-lg: 6px;
}
```

Also override any visual-identity-v2 variables, glass tints, and foreground/background layers present in the existing theme blocks. Mirror the structure of `html.theme-warm` to ensure nothing is missed — check every variable it overrides and provide a pro-dark equivalent.

- [ ] **Step 2: Add Pro Dark block to neon.css**

Add after existing theme blocks:

```css
/* ── Pro Dark — neon zeroing ────── */
html.theme-pro-dark {
  /* Effects off */
  --neon-scanline-opacity: 0;
  --neon-particle-count: 0;
  --neon-glass-blur: none;
  --neon-glass-edge: none;
  --neon-glass-shadow: none;

  /* Glow off */
  --neon-cyan-glow: transparent;
  --neon-pink-glow: transparent;
  --neon-blue-glow: transparent;
  --neon-purple-glow: transparent;
  --neon-orange-glow: transparent;
  --neon-red-glow: transparent;

  /* Remap neon colors to muted equivalents */
  --neon-cyan: #4a88c7;
  --neon-pink: #b07cc7;
  --neon-blue: #4a88c7;
  --neon-purple: #8a7cb5;
  --neon-orange: #c9923a;
  --neon-red: #cc5858;

  /* Neon surfaces → pro dark palette */
  --neon-surface-deep: #1e1f22;
  --neon-surface-base: #2b2d30;
  --neon-surface-mid: #393b40;
  --neon-border-base: #393b40;
  --neon-text-primary: #bcbec4;
  --neon-text-secondary: #8c8f94;
  --neon-text-tertiary: #6f737a;

  /* Neon color surfaces/borders → subtle tints */
  --neon-cyan-surface: rgba(74, 136, 199, 0.1);
  --neon-cyan-border: rgba(74, 136, 199, 0.25);
  --neon-pink-surface: rgba(176, 124, 199, 0.1);
  --neon-pink-border: rgba(176, 124, 199, 0.25);
  --neon-blue-surface: rgba(74, 136, 199, 0.1);
  --neon-blue-border: rgba(74, 136, 199, 0.25);
  --neon-purple-surface: rgba(138, 124, 181, 0.1);
  --neon-purple-border: rgba(138, 124, 181, 0.25);
  --neon-orange-surface: rgba(201, 146, 58, 0.1);
  --neon-orange-border: rgba(201, 146, 58, 0.25);
  --neon-red-surface: rgba(204, 88, 88, 0.1);
  --neon-red-border: rgba(204, 88, 88, 0.25);
}
```

Check the full `:root` block in `neon.css` for any variables not listed above — override them all.

- [ ] **Step 3: Add Pro Dark block to design-system.css**

Mirror the existing `html.theme-light` overrides (around line 986):

```css
html.theme-pro-dark .glass-modal {
  background: #2b2d30;
  backdrop-filter: none;
}
html.theme-pro-dark .glass-highlight {
  display: none;
}
html.theme-pro-dark .glass::after {
  display: none;
}
html.theme-pro-dark .elevation-3 {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
html.theme-pro-dark .elevation-3-backdrop {
  background: rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 4: Visual verification**

Run: `npm run dev`
Open Settings → Appearance → click Pro Dark (if UI task is done) or manually add `theme-pro-dark` class to `<html>` in DevTools.
Walk through all views: Dashboard, Agents, IDE, Pipeline, Code Review, Source Control, Settings.
Verify: no neon glow, no particles, no scanlines, blue accent, compact spacing, readable text on all surfaces.

- [ ] **Step 5: Run checks**

Run: `npm run typecheck && npm test && npm run lint`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/base.css src/renderer/src/assets/neon.css src/renderer/src/assets/design-system.css
git commit -m "feat: add Pro Dark theme CSS variables (IntelliJ-inspired)"
```

---

### Task 3: CSS — Pro Light Theme Variables

**Files:**
- Modify: `src/renderer/src/assets/base.css` (add `html.theme-pro-light` block after `html.theme-pro-dark`)
- Modify: `src/renderer/src/assets/neon.css` (add `html.theme-pro-light` block)
- Modify: `src/renderer/src/assets/design-system.css` (add `html.theme-pro-light` glass/elevation overrides)

- [ ] **Step 1: Add Pro Light block to base.css**

Add after the Pro Dark block:

```css
/* ── Pro Light — IntelliJ-inspired professional light theme ────── */
html.theme-pro-light {
  /* Core palette */
  --bde-bg: #f7f8fa;
  --bde-surface: #ffffff;
  --bde-surface-high: #ebedf0;
  --bde-border: #d4d5d8;
  --bde-border-hover: #b8bac0;
  --bde-accent: #2675bf;
  --bde-accent-dim: #1a5c99;
  --bde-accent-hover: #3085cf;
  --bde-text: #1e1f22;
  --bde-text-muted: #5e6166;
  --bde-text-dim: #818388;

  /* Semantic */
  --bde-danger: #cc4848;
  --bde-warning: #c97a1a;
  --bde-info: #2675bf;
  --bde-success: #49a04b;

  /* Interaction states */
  --bde-hover: #eef0f3;
  --bde-selected: #d4e4f5;
  --bde-overlay: rgba(0, 0, 0, 0.3);

  /* Shadows */
  --bde-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
  --bde-shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
  --bde-shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.12);

  /* Gradients disabled */
  --bde-gradient-aurora: none;
  --bde-gradient-electric: none;
  --bde-gradient-solar: none;
  --bde-gradient-ember: none;

  /* Compact density (same as pro-dark) */
  --bde-space-1: 3px;
  --bde-space-2: 6px;
  --bde-space-3: 8px;
  --bde-space-4: 12px;
  --bde-space-5: 14px;
  --bde-space-6: 18px;
  --bde-space-7: 22px;
  --bde-space-8: 28px;
  --bde-size-2xs: 9px;
  --bde-size-xs: 10px;
  --bde-size-sm: 11px;
  --bde-size-base: 12px;
  --bde-size-lg: 13px;
  --bde-size-xl: 15px;
  --bde-size-xxl: 18px;
  --bde-radius-sm: 3px;
  --bde-radius-md: 4px;
  --bde-radius-lg: 6px;
}
```

Mirror every variable overridden in the existing `html.theme-light` block — provide pro-light equivalents for all of them.

- [ ] **Step 2: Add Pro Light block to neon.css**

Same neon zeroing as Pro Dark but with light-appropriate surfaces:

```css
html.theme-pro-light {
  /* Same effect zeroing as pro-dark */
  --neon-scanline-opacity: 0;
  --neon-particle-count: 0;
  --neon-glass-blur: none;
  --neon-glass-edge: none;
  --neon-glass-shadow: none;
  --neon-cyan-glow: transparent;
  --neon-pink-glow: transparent;
  --neon-blue-glow: transparent;
  --neon-purple-glow: transparent;
  --neon-orange-glow: transparent;
  --neon-red-glow: transparent;

  /* Neon colors → muted for light background */
  --neon-cyan: #2675bf;
  --neon-pink: #8e4fa0;
  --neon-blue: #2675bf;
  --neon-purple: #6b5fa0;
  --neon-orange: #b07818;
  --neon-red: #b83c3c;

  /* Neon surfaces → pro light palette */
  --neon-surface-deep: #f7f8fa;
  --neon-surface-base: #ffffff;
  --neon-surface-mid: #ebedf0;
  --neon-border-base: #d4d5d8;
  --neon-text-primary: #1e1f22;
  --neon-text-secondary: #5e6166;
  --neon-text-tertiary: #818388;

  /* Color surfaces/borders → light tints */
  --neon-cyan-surface: rgba(38, 117, 191, 0.08);
  --neon-cyan-border: rgba(38, 117, 191, 0.2);
  --neon-pink-surface: rgba(142, 79, 160, 0.08);
  --neon-pink-border: rgba(142, 79, 160, 0.2);
  --neon-blue-surface: rgba(38, 117, 191, 0.08);
  --neon-blue-border: rgba(38, 117, 191, 0.2);
  --neon-purple-surface: rgba(107, 95, 160, 0.08);
  --neon-purple-border: rgba(107, 95, 160, 0.2);
  --neon-orange-surface: rgba(176, 120, 24, 0.08);
  --neon-orange-border: rgba(176, 120, 24, 0.2);
  --neon-red-surface: rgba(184, 60, 60, 0.08);
  --neon-red-border: rgba(184, 60, 60, 0.2);
}
```

- [ ] **Step 3: Add Pro Light block to design-system.css**

```css
html.theme-pro-light .glass-modal {
  background: #ffffff;
  backdrop-filter: none;
}
html.theme-pro-light .glass-highlight {
  display: none;
}
html.theme-pro-light .glass::after {
  display: none;
}
html.theme-pro-light .elevation-3 {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
html.theme-pro-light .elevation-3-backdrop {
  background: rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 4: Visual verification**

Same as Task 2 step 4 but for Pro Light. Verify light backgrounds, dark text, no neon effects, blue accent, compact spacing.

- [ ] **Step 5: Run checks**

Run: `npm run typecheck && npm test && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/base.css src/renderer/src/assets/neon.css src/renderer/src/assets/design-system.css
git commit -m "feat: add Pro Light theme CSS variables (IntelliJ-inspired)"
```

---

### Task 4: Settings UI — 5-Theme Selector

**Files:**
- Modify: `src/renderer/src/components/settings/AppearanceSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `AppearanceSection.test.tsx`:

```ts
it('renders Pro Dark and Pro Light theme buttons', () => {
  render(<AppearanceSection />)
  expect(screen.getByRole('button', { name: /pro dark/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /pro light/i })).toBeInTheDocument()
})

it('clicking Pro Dark sets theme to pro-dark', async () => {
  render(<AppearanceSection />)
  await userEvent.click(screen.getByRole('button', { name: /pro dark/i }))
  expect(useThemeStore.getState().theme).toBe('pro-dark')
})

it('clicking Pro Light sets theme to pro-light', async () => {
  render(<AppearanceSection />)
  await userEvent.click(screen.getByRole('button', { name: /pro light/i }))
  expect(useThemeStore.getState().theme).toBe('pro-light')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`
Expected: FAIL — buttons not found

- [ ] **Step 3: Update AppearanceSection**

Add Pro Dark and Pro Light buttons to the theme selector. Group them with labels — "Fun" row (Dark, Light, Warm) and "Professional" row (Pro Dark, Pro Light):

```tsx
<SettingsCard title="Theme" subtitle="Choose your visual theme">
  <div style={{ fontSize: 11, color: 'var(--bde-text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fun</div>
  <div className="settings-theme-buttons">
    <button className={`bde-btn bde-btn--sm ${theme === 'dark' ? 'bde-btn--primary' : 'bde-btn--ghost'}`} onClick={() => setTheme('dark')} type="button" aria-pressed={theme === 'dark'}>Dark</button>
    <button className={`bde-btn bde-btn--sm ${theme === 'light' ? 'bde-btn--primary' : 'bde-btn--ghost'}`} onClick={() => setTheme('light')} type="button" aria-pressed={theme === 'light'}>Light</button>
    <button className={`bde-btn bde-btn--sm ${theme === 'warm' ? 'bde-btn--primary' : 'bde-btn--ghost'}`} onClick={() => setTheme('warm')} type="button" aria-pressed={theme === 'warm'}>Warm</button>
  </div>
  <div style={{ fontSize: 11, color: 'var(--bde-text-dim)', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Professional</div>
  <div className="settings-theme-buttons">
    <button className={`bde-btn bde-btn--sm ${theme === 'pro-dark' ? 'bde-btn--primary' : 'bde-btn--ghost'}`} onClick={() => setTheme('pro-dark')} type="button" aria-pressed={theme === 'pro-dark'}>Pro Dark</button>
    <button className={`bde-btn bde-btn--sm ${theme === 'pro-light' ? 'bde-btn--primary' : 'bde-btn--ghost'}`} onClick={() => setTheme('pro-light')} type="button" aria-pressed={theme === 'pro-light'}>Pro Light</button>
  </div>
</SettingsCard>
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: Run all checks**

Run: `npm run typecheck && npm test && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/AppearanceSection.tsx src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx
git commit -m "feat: add Pro Dark and Pro Light to theme selector UI"
```
