# Team 3 — Agents & Terminal Audit

## Executive Summary

The Agents and Terminal views are the operational heart of BDE, yet they currently feel **utilitarian rather than alive**. Running agents are the most important state in the entire app — they represent active work being done — but visually they get a 6px pulsing dot and nothing else. The entire agent experience reads like a log viewer rather than a mission control dashboard.

Key themes across all three personas:

1. **Running agents need to breathe.** The current `pulse` animation on a 6px dot is the only visual signal that work is happening. No glow, no shimmer, no ambient energy.
2. **AgentCard and ChatBubble use inline styles exclusively**, bypassing the glassmorphism and glow system already built in `design-system.css`. These components should be the flagship users of those utilities.
3. **Terminal and Agents are visually disconnected.** Agent output tabs in the terminal reuse `ChatRenderer` but lack any visual bridge to the Agents view — no status glow, no health indication.
4. **The HealthBar is anemic.** It shows text stats in a 28px strip with no visual weight. For the primary status indicator of the agent infrastructure, it needs presence.
5. **SpawnModal already uses `glass-modal`** but the rest of the agent components are stuck on raw token-based inline styles with `tokens.radius.sm` (4px) instead of the new 16-20px radii.

---

## UX Designer Findings

### Agent Cards

**Current state:** Flat button with 2px left border accent, 6px status dot, and plain text. No background differentiation for running vs. completed. No hover lift, no glow, no border radius beyond 0px (it is a plain `<button>`).

**Issues:**

- **No card container feel.** The AgentCard is a full-width `<button>` with `background: transparent` or `surfaceHigh` when selected. It reads as a list row, not a card. Given the "feast-site" direction with 20px radius cards, these need actual card treatment.
- **Running agents are visually dead.** A 6px dot with CSS `animation: pulse 2s infinite` is the only "alive" signal. There is no `@keyframes pulse` defined in the agent CSS — it relies on whatever global `pulse` keyframe exists (likely from a library or nothing). Running agents should have:
  - Accent-tinted left border that glows (`pulse-glow` keyframe already exists in design-system.css but is unused here)
  - Subtle ambient background gradient: `radial-gradient(circle at left, rgba(0,211,127,0.06), transparent 60%)`
  - The status dot should use `glow-accent-sm` class
- **Completed/failed agents lack visual settlement.** Done agents should feel "cooled down" — reduced opacity on the status dot, slightly muted text. Failed agents should have a danger-tinted left border.
- **No hover micro-interaction.** Missing `active:scale(0.97)` and `hover:border-brighten` from the design direction.
- **Status dot is tiny at 6px.** Bump to 8px with a `box-shadow` ring for running state.

**Recommendations:**

1. Move AgentCard to CSS classes (`.agent-card`, `.agent-card--running`, `.agent-card--selected`, `.agent-card--failed`)
2. Add `border-radius: 12px` to cards with `margin: 0 8px`
3. Running cards get `animation: pulse-glow 2.5s ease-in-out infinite` on the left border or the entire card
4. Add `transition: transform 100ms ease; &:active { transform: scale(0.98) }` for tactile feel
5. Selected card gets `border: 1px solid rgba(0,211,127,0.3)` instead of just a left accent

### Agent Detail / Chat

**Current state:** Functional but flat. Chat bubbles are rectangular with 6px radius. ThinkingBlock has purple tinting (good). ToolCallBlock has a 3px blue left border. No message grouping visual rhythm.

**Issues:**

- **ChatBubble radius is `tokens.radius.md` = 6px.** For the feast-site aesthetic, these should be 14-16px. Agent messages should have a slightly different radius pattern (rounded top-right, less rounded bottom-left) to create a conversational feel.
- **No avatar or icon for agent vs. user messages.** The alignment (left for agent, right for user) is correct but there is no visual icon/avatar to reinforce the distinction.
- **ThinkingBlock is the best-styled component** — it uses CSS variables (`var(--bde-purple)`) and has good visual hierarchy with the token count badge. However, it could benefit from a subtle shimmer animation when the agent is actively thinking (not just a static block).
- **ToolCallBlock left border is `tokens.color.info` (blue)** which is good for tool calls, but the expanded JSON view uses `tokens.color.surface` background which blends with the chat background. Needs more contrast.
- **CompletedBlock and StartedBlock are plain centered text.** The completion block should be a celebration moment for successful agents — a subtle green glow card. Failed completions should be a danger-bordered card.
- **No visual breathing room between message types.** Text blocks, tool calls, and thinking blocks all get the same `tokens.space[1]` vertical padding from the virtualizer wrapper. Tool calls should have more vertical separation.

**Recommendations:**

1. Increase ChatBubble border-radius to `14px` with asymmetric corners: agent `14px 14px 14px 4px`, user `14px 14px 4px 14px`
2. Add a small Bot icon (12px) before agent messages and a User icon before user messages
3. Add a `@keyframes shimmer` to ThinkingBlock while agent is running — a horizontal light sweep across the purple background
4. CompletedBlock should be a proper card: `background: rgba(0,211,127,0.08); border: 1px solid rgba(0,211,127,0.2); border-radius: 12px; padding: 12px`
5. ErrorBlock should mirror CompletedBlock but with danger colors
6. ToolCallBlock expanded JSON blocks need `background: var(--bde-bg)` (darker than surface) for contrast

### Spawn Modal

**Current state:** Uses `glass-modal` class (good), has framer-motion `scaleIn` animation (good), has model chip selection and task history dropdown. This is the most polished agent component.

**Issues:**

- **Model chips use `Button` with ghost variant.** Active chips get `spawn-modal__chip--active` but there is no CSS file defining `.spawn-modal__*` classes anywhere in the CSS files — these styles must be in an undiscovered CSS file or inline. This means the modal is likely unstyled or relying on defaults.
- **The textarea and select use inline-defined classes** (`spawn-modal__textarea`, `spawn-modal__select`) that may not have CSS backing. Need to verify all SpawnModal CSS exists.
- **The "Spawn" CTA button uses `Button variant="primary"`** which is `background: var(--bde-accent)` — flat green. For the primary action of launching an agent, this should use the gradient CTA pattern: `linear-gradient(135deg, #00D37F, #00A863)` with a glow shadow.
- **No visual preview of what will happen.** The modal could show a small visual of the target repo path and the model's cost tier.

**Recommendations:**

1. Locate or create SpawnModal CSS — all `.spawn-modal__*` classes need definitions
2. Spawn button should use `.btn-cta` pattern with gradient and glow
3. Add a subtle `ambient-glow` behind the modal title for visual hierarchy
4. Task history dropdown should use `glass-surface` treatment instead of plain background

### Health Bar

**Current state:** 28px tall strip with text labels. Connected/disconnected dot (8px). Shows Queued/Active/Done/Failed as text.

**Issues:**

- **Visually insignificant for its importance.** The HealthBar is the user's first-glance indicator of "is my agent infrastructure running?" but it looks like a plain footer bar.
- **No visual weight for active count.** When agents are running, the Active count should pulse or have an accent color background.
- **Stats are incomplete.** `stats.queued` and `stats.doneToday` are always 0 in `HealthBarWrapper` — they are hardcoded placeholders. This is misleading.
- **The pipe separator (`|`) is styled with `tokens.color.border`** which is barely visible. Use a proper divider element.
- **No glass treatment.** Should use `glass-surface` class with a subtle top-border gradient.

**Recommendations:**

1. Increase height to 32-36px with padding
2. Connection dot should use `glow-accent-sm` when connected and `glow-pulse` when agents are running
3. Active count should have an accent-tinted badge: `background: var(--bde-accent-dim); border-radius: 99px; padding: 0 8px`
4. Fix the hardcoded 0s — pull real queued/done counts from the API
5. Add glass surface background with subtle gradient

### Terminal Pane

**Current state:** xterm.js instance with `tokens.space[2]` (8px) padding. Theme comes from `getTerminalTheme()`. Standard xterm rendering with fit/search/web-links addons.

**Issues:**

- **No visual chrome around the terminal.** The terminal pane is just a bare xterm div. No subtle inner shadow, no rounded corners, no inset feel. Compared to iTerm2 or Warp, it feels raw.
- **Padding is 8px which is tight.** Terminal padding should be at least 12-16px for readability and visual breathing room.
- **No custom scrollbar styling** for the terminal container. xterm uses its own scrollbar which may not match the app's design language.
- **Font size (13px) is reasonable** but the `lineHeight: 1.5` is generous for a terminal — 1.3 to 1.4 is more typical.

**Recommendations:**

1. Wrap terminal pane in a container with `border-radius: 8px; overflow: hidden` when not in split mode
2. Increase padding to 12px (`tokens.space[3]`)
3. Add a subtle inner shadow: `box-shadow: inset 0 2px 8px rgba(0,0,0,0.3)` to give depth
4. Style xterm scrollbar via `.xterm-viewport::-webkit-scrollbar` to match app theme
5. Reduce lineHeight to 1.35 for terminal density

### Terminal Tabs

**Current state:** Well-styled with CSS classes. Active tab has green dot indicator via `::before`. Agent tabs have purple dot and italic text. Tab close buttons show on hover. Supports drag reorder, rename, context menu.

**Issues:**

- **Tab bar height at 36px with 26px tabs** leaves dead space. The tabs feel small within the bar.
- **Active tab uses `var(--bde-selected)` (rgba 8% white)** which is very subtle. Hard to see which tab is active at a glance.
- **No tab count badge.** When many tabs are open and overflow is triggered, the scroll arrows appear but there is no visual count.
- **Agent tabs only differ by italic font style** and purple dot. They should have a more distinctive treatment — perhaps a subtle purple background tint.
- **The `::before` dot indicator on active tabs conflicts with the `terminal-tab__status-dot`** `<span>` — there are potentially two dots showing. The CSS `::before` creates a dot AND the component renders a `<span>` dot with `getStatusDotColor()`. Need to verify these do not double up.

**Recommendations:**

1. Active tab: increase background opacity to `rgba(255,255,255,0.12)` and add a bottom accent border (2px green line)
2. Agent tabs: add `background: var(--bde-purple-dim)` for instant recognition
3. Verify the double-dot issue — either remove the `::before` pseudo-element or the `<span>` status dot
4. Add tab count indicator when overflow is detected (e.g., "+3" chip on the right scroll button)
5. Increase tab border-radius from 4px to 8px for softer feel

### Find Bar

**Current state:** Floating absolutely positioned bar at top-right. Glass-ish with `var(--bde-surface-high)` background, border, and shadow. Well-executed search with live result count.

**Issues:**

- **Missing glassmorphism.** Has solid background instead of `backdrop-filter: blur()`. Should use the glass-modal or glass-surface pattern.
- **Border radius is `var(--bde-radius-md)` = 6px.** Bump to 12-14px for consistency with the new direction.
- **No enter/exit animation.** Appears/disappears instantly. Should slide in from the top-right with a fade.
- **Button hover states are basic.** The prev/next/close buttons should have smooth transitions with the `hover-border-brighten` pattern.

**Recommendations:**

1. Add `backdrop-filter: blur(16px)` and reduce background opacity
2. Increase border-radius to 12px
3. Add CSS transition or framer-motion for open/close
4. Style with subtle shadow matching `--bde-shadow-md`

---

## Product Manager Findings

### Agent Monitoring Workflow

**Current state:** Two-panel layout — agent list on left, detail on right. Polling-based updates. HealthBar shows connection status.

**Gaps:**

1. **No at-a-glance agent health summary.** When 3 agents are running, the user has to scan the list to understand aggregate status. Need a visual summary strip — e.g., "3 running, 1 queued" with mini progress bars or a stacked bar chart.
2. **No cost tracking in the list view.** Agents show model and duration but not cost. For a tool that spawns many agents, cost visibility in the list is critical. Add a cost column or badge to AgentCard.
3. **No completion notification pattern.** When an agent finishes (success or failure), there is no visual event beyond the status dot changing color. Should flash the card, play a subtle animation, and potentially trigger a desktop notification.
4. **HealthBarWrapper hardcodes `queued: 0` and `doneToday: 0`** — the user sees these values and thinks nothing is queued or done. Either pull real data or hide the fields until data is available.
5. **No agent retry/restart action.** If an agent fails, the user must create a new one via SpawnModal. A "Retry" button on failed agents would reduce friction.
6. **No agent cancellation from the list.** User must go to detail view. A right-click context menu on AgentCard with "Kill" would be natural.
7. **The log fallback (`LogFallback`) is a plain `<pre>` block.** For older agents without structured events, this is a poor reading experience. At minimum, add ANSI color parsing.

### Terminal UX

**Current state:** Multi-tab terminal with shell/agent tab types, split panes, find bar. Keyboard shortcuts mirror standard terminal conventions.

**Gaps:**

1. **No terminal session persistence.** Closing the app loses all terminal state. This is expected for shell PTYs but agent output tabs should reconnect on relaunch.
2. **Agent output tab has no controls.** No ability to clear, search, or filter the agent output. The FindBar is disabled for agent tabs (`!isAgentTab && showFind`).
3. **No command history or snippets.** Power users running the same git commands repeatedly would benefit from a command palette or snippet library within the terminal.
4. **Split pane is horizontal only.** The code has a comment "Reserved for vertical split in Phase 2" — this should be tracked. Vertical split is essential for side-by-side log comparison.
5. **No terminal-to-agent bridge.** Cannot spawn an agent directly from a terminal context (e.g., "run this command as an agent task"). The `handleOpenShell` in AgentDetail goes the other direction (agent -> terminal) but not terminal -> agent.
6. **Tab unread indicator exists in the store** (`hasUnread`) but it is never set to true — `setUnread` is defined but no code calls it. Dead feature.
7. **Zoom level is not persisted.** `fontSize` resets to 13 on app restart. Should save to settings.

### Missing UX Patterns

1. **No agent timeline view.** Users managing multiple agents over a sprint need a Gantt-style timeline showing when agents ran, how long they took, and their outcomes.
2. **No agent output search.** ChatRenderer has no search/filter capability. For long agent conversations (500+ events), finding a specific tool call or error is needle-in-haystack.
3. **No agent comparison.** Cannot view two agents side by side. This would help when an agent is retried — comparing the failed run to the successful run.
4. **No "Watch" mode for agents.** The polling interval for sessions is `POLL_SESSIONS_INTERVAL` — when an agent completes, the update could be delayed by up to one poll cycle. Real-time events via IPC would eliminate lag.
5. **No keyboard navigation in AgentList.** Cannot arrow-key through agents. Must click.

---

## Sr. Frontend Dev Findings

### Component-Level Changes

1. **AgentCard: Move from inline styles to CSS module or CSS classes.**
   - Currently 100% inline styles. This prevents hover states, pseudo-elements, animations, and media queries.
   - The `animation: pulse 2s infinite` references a keyframe that may not exist in scope — needs `@keyframes pulse` defined in agents.css.
   - The card is a `<button>` which is correct for accessibility but needs `border-radius` and proper focus-visible styling.
   - Estimated effort: **Medium** (2-3 hours). Create `.agent-card` CSS class set, replace inline styles, add keyframes.

2. **AgentList: Running/Recent groups are not collapsible.**
   - `GroupHeader` for Running and Recent passes `open={true}` and `onToggle={() => {}}` — these groups are always open with a non-functional toggle. Either make them collapsible or remove the chevron to avoid confusion.
   - Estimated effort: **Small** (30 min).

3. **ChatRenderer: Virtualizer `estimateSize` is static at 60px.**
   - This causes layout jumps as items are measured. Different block types have vastly different heights: text (40-200px), tool calls (40-400px expanded), thinking (40-300px expanded). Should use a type-based estimate.
   - The `contain: 'strict'` on the scroll parent is good for performance.
   - Estimated effort: **Small** (1 hour). Add a `getEstimateForType(block.type)` function.

4. **ChatBubble: `whiteSpace: 'pre-wrap'` can cause very wide bubbles.**
   - Long single-line outputs (e.g., URLs, file paths) will push the bubble to `maxWidth: 85%`. Add `overflow-wrap: break-word` in addition to `word-break: break-word`.
   - Estimated effort: **Trivial**.

5. **SpawnModal: Missing CSS definitions.**
   - All `.spawn-modal__*` classes are referenced in the TSX but no CSS file defines them. Either they are being generated dynamically, exist in an unscanned CSS file, or the modal is rendering unstyled. Need to create `agents.css` rules or a dedicated `spawn-modal.css`.
   - Estimated effort: **Medium** (2-3 hours to create full CSS).

6. **SteerInput: Inline event handlers for focus/blur border color.**
   - Uses `onMouseEnter`/`onMouseLeave` style manipulation in AgentDetail and `onFocus`/`onBlur` in SteerInput. This is fragile and unmaintainable. Replace with CSS `:focus-within` and `:hover` pseudo-classes.
   - Estimated effort: **Small** (30 min).

7. **TerminalTabBar: Double status dot rendering.**
   - The CSS `.terminal-tab--active::before` creates a 6px dot AND the component renders a `<span className="terminal-tab__status-dot">`. These likely render side by side, creating two dots for active tabs. Remove one.
   - Estimated effort: **Trivial**.

8. **AgentOutputTab: Duplicate empty/waiting states.**
   - The `sessionKey` check and the final empty state both render the same "Waiting for agent output..." message. Consolidate.
   - Estimated effort: **Trivial**.

### CSS Changes

1. **Create comprehensive `agents.css` rules.** Current file is only 49 lines covering the sidebar header and spawn button. Need:
   - `.agent-card`, `.agent-card--running`, `.agent-card--selected`, `.agent-card--done`, `.agent-card--failed`
   - `.agent-detail__header`, `.agent-detail__meta`
   - `.chat-bubble`, `.chat-bubble--agent`, `.chat-bubble--user`, `.chat-bubble--error`
   - `.thinking-block`, `.thinking-block--active`
   - `.tool-call-block`, `.tool-call-block--expanded`
   - `.health-bar`, `.health-bar__stat`, `.health-bar__dot`
   - `.steer-input`, `.steer-input__send-btn`
   - Estimated effort: **Large** (4-6 hours).

2. **Add agent-specific keyframes to agents.css:**

   ```css
   @keyframes agent-pulse {
     0%,
     100% {
       opacity: 1;
     }
     50% {
       opacity: 0.6;
     }
   }

   @keyframes agent-breathe {
     0%,
     100% {
       box-shadow: 0 0 0 0 rgba(0, 211, 127, 0);
     }
     50% {
       box-shadow: 0 0 12px 2px rgba(0, 211, 127, 0.15);
     }
   }

   @keyframes thinking-shimmer {
     0% {
       background-position: -200% 0;
     }
     100% {
       background-position: 200% 0;
     }
   }
   ```

3. **Terminal CSS improvements:**
   - Add `.terminal-pane` wrapper with inner shadow and rounded corners
   - Style xterm scrollbar: `.xterm-viewport::-webkit-scrollbar { width: 6px }` etc.
   - Agent tab background tint: `.terminal-tab--agent { background: var(--bde-purple-dim) }`

4. **tokens.ts radius values are too small for the new direction.**
   - Current: `sm: 4px, md: 6px, lg: 8px, xl: 12px`
   - Target: `sm: 8px, md: 12px, lg: 16px, xl: 20px`
   - This is a cross-team concern but it directly impacts every agent component since they all reference `tokens.radius.*`.

### Performance Concerns

1. **ChatRenderer virtualization is solid** — uses `@tanstack/react-virtual` with dynamic measurement. The `overscan: 10` is reasonable. However:
   - The `pairEvents()` function runs on every render (memoized by events array reference). For 1000+ events, this creates 1000+ ChatBlock objects. Consider incremental pairing or caching.
   - `JSON.stringify(input, null, 2)` in ToolCallBlock expanded view is called during render for large tool inputs. Memoize or defer until actually expanded.

2. **AgentCard re-render on tick.** Running agents set a 1-second interval that updates a dummy state (`setTick`). This re-renders the card every second. For 10 running agents, that is 10 re-renders/second in AgentList. Consider:
   - Moving the duration format to a separate `<RunningDuration>` component to isolate re-renders
   - Using `requestAnimationFrame` instead of `setInterval` for smoother updates

3. **Terminal font size (zoom) is not applied.** The store tracks `fontSize` with `zoomIn`/`zoomOut`/`resetZoom` but `TerminalPane` always creates xterm with `fontSize: 13`. The store value is never read by the pane component. This is a bug — zoom controls do nothing.

4. **Terminal tab `hasUnread` is never set.** The store has `setUnread(id, boolean)` but no code calls it. The `getStatusDotColor` checks `tab.hasUnread` to show blue, but it will never be true. Either implement the unread detection (compare `activeTabId` to tab receiving data) or remove the dead code.

5. **HealthBarWrapper polls every 5 seconds** with `setInterval` inside a `useEffect`. This continues even when the Agents view is not active. Should use `useVisibilityAwareInterval` like the agent list polling.

---

## Priority Matrix

| Priority | Item                                                 | Persona | Effort  | Impact                                    |
| -------- | ---------------------------------------------------- | ------- | ------- | ----------------------------------------- |
| **P0**   | Running agent card glow/breathe animation            | UX      | Medium  | Core experience — agents must feel alive  |
| **P0**   | Fix terminal zoom bug (fontSize not applied)         | Dev     | Small   | Feature is broken — buttons do nothing    |
| **P0**   | Create comprehensive agents.css (move inline to CSS) | Dev     | Large   | Unlocks all visual improvements           |
| **P0**   | Fix HealthBarWrapper hardcoded 0s                    | PM      | Small   | Misleading data display                   |
| **P1**   | ChatBubble radius increase + asymmetric corners      | UX      | Small   | Visual polish, conversational feel        |
| **P1**   | CompletedBlock/ErrorBlock card treatment             | UX      | Small   | Celebration/alert moments                 |
| **P1**   | Terminal tab double-dot fix                          | Dev     | Trivial | Visual bug                                |
| **P1**   | Agent completion notification/flash                  | PM      | Medium  | Users miss when agents finish             |
| **P1**   | Implement terminal `hasUnread` or remove dead code   | Dev     | Small   | Clean up or deliver feature               |
| **P1**   | HealthBar glass treatment + active stat badges       | UX      | Medium  | Status bar visual weight                  |
| **P1**   | SpawnModal CTA gradient button + locate/create CSS   | UX/Dev  | Medium  | Primary action deserves premium treatment |
| **P2**   | ThinkingBlock shimmer animation while running        | UX      | Small   | Subtle life indicator                     |
| **P2**   | Find bar glassmorphism + enter animation             | UX      | Small   | Visual consistency                        |
| **P2**   | Terminal inner shadow + scrollbar styling            | UX      | Small   | Depth and polish                          |
| **P2**   | ChatRenderer estimate size by block type             | Dev     | Small   | Reduce layout jumps                       |
| **P2**   | Isolate AgentCard duration ticker to child component | Dev     | Small   | Performance (10 running agents)           |
| **P2**   | AgentList keyboard navigation (arrow keys)           | PM      | Medium  | Power user workflow                       |
| **P2**   | Agent cancel/retry from list context menu            | PM      | Medium  | Workflow efficiency                       |
| **P2**   | HealthBar poll only when Agents view is active       | Dev     | Trivial | Unnecessary background work               |
| **P3**   | Terminal agent tab search/filter                     | PM      | Medium  | Long agent output navigation              |
| **P3**   | Token radius scale update (cross-team)               | Dev     | Large   | Foundation for all new design             |
| **P3**   | AgentList group collapse functionality               | Dev     | Small   | Non-functional chevrons are confusing     |
| **P3**   | Terminal session zoom persistence                    | PM      | Small   | QoL improvement                           |
| **P3**   | Vertical split pane support                          | PM      | Large   | Phase 2 tracked feature                   |
