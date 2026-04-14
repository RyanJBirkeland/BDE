# Decompose panelLayout.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure tree functions to panel-tree.ts and persistence logic to panel-persistence.ts, leaving panelLayout.ts as a thin Zustand store.

**Architecture:** Three-layer separation: `panel-tree.ts` contains deterministic tree manipulation (no side effects, no imports from Zustand/React/Electron), `panel-persistence.ts` wraps IPC calls for settings I/O (pure functions, no Zustand), and `panelLayout.ts` becomes a thin Zustand store that orchestrates both. No circular dependencies.

**Tech Stack:** TypeScript, React, Zustand, Vitest

---

## Task 1: Create panel-tree.ts

**Files:**
- Create: `src/renderer/src/stores/panel-tree.ts`
- Modify: `src/renderer/src/stores/panelLayout.ts`

- [ ] Read `src/renderer/src/stores/panelLayout.ts` and identify all pure functions (lines ~41–280): `_resetIdCounter`, `nextId`, `createLeaf`, `findLeaf`, `findFirstLeaf`, `getOpenViews`, `splitNode`, `addTab`, `closeTab`, `setActiveTab`, `moveTab`, `replaceLeafWithSplit`, `migrateLayout`, `isValidLayout`
- [ ] Create `src/renderer/src/stores/panel-tree.ts`:
  - Import only types from `../lib/view-types` (or wherever `PanelNode`, `PanelLeafNode`, `PanelSplitNode`, `PanelTab`, `View`, `DropZone` are defined)
  - Import `VIEW_LABELS` from `../lib/view-registry` if needed by any tree function
  - Export all 14 functions — signatures unchanged
  - Export `DEFAULT_LAYOUT = createLeaf('dashboard')`
  - **ZERO imports from Zustand, React, or Electron** — verify with: `grep -E 'from .*(zustand|react|electron)' src/renderer/src/stores/panel-tree.ts` must return empty
- [ ] In `panelLayout.ts`, remove the pure function definitions (lines ~41–280)
- [ ] Add import: `import { _resetIdCounter, createLeaf, findLeaf, findFirstLeaf, getOpenViews, splitNode, addTab, closeTab, setActiveTab, moveTab, replaceLeafWithSplit, migrateLayout, isValidLayout, DEFAULT_LAYOUT } from './panel-tree'`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract pure tree functions to panel-tree.ts"`

---

## Task 2: Create panel-persistence.ts

**Files:**
- Create: `src/renderer/src/stores/panel-persistence.ts`
- Modify: `src/renderer/src/stores/panelLayout.ts`

- [ ] Read `panelLayout.ts` and identify persistence logic: debounced persister setup, `flushLayoutPersistence()`, store subscription, window `beforeunload` handler (lines ~531–561)
- [ ] Create `src/renderer/src/stores/panel-persistence.ts`:
  - Import: `type { PanelNode }` from `./panel-tree`
  - Export `saveLayout(layout: PanelNode | null): void` — wraps `window.api.settings.setJson('panel.layout', layout)` with try/catch
  - Export `loadLayout(): Promise<PanelNode | null>` — wraps `window.api.settings.getJson('panel.layout')`
  - Export `createLayoutPersister(delayMs = 500): { persist: (layout: PanelNode) => void; flush: (layout: PanelNode | null) => void; cancel: () => void }` — debounced save implementation
  - **ZERO imports from Zustand or React** — verify with: `grep -E 'from .*(zustand|react)' src/renderer/src/stores/panel-persistence.ts` must return empty
- [ ] In `panelLayout.ts`, remove lines ~531–561 (debounced persister, store subscription, beforeunload handler)
- [ ] Add import: `import { loadLayout, createLayoutPersister } from './panel-persistence'`
- [ ] In the store's `loadSavedLayout` action: replace inline `window.api.settings.getJson` call with `await loadLayout()`
- [ ] After store definition: recreate subscription and beforeunload using `createLayoutPersister()`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract persistence logic to panel-persistence.ts"`

---

## Task 3: Clean Up panelLayout.ts

**Files:**
- Modify: `src/renderer/src/stores/panelLayout.ts`

- [ ] Verify `panelLayout.ts` now contains only:
  - Type re-exports (if any consumers import types from this file)
  - Zustand store definition with actions: `splitPanel`, `closeTab`, `addTab`, `setActiveTab`, `moveTab`, `focusPanel`, `resetLayout`, `loadSavedLayout`, `findPanelByView`, `getOpenViews`, `setView`, `setPersistable`
  - Store subscription + beforeunload wired to `createLayoutPersister()`
  - All action names **unchanged** — no consumer file changes needed
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test` — zero regressions
- [ ] Verify purity: `grep -E 'from .*(zustand|react|electron)' src/renderer/src/stores/panel-tree.ts` — must return empty
- [ ] Verify purity: `grep -E 'from .*(zustand|react)' src/renderer/src/stores/panel-persistence.ts` — must return empty
- [ ] Run `npm run lint` — zero errors
- [ ] Commit: `git add -A && git commit -m "refactor: panelLayout.ts is now a thin store facade"`

---

## Verification

- `npm run typecheck` — zero errors
- `npm test` — zero regressions
- File sizes: `panel-tree.ts` ≤250 lines, `panel-persistence.ts` ≤60 lines, `panelLayout.ts` ≤200 lines
- Zero Zustand/React imports in `panel-tree.ts` or `panel-persistence.ts`
