# IntelliJ-Inspired Professional Themes

**Date:** 2026-04-04
**Status:** Approved

## Summary

Add two professional themes — **Pro Dark** and **Pro Light** — inspired by JetBrains IntelliJ's New UI design language. These join the existing Dark, Light, and Warm themes in a flat 5-theme selector. Pro themes feature muted color palettes, compact spacing, zero neon effects, and an IDE-native aesthetic.

## Goals

- Professional, IDE-grade appearance matching IntelliJ's design language
- Compact information density — more content visible per screen
- Zero neon effects (no glow, particles, scanlines, glass morphism)
- Preserve existing themes untouched — additive change only

## Approach

**CSS Variable Override (Approach A)** — add `html.theme-pro-dark` and `html.theme-pro-light` selector blocks to `base.css` and `neon.css`, following the same pattern as the existing `html.theme-light` and `html.theme-warm` blocks. No new CSS files, no component-level changes. All existing components automatically pick up pro theme values through CSS custom properties.

## Color Palettes

### Pro Dark

| Token | Value | Usage |
|-------|-------|-------|
| `--bde-bg` | `#1e1f22` | Base background |
| `--bde-surface` | `#2b2d30` | Cards, panels |
| `--bde-surface-high` | `#393b40` | Elevated surfaces, tab bars |
| `--bde-border` | `#393b40` | Default borders |
| `--bde-border-hover` | `#4e5157` | Hover borders |
| `--bde-accent` | `#4a88c7` | Primary accent (IntelliJ blue) |
| `--bde-accent-dim` | `#3a6d9e` | Muted accent |
| `--bde-text` | `#bcbec4` | Primary text |
| `--bde-text-muted` | `#8c8f94` | Secondary text |
| `--bde-text-dim` | `#6f737a` | Tertiary text |
| `--bde-danger` | `#db5c5c` | Error/danger |
| `--bde-warning` | `#e6a235` | Warning |
| `--bde-info` | `#4a88c7` | Info (matches accent) |
| `--bde-success` | `#5fad65` | Success |

### Pro Light

| Token | Value | Usage |
|-------|-------|-------|
| `--bde-bg` | `#f7f8fa` | Base background |
| `--bde-surface` | `#ffffff` | Cards, panels |
| `--bde-surface-high` | `#ebedf0` | Elevated surfaces, tab bars |
| `--bde-border` | `#d4d5d8` | Default borders |
| `--bde-border-hover` | `#b8bac0` | Hover borders |
| `--bde-accent` | `#2675bf` | Primary accent (IntelliJ blue) |
| `--bde-accent-dim` | `#1a5c99` | Muted accent |
| `--bde-text` | `#1e1f22` | Primary text |
| `--bde-text-muted` | `#5e6166` | Secondary text |
| `--bde-text-dim` | `#818388` | Tertiary text |
| `--bde-danger` | `#cc4848` | Error/danger |
| `--bde-warning` | `#c97a1a` | Warning |
| `--bde-info` | `#2675bf` | Info (matches accent) |
| `--bde-success` | `#49a04b` | Success |

## Compact Density

Pro themes override spacing, font size, and radius tokens for ~30% tighter layout:

| Token | Default (Neon) | Pro |
|-------|---------------|-----|
| `--bde-space-1` | `4px` | `3px` |
| `--bde-space-2` | `8px` | `6px` |
| `--bde-space-3` | `12px` | `8px` |
| `--bde-space-4` | `16px` | `12px` |
| `--bde-space-5` | `20px` | `14px` |
| `--bde-space-6` | `24px` | `18px` |
| `--bde-size-sm` | `12px` | `11px` |
| `--bde-size-base` | `13px` | `12px` |
| `--bde-size-lg` | `14px` | `13px` |
| `--bde-radius-sm` | `4px` | `3px` |
| `--bde-radius-md` | `8px` | `4px` |
| `--bde-radius-lg` | `12px` | `6px` |

## Neon Effect Zeroing

Both pro themes disable all decorative neon effects:

```css
/* Effects → off */
--neon-scanline-opacity: 0;
--neon-particle-count: 0;
--neon-glass-blur: none;
--neon-glass-edge: none;
--neon-glass-shadow: none;

/* Glow → transparent (all 6 colors) */
--neon-cyan-glow: transparent;
--neon-pink-glow: transparent;
--neon-blue-glow: transparent;
--neon-purple-glow: transparent;
--neon-orange-glow: transparent;
--neon-red-glow: transparent;

/* Neon colors → muted professional equivalents */
--neon-cyan: var(--bde-accent);
--neon-pink: #b07cc7;
--neon-blue: var(--bde-accent);
--neon-purple: #8a7cb5;
--neon-orange: #c9923a;
--neon-red: #cc5858;
```

## Files to Change

### 1. `src/renderer/src/assets/base.css`
Add `html.theme-pro-dark` and `html.theme-pro-light` selector blocks after the existing `html.theme-warm` block. Each block overrides:
- All `--bde-*` color variables (palette tables above)
- All `--bde-space-*` variables (compact density)
- All `--bde-size-*` variables (compact font sizes)
- All `--bde-radius-*` variables (tighter radii)
- Gradient variables (disabled — set to `none` or solid fallbacks)
- Shadow variables (subtle, no glow — e.g., `0 1px 3px rgba(0,0,0,0.12)`)
- Hover/selected/overlay states (solid tints, no transparency effects)

### 2. `src/renderer/src/assets/neon.css`
Add `html.theme-pro-dark` and `html.theme-pro-light` selector blocks. Each block:
- Zeros all effect variables (scanlines, particles, glass, glow)
- Remaps neon colors to muted professional equivalents
- Sets surface/border variables to match pro palette

### 3. `src/renderer/src/assets/design-system.css`
Add `html.theme-pro-dark` and `html.theme-pro-light` blocks matching existing `html.theme-light` overrides for:
- `.glass-modal` background (solid, no blur)
- `.glass-highlight` (disabled)
- `.glass::after` (disabled)
- `.elevation-3` shadow (subtle)

### 4. `src/renderer/src/stores/theme.ts`
- Expand `Theme` type: `'dark' | 'light' | 'warm' | 'pro-dark' | 'pro-light'`
- Update `applyTheme()` to handle all 5 class names (remove all, add the matching one — except `dark` which has no class)
- Update `toggleTheme()` cycle: `dark → light → warm → pro-dark → pro-light → dark`

### 5. `src/renderer/src/components/settings/AppearanceSection.tsx`
- Add "Pro Dark" and "Pro Light" buttons to the theme selector
- Consider grouping: "Fun" row (Dark, Light, Warm) and "Professional" row (Pro Dark, Pro Light) with labels

### 6. Tests
- `src/renderer/src/stores/__tests__/theme.test.ts` — add tests for pro-dark/pro-light: state, localStorage, class application, toggle cycle
- `src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx` — add tests for new theme buttons

## How to Test

1. Run `npm run dev`, open Settings → Appearance
2. Click each of the 5 theme buttons — verify instant switch, no flash
3. Pro Dark: deep gray backgrounds, blue accent, no glow/particles/scanlines, compact spacing
4. Pro Light: white/light gray backgrounds, blue accent, no effects, compact spacing
5. Navigate all views (Dashboard, Agents, IDE, Pipeline, Code Review, Source Control) in each pro theme — verify no broken styles, readable text, no leftover neon effects
6. Verify accent color picker still works in pro themes
7. Verify cross-window theme sync (tear-off windows)
8. Run `npm test` — all theme store and appearance tests pass
9. Run `npm run typecheck` — zero errors

## Out of Scope

- Compact density as a separate toggle (may add later)
- Per-view theme overrides
- Custom theme editor
- Monaco editor theme integration (inherits from Electron, separate concern)
