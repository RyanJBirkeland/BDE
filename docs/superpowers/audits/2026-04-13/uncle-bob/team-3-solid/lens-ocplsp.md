# OCP + LSP Audit — BDE Clean Architecture

**Lens:** Open/Closed Principle + Liskov Substitution Principle  
**Auditor:** Clean Architecture OCP+LSP Agent  
**Date:** 2026-04-13

---

## F-t3-ocplsp-1: Agent Type Switch in prompt-composer.ts
**Severity:** High
**Category:** OCP
**Location:** `src/main/agent-manager/prompt-composer.ts:654-671`
**Evidence:** Hard-coded switch statement with 6 cases for agent types (pipeline, assistant, adhoc, copilot, synthesizer, reviewer). Every addition touches existing dispatch code.
**Impact:** Adding a new agent type requires modifying: (1) AgentType union, (2) new builder function, (3) switch case. Violates OCP — new behavior requires modifying existing code.
**Recommendation:** Implement a personality registry pattern using `Record<AgentType, BuilderFunction>` instead of switch dispatch. New agent types register themselves without touching core dispatch.
**Effort:** S
**Confidence:** High

---

## F-t3-ocplsp-2: Hardcoded Task Status Strings Across 100+ Locations
**Severity:** High
**Category:** OCP
**Location:** `src/main/agent-manager/terminal-handler.ts:10-16`, `src/main/handlers/sprint-batch-handlers.ts:88-94`, `src/main/handlers/sprint-retry-handler.ts:19-20` (and 100+ other locations)
**Evidence:** Status values hardcoded as string literals: `'done'`, `'review'`, `'failed'`, `'error'` scattered across at least 107 locations. Some code uses `TERMINAL_STATUSES.has()` correctly; other code duplicates the logic inline.
**Impact:** Adding a new terminal status requires finding and updating all occurrences. Inconsistent — some files may be forgotten when status machine changes.
**Recommendation:** Standardize on importing and using predicate sets from `src/shared/task-state-machine.ts`: `TERMINAL_STATUSES.has()`, `FAILURE_STATUSES.has()`. Export `isTerminal(status)` and `isFailure(status)` helpers and enforce their use everywhere.
**Effort:** M
**Confidence:** High

---

## F-t3-ocplsp-3: Status-Based Dispatch in Metrics (No Polymorphism)
**Severity:** Medium
**Category:** OCP
**Location:** `src/main/agent-manager/terminal-handler.ts:10-16`
**Evidence:**
```typescript
if (status === 'done' || status === 'review') { metrics.increment('agentsCompleted') }
else if (status === 'failed' || status === 'error') { metrics.increment('agentsFailed') }
```
**Impact:** Adding new status classifications requires modifying the if/else tree. Logic tightly coupled to status enumeration.
**Recommendation:** Create a status classification map: `const statusClass: Record<string, 'completed'|'failed'|'other'> = {...}` and dispatch via map lookup.
**Effort:** S
**Confidence:** Medium

---

## F-t3-ocplsp-4: IPC Handler Registration via Hardcoded Channel Names
**Severity:** Medium
**Category:** OCP
**Location:** `src/main/handlers/sprint-batch-handlers.ts:22,117`, `src/main/handlers/agent-handlers.ts:34-109` (40+ handlers)
**Evidence:** IPC channels registered as string literals: `safeHandle('sprint:batchUpdate', ...)`, `safeHandle('agent:steer', ...)` scattered across handler files.
**Impact:** Easy to mistype channel names between main and renderer. No central registry means no compile-time guarantee that a channel has a handler.
**Recommendation:** All channel names already defined in `src/shared/ipc-channels/` — enforce that handler registrations always use the imported constant, never an inline string literal.
**Effort:** M
**Confidence:** High

---

## F-t3-ocplsp-5: Personality Objects Without Compile-Time Validation
**Severity:** Medium
**Category:** LSP
**Location:** `src/main/agent-manager/prompt-composer.ts:196-216`
**Evidence:** Personality interface is defined, but actual personality objects (pipelinePersonality, assistantPersonality, etc.) are defined in separate files without `satisfies` assertion.
**Impact:** Runtime failures if a personality deviates from interface (e.g., missing `constraints` field). Violates LSP — subtypes not validated as substitutable at compile time.
**Recommendation:** Use TypeScript `satisfies` keyword on all personality object definitions:
```typescript
export const pipelinePersonality = { ... } satisfies Personality
```
**Effort:** S
**Confidence:** Medium

---

## F-t3-ocplsp-6: Inconsistent Use of Status Predicates
**Severity:** High
**Category:** OCP
**Location:** `src/main/agent-manager/resolve-dependents.ts:46,58` (correct) vs `terminal-handler.ts`, `retry-handler.ts` (incorrect)
**Evidence:** Some code uses `TERMINAL_STATUSES.has()` correctly; other code hardcodes status strings directly.
**Impact:** When adding a new failure status, only some files will be updated — others silently break. This is the "shotgun surgery" smell at the architecture level.
**Recommendation:** Export predicate helper functions from `task-state-machine.ts` and enforce via lint rule or search-and-destroy pass.
**Effort:** M
**Confidence:** High

---

## F-t3-ocplsp-7: getDotColor Status Switch (Hardcoded Rendering Logic)
**Severity:** Medium
**Category:** OCP
**Location:** `src/renderer/src/lib/task-format.ts:13-33`
**Evidence:** Switch statement maps status strings to CSS color tokens across 20 cases.
**Impact:** Adding new status requires adding switch case. Color scheme is hardcoded; any design system change requires code modification.
**Recommendation:** Move mapping to data structure:
```typescript
const STATUS_COLORS: Record<TaskStatus, string> = { done: 'var(--color-done)', ... }
```
**Effort:** S
**Confidence:** High

---

## F-t3-ocplsp-8: buildAssistantPrompt Dual-Personality Selector
**Severity:** Medium
**Category:** LSP
**Location:** `src/main/agent-manager/prompt-composer.ts:432`
**Evidence:** `buildAssistantPrompt()` handles two distinct agent types (assistant, adhoc) by selecting personality at runtime, making the two types non-substitutable.
**Impact:** The function's behavior differs based on type — callers can't reason about what they'll get. Weak LSP violation since both use the same base interface.
**Recommendation:** Separate into two builders: `buildAssistantPrompt()` and `buildAdhocPrompt()`, each with its own personality. Reduces hidden branching.
**Effort:** S
**Confidence:** Medium

---

## F-t3-ocplsp-9: ISprintTaskRepository — Exemplary LSP Pattern (Positive Finding)
**Severity:** Low (No violation — positive example)
**Category:** LSP
**Location:** `src/main/data/sprint-task-repository.ts:39-95`
**Evidence:** Interface hierarchy demonstrates correct LSP design through role-based interface segregation: `IAgentTaskRepository`, `ISprintPollerRepository`, `IDashboardRepository`. Consumers only depend on the subset they need.
**Impact:** N/A — this is the pattern to replicate elsewhere.
**Recommendation:** Maintain and extend this pattern. Use it as the template when adding new repository roles.
**Effort:** S
**Confidence:** High

---

## Summary

| Finding | Severity | Effort | Category |
|---------|----------|--------|----------|
| F-t3-ocplsp-1 | High | S | OCP — agent type switch |
| F-t3-ocplsp-2 | High | M | OCP — 107+ hardcoded status strings |
| F-t3-ocplsp-6 | High | M | OCP — inconsistent predicate use |
| F-t3-ocplsp-4 | Medium | M | OCP — hardcoded channel names |
| F-t3-ocplsp-3 | Medium | S | OCP — metrics status dispatch |
| F-t3-ocplsp-5 | Medium | S | LSP — no compile-time personality validation |
| F-t3-ocplsp-7 | Medium | S | OCP — status color switch |
| F-t3-ocplsp-8 | Medium | S | LSP — dual-personality function |

**Quick wins (S effort):** F-t3-ocplsp-1, F-t3-ocplsp-3, F-t3-ocplsp-5, F-t3-ocplsp-7, F-t3-ocplsp-8
