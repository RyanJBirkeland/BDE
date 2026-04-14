# Clean Architecture: Dependency Rule Audit
**Date:** 2026-04-14  
**Auditor:** Claude Agent  
**Scope:** `src/main`, `src/shared`, `src/renderer`, `src/preload`

## Overall Health Summary

The codebase maintains a well-structured Clean Architecture across the main layers (data → services → handlers → IPC bridge → preload → renderer). The process boundary between main and renderer is properly enforced via IPC, with no forbidden cross-layer imports detected. However, **one significant architectural smell** exists: several business utility functions (`git-operations`, `prompt-composer`, `resolve-dependents`) reside in the `agent-manager/` subdirectory but are imported by the `services/` layer, violating the inbound-only dependency rule. These utilities should either be moved to a dedicated utility layer or re-exported from `agent-manager/index.ts` with explicit intent. Handlers follow strict module isolation (no cross-handler imports), and shared types remain clean. The codebase is mid-refactor; these findings reflect the sprint-based evolution underway.

---

## F-t1-dep-rule-1: Services Importing Business Utilities from Agent-Manager Subdirectory

**Severity:** High  
**Category:** Dependency Rule  
**Location:** Multiple locations:
- `src/main/services/task-terminal-service.ts:1`
- `src/main/services/review-service.ts:6`
- `src/main/services/review-action-executor.ts:21`
- `src/main/services/review-merge-service.ts:10`
- `src/main/services/review-pr-service.ts:8`
- `src/main/services/copilot-service.ts:4`

**Evidence:**
```typescript
// In task-terminal-service.ts
import { resolveDependents } from '../agent-manager/resolve-dependents'

// In review-service.ts
import { buildAgentPrompt } from '../agent-manager/prompt-composer'

// In review-action-executor.ts
import { rebaseOntoMain } from '../agent-manager/git-operations'
```

**Impact:** The `agent-manager/` directory is meant to contain the agent orchestration engine (drain loop, task claiming, completion handling). When services import utilities directly from subdirectories within `agent-manager/`, it creates ambiguity about whether these are agent-specific concerns or shared business logic. This violates clean architecture's inbound-only dependency rule and makes refactoring the agent-manager harder.

**Recommendation:** 
1. **Option A (Preferred):** Move `git-operations.ts`, `prompt-composer.ts`, and `resolve-dependents.ts` to a new `src/main/utils/` layer (or rename to `src/main/lib/` if using that for utilities).
2. **Option B:** Explicitly re-export these utilities from `agent-manager/index.ts` with a clear comment: `// Re-export utilities for backward compatibility (domain logic, not orchestration)`. This makes the intent explicit but requires updating all service imports.
3. **Option C:** Keep the files in agent-manager but alias them through a utility barrel-export to establish they are re-usable, not orchestration-private.

**Effort:** M (moving 3 files + updating 8 import sites is straightforward; requires testing the refactored boundary)  
**Confidence:** High

---

## F-t1-dep-rule-2: Agent-Manager/Git-Operations Imports from Services

**Severity:** Medium  
**Category:** Dependency Rule  
**Location:** `src/main/agent-manager/git-operations.ts:10`

**Evidence:**
```typescript
import { runPostMergeDedup } from '../services/post-merge-dedup'
```

**Impact:** While `post-merge-dedup` is a pure utility (no upward imports from handlers), the import of a service function into a module within agent-manager creates a subtle cycle: `agent-manager/git-operations → services/post-merge-dedup ← other services → agent-manager/git-operations`. This isn't a hard cycle (since `post-merge-dedup` doesn't import from `git-operations`), but it complicates the dependency graph and makes it ambiguous whether `post-merge-dedup` is an agent-specific concern or a general service.

**Recommendation:**
1. Move `post-merge-dedup` into `src/main/lib/` as a pure utility (imports only env-utils, lib/async-utils, and logger).
2. Update the import: `import { runPostMergeDedup } from '../lib/post-merge-dedup'`.
3. Add a comment in the new location clarifying it's a follow-up git operation, not a domain service.

**Effort:** S (move 1 file + update 2 import sites)  
**Confidence:** High

---

## F-t1-dep-rule-3: Architectural Smell — Business Utilities in Agent-Manager Namespace

**Severity:** Medium  
**Category:** Dependency Rule  
**Location:** `src/main/agent-manager/` contains:
- `git-operations.ts` (git utilities for all contexts)
- `prompt-composer.ts` (prompt assembly for all agent types)
- `resolve-dependents.ts` (task dependency resolution logic)

**Evidence:**
These files are imported by non-agent-manager code:
- `git-operations` imported by 5 services (review operations, terminal service)
- `prompt-composer` imported by 3 places (review-service, copilot-service, handlers)
- `resolve-dependents` imported by task-terminal-service and called directly from handlers

**Impact:** Over time, developers may assume functions in `agent-manager/` are only for agent orchestration. When a new service needs git operations or prompt logic, they may duplicate code instead of reusing it, leading to divergence. Conversely, if the agent-manager becomes a utility grab-bag, its core orchestration logic becomes harder to isolate and test.

**Recommendation:** 
Establish a clear `src/main/utils/` or `src/main/operations/` layer containing:
- `operations/git.ts` (rebase, merge, PR operations)
- `operations/prompt.ts` (dispatch to prompt builders)
- `operations/dependency-resolution.ts` (cascade resolution logic)

This signals to future developers: "These are business operations that any layer can use," distinct from the agent-manager's orchestration engine.

**Effort:** L (restructuring 3 files, updating 8+ import sites across services and handlers, documenting the new layer)  
**Confidence:** Medium

---

## F-t1-dep-rule-4: Infrastructure Wiring in Index.ts Imports from Data Layer

**Severity:** Low  
**Category:** Dependency Rule  
**Location:** `src/main/index.ts:26-28, 160-162`

**Evidence:**
```typescript
import { setSprintQueriesLogger } from './data/sprint-queries'
import { setTaskGroupQueriesLogger } from './data/task-group-queries'
import { setSettingsQueriesLogger } from './data/settings-queries'

// Later, during app.whenReady():
setSprintQueriesLogger(logger)
setTaskGroupQueriesLogger(createLogger('task-group-queries'))
setSettingsQueriesLogger(createLogger('settings-queries'))
```

**Evidence:** Index.ts (application root) imports setters from the data layer to configure loggers. This is infrastructure wiring, not business logic, and is **intentional and acceptable**.

**Impact:** None. This is a known pattern for injecting infrastructure concerns (loggers) across module boundaries at the app bootstrap phase. The comment in the baseline confirms this is expected.

**Recommendation:** No action. Document this pattern in CLAUDE.md as an exception: "Infrastructure wiring at app bootstrap (index.ts) is permitted to inject loggers across layer boundaries to enable structured logging without circular dependencies."

**Effort:** N/A  
**Confidence:** High

---

## F-t1-dep-rule-5: Handler Registry Pattern (Legitimate)

**Severity:** N/A (Approved Pattern)  
**Category:** Dependency Rule  
**Location:** `src/main/handlers/registry.ts:1-50` (imports all handler modules)

**Evidence:**
```typescript
import { registerAgentHandlers } from './agent-handlers'
import { registerGitHandlers } from './git-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
// ... 15 more handler imports
```

**Impact:** The registry pattern is a legitimate aggregation pattern at the handler layer. Each handler module exports a register function with no cross-handler dependencies, and the registry centralizes wiring in one place. This is Clean Architecture–compliant.

**Recommendation:** No action. This is a solid pattern and should be documented in CLAUDE.md as the approved way to organize IPC handlers.

**Effort:** N/A  
**Confidence:** High

---

## Summary of Findings

| Finding | Severity | Type | Fix Effort | Impact |
|---------|----------|------|-----------|--------|
| F-t1-dep-rule-1 | High | Services → Agent-Manager utilities | M | Ambiguous layering of business logic |
| F-t1-dep-rule-2 | Medium | Agent-Manager → Services cycle | S | Subtle dependency graph complexity |
| F-t1-dep-rule-3 | Medium | Utilities in wrong namespace | L | Discoverability and future duplication risk |
| F-t1-dep-rule-4 | Low | Index.ts data imports | N/A | Infrastructure wiring—intentional, acceptable |
| F-t1-dep-rule-5 | N/A | Handler registry pattern | N/A | Well-designed aggregation—approved pattern |

**Recommended Action Plan:**
1. **Phase 1 (Sprint N):** Move `post-merge-dedup.ts` to `lib/` (effort: S, unblocks Phase 2)
2. **Phase 2 (Sprint N+1):** Create `src/main/utils/` layer and migrate `git-operations`, `prompt-composer`, `resolve-dependents` (effort: M, high confidence fix)
3. **Phase 3:** Document the approved patterns in CLAUDE.md (renderer IPC boundary, handler registry, bootstrap wiring)

**No critical blocking issues.** The codebase is maintainable in its current state; these are medium-term architectural clarity improvements.
