# BDE — Sessions Sidebar Redesign Spec

**Date:** 2026-03-16
**Status:** Ready to implement
**Branch:** feat/sessions-sidebar-redesign
**Reference:** docs/visual-identity-spec.md (already in repo)

---

## Problem

The Sessions sidebar has two issues:

1. **AgentRow is fixed at `height: 36px`** but renders 3 lines of content (label + meta badges + task preview) → text overflows and overlaps
2. **Sidebar header is cramped** — "AGENTS" title + spawn button squeezed together, no breathing room

Ryan's direction: fix the cramping, AND double down on the glass + gradient aesthetic.

---

## 1. AgentRow Fix

### Root Cause

`.agent-row { height: 36px }` — hard-coded single-line height. The row renders up to 3 rows of content.

### Fix

Remove `height: 36px`. Replace with `min-height` + proper padding so rows auto-size to content:

```css
.agent-row {
  display: flex;
  align-items: flex-start; /* was: center — must change so dot aligns to first line */
  gap: 8px;
  width: 100%;
  min-height: 44px; /* comfortable minimum for label + meta */
  padding: 8px 10px; /* replaces height: 36px */
  /* all other properties unchanged */
}

.agent-row__dot {
  margin-top: 5px; /* align dot with first line of text, not center */
  flex-shrink: 0;
}

.agent-row__info {
  gap: 3px; /* was: 1px — give lines room to breathe */
}

.agent-row__meta {
  flex-wrap: wrap; /* allow badges to wrap if sidebar is narrow */
  gap: 4px;
  row-gap: 2px;
}
```

### Selected + Glass State (enhance with double-down directive)

When selected, the row should feel premium. Upgrade the selected state:

```css
.agent-row--selected {
  background: linear-gradient(135deg, rgba(0, 211, 127, 0.08) 0%, rgba(108, 142, 239, 0.05) 100%);
  border: 1px solid rgba(0, 211, 127, 0.25);
  box-shadow:
    0 0 16px rgba(0, 211, 127, 0.1),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.06);
}
```

Running rows get a more vivid pulse:

```css
@keyframes pulse-glow-row {
  0%,
  100% {
    box-shadow: 0 0 8px rgba(0, 211, 127, 0.08);
  }
  50% {
    box-shadow:
      0 0 20px rgba(0, 211, 127, 0.18),
      0 0 0 1px rgba(0, 211, 127, 0.15);
  }
}
.agent-row.glow-pulse {
  animation: pulse-glow-row 2.5s ease-in-out infinite;
}
```

---

## 2. Sidebar Header Redesign

### Current HTML (SessionsView.tsx ~line 268)

```html
<div class="session-list__header">
  <span class="session-list__title bde-section-title">AGENTS</span>
  <button class="session-list__new-btn">+</button>
</div>
<div class="session-list__search">
  <input placeholder="Filter agents…" />
</div>
```

### Target Layout

```
┌────────────────────────────────────┐
│  ✦ AGENTS              [+Spawn]   │  ← gradient accent line below
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│  [⌕  Filter agents...          ]  │  ← glass search input
└────────────────────────────────────┘
```

### CSS changes to `session-list__header`:

```css
.session-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 10px; /* was: cramped */
  position: relative;
}

/* Aurora accent line under header */
.session-list__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 12px;
  right: 12px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

.session-list__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  /* Gradient text — double down */
  background: linear-gradient(135deg, var(--accent) 0%, var(--color-info) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.session-list__new-btn {
  /* Use .btn-glass from design-system.css */
  background: rgba(0, 211, 127, 0.08);
  border: 1px solid rgba(0, 211, 127, 0.2);
  color: var(--accent);
  border-radius: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease-out;
}
.session-list__new-btn:hover {
  background: rgba(0, 211, 127, 0.15);
  border-color: rgba(0, 211, 127, 0.4);
  box-shadow: 0 0 12px rgba(0, 211, 127, 0.2);
}
```

### Search input (glass treatment):

```css
.session-list__search {
  padding: 8px 10px 6px;
}

.session-list__search input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.session-list__search input:focus {
  border-color: rgba(0, 211, 127, 0.35);
  box-shadow: 0 0 0 3px rgba(0, 211, 127, 0.08);
  background: rgba(255, 255, 255, 0.06);
}
```

---

## 3. Group Headers (ACTIVE / RECENT / HISTORY)

Upgrade from plain uppercase labels to premium section dividers:

```css
.agent-list__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  position: relative;
  user-select: none;
}

/* Gradient left-edge accent line on each group header */
.agent-list__group-header::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 12px;
  border-radius: 2px;
  background: var(--gradient-aurora);
  opacity: 0.6;
}
```

---

## 4. Files to Change

| File                                   | What changes                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/assets/sessions.css` | AgentRow height→padding, dot margin-top, meta flex-wrap, selected gradient bg, pulse animation, header padding+gradient line+gradient title, search glass input, group header left-accent line, spawn btn glow |
| No .tsx changes needed                 | All fixes are pure CSS                                                                                                                                                                                         |

---

## 5. Out of Scope

- AgentRow data or logic changes
- Sidebar width changes
- Split view / multi-pane layout

---

## Success Criteria

- [ ] AgentRow shows all 3 lines (label + meta + task) without overlap at any sidebar width
- [ ] Status dot aligns with first line of text
- [ ] Meta badges wrap on narrow sidebar instead of overflowing
- [ ] Sidebar header "AGENTS" title has aurora gradient text
- [ ] Gradient accent line under header
- [ ] Spawn button has green glass glow on hover
- [ ] Search input has glass focus ring
- [ ] Group headers (ACTIVE/RECENT/HISTORY) have left-edge gradient accent
- [ ] Selected row has gradient glass bg + green border
- [ ] Running row pulse is more vivid
