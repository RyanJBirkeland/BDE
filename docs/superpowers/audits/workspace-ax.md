# Workspace Domain Audit (IDE + Agents + Terminal)

**Auditor:** Architectural Engineer (AX)
**Date:** 2026-03-27
**Scope:** IDEView, AgentsView, `components/ide/`, `components/agents/`, `components/terminal/`, stores (ide, agentEvents, agents, agentHistory, localAgents, terminal), `ide-fs-handlers.ts`, `agent-event-mapper.ts`

---

## 1. Executive Summary

The Workspace domain has well-designed sandboxing for IDE file I/O (path traversal guard, atomic writes, binary detection) and a clean agent event pipeline from SDK wire protocol through to the renderer. However, **four agent-related Zustand stores exist where two would suffice** -- `useAgentsStore` (409 lines) is a complete superset of `useAgentHistoryStore`, `useLocalAgentsStore`, and `useAgentEventsStore`, yet the unified store is completely dead (zero imports outside its own file and test). The agents component directory contains 24 files with at least 4 confirmed dead components and significant duplication between the two rendering paths (ChatRenderer vs ConsoleLine). The IDEView carries a 100-line keyboard handler effect that mixes editor and terminal concerns.

---

## 2. Critical Issues (must fix)

### C1. Dead unified `useAgentsStore` -- 409 lines of unshipped code

**File:** `src/renderer/src/stores/agents.ts`

`useAgentsStore` consolidates local processes, history, unified view, events, and log polling into a single mega-store. It is imported by **zero components** -- only its own definition and `src/renderer/src/stores/__tests__/agents.test.ts` reference it. Meanwhile, the app actually uses the three separate stores:

- `useAgentHistoryStore` (`agentHistory.ts`) -- imported by `AgentConsole.tsx`, `LiveActivityStrip.tsx`, `CommandPalette.tsx`
- `useAgentEventsStore` (`agentEvents.ts`) -- imported by `AgentsView.tsx`, `AgentConsole.tsx`, `LiveActivityStrip.tsx`, `AgentOutputTab.tsx`, `LogDrawer.tsx`, `TaskMonitorPanel.tsx`
- `useLocalAgentsStore` (`localAgents.ts`) -- imported by `AgentLaunchpad.tsx`, `CommandPalette.tsx`

This is 409 lines of dead code with 600+ lines of dead tests. The unified store also duplicates the `PLANNING_PROMPT_PREFIX` constant (line 28-47) and `MAX_EVENTS_PER_AGENT` (line 49) -- any bug fix in one copy won't reach the other.

**Fix:** Delete `src/renderer/src/stores/agents.ts` and `src/renderer/src/stores/__tests__/agents.test.ts`.

### C2. `AgentDetail` is dead code -- replaced by `AgentConsole`

**File:** `src/renderer/src/components/agents/AgentDetail.tsx` (211 lines)

`AgentConsole.tsx` line 1 says "Terminal-style detail pane replacing AgentDetail." `AgentDetail` is not imported by any component -- only by `AgentDetail.test.tsx`. It contains a `LogFallback` component (lines 156-211) that duplicates log-fetching logic, and it imports `useTerminalStore` to create shell tabs from an agent's repo path -- a cross-domain coupling that the replacement `ConsoleHeader.tsx` also implements (line 61).

**Fix:** Delete `AgentDetail.tsx` and `__tests__/AgentDetail.test.tsx`.

### C3. Cross-domain coupling: Agent components directly import terminal store

**Files:**

- `src/renderer/src/components/agents/ConsoleHeader.tsx` line 8: `import { useTerminalStore } from '../../stores/terminal'`
- `src/renderer/src/components/agents/AgentDetail.tsx` line 11 (dead, but shows the pattern)

`ConsoleHeader` reaches into `useTerminalStore.getState().addTab()` to create a terminal tab from an agent's repo path (line 61). This violates the domain boundary -- agent components should emit an intent ("open shell at path") via callback prop, and the parent (`AgentsView`) should bridge to the terminal store.

**Fix:** Add an `onOpenShell: (cwd: string) => void` prop to `ConsoleHeader` / `AgentConsole`, and move the `useTerminalStore.getState().addTab()` call up to `AgentsView`.

---

## 3. Significant Issues (should fix)

### S1. Dual rendering paths for agent events: `ChatRenderer` vs `ConsoleLine`

**Files:**

- `src/renderer/src/components/agents/ChatRenderer.tsx` (237 lines) -- used by `AgentDetail` (dead), `AgentOutputTab`, `LogDrawer`, `TaskMonitorPanel`
- `src/renderer/src/components/agents/ConsoleLine.tsx` (387 lines) -- used by `AgentConsole`

Both consume `ChatBlock[]` from `pairEvents()`. `ChatRenderer` uses bubble-style rendering via `ChatBubble`, `ThinkingBlock`, `ToolCallBlock`, and `PlaygroundCard`/`PlaygroundModal`. `ConsoleLine` uses terminal-line rendering with prefix badges and CSS classes. The virtualizer setup is duplicated between `ChatRenderer` (lines 169-181) and `AgentConsole` (lines 35-47) -- identical `useVirtualizer` config, auto-scroll logic, and scroll-follow state.

**Impact:** Bug fixes to event rendering must be applied in two places. The `ChatBubble`, `ThinkingBlock`, and `ToolCallBlock` components (3 files, ~270 lines combined) are only used by `ChatRenderer`, which is only live-imported by terminal `AgentOutputTab` and sprint components -- NOT by the main Agents view.

**Fix:** Extract the virtual-scroll container into a shared `VirtualEventList` component. Determine whether `ChatRenderer` (bubble style) or `ConsoleLine` (terminal style) should be the canonical renderer and deprecate the other. If both styles are needed, share the virtualizer wrapper and let a `renderRow` prop switch between styles.

### S2. IDEView monolith keyboard handler (100 lines)

**File:** `src/renderer/src/views/IDEView.tsx` lines 168-296

A single `useEffect` binds ~15 keyboard shortcuts spanning both editor and terminal concerns. The effect has 16 dependencies (lines 278-296). Terminal-specific shortcuts (Cmd+T, Cmd+D, Cmd+F, zoom, tab navigation, Ctrl+L) are mixed with editor shortcuts (Cmd+S, Cmd+W, Cmd+O, Cmd+B, Cmd+J).

**Impact:** Adding or modifying any shortcut requires editing this monolith and risks breaking unrelated shortcuts. The dependency array is fragile.

**Fix:** Extract into `useIDEKeyboardShortcuts(focusedPanel, activeView)` or split into `useEditorShortcuts` and `useTerminalShortcuts`.

### S3. `fileContents` state lives in IDEView, not in the IDE store

**File:** `src/renderer/src/views/IDEView.tsx` line 103

`const [fileContents, setFileContents] = useState<Record<string, string>>({})` holds all file content in component-local state. This means:

- Content is lost when IDEView unmounts (switching views in the panel system).
- `handleContentChange` and `handleSave` must be threaded through props instead of accessed from the store.
- The content cache cannot be shared with other panels.

The IDE store already tracks `openTabs`, `activeTabId`, and `isDirty` -- the content map is the missing piece.

**Fix:** Move `fileContents` into `useIDEStore` with actions `setFileContent(filePath, content)` and a selector `getFileContent(filePath)`. This also eliminates 3 callback-prop chains.

### S4. Module-level side effects in `TerminalPane.tsx`

**File:** `src/renderer/src/components/terminal/TerminalPane.tsx` lines 13-14

```typescript
const terminalInstances = new Map<string, Terminal>()
const searchAddons = new Map<string, SearchAddon>()
```

These module-scoped maps plus the exported `clearTerminal()` and `getSearchAddon()` functions create hidden global state that bypasses React's rendering model. `IDEView.tsx` imports `clearTerminal` (line 15) and calls it imperatively. `FindBar.tsx` imports `getSearchAddon` (line 4).

**Impact:** This works but is untestable and creates a tight coupling between unrelated components via module globals.

**Fix:** Consider lifting xterm instance management into the terminal store or using a React context. At minimum, document these module-level maps as intentional escape hatches.

### S5. Known dead components: AgentTimeline, TimelineBar, HealthBar, PaneStatusBar, EmptyState

**Files (confirmed dead -- no live imports):**
| Component | File | Lines | Notes |
|---|---|---|---|
| `AgentTimeline` | `components/agents/AgentTimeline.tsx` | 95 | Known dead per CLAUDE.md |
| `TimelineBar` | `components/agents/TimelineBar.tsx` | 114 | Only imported by AgentTimeline |
| `AgentDetail` | `components/agents/AgentDetail.tsx` | 211 | Replaced by AgentConsole (C2) |
| `HealthBar` | `components/agents/HealthBar.tsx` | 70 | Only imported by its test |
| `PaneStatusBar` | `components/terminal/PaneStatusBar.tsx` | 42 | Only imported by itself (no consumers) |
| `EmptyState` | `components/terminal/EmptyState.tsx` | 49 | Only imported by itself (no consumers) |

Plus their test files:

- `__tests__/AgentTimeline.test.tsx`
- `__tests__/AgentDetail.test.tsx`
- `__tests__/HealthBar.test.tsx`

**Total dead code:** ~581 lines of components + associated tests and CSS rules.

---

## 4. Minor Issues (nice to fix)

### M1. `formatDuration` duplicated 3 times in agent components

Implementations exist in:

- `src/renderer/src/components/agents/AgentCard.tsx` lines 26-33
- `src/renderer/src/components/agents/ConsoleHeader.tsx` lines 24-39
- `src/renderer/src/components/agents/ConsoleLine.tsx` lines 22-30

All format milliseconds/timestamps to human-readable strings but with slightly different signatures and output formats.

**Fix:** Extract a shared `formatDuration(ms: number): string` utility in `src/renderer/src/lib/format-utils.ts`.

### M2. `formatTime` duplicated in ConsoleLine and ToolCallBlock

- `src/renderer/src/components/agents/ConsoleLine.tsx` lines 14-19
- `src/renderer/src/components/agents/ToolCallBlock.tsx` lines 17-27

Identical logic, different locations.

### M3. `formatFileSize` duplicated in PlaygroundCard and PlaygroundModal

- `src/renderer/src/components/agents/PlaygroundCard.tsx` lines 17-21
- `src/renderer/src/components/agents/PlaygroundModal.tsx` lines 23-27

### M4. AgentPicker imports type from preload instead of shared

**File:** `src/renderer/src/components/terminal/AgentPicker.tsx` line 2

```typescript
import type { AgentMeta } from '../../../../preload/index.d'
```

All other renderer code imports from `../../../../shared/types`. This works but creates a fragile dependency on the preload type declaration rather than the canonical shared types.

### M5. `PLANNING_PROMPT_PREFIX` exists in both `agents.ts` (dead) and likely should live in a shared constants file

The constant on line 28 of `agents.ts` is only used by the dead unified store. If planning mode is revived, it should live in `src/renderer/src/lib/constants.ts` or `src/shared/`.

### M6. `TerminalPane` does not use the `fontSize` from the terminal store

**File:** `src/renderer/src/components/terminal/TerminalPane.tsx` line 43

Terminal font size is hardcoded to `13` in the xterm options. The terminal store has `fontSize` state with `zoomIn/zoomOut/resetZoom` actions (lines 149-159 of `terminal.ts`), and `IDEView` binds keyboard shortcuts for zoom (lines 249-266). But `TerminalPane` never subscribes to the store's `fontSize` -- the zoom shortcuts update store state that nothing reads.

**Fix:** Subscribe to `useTerminalStore((s) => s.fontSize)` in `TerminalPane` and update `term.options.fontSize` reactively, similar to the theme subscription (lines 106-116).

### M7. Inline styles dominate agent components

`AgentCard`, `AgentList`, `AgentPill`, `AgentsView`, `ChatBubble`, `SteerInput`, `ThinkingBlock`, `ToolCallBlock`, `PlaygroundCard`, `PlaygroundModal` all use extensive inline `style={{}}` objects. The IDE components use CSS classes (`ide-*` in `ide-neon.css`). The console components use CSS classes (`console-*` in `agents-neon.css`). This inconsistency makes theming harder.

---

## 5. Component Dependency Graph

```
AgentsView
  +-- LiveActivityStrip
  |     +-- AgentPill
  |     +-- useAgentHistoryStore
  |     +-- useAgentEventsStore
  +-- AgentList
  |     +-- AgentCard
  |         +-- NeonCard
  +-- AgentConsole
  |     +-- ConsoleHeader -----> useTerminalStore (cross-domain!)
  |     |     +-- NeonBadge
  |     +-- ConsoleLine (virtual-scrolled)
  |     |     +-- renderAgentMarkdown
  |     +-- CommandBar
  |           +-- CommandAutocomplete
  +-- AgentLaunchpad
  |     +-- LaunchpadGrid -----> useLocalAgentsStore
  |     +-- LaunchpadConfigure
  |     +-- LaunchpadReview
  +-- useAgentHistoryStore
  +-- useAgentEventsStore
  +-- NeonCard, MiniChart

IDEView
  +-- FileSidebar
  |     +-- FileTree
  |     |     +-- FileTreeNode (recursive)
  |     +-- FileContextMenu
  +-- EditorTabBar
  +-- EditorPane (Monaco)
  +-- TerminalPanel (bridge to terminal/)
  |     +-- TerminalTabBar
  |     |     +-- ShellPicker
  |     |     +-- AgentPicker
  |     +-- TerminalToolbar
  |     +-- TerminalContent
  |           +-- TerminalPane (xterm) <-- module-global Maps
  |           +-- FindBar
  |           +-- AgentOutputTab -----> ChatRenderer (agents/)
  |                 +-- useAgentEventsStore
  +-- IDEEmptyState
  +-- UnsavedDialog
  +-- useIDEStore
  +-- useTerminalStore

DEAD (no live imports):
  AgentTimeline -> TimelineBar
  AgentDetail -> ChatRenderer, SteerInput, useTerminalStore
  HealthBar
  PaneStatusBar
  EmptyState (terminal)
  useAgentsStore (unified mega-store, 409 lines)

SHARED across domains:
  ChatRenderer (agents/) <-- used by terminal/AgentOutputTab, sprint/LogDrawer, sprint/TaskMonitorPanel
    +-- ChatBubble
    +-- ThinkingBlock
    +-- ToolCallBlock
    +-- PlaygroundCard
    +-- PlaygroundModal
  pairEvents (lib/) <-- used by ChatRenderer AND AgentConsole
  useAgentEventsStore <-- used by agents/, terminal/, sprint/

agent-event-mapper.ts (main process)
  mapRawMessage(raw) -> AgentEvent[]
  emitAgentEvent(agentId, event) -> broadcast() + appendEvent()
    |
    v
  IPC 'agent:event' -> useAgentEventsStore.init() subscriber
    |
    v
  AgentConsole (via ConsoleLine) / ChatRenderer (via block renderers)

ide-fs-handlers.ts (main process)
  validateIdePath() -- path traversal guard
  readDir() / readFileContent() / writeFileContent()
  fs:watchDir -> recursive watcher -> debounce -> broadcastDirChanged
    |
    v
  IPC 'fs:dirChanged' -> FileTree.loadEntries() / FileTreeNode children reload
```
