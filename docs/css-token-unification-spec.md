# CSS Token Unification Spec

**Date:** 2026-03-16
**Branch:** feat/css-token-unification
**Goal:** Merge two parallel CSS token systems into one. Apply glass/gradient treatment to Memory, Settings, and Cost views so they match Sprint Center quality.

---

## Problem

BDE has two coexisting token systems:

| System                                           | Defined In          | Used By                           |
| ------------------------------------------------ | ------------------- | --------------------------------- |
| `--bde-*`                                        | `design-system.css` | Sessions, Sprint, modals, buttons |
| `--bg-*`, `--accent-*`, `--text-*`, `--border-*` | `base.css`          | Terminal, Memory, Settings, Cost  |

Result: Terminal/Memory/Settings/Cost look like a different app. Same product, two visual identities.

---

## Canonical Token Set (keep `--bde-*`, remove duplicates)

The `--bde-*` tokens in `design-system.css` are the canonical system. The `--bg-*` etc. in `base.css` are the legacy system.

### Mapping (old → canonical)

```
--bg                  → --bde-bg
--bg-secondary        → --bde-surface
--bg-hover            → --bde-surface-hover
--border              → --bde-border
--border-light        → --bde-border-light
--text                → --bde-text
--text-muted          → --bde-text-muted
--text-dim            → --bde-text-dim
--accent              → --bde-accent
--accent-dim          → --bde-accent-dim
--color-error         → --bde-error
--color-warning       → --bde-warning
--color-ai            → --bde-color-ai
--radius-sm           → --bde-radius-sm
--radius-md           → --bde-radius-md
--size-sm             → --bde-size-sm
--size-xs             → --bde-size-xs
--font-ui             → --bde-font-ui
--font-mono           → --bde-font-mono
```

**Strategy:** Keep both names temporarily by aliasing in `base.css`:

```css
:root {
  /* Legacy aliases — point to canonical tokens */
  --bg: var(--bde-bg);
  --bg-secondary: var(--bde-surface);
  --border: var(--bde-border);
  /* etc. */
}
```

This is zero-risk: existing code using old names still works, new code uses canonical names. Remove aliases in a follow-up once all usages are migrated.

---

## View-by-View Glass Treatment

### MemoryView

Current: plain dark background, file list with no visual hierarchy.
Target: glass header bar with aurora "MEMORY" title, glass sidebar panel, glass editor area.

```css
.memory-view__header {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--bde-border);
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  flex-shrink: 0;
  position: relative;
}
.memory-view__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(167, 139, 250, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}
.memory-view__title {
  background: linear-gradient(90deg, #a78bfa 0%, #6c8eef 60%, #00d37f 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.memory-view__sidebar {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-sm);
  border-right: 1px solid var(--bde-border);
}
.memory-file-item {
  border-radius: var(--bde-radius-sm);
  transition: background 0.12s;
}
.memory-file-item:hover {
  background: var(--bde-surface-hover);
}
.memory-file-item--active {
  background: var(--glass-tint);
  border-left: 2px solid var(--bde-accent);
}
```

### SettingsView

Current: plain form fields with no visual grouping.
Target: glass header, glass card sections per setting group.

```css
.settings-view__header {
  /* same pattern as memory-view__header */
}
.settings-view__title {
  background: linear-gradient(90deg, #6c8eef 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.settings-section {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-sm);
  border: 1px solid var(--bde-border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
}
.settings-section__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--bde-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 12px;
}
```

### CostView

Current: data tables with no hierarchy.
Target: glass header, glass stat cards at top, glass table.

```css
.cost-view__header {
  /* same glass header pattern */
}
.cost-view__title {
  background: linear-gradient(90deg, #00d37f 0%, #6c8eef 100%);
  /* aurora gradient text */
}
.cost-stat-card {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-sm);
  border: 1px solid var(--bde-border);
  border-radius: 8px;
  padding: 12px 16px;
  transition: border-color 0.15s;
}
.cost-stat-card:hover {
  border-color: var(--bde-border-light);
}
.cost-stat-card__value {
  font-size: 22px;
  font-weight: 700;
  color: var(--bde-text);
  font-variant-numeric: tabular-nums;
}
.cost-stat-card__label {
  font-size: 11px;
  color: var(--bde-text-muted);
  margin-top: 2px;
}
```

---

## Files to Change

| File                                      | Action            | What                                                                |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `src/renderer/src/assets/base.css`        | **MODIFY**        | Add legacy token aliases (--bg → --bde-bg etc.) at top of :root     |
| `src/renderer/src/views/MemoryView.tsx`   | **MODIFY**        | Replace old token class names; add header section with aurora title |
| `src/renderer/src/views/SettingsView.tsx` | **MODIFY**        | Wrap settings in glass section cards; add glass header              |
| `src/renderer/src/views/CostView.tsx`     | **MODIFY**        | Add glass header + glass stat cards above the table                 |
| `src/renderer/src/assets/memory.css`      | **CREATE/MODIFY** | Memory-specific glass styles                                        |
| `src/renderer/src/assets/settings.css`    | **CREATE/MODIFY** | Settings-specific glass styles                                      |
| `src/renderer/src/assets/cost.css`        | **CREATE/MODIFY** | Cost-specific glass styles                                          |

---

## Out of Scope

- Removing old token names (aliases keep them alive — cleanup is a separate story)
- CostView data/logic changes (layout only)
- MemoryView editor improvements
- Settings new functionality

---

## Success Criteria

- [ ] No visual regression in Sessions, Sprint, Terminal (all existing glass preserved)
- [ ] Memory, Settings, Cost views have glass headers with aurora gradient titles
- [ ] Memory file list has glass sidebar + active item accent
- [ ] Settings has glass section cards grouping related fields
- [ ] Cost has glass stat cards row at top
- [ ] Old token names still resolve (aliases in base.css)
- [ ] npm test passes
