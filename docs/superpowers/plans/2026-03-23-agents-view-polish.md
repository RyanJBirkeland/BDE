# Agents View UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Agents view as a chat-first Claude Code GUI with IDE-dense styling, tabbed content, sidebar Sessions/Queue split, and inline new-session form.

**Architecture:** Seven incremental tasks, each producing a working UI. Task 1 creates the CSS foundation + sidebar restructure. Task 2 builds the new session form (replacing SpawnModal). Tasks 3-5 build the three tab views (Chat, Tools, Files). Task 6 wires the session header + tab switching + AgentsView orchestration. Task 7 removes old components and cleans up.

**Tech Stack:** React, TypeScript, Zustand, CSS (design tokens), `@tanstack/react-virtual` (existing)

**Spec:** `docs/superpowers/specs/2026-03-23-agents-view-polish-design.md`

---

## File Structure

### New Files

```
src/renderer/src/assets/agents-view.css          # All Agents view styles (replaces agents.css)
src/renderer/src/components/agents/SessionList.tsx     # Sidebar: ad-hoc sessions
src/renderer/src/components/agents/QueueList.tsx       # Sidebar: sprint/external agents
src/renderer/src/components/agents/NewSessionForm.tsx  # Empty-state spawn form
src/renderer/src/components/agents/SessionHeader.tsx   # Header bar: info + tabs + stop
src/renderer/src/components/agents/ChatTab.tsx         # Chat tab: interleaved stream
src/renderer/src/components/agents/ToolBlock.tsx       # Grouped tool calls (collapsible)
src/renderer/src/components/agents/AgentText.tsx       # Agent text block (pre-wrap)
src/renderer/src/components/agents/UserMessage.tsx     # User message with label
src/renderer/src/components/agents/ToolsTab.tsx        # Tools inspector tab
src/renderer/src/components/agents/FilesTab.tsx        # Files touched tab
```

### Modified Files

```
src/renderer/src/views/AgentsView.tsx                  # Complete rewrite: new layout
src/renderer/src/components/agents/AgentCard.tsx        # Simplify: remove source icon
src/renderer/src/components/agents/SteerInput.tsx       # Polish: Cmd+Enter, hints
src/renderer/src/components/agents/ThinkingBlock.tsx    # Restyle: design tokens
```

### Deleted Files (Task 7)

```
src/renderer/src/components/agents/SpawnModal.tsx
src/renderer/src/components/agents/ChatRenderer.tsx
src/renderer/src/components/agents/ChatBubble.tsx
src/renderer/src/components/agents/AgentList.tsx
src/renderer/src/components/agents/AgentDetail.tsx
src/renderer/src/components/agents/HealthBar.tsx
src/renderer/src/assets/agents.css
```

---

## Task 1: CSS foundation + SessionList + QueueList

Create the new CSS file and sidebar components. After this task, the sidebar renders with Sessions/Queue sections (using existing data) but the main panel is still the old AgentDetail.

**Files:**

- Create: `src/renderer/src/assets/agents-view.css`
- Create: `src/renderer/src/components/agents/SessionList.tsx`
- Create: `src/renderer/src/components/agents/QueueList.tsx`

- [ ] **Step 1: Create `agents-view.css`**

Complete CSS for the entire Agents view. Use CSS variables from `base.css` and `design-system.css`. Key sections: layout, sidebar, session header, chat tab, tool blocks, tabs, new session form, steer input.

```css
/* ── Agents View: Layout ─────────────────────────── */

.agents-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-base, var(--bde-bg));
}

.agents-view__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Sidebar ─────────────────────────────────────── */

.agents-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border, var(--bde-border));
  overflow: hidden;
}

.agents-sidebar__header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  border-bottom: 1px solid var(--border, var(--bde-border));
  flex-shrink: 0;
}

.agents-sidebar__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

.agents-sidebar__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.agents-sidebar__add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: 1px solid var(--border, var(--bde-border));
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  color: var(--text-secondary, var(--bde-text-muted));
  transition:
    color 0.12s ease,
    border-color 0.12s ease;
}

.agents-sidebar__add-btn:hover {
  color: var(--text-primary, var(--bde-text));
  border-color: var(--text-secondary, var(--bde-text-muted));
}

.agents-sidebar__content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.agents-sidebar__divider {
  height: 1px;
  background: var(--border, var(--bde-border));
  margin: 8px 12px;
}

/* ── Sidebar: Section Headers ────────────────────── */

.agents-section__header {
  padding: 6px 12px 2px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-ghost, var(--bde-text-dim));
  font-weight: 600;
}

.agents-section__empty {
  padding: 16px 12px;
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 10px;
  text-align: center;
}

/* ── Sidebar: Agent Card ─────────────────────────── */

.agent-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px;
  margin: 2px 4px;
  border-radius: 0 4px 4px 0;
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: background 0.1s ease;
  background: transparent;
  border: none;
  width: calc(100% - 8px);
  text-align: left;
  font-family: inherit;
}

.agent-card:hover {
  background: var(--bg-hover, var(--bde-hover-strong));
}

.agent-card--selected {
  background: var(--glass-tint-mid, var(--bde-selected));
  border-left-color: var(--accent, var(--bde-accent));
}

.agent-card__top {
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-card__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-card__dot--running {
  background: var(--accent, var(--bde-accent));
  animation: pulse 2s ease-in-out infinite;
}

.agent-card__dot--active {
  background: var(--color-warning, #f59e0b);
}

.agent-card__dot--done {
  background: var(--text-ghost, var(--bde-text-dim));
}

.agent-card__dot--failed {
  background: var(--color-danger, var(--bde-danger));
}

.agent-card__dot--queued {
  background: var(--text-ghost, var(--bde-text-dim));
  opacity: 0.5;
}

.agent-card__title {
  font-size: 11px;
  color: var(--text-primary, var(--bde-text));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card--selected .agent-card__title {
  color: var(--text-primary, #fff);
}

.agent-card__meta {
  font-size: 9px;
  color: var(--text-ghost, var(--bde-text-dim));
  padding-left: 10px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* ── Session Header ──────────────────────────────── */

.session-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border, var(--bde-border));
  flex-shrink: 0;
}

.session-header__info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-header__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.session-header__name {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-primary, var(--bde-text));
}

.session-header__meta {
  font-size: 10px;
  color: var(--text-ghost, var(--bde-text-dim));
}

.session-header__tabs {
  margin-left: auto;
  display: flex;
  gap: 1px;
  background: var(--bg-base, var(--bde-bg));
  border-radius: 6px;
  padding: 2px;
}

.session-header__tab {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-ghost, var(--bde-text-dim));
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition:
    color 0.1s,
    background 0.1s;
}

.session-header__tab:hover {
  color: var(--text-secondary, var(--bde-text-muted));
}

.session-header__tab--active {
  background: var(--glass-tint-mid, var(--bde-selected));
  color: var(--accent, var(--bde-accent));
}

.session-header__stop {
  background: none;
  border: none;
  color: var(--text-ghost, var(--bde-text-dim));
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  transition:
    color 0.1s,
    background 0.1s;
}

.session-header__stop:hover {
  color: var(--color-danger, var(--bde-danger));
  background: var(--bg-hover, var(--bde-hover-strong));
}

.session-header__status {
  font-size: 10px;
  color: var(--text-ghost, var(--bde-text-dim));
  padding: 2px 6px;
}

/* ── Chat Tab ────────────────────────────────────── */

.chat-tab {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-tab__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 12px;
}

/* ── Agent Text ──────────────────────────────────── */

.agent-text {
  color: var(--text-primary, var(--bde-text));
  font-size: var(--bde-size-sm, 12px);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2px 0;
}

.agent-text code {
  background: var(--glass-tint-mid, var(--bde-selected));
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--bde-font-code);
  font-size: 10px;
}

/* ── User Message ────────────────────────────────── */

.user-message {
  padding: 2px 0;
}

.user-message__divider {
  height: 1px;
  background: var(--border, var(--bde-border));
  margin-bottom: 6px;
  opacity: 0.5;
}

.user-message__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--accent, var(--bde-accent));
}

.user-message__time {
  font-size: 9px;
  color: var(--text-ghost, var(--bde-text-dim));
  margin-left: 6px;
}

.user-message__text {
  font-size: var(--bde-size-sm, 12px);
  color: var(--text-primary, var(--bde-text));
  line-height: 1.5;
  white-space: pre-wrap;
  margin-top: 2px;
}

/* ── Tool Block ──────────────────────────────────── */

.tool-block {
  background: var(--bg-base, var(--bde-bg));
  border-radius: 6px;
  border-left: 2px solid var(--color-info, #00b4d8);
  overflow: hidden;
}

.tool-block--running {
  border-left-color: var(--color-warning, #f59e0b);
}

.tool-block__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.1s;
}

.tool-block__row:hover {
  background: var(--bg-hover, var(--bde-hover-strong));
}

.tool-block__tool-name {
  color: var(--color-info, #00b4d8);
  font-weight: 600;
  min-width: 36px;
}

.tool-block__summary {
  color: var(--text-secondary, var(--bde-text-muted));
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-block__status {
  font-size: 9px;
  flex-shrink: 0;
}

.tool-block__status--success {
  color: var(--accent, var(--bde-accent));
}

.tool-block__status--failed {
  color: var(--color-danger, var(--bde-danger));
}

.tool-block__status--running {
  color: var(--color-warning, #f59e0b);
}

.tool-block__detail {
  border-top: 1px solid var(--border, var(--bde-border));
  padding: 8px 10px;
}

.tool-block__detail-label {
  font-size: 9px;
  text-transform: uppercase;
  color: var(--text-ghost, var(--bde-text-dim));
  margin-bottom: 4px;
  font-weight: 600;
}

.tool-block__detail-json {
  font-family: var(--bde-font-code);
  font-size: 10px;
  color: var(--text-secondary, var(--bde-text-muted));
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  line-height: 1.5;
}

/* ── Completion / Error / Rate Limit ─────────────── */

.chat-completed {
  font-size: 10px;
  color: var(--text-ghost, var(--bde-text-dim));
  padding: 4px 0;
}

.chat-completed--failed {
  color: var(--color-danger, var(--bde-danger));
}

.chat-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--color-danger, var(--bde-danger));
}

.chat-rate-limited {
  font-size: 10px;
  color: var(--color-warning, #f59e0b);
  padding: 2px 0;
}

.chat-started {
  font-size: 10px;
  color: var(--text-ghost, var(--bde-text-dim));
  text-align: center;
  padding: 4px 0;
}

/* ── New Session Form ────────────────────────────── */

.new-session {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.new-session__inner {
  width: 100%;
  max-width: 520px;
}

.new-session__greeting {
  text-align: center;
  margin-bottom: 24px;
}

.new-session__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent, #00d37f), var(--color-info, #00b4d8));
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #000;
  font-weight: bold;
}

.new-session__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, var(--bde-text));
}

.new-session__subtitle {
  font-size: 11px;
  color: var(--text-ghost, var(--bde-text-dim));
  margin-top: 4px;
}

.new-session__textarea {
  width: 100%;
  background: var(--bg-base, var(--bde-bg));
  border: 1px solid var(--border, var(--bde-border));
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 12px;
  font-family: var(--bde-font-ui);
  color: var(--text-primary, var(--bde-text));
  resize: none;
  outline: none;
  min-height: 48px;
  transition: border-color 0.12s ease;
}

.new-session__textarea:focus {
  border-color: var(--accent, var(--bde-accent));
}

.new-session__textarea::placeholder {
  color: var(--text-ghost, var(--bde-text-dim));
}

.new-session__options {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}

.new-session__repo-select {
  background: var(--bg-base, var(--bde-bg));
  border: 1px solid var(--border, var(--bde-border));
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 10px;
  color: var(--text-secondary, var(--bde-text-muted));
  font-family: var(--bde-font-ui);
  outline: none;
}

.new-session__model-chips {
  display: flex;
  gap: 2px;
  background: var(--bg-base, var(--bde-bg));
  border-radius: 8px;
  padding: 2px;
}

.new-session__model-chip {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-ghost, var(--bde-text-dim));
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition:
    color 0.1s,
    background 0.1s;
}

.new-session__model-chip--active {
  background: var(--glass-tint-mid, var(--bde-selected));
  color: var(--accent, var(--bde-accent));
}

.new-session__send-btn {
  margin-left: auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  transition:
    background 0.12s,
    color 0.12s;
}

.new-session__send-btn--enabled {
  background: var(--accent, var(--bde-accent));
  color: #000;
}

.new-session__send-btn--disabled {
  background: var(--border, var(--bde-border));
  color: var(--text-ghost, var(--bde-text-dim));
  cursor: not-allowed;
}

/* ── Steer Input (polished) ──────────────────────── */

.steer-input {
  padding: 10px 16px;
  border-top: 1px solid var(--border, var(--bde-border));
  flex-shrink: 0;
}

.steer-input__row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.steer-input__textarea {
  flex: 1;
  background: var(--bg-base, var(--bde-bg));
  border: 1px solid var(--border, var(--bde-border));
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 11px;
  font-family: var(--bde-font-ui);
  color: var(--text-primary, var(--bde-text));
  resize: none;
  outline: none;
  line-height: 1.5;
  transition: border-color 0.12s ease;
}

.steer-input__textarea:focus {
  border-color: var(--accent, var(--bde-accent));
}

.steer-input__textarea::placeholder {
  color: var(--text-ghost, var(--bde-text-dim));
}

.steer-input__send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background 0.12s,
    color 0.12s;
}

.steer-input__send--enabled {
  background: var(--accent, var(--bde-accent));
  color: #000;
}

.steer-input__send--disabled {
  background: var(--border, var(--bde-border));
  color: var(--text-ghost, var(--bde-text-dim));
  cursor: not-allowed;
}

.steer-input__hints {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-ghost, var(--bde-text-dim));
}

/* ── Tools Tab ───────────────────────────────────── */

.tools-tab {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.tools-tab__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 12px;
}

.tools-tab__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.1s;
}

.tools-tab__row:hover {
  background: var(--bg-hover, var(--bde-hover-strong));
}

.tools-tab__time {
  color: var(--text-ghost, var(--bde-text-dim));
  min-width: 60px;
  flex-shrink: 0;
}

.tools-tab__name {
  color: var(--color-info, #00b4d8);
  font-weight: 600;
  min-width: 48px;
}

.tools-tab__summary {
  color: var(--text-secondary, var(--bde-text-muted));
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tools-tab__badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.tools-tab__badge--success {
  background: rgba(0, 211, 127, 0.15);
  color: var(--accent, var(--bde-accent));
}

.tools-tab__badge--failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-danger, var(--bde-danger));
}

.tools-tab__badge--running {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning, #f59e0b);
}

.tools-tab__detail {
  padding: 8px 16px 8px 84px;
  border-bottom: 1px solid var(--border, var(--bde-border));
}

/* ── Files Tab ───────────────────────────────────── */

.files-tab {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.files-tab__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 12px;
}

.files-tab__section-header {
  padding: 8px 16px 4px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-ghost, var(--bde-text-dim));
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.files-tab__count {
  background: var(--glass-tint-mid, var(--bde-selected));
  padding: 0 6px;
  border-radius: 8px;
  font-size: 9px;
}

.files-tab__file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.1s;
}

.files-tab__file:hover {
  background: var(--bg-hover, var(--bde-hover-strong));
}

.files-tab__path {
  color: var(--text-secondary, var(--bde-text-muted));
  font-family: var(--bde-font-code);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-tab__tool {
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 9px;
}

/* ── Main Panel ──────────────────────────────────── */

.agents-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Resize Handle ───────────────────────────────── */

.agents-resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.1s;
}

.agents-resize-handle:hover {
  background: var(--accent, var(--bde-accent));
}

/* ── Loading State ───────────────────────────────── */

.agents-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-ghost, var(--bde-text-dim));
  font-size: 12px;
}
```

- [ ] **Step 2: Create `SessionList.tsx`**

```tsx
import type { AgentMeta } from '../../../../shared/types'
import { AgentCard } from './AgentCard'

interface SessionListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function SessionList({ agents, selectedId, onSelect }: SessionListProps) {
  const sessions = agents
    .filter((a) => a.source === 'adhoc')
    .sort((a, b) => {
      // Running first, then by startedAt descending
      if (a.status === 'running' && b.status !== 'running') return -1
      if (b.status === 'running' && a.status !== 'running') return 1
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    })

  return (
    <div>
      <div className="agents-section__header">Sessions ({sessions.length})</div>
      {sessions.length === 0 ? (
        <div className="agents-section__empty">No sessions yet</div>
      ) : (
        sessions.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onClick={() => onSelect(agent.id)}
          />
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `QueueList.tsx`**

```tsx
import type { AgentMeta } from '../../../../shared/types'
import { AgentCard } from './AgentCard'

interface QueueListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function QueueList({ agents, selectedId, onSelect }: QueueListProps) {
  const queueAgents = agents
    .filter((a) => a.source === 'bde' || a.source === 'external')
    .sort((a, b) => {
      // Active first, then by startedAt descending
      if (a.status === 'running' && b.status !== 'running') return -1
      if (b.status === 'running' && a.status !== 'running') return 1
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    })

  const activeCount = queueAgents.filter((a) => a.status === 'running').length

  return (
    <div>
      <div className="agents-section__header">
        Queue{activeCount > 0 ? ` (${activeCount} active)` : ` (${queueAgents.length})`}
      </div>
      {queueAgents.length === 0 ? (
        <div className="agents-section__empty">No queued tasks</div>
      ) : (
        queueAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onClick={() => onSelect(agent.id)}
          />
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `AgentCard.tsx` — simplify for new design**

Remove source icon (Bot/Cpu), use CSS classes instead of inline styles. Keep the live ticker for running agents.

The card should use the new CSS classes: `agent-card`, `agent-card--selected`, `agent-card__dot`, `agent-card__dot--{status}`, `agent-card__title`, `agent-card__meta`.

Map status to dot class (same for all agents — sidebar sections provide visual distinction):

- `running` → `agent-card__dot--running` (green pulse)
- `done` → `agent-card__dot--done`
- `failed` → `agent-card__dot--failed`
- default → `agent-card__dot--done`

- [ ] **Step 5: Verify typecheck + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/agents-view.css src/renderer/src/components/agents/SessionList.tsx src/renderer/src/components/agents/QueueList.tsx src/renderer/src/components/agents/AgentCard.tsx
git commit -m "feat(agents): add CSS foundation, SessionList, QueueList, simplify AgentCard"
```

---

## Task 2: NewSessionForm — inline spawn replacing SpawnModal

**Files:**

- Create: `src/renderer/src/components/agents/NewSessionForm.tsx`

- [ ] **Step 1: Create `NewSessionForm.tsx`**

Centered form with greeting, textarea, repo select, model chips, send button.

Key props: `onSessionCreated: (id: string) => void` — called after spawn succeeds so AgentsView can set `selectedId`.

**Repo path resolution** (same pattern as current SpawnModal):

1. On mount, call `window.api.getRepoPaths()` → `Record<string, string>` (lowercase name → path)
2. Use `useRepoOptions()` hook for select labels
3. On submit, look up `repoPaths[repo.toLowerCase()]` for filesystem path
4. If path not found, show error toast

**Model:** `CLAUDE_MODELS` from `src/shared/models.ts`, default `'sonnet'`.
**Spawn:** `useLocalAgentsStore.getState().spawnAgent({ task, repoPath, model })`.
Task history from localStorage (`HISTORY_KEY = 'bde-spawn-history'`).

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/NewSessionForm.tsx
git commit -m "feat(agents): add NewSessionForm — inline spawn replacing SpawnModal"
```

---

## Task 3: ChatTab — interleaved stream with tool grouping

**Files:**

- Create: `src/renderer/src/components/agents/AgentText.tsx`
- Create: `src/renderer/src/components/agents/UserMessage.tsx`
- Create: `src/renderer/src/components/agents/ToolBlock.tsx`
- Create: `src/renderer/src/components/agents/ChatTab.tsx`

- [ ] **Step 1: Create `AgentText.tsx`**

Simple component: renders agent text with `pre-wrap` styling. Uses `.agent-text` CSS class.

```tsx
interface AgentTextProps {
  text: string
}

export function AgentText({ text }: AgentTextProps) {
  return <div className="agent-text">{text}</div>
}
```

- [ ] **Step 2: Create `UserMessage.tsx`**

User message with "You" label, timestamp, divider above, text below.

```tsx
interface UserMessageProps {
  text: string
  timestamp: number
}

export function UserMessage({ text, timestamp }: UserMessageProps) {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="user-message">
      <div className="user-message__divider" />
      <div>
        <span className="user-message__label">You</span>
        <span className="user-message__time">{time}</span>
      </div>
      <div className="user-message__text">{text}</div>
    </div>
  )
}
```

- [ ] **Step 3: Create `ToolBlock.tsx`**

Grouped consecutive tool calls. Each tool is a row. Click block header to expand all input/output. Left border color based on whether any tool is still running.

Props: `tools: Array<{ tool: string; summary: string; input?: unknown; result?: { success: boolean; summary: string; output?: unknown } }>`.

Each row shows: tool name (cyan, bold) | summary | status (✓/✗/running...).

Collapsible: click toggles expanded state. When expanded, shows input/output JSON for each tool.

- [ ] **Step 4: Create `ChatTab.tsx`**

Main chat stream component. Takes `events: AgentEvent[]`. Transforms events into renderable blocks using a `groupEvents()` function:

**Grouping algorithm — merges N consecutive tool events into one ToolBlock:**

Maintain a `toolGroup: ToolEntry[]` accumulator. Tool events add to the group. Non-tool events flush the group as a `ToolBlock`, then render themselves. Tool pairing: on `agent:tool_call`, look ahead — if next event is `agent:tool_result` with same `tool` name, pair them and skip the result. Otherwise, add without result (shown as "running...").

```
for each event:
  if tool_call → look ahead for matching result, add to toolGroup
  if tool_result (orphaned) → add to toolGroup
  else → flush toolGroup as ToolBlock, then render event
flush any remaining toolGroup
```

Non-tool events map 1:1: text→AgentText, user_message→UserMessage, started/completed/error/rate_limited→styled divs, thinking→ThinkingBlock.

Auto-scroll: track `isAtBottom` ref, scroll to bottom when new events arrive and user is near bottom.

- [ ] **Step 5: Verify typecheck + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/AgentText.tsx src/renderer/src/components/agents/UserMessage.tsx src/renderer/src/components/agents/ToolBlock.tsx src/renderer/src/components/agents/ChatTab.tsx
git commit -m "feat(agents): add ChatTab with tool grouping, AgentText, UserMessage, ToolBlock"
```

---

## Task 4: ToolsTab — tool call inspector

**Files:**

- Create: `src/renderer/src/components/agents/ToolsTab.tsx`

- [ ] **Step 1: Create `ToolsTab.tsx`**

Chronological list of all tool call events. Each row: timestamp | tool name | summary | status badge. Click to expand input/output JSON.

Filter tool events from the full `AgentEvent[]` array: `events.filter(e => e.type === 'agent:tool_call' || e.type === 'agent:tool_result')`.

Pair them (same logic as current `pairEvents` but simpler — just match consecutive call+result with same tool name).

Uses `.tools-tab__*` CSS classes.

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/ToolsTab.tsx
git commit -m "feat(agents): add ToolsTab — tool call inspector"
```

---

## Task 5: FilesTab — files touched view

**Files:**

- Create: `src/renderer/src/components/agents/FilesTab.tsx`

- [ ] **Step 1: Create `FilesTab.tsx`**

Extracts file paths from tool call events. Groups by action:

- **Read**: tool_call where `tool === 'Read'`
- **Modified**: tool_call where `tool === 'Edit' || tool === 'Write'`
- **Searched**: tool_call where `tool === 'Glob' || tool === 'Grep'`

Extract path from `input` field (typically `input.file_path` or `input.path` or `input.pattern`).

Deduplicate by path within each group. Show count badges.

Click to expand: show the tool's raw input/output.

Uses `.files-tab__*` CSS classes.

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/FilesTab.tsx
git commit -m "feat(agents): add FilesTab — files touched view"
```

---

## Task 6: SessionHeader + AgentsView rewrite

Wire everything together. This is the big integration task.

**Files:**

- Create: `src/renderer/src/components/agents/SessionHeader.tsx`
- Modify: `src/renderer/src/views/AgentsView.tsx` (complete rewrite)
- Modify: `src/renderer/src/components/agents/SteerInput.tsx` (polish)
- Modify: `src/renderer/src/components/agents/ThinkingBlock.tsx` (restyle)

- [ ] **Step 1: Create `SessionHeader.tsx`**

Props: `agent: AgentMeta`, `activeTab: string`, `onTabChange: (tab) => void`, `onStop: () => void`.

Renders: status dot + task name + model/repo metadata + tab buttons (Chat/Tools/Files) + stop button (only if running, otherwise status text).

- [ ] **Step 2: Rewrite `AgentsView.tsx`**

New structure:

```
motion.div (root, fade-in)
├── agents-view__body (flex row)
│   ├── agents-sidebar (resizable)
│   │   ├── sidebar header (AGENTS + add button)
│   │   ├── sidebar content (scrollable)
│   │   │   ├── SessionList
│   │   │   ├── divider
│   │   │   └── QueueList
│   │
│   ├── resize handle
│   └── agents-main
│       ├── if selectedId === null → NewSessionForm
│       ├── else →
│       │   ├── SessionHeader (with tabs + stop)
│       │   ├── activeTab === 'chat' → ChatTab + SteerInput (if running)
│       │   ├── activeTab === 'tools' → ToolsTab
│       │   └── activeTab === 'files' → FilesTab
```

Key state:

- `selectedId: string | null` — null shows NewSessionForm
- `activeTab: 'chat' | 'tools' | 'files'` — local state, resets to 'chat' on selection change
- Remove auto-select-first-agent logic
- Keep existing polling, event init, sidebar resize hooks
- Remove HealthBarWrapper (queue section header replaces it)
- Listen for `bde:open-spawn-modal` event (from CommandPalette) → set `selectedId = null` to show NewSessionForm

Import `agents-view.css` instead of `agents.css`.

**Note:** Tasks 2-5 create components that won't be visually testable until this task. Typecheck confirms they compile; visual verification happens here.

- [ ] **Step 3: Polish `SteerInput.tsx`**

Switch to CSS classes (`.steer-input__*`). Change send shortcut from Enter to Cmd+Enter. Add keyboard hints below input. Use rounded send button with accent color.

- [ ] **Step 4: Restyle `ThinkingBlock.tsx`**

Replace hardcoded hex colors (`#A855F7`, `rgba(168, 85, 247, 0.15)`) with CSS variables (`var(--color-ai)` or similar). Keep the collapsible structure.

- [ ] **Step 5: Verify typecheck + tests + visual check**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Then: `npm run dev` and visually verify the full flow — spawn, chat, steer, stop, view queue agents.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/SessionHeader.tsx src/renderer/src/views/AgentsView.tsx src/renderer/src/components/agents/SteerInput.tsx src/renderer/src/components/agents/ThinkingBlock.tsx src/renderer/src/assets/agents-view.css
git commit -m "feat(agents): rewrite AgentsView — chat-first layout with tabs, sidebar split, new session form"
```

---

## Task 7: Remove old components + cleanup

**Files:**

- Delete: `src/renderer/src/components/agents/SpawnModal.tsx`
- Delete: `src/renderer/src/components/agents/ChatRenderer.tsx`
- Delete: `src/renderer/src/components/agents/ChatBubble.tsx`
- Delete: `src/renderer/src/components/agents/AgentList.tsx`
- Delete: `src/renderer/src/components/agents/AgentDetail.tsx`
- Delete: `src/renderer/src/components/agents/HealthBar.tsx`
- Delete: `src/renderer/src/assets/agents.css`

- [ ] **Step 1: Remove old component files**

Delete all 7 files listed above. These are no longer imported by any component after Task 6.

- [ ] **Step 2: Remove any lingering imports**

Search for imports of removed components across the codebase:

- `CommandPalette` dispatches `bde:open-spawn-modal` — keep this event. AgentsView listens for it (Task 6) and sets `selectedId = null`.
- Check `App.tsx` for any SpawnModal references — remove if found.
- Check smoke tests (`src/renderer/src/views/__tests__/smoke.test.tsx`) — mock path may be `../../components/sessions/SpawnModal` (old path). Remove stale mocks.

- [ ] **Step 3: Remove old test files**

Delete tests that reference removed components. Update smoke tests if they import removed components.

- [ ] **Step 4: Verify typecheck + full test suite**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS with no references to removed files.

- [ ] **Step 5: Commit**

```bash
git rm src/renderer/src/components/agents/SpawnModal.tsx src/renderer/src/components/agents/ChatRenderer.tsx src/renderer/src/components/agents/ChatBubble.tsx src/renderer/src/components/agents/AgentList.tsx src/renderer/src/components/agents/AgentDetail.tsx src/renderer/src/components/agents/HealthBar.tsx src/renderer/src/assets/agents.css
git add -u  # stage updated test/import files
git commit -m "chore(agents): remove old components — SpawnModal, ChatRenderer, ChatBubble, AgentList, AgentDetail, HealthBar"
```

---

## Execution Summary

| Task | What                                                                 | New Files | Modified   |
| ---- | -------------------------------------------------------------------- | --------- | ---------- |
| 1    | CSS + sidebar (SessionList, QueueList, AgentCard)                    | 3         | 1          |
| 2    | NewSessionForm (inline spawn)                                        | 1         | 0          |
| 3    | ChatTab + AgentText + UserMessage + ToolBlock                        | 4         | 0          |
| 4    | ToolsTab (inspector)                                                 | 1         | 0          |
| 5    | FilesTab (files touched)                                             | 1         | 0          |
| 6    | SessionHeader + AgentsView rewrite + SteerInput/ThinkingBlock polish | 1         | 4          |
| 7    | Remove old components + cleanup                                      | 0         | -7 deleted |

**Total tasks:** 7
**New files:** 11
**Modified files:** 5
**Deleted files:** 7
**New dependencies:** None
