# Epic: Design Polish (DP)

**Date:** 2026-03-16
**Owner:** UI/UX Engineering
**Goal:** Eliminate every visual inconsistency, missing glass treatment, broken empty state, and orphaned token reference so BDE looks like a single designer built every pixel in the same weekend.

---

## Context

The audit report (`docs/audit-design-report.md`) identified two parallel CSS variable systems, uneven glass morphism adoption, an entirely inline-styled Terminal view, hardcoded hex colors scattered through TSX, inconsistent view headers, missing loading states, and an unused motion system. This epic addresses the visual debt across 8 focused stories.

## Audit Summary

| Area                | Finding                                                                                                                                                                 | Severity |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| CSS Variables       | Two parallel systems: `--bde-*` (old) and `--bg-*`/`--accent-*`/`--text-*` (v2). Body still uses `--bde-bg`, `--bde-text`.                                              | Critical |
| Glass Morphism      | Applied to modals, TitleBar, ActivityBar, Sessions sidebar, AgentRow. Missing from DiffView, MemoryView, CostView, SettingsView, Sprint columns, SpecDrawer, StatusBar. | High     |
| View Headers        | `text-gradient-aurora` only on "SPRINT CENTER" and "NEW TICKET". CostView, SettingsView, MemoryView, DiffView, Sessions sidebar all use plain text headers.             | High     |
| Terminal View       | 23 `style={{}}` blocks, 63 `tokens.*` references. Zero CSS classes. No glass, no gradients, visually disconnected.                                                      | High     |
| Hardcoded Colors    | `#a78bfa`, `#3B82F6`, `#60a5fa`, `#888`, `#ef4444`, `#2a2a2a`, `#000` in TSX and CSS.                                                                                   | Medium   |
| Loading States      | Missing in Sessions (initial list), Memory (file list + file content), Terminal.                                                                                        | Medium   |
| Empty States        | DiffView sidebar uses raw `<div>` not `<EmptyState>`. Sessions "Select a session" is generic. No action CTAs on most empty states.                                      | Medium   |
| Motion              | `motion.ts` defines 5 springs + 7 variants. Only used in 5 files. View transitions use CSS `120ms ease` instead of spring physics.                                      | Low      |
| Heading Classes     | `heading-page`, `heading-hero`, `heading-section` defined in CSS, used in 0 TSX files.                                                                                  | Low      |
| Dual Button Systems | Old `bde-btn--*` classes coexist with new `btn-primary`/`btn-glass`. SettingsView bypasses `<Button>` component.                                                        | Low      |

---

## Stories

| ID    | Title                                   | Priority | Affected Files                                                                   |
| ----- | --------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| DP-S1 | Unify CSS variable systems              | P0       | `base.css`, `design-system.css`, all view CSS, `tokens.ts`                       |
| DP-S2 | Glass morphism for all views            | P0       | `main.css`, `cost.css`, `sprint.css`, all 7 views                                |
| DP-S3 | Consistent aurora gradient view headers | P1       | All view TSX files, `main.css`, `sessions.css`, `cost.css`                       |
| DP-S4 | Terminal view CSS migration             | P1       | `TerminalView.tsx`, `terminal.css`                                               |
| DP-S5 | Hardcoded color purge                   | P1       | `TerminalView.tsx`, `CostView.tsx`, `sprint.css`, `main.css`                     |
| DP-S6 | Loading & empty state polish            | P2       | `SessionsView.tsx`, `MemoryView.tsx`, `DiffView.tsx`, `sessions.css`, `main.css` |
| DP-S7 | Motion system adoption                  | P2       | `motion.ts`, view wrappers, `App.tsx`, list components                           |
| DP-S8 | Interactive state audit                 | P2       | All interactive components, `design-system.css`, `sprint.css`                    |

## Execution Order

```
DP-S1 (token unification) ──┐
                             ├── DP-S2 (glass) ──┐
DP-S4 (terminal migration) ─┘                    ├── DP-S3 (headers)
                                                  ├── DP-S5 (color purge)
                                                  ├── DP-S6 (loading/empty)
                                                  ├── DP-S7 (motion)
                                                  └── DP-S8 (interactive states)
```

DP-S1 and DP-S4 are prerequisites — they eliminate the dual token system and the inline-style problem that all other stories depend on.

## Success Criteria

- `grep -r '#[0-9a-fA-F]\{6\}' src/renderer/src/views/` returns 0 results (except intentional constants like accent presets)
- `grep -r 'style={{' src/renderer/src/views/TerminalView.tsx` returns 0 results
- Every view has: glass sidebar or panel, aurora gradient title, skeleton loading state, and `<EmptyState>` with action CTA
- `motion.ts` SPRINGS/VARIANTS are used in all view transitions and list stagger animations
- All `--bde-*` CSS variables are deprecated with `/* DEPRECATED */` comments and forwarded to v2 equivalents
