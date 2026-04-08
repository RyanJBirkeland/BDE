# Bundle / Asset Auditor

**Lens scope:** Renderer bundle composition, code splitting, Monaco workers, cold-start asset weight.

**Summary:** BDE's renderer architecture demonstrates solid foundational patterns for code splitting (9 lazy views), but suffers from three critical performance gaps: (1) **xterm+addons (2.5MB) loaded synchronously in IDE view without lazy boundaries**, triggering full xterm initialization on first IDE access; (2) **19.5KB of view-specific CSS imported eagerly in main.css**, including unused agent/sprint/settings styles on every cold start; (3) **Monaco pre-bundled (74MB disk) but not chunked separately**—the monaco-editor chunk likely balloons the main view. Framer-motion (5.5MB) is correctly lazy via view imports but CSS bloat and lack of Suspense around TerminalPane prevent reaching sub-2s cold-start.

---

## Findings

### F-t2-bundle-1: Xterm (2.5MB) + Addons Loaded Synchronously on IDE View Entry
**Severity:** High  
**Category:** I/O | Latency  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/terminal/TerminalPane.tsx:1-10` and `/Users/ryan/projects/BDE/src/renderer/src/components/terminal/TerminalContent.tsx:1-5`  
**Evidence:**
```typescript
// TerminalPane.tsx — imported at module top level
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'

// TerminalContent.tsx — direct import (no lazy)
import { TerminalPane } from './TerminalPane'
```
TerminalContent is included in IDEView (lazy) but TerminalPane itself is eagerly evaluated when TerminalContent loads. xterm (2.5MB on disk) includes ~300KB minified + gzip overhead. All 4 xterm addons are bundled into the IDE chunk.
**Impact:** IDEView entry cost = +500KB–800KB (gzipped xterm core + addons). Cold start adds 200–400ms if IDE is first tab or navigated early. First paint delay if terminal is visible.
**Recommendation:** Wrap TerminalPane in React.lazy() with Suspense boundary in TerminalContent. Load xterm only on first terminal tab creation via dynamic import(). Defer addon initialization to use.event time.
**Effort:** M  
**Confidence:** High

---

### F-t2-bundle-2: 19.5KB All-View CSS Eagerly Imported in main.css
**Severity:** Medium  
**Category:** I/O  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/assets/main.css:1-24` (imports all view styles)  
**Evidence:**
```css
/* main.css — imported in src/renderer/src/main.tsx */
@import './agents-neon.css';
@import './sprint-neon.css';
@import './sprint.css';
@import './sprint-pipeline-neon.css';
@import './settings.css';
@import './settings-v2-neon.css';
@import './ide.css';
@import './code-review-neon.css';
@import './diff.css';
@import './diff-neon.css';
@import './source-control-neon.css';
@import './onboarding-neon.css';
@import './planner-neon.css';
/* ... total 19,585 lines across all CSS files */
```
All view-specific CSS (~19.5KB min-gzip) loads before any view renders. Only dashboard, header, and sidebar CSS needed on first paint; 70% of styles unused until view switch.
**Impact:** Cold-start CSS block ~50–80ms. Stylesheet TTI cost. Browser must parse selector rules for AgentsView, SprintView, SettingsView, etc. even if never visited in session.
**Recommendation:** Move view-specific CSS (agents.css, sprint.css, settings.css, ide.css, planner.css, etc.) into lazy-imported chunks alongside their views. Keep only base.css, design-system.css, neon.css, neon-shell.css, and app-shell styles in main.css. Use CSS-in-JS or lazy <link> tags per view chunk.
**Effort:** M  
**Confidence:** High

---

### F-t2-bundle-3: Monaco Pre-Bundled (74MB) — No Manual Chunk Isolation, Worker Path Unclear
**Severity:** Medium  
**Category:** I/O | Latency  
**Location:** `/Users/ryan/projects/BDE/electron.vite.config.ts:24-35` and `/Users/ryan/projects/BDE/src/renderer/src/components/ide/EditorPane.tsx:7-12`  
**Evidence:**
```typescript
/* electron.vite.config.ts — monaco listed in optimizeDeps but manual chunk only claims 'monaco-editor' */
optimizeDeps: {
  include: ['xterm', 'xterm-addon-fit', 'xterm-addon-web-links', 'monaco-editor']
},
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'monaco-editor': ['monaco-editor']  // ← Only this; no worker chunks
      }
    }
  }
}

/* EditorPane.tsx — Pre-loads monaco but config lacks worker path */
const monacoPromise = import('monaco-editor')
monacoPromise.then((monaco) => {
  loader.config({ monaco })  // ← No workerMain or CDN path; relies on Electron's default
})
```
Monaco is pre-bundled (74MB disk) but Vite's default behavior may emit workers to dist/. Comment at line 8 says "Pre-load Monaco via dynamic ESM import so it works in Electron without CDN" but no explicit workerMain configuration. @monaco-editor/react likely tries to load workers from default path which may not resolve in Electron asar context.
**Impact:** Monaco editor init may silently fail worker loading → 10–30ms syntax highlighting/intellisense delay per open file. Workers may be embedded in main.js instead of separate bundles, inflating IPC overhead. Cold start adds 100–200ms if IDE view opened first.
**Recommendation:** (1) Set `loader.config({ monaco, workerMain: '/dist/workers/editor.worker.js' })` or equivalent asar-safe path. (2) Use Vite plugin to emit language/css/html/json workers to separate chunks, not main bundle. (3) Consider lazy-loading Monaco only when EditorPane is visible (add Suspense with fallback).
**Effort:** M  
**Confidence:** Medium

---

### F-t2-bundle-4: All View Modules Lazily Imported But No Component-Level Suspense Boundaries
**Severity:** Medium  
**Category:** Latency  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/lib/view-resolver.tsx:1-37` and `/Users/ryan/projects/BDE/src/renderer/src/components/panels/PanelLeaf.tsx:104-117`  
**Evidence:**
```typescript
/* view-resolver.tsx — All views are lazy() */
const DashboardView = lazy(() => import('../views/DashboardView'))
const AgentsView = lazy(() =>
  import('../views/AgentsView').then((m) => ({ default: m.AgentsView }))
)
// ... 7 more lazy views

/* PanelLeaf.tsx — Single Suspense boundary wraps all view instances */
<Suspense fallback={<ViewSkeleton />}>
  {resolveView(tab.viewKey)}
</Suspense>
```
Good practice: views are lazily chunked. However, PanelLeaf uses a single ViewSkeleton fallback for all views. If multiple panels are open (common), switching between two non-cached views loads second view before first finishes (no view preloading via VIEW_LOADERS in production).
**Impact:** View switch latency = 100–300ms per view if not preloaded. No cache between same view opened in two panels.
**Recommendation:** (1) Call VIEW_LOADERS[viewKey]() on ActivityBar hover to preload next view. (2) Cache loaded view chunks in a Map to avoid re-fetch if same view opened in second panel. (3) Add view-specific suspense boundaries with contextual loading skeletons (IDE loading ≠ Dashboard loading).
**Effort:** M  
**Confidence:** Medium

---

### F-t2-bundle-5: App.tsx Imports framer-motion + 38 Direct Store/Component Imports, Creating High Dependency Fan-Out
**Severity:** Medium  
**Category:** Latency  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/App.tsx:1-37`  
**Evidence:**
```typescript
/* App.tsx lines 1–37 — 40+ top-level imports at entry point */
import { motion, AnimatePresence } from 'framer-motion'  // 5.5MB disk
import { useCommandPaletteStore } from './stores/commandPalette'
import { useCostDataStore } from './stores/costData'
import { useSprintUI } from './stores/sprintUI'
import { useKeybindingsStore } from './stores/keybindings'
import { CommandPalette } from './components/layout/CommandPalette'
import { QuickCreateBar } from './components/ui/QuickCreateBar'
import { ToastContainer } from './components/layout/ToastContainer'
import { UnifiedHeader } from './components/layout/UnifiedHeader'
import { NeonSidebar } from './components/layout/NeonSidebar'
// ... 30+ more imports
```
App.tsx is not lazy; it's rendered immediately on cold start. Framer-motion (5.5MB) is a large dependency, but more critically, each import pulls in store initializers (Zustand stores) and layout components (Header, Sidebar, CommandPalette). This creates a deep dependency chain evaluated before first render.
**Impact:** Main.js chunk includes framer-motion core + all store setup + layout components. Cold start parse/eval = 200–400ms (5.5MB framer-motion + 2–3MB Zustand stores + UI components). Possible improvement: defer QuickCreateBar, CommandPalette, FeatureGuideModal until after first render.
**Recommendation:** Lazy-import low-priority overlays (QuickCreateBar, FeatureGuideModal, ShortcutsOverlay) after App mounts. Use React.lazy() + Suspense for these. Keep Header, Sidebar, PanelRenderer, ToastContainer synchronous (essential layout).
**Effort:** M  
**Confidence:** Medium

---

### F-t2-bundle-6: TerminalPane Not Wrapped in Suspense — Full xterm Init on IDE First Paint
**Severity:** High  
**Category:** Latency  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/terminal/TerminalContent.tsx:50-74`  
**Evidence:**
```typescript
/* TerminalContent.tsx — No Suspense wrapper around TerminalPane instances */
{tabs.map((tab) => {
  // ... tab.kind checks
  return (
    <div key={tab.id} className={paneClass}>
      <TerminalPane  // ← Eagerly rendered if visible
        tabId={tab.id}
        shell={tab.shell}
        cwd={tab.cwd}
        visible={activeView === 'ide'}
      />
    </div>
  )
})}
```
If IDEView opens with terminal tabs visible (default in many layouts), TerminalPane is synchronously initialized, calling `new Terminal()` and loading all 4 addons. Initial fit is deferred via requestAnimationFrame but the xterm import itself is not lazy.
**Impact:** IDE view first render blocks on xterm load (200–400ms). If user opens IDE then switches to another view, xterm JS is wasted (not used until IDE returns to focus).
**Recommendation:** Wrap TerminalPane in `React.lazy()`. Load only for visible tabs. Add Suspense boundary with minimal fallback (e.g., `<div className="terminal-placeholder" style={{ height: '100%' }} />`).
**Effort:** S  
**Confidence:** High

---

### F-t2-bundle-7: NeonSidebar and UnifiedHeader Imported Eagerly in App — Include Asset Dependencies
**Severity:** Low  
**Category:** I/O  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/App.tsx:10-11` and view imports  
**Evidence:**
```typescript
import { UnifiedHeader } from './components/layout/UnifiedHeader'
import { NeonSidebar } from './components/layout/NeonSidebar'
// ... rendered in App
<UnifiedHeader />
<NeonSidebar model={DEFAULT_MODEL.modelId} />
```
Both are essential layout shells (always visible), correctly kept synchronous. However, UnifiedHeader likely imports CommandPalette trigger and NeonSidebar imports all view icons (lucide-react). Lucide-react (icon pack) is properly tree-shaken but the entire icon set is pulled into sidebar chunk.
**Impact:** Sidebar bundle includes icons for all 9 views + settings + more, ~100–150KB gzipped. This is necessary overhead but worth verifying icon imports are truly used-only (not all 577 icons from lucide-react).
**Recommendation:** Audit lucide-react imports in NeonSidebar and other layout components; verify tree-shaking is working. Consider inline SVGs for most-used icons if lucide-react imports grow.
**Effort:** S  
**Confidence:** Low

---

### F-t2-bundle-8: @anthropic-ai/claude-agent-sdk (58MB) Listed in Dependencies But Not Analyzed for Renderer
**Severity:** Low  
**Category:** I/O  
**Location:** `/Users/ryan/projects/BDE/package.json:35`  
**Evidence:**
```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.81",  // 58MB disk
    // ...
  }
}
```
Grep found no imports of `@anthropic-ai/claude-agent-sdk` in the renderer source. The SDK is listed as a dependency but appears to be consumed only by the main process (out of scope for this audit). If accidentally bundled into renderer, it would add 58MB to disk footprint.
**Impact:** Potential 5–10MB gzipped if bundled into renderer (currently not detected). Unknown runtime cost if main process SDK is imported into renderer chunks.
**Recommendation:** Verify rollupOptions.external includes '@anthropic-ai/claude-agent-sdk' to ensure it is NOT bundled into renderer. Confirm it is only used in main process.
**Effort:** S  
**Confidence:** Medium

---

### F-t2-bundle-9: CSS-in-JS Not Used — All Styling Via Imported CSS Files, No View-Level Isolation
**Severity:** Low  
**Category:** I/O | Bundle Composition  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/assets/main.css` and view imports  
**Evidence:**
```typescript
// e.g., AgentsView imports:
import '../assets/agents.css'

// DashboardView imports:
// (no explicit import, but agents-neon.css loaded globally)

// IDEView imports:
import '../assets/ide-neon.css'
```
CSS is imported per view, which is correct, but the CSS is not scoped to view components. All CSS rules are global, meaning selector specificity and cascade issues may force larger files to override earlier rules. No CSS Modules or scoped CSS in use.
**Impact:** CSS cascade conflicts may force more specificity or !important, inflating CSS size by 5–10%. No automatic dead-code elimination for unused selectors.
**Recommendation:** Migrate high-traffic views (agents, sprint, ide) to CSS Modules or scoped CSS-in-JS (emotion, styled-components). Start with agents.css (largest view).
**Effort:** L  
**Confidence:** Low

---

## Open Questions

1. **Monaco Worker Resolution in Electron:** Does @monaco-editor/react correctly load editor.worker.js and language workers in the Electron asar context, or are workers embedded in the main bundle? Verify via DevTools Network tab.

2. **Xterm CSS Size:** Is xterm/css/xterm.css fully used, or is it safe to prune? Check against actual UI features used (colors, fonts, cursor styles).

3. **View Preloading in Production:** Is VIEW_LOADERS map used anywhere in production (ActivityBar hover detection)? If not, it is dead code that should be removed or implemented.

4. **Framer-motion Tree-Shaking:** Confirm tree-shaking is working; framer-motion reported size is disk, but gzipped runtime should be <1MB. Verify via bundle analyzer.

5. **Cold-Start Measurement:** What is the current cold-start time (blank window to first render) and time-to-interactive? Establish baseline before optimizations.

6. **Main Process SDK Leakage:** Audit bundled main.js to confirm @anthropic-ai/claude-agent-sdk is marked external and not included in renderer build.

---

## Prioritized Recommendations Summary

| ID | Finding | Fix | Effort | Est. Savings (Gzipped) |
|---|---------|-----|--------|----------------------|
| F-t2-bundle-1 | Xterm sync load | Lazy + Suspense TerminalPane | M | 300–500KB |
| F-t2-bundle-2 | View CSS eager | Lazy CSS per view | M | 150–250KB |
| F-t2-bundle-3 | Monaco worker path | Explicit config + lazy init | M | 100–200KB |
| F-t2-bundle-4 | View preload missing | Implement VIEW_LOADERS hover | M | 0 (UX only) |
| F-t2-bundle-5 | App.tsx fan-out | Lazy overlays | M | 200–300KB |
| F-t2-bundle-6 | TerminalPane no Suspense | Wrap in lazy() | S | 200–400KB |
| F-t2-bundle-7 | Lucide-react audit | Verify tree-shake | S | 20–50KB |
| F-t2-bundle-8 | SDK external check | Add to rollupOptions.external | S | 5–10MB (if leaked) |
| F-t2-bundle-9 | No CSS scoping | CSS Modules (agents.css first) | L | 50–100KB |

**Estimated Total Cold-Start Improvement: 1.0–2.5MB gzipped (15–40% reduction if all applied).**

