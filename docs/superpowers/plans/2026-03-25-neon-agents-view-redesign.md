# Neon Agents View Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Agents view into a neon cyberpunk command center with three stacked zones: live activity strip, fleet list + terminal console, and timeline waterfall.

**Architecture:** Stacked zones layout. New agent-specific CSS file. Console replaces detail pane with terminal-aesthetic event rendering. Command bar with slash-command autocomplete replaces steer input. `pairEvents()` extracted to shared util for reuse. All existing stores preserved — UI-only redesign.

**Tech Stack:** React, TypeScript, @tanstack/react-virtual, Framer Motion, lucide-react, CSS custom properties, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-25-neon-agents-view-redesign-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/renderer/src/assets/agents-neon.css` | Agent-specific neon CSS — console lines, command bar, timeline, live strip |
| `src/renderer/src/lib/pair-events.ts` | Extracted `pairEvents()` + `ChatBlock` type from ChatRenderer |
| `src/renderer/src/components/agents/ConsoleLine.tsx` | Single terminal line — colored prefix, collapsible, timestamp |
| `src/renderer/src/components/agents/AgentConsole.tsx` | Terminal-style console replacing AgentDetail |
| `src/renderer/src/components/agents/ConsoleHeader.tsx` | Console header — status, actions, metadata |
| `src/renderer/src/components/agents/CommandBar.tsx` | Command input with `>` prompt and slash commands |
| `src/renderer/src/components/agents/CommandAutocomplete.tsx` | Autocomplete popup for slash commands |
| `src/renderer/src/components/agents/AgentPill.tsx` | Running agent pill for live strip |
| `src/renderer/src/components/agents/LiveActivityStrip.tsx` | Top zone — running agent pills |
| `src/renderer/src/components/agents/TimelineBar.tsx` | Single Gantt bar |
| `src/renderer/src/components/agents/AgentTimeline.tsx` | Bottom zone — Gantt timeline |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/views/AgentsView.tsx` | Rewrite — three stacked zones |
| `src/renderer/src/components/agents/AgentCard.tsx` | Neon restyling |
| `src/renderer/src/components/agents/AgentList.tsx` | Neon restyling |
| `src/renderer/src/components/agents/SpawnModal.tsx` | Neon restyling |
| `src/renderer/src/components/agents/ChatRenderer.tsx` | Import pairEvents from shared util |
| `src/renderer/src/App.tsx` | Import agents-neon.css |

---

## Task 1: Agents Neon CSS

Create the CSS foundation for all agent components.

**Files:** Create `src/renderer/src/assets/agents-neon.css`, modify `src/renderer/src/App.tsx`

**Full spec for agent task:** See below — this creates the CSS file with all classes needed by subsequent tasks.

---

## Task 2: Extract pairEvents to Shared Util

Extract `pairEvents()` and `ChatBlock` type from `ChatRenderer.tsx` into a shared utility so both the existing ChatRenderer and the new AgentConsole can use it.

**Files:** Create `src/renderer/src/lib/pair-events.ts`, modify `src/renderer/src/components/agents/ChatRenderer.tsx`

---

## Task 3: ConsoleLine Component

Terminal-style line renderer with colored prefixes and collapsible content.

**Files:** Create `src/renderer/src/components/agents/ConsoleLine.tsx` + test

---

## Task 4: ConsoleHeader + AgentConsole

The terminal-style console that replaces AgentDetail.

**Files:** Create `ConsoleHeader.tsx`, `AgentConsole.tsx` + tests

---

## Task 5: CommandBar + CommandAutocomplete

Command input with slash-command autocomplete replacing SteerInput.

**Files:** Create `CommandBar.tsx`, `CommandAutocomplete.tsx` + tests

---

## Task 6: AgentPill + LiveActivityStrip

Top zone showing running agents as glowing pills.

**Files:** Create `AgentPill.tsx`, `LiveActivityStrip.tsx` + test

---

## Task 7: TimelineBar + AgentTimeline

Bottom zone with Gantt-style timeline waterfall.

**Files:** Create `TimelineBar.tsx`, `AgentTimeline.tsx` + test

---

## Task 8: AgentCard + AgentList Neon Restyling

Upgrade the fleet list with neon treatment.

**Files:** Modify `AgentCard.tsx`, `AgentList.tsx`

---

## Task 9: SpawnModal Neon Restyling

Upgrade the spawn modal with neon treatment.

**Files:** Modify `SpawnModal.tsx`

---

## Task 10: AgentsView Rewrite

Compose all zones into the final three-zone layout.

**Files:** Rewrite `AgentsView.tsx`

---

## Task 11: Final Integration + Cleanup

Run all tests, typecheck, lint, remove dead code, create PR.

**Files:** All modified files, delete unused components
