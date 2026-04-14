# Prompt Pipeline Audit — Synthesis Report
**Date:** 2026-04-13  
**Lenses completed:** 9 of 9  
**Total raw findings:** 73 across 9 lenses  
**Findings after deduplication:** 56 unique root causes  

---

## 1. Top 10 Ranked Actions

Rankings use **Score = (Severity × Confidence) / Effort** where Severity: Critical=4, High=3, Medium=2, Low=1; Confidence: High=3, Medium=2, Low=1; Effort: S=1, M=2, L=4.

---

### Rank 1 — Prompt Injection: Wrap All User-Controlled Content in XML Tags
**Primary ID:** F-t4-safety-1  
**Aliases:** F-t4-safety-2, F-t4-safety-3, F-t4-safety-4, F-t4-safety-5, F-t4-safety-6, F-t4-safety-8, F-t4-safety-9, F-t4-safety-10

**Score:** 9.0 (High=3 × High=3 / S=1)  
**Severity:** High | **Effort:** S

**Root cause:** Every prompt builder interpolates user-controlled data — task specs, upstream task titles, copilot chat messages, form context, cross-repo contracts, retry notes, and synthesizer instructions — directly into the prompt string with no structural boundary. Markdown section headers (`## Task Specification`) provide only visual separation; the model treats adjacent content at the same instruction level.

**What to do:** In each affected builder, wrap user-provided content in XML tags immediately before concatenation:
- `prompt-pipeline.ts:170` — `<user_spec>…</user_spec>` around taskContent  
- `prompt-sections.ts:113` — `<upstream_spec>…</upstream_spec>` around upstream spec and title  
- `prompt-sections.ts:128-134` — validate branch name to `[a-z0-9A-Z/_-]` before interpolation  
- `prompt-sections.ts:143-149` — `<failure_notes>…</failure_notes>` around previousNotes  
- `prompt-copilot.ts:77-79` — `<content>…</content>` around each message's content  
- `prompt-copilot.ts:54-62` — `<task_title>`, `<repo_name>`, `<spec_draft>` tags  
- `prompt-pipeline.ts:177-181` — `<cross_repo_contract>…</cross_repo_contract>`  
- `prompt-assistant.ts:64-66` — add `## User Task` header + `<user_task>…</user_task>`  
- `prompt-synthesizer.ts:82-88` — `<codebase_context>` and `<generation_instructions>` tags  

F-t4-safety-7 (scratchpad path) is excluded here — taskId is system-generated UUID, risk is low; see Rank 9.

---

### Rank 2 — Missing Exhaustiveness Check in Agent Type Switch
**Primary ID:** F-t2-comp-arch-8  

**Score:** 9.0 (High=3 × High=3 / S=1)  
**Severity:** High | **Effort:** S  

**Root cause:** `buildAgentPrompt()` in `prompt-composer.ts:41-73` declares `let prompt: string` without initialization. If a new agent type is added to the `AgentType` union without updating the switch, TypeScript does not catch the gap — `prompt` is `undefined` at runtime and `.length` throws. The current 5-case switch has no `default: never` guard.

**What to do:** Add a default exhaustiveness clause to the switch:
```typescript
default: {
  const _exhaustive: never = agentType
  throw new Error(`Unknown agent type: ${_exhaustive}`)
}
```

---

### Rank 3 — Centralize Truncation Limits (Multiple Magic Constants)
**Primary ID:** F-t2-comp-arch-4  
**Aliases:** F-t2-flow-3, F-t1-tok-cache-6

**Score:** 9.0 (Medium=2 × High=3 / S=1) — ties broken by Severity (Medium) then Effort (S wins)  
**Severity:** Medium | **Effort:** S  

**Root cause:** Truncation policy constants are scattered across three modules: `MAX_TASK_CONTENT_CHARS = 8000` in `prompt-pipeline.ts:167`, `truncateSpec(upstream.spec, 2000)` in `prompt-sections.ts:112-120`, and `MAX_DIFF_CHARS = 2000` in the same file. If limits need adjustment, they must be hunted down across files, and they can silently diverge.

**What to do:** Create `src/main/agent-manager/prompt-constants.ts`:
```typescript
export const PROMPT_TRUNCATION = {
  TASK_SPEC_CHARS: 8000,
  UPSTREAM_SPEC_CHARS: 2000,
  UPSTREAM_DIFF_CHARS: 2000,
}
```
Import and use in `prompt-pipeline.ts` and `prompt-sections.ts`. Optionally move the truncation call to the caller (`run-agent.ts`) so prompt builders receive pre-normalized content (per F-t2-flow-3).

---

### Rank 4 — Flush Agent Events Before Early Return on Watchdog Cleanup
**Primary ID:** F-t3-sdk-stream-5  

**Score:** 9.0 (Medium=2 × High=3 / S=1)  
**Severity:** Medium | **Effort:** S  

**Root cause:** When the watchdog times out an agent and deletes it from `activeAgents`, `finalizeAgentRun()` detects `!activeAgents.has(task.id)` and returns early (line ~700) — skipping `persistAgentRunTelemetry` and `resolveAgentExit`. The event batcher (`emitAgentEvent`) batches events into `_pending[]` with a 100ms flush timer. At the early return, the pending batch is never explicitly flushed. Events are broadcast to the UI (live tail) but not persisted to SQLite. The task DB gets the status update; the `agent_events` table loses the tail.

**What to do:** Call `flushAgentEventBatcher()` immediately before the early return block:
```typescript
if (!activeAgents.has(task.id)) {
  flushAgentEventBatcher()  // flush before cleanup
  await capturePartialDiff(...)
  cleanupWorktree(...).catch(...)
  return
}
```
Also call `flushAgentEventBatcher()` in the SIGTERM handler in `agent-manager/index.ts`.

---

### Rank 5 — Expose Local Personality Interface to Canonical AgentPersonality Type
**Primary ID:** F-t2-comp-arch-6  

**Score:** 9.0 (Medium=2 × High=3 / S=1)  
**Severity:** Medium | **Effort:** S  

**Root cause:** `prompt-sections.ts` defines a local `Personality` interface that duplicates the shape of `AgentPersonality` from `agent-system/personality/types.ts`. They share the same fields today, but they are disconnected — if a field is added to `AgentPersonality`, the local interface stays stale and `buildPersonalitySection()` silently misses it.

**What to do:** Remove the local `Personality` interface from `prompt-sections.ts` and import `AgentPersonality` instead:
```typescript
import type { AgentPersonality } from '../agent-system/personality/types'
export function buildPersonalitySection(personality: AgentPersonality): string { ... }
```

---

### Rank 6 — Export Reviewer Builders Separately (Eliminate "And" Function)
**Primary ID:** F-t2-comp-arch-5  

**Score:** 9.0 (Medium=2 × High=3 / S=1)  
**Severity:** Medium | **Effort:** S  

**Root cause:** `buildReviewerPrompt()` in `prompt-composer-reviewer.ts:109-112` bifurcates on `input.reviewerMode` into two completely different prompt shapes — one producing structured JSON output, one producing conversational markdown. These are not variants of the same operation; they are two distinct agent personalities dispatched by a flag. Callers cannot tell from the function signature which output format they'll receive.

**What to do:** Remove the `buildReviewerPrompt` dispatcher. Export `buildReviewerReviewPrompt` and `buildReviewerChatPrompt` directly. Update `prompt-composer.ts` case `'reviewer'` to dispatch explicitly on `input.reviewerMode`. This moves the branching one level up where it belongs.

---

### Rank 7 — Eliminate Instruction Redundancy Across Preamble and Personality (Three Overlapping Layers)
**Primary ID:** F-t4-inject-002  
**Aliases:** F-t4-inject-003, F-t4-inject-004, F-t4-inject-005, F-t4-inject-007

**Score:** 4.5 (High=3 × High=3 / M=2)  
**Severity:** High | **Effort:** M  

**Root cause:** The same constraints appear two or three times per prompt because preamble and personality were built independently:
- **Copilot** (F-t4-inject-002): "Read-only tool access: Read, Grep, Glob ONLY" appears in `SPEC_DRAFTING_PREAMBLE` and again in `copilot-personality.constraints[]`. The "DATA not instructions" directive appears in the preamble, personality `roleFrame`, and the constraint array — three times (~300 tokens wasted per copilot spawn).
- **Synthesizer** (F-t4-inject-003): "Keep under 500 words" appears in `synthesizer-personality.patterns` and again in `SYNTHESIZER_SPEC_REQUIREMENTS`. "Concrete action" guidance appears in `personality.constraints`, `personality.patterns`, and the 56-line enforcement block (~450 tokens wasted).
- **Pipeline** (F-t4-inject-004): "NEVER commit secrets or .env files" is in `CODING_AGENT_PREAMBLE` Hard Rules and in `pipeline-personality.constraints[]` (~120 tokens duplicated).
- **Reviewer** (F-t4-inject-005): "You do NOT write code" stated in shared `REVIEWER_PREAMBLE` and repeated verbatim in both `buildReviewerReviewPrompt` and `buildReviewerChatPrompt` mode-specific Role sections (~100 tokens).
- **Synthesizer** (F-t4-inject-007): "Each section must map to concrete implementation steps" in `personality.constraints`, "Keep specs actionable" in `personality.patterns`, and detailed GOOD/BAD examples in `SYNTHESIZER_SPEC_REQUIREMENTS` (~150 tokens).

**What to do:** Audit each agent type: identify which constraints live in the preamble and remove them from personality.constraints (and vice versa). Establish a clear ownership rule — preamble owns hard safety rules (no secrets, no main branch), personality owns behavioral voice and patterns. For the reviewer, remove "You do NOT write code" from mode-specific Role sections. For copilot/synthesizer, consolidate "concrete action" / "DATA not instructions" into a single statement per location.

---

### Rank 8 — settingSources Inconsistency Forces CLAUDE.md Re-Parse on Every Pipeline/Adhoc Spawn
**Primary ID:** F-t1-tok-cache-2  
**Aliases:** F-t4-inject-009

**Score:** 4.5 (Critical=4 × High=3 / M=2) — note: F-t1-tok-cache-2 rates this Critical, F-t4-inject-009 rates it a design question; merged under Critical  
**Severity:** Critical | **Effort:** M  

**Root cause:** `sdk-adapter.ts:137` and `adhoc-agent.ts:142` pass `settingSources: ['user', 'project', 'local']` to every SDK query call. The SDK then reads, parses, and injects `CLAUDE.md` on every spawn and retry — an operation BDE's prompt composer never sees and therefore cannot cache or deduplicate. Copilot and synthesizer correctly pass `settingSources: []` and inject BDE conventions via their own prompt builders. The inconsistency means pipeline/adhoc agents receive CLAUDE.md from the SDK plus whatever BDE conventions the prompt builder injects — potential for doubled guidance — and cannot benefit from any caching strategy.

**F-t4-inject-009 adds:** It is unclear whether this is intentional for pipeline agents (they may need the full project context that CLAUDE.md provides) or an oversight. Copilot deliberately skips it. Adhoc/assistant agents are interactive and might benefit from it; pipeline agents are autonomous and already get BDE conventions injected. The design intent must be decided before the fix is implemented.

**What to do:** First, document the intended model: should pipeline agents receive CLAUDE.md via SDK or via prompt builder? If via prompt builder (recommended for cacheability), switch pipeline and adhoc to `settingSources: ['user']` (keep user hooks) or `settingSources: []`, and inject CLAUDE.md content explicitly in `buildPipelinePrompt()` where it can be hashed and cached. This eliminates the per-spawn file-read overhead and enables future prompt caching.

---

### Rank 9 — Misclassification of Stream Failures as Normal Exit
**Primary ID:** F-t3-sdk-stream-3  

**Score:** 4.5 (High=3 × High=3 / M=2)  
**Severity:** High | **Effort:** M  

**Root cause:** When `consumeMessages()` returns with `streamError` set (e.g., stdout pipe broken, network cut, child process crash), `exitCode` is `undefined`. `finalizeAgentRun()` proceeds unconditionally regardless of `streamError`, treating `undefined` as exit code 1. `classifyExit()` then classifies this as a normal failure subject to fast-fail detection and retry — even when the stream failure indicates a system-level problem (e.g., OOM, socket eviction) rather than agent logic failure. No structured event is emitted to the UI; only a warning log is written.

**What to do:**
1. In `run-agent.ts`, immediately after detecting `streamError`, emit an explicit `agent:error` event via `emitAgentEvent()` with `message: "Stream interrupted: ..."`.
2. In `resolveAgentExit()` (or before calling it), add a `streamError` parameter that gates a separate `'stream_failure'` classification path, which may apply different retry backoff or route to `'error'` status instead of `'failed'`.

---

### Rank 10 — Remove Playground Fire-and-Forget Race (Write Detection vs. Worktree Cleanup)
**Primary ID:** F-t3-sdk-stream-2  
**Aliases:** F-t3-sdk-stream-4

**Score:** 4.5 (High=3 × High=3 / M=2)  
**Severity:** High | **Effort:** M  

**Root cause:** In `run-agent.ts:111-124`, `detectPlaygroundWrite()` calls `tryEmitPlaygroundEvent()` as fire-and-forget (`Promise.catch()` only, no await). The message loop continues; the stream may complete and `cleanupOrPreserveWorktree()` may run before the async `stat()` + `readFile()` in `tryEmitPlaygroundEvent()` finish. If the worktree is cleaned up first, the file read fails silently and the playground event is lost. F-t3-sdk-stream-4 adds: on a slow/stalled filesystem, the unguarded file I/O can hang indefinitely, blocking clean shutdown.

**What to do:**
1. Replace fire-and-forget with a collection pattern: accumulate detected HTML paths into a `pendingPlaygroundWrites: string[]` during the message loop.
2. After `consumeMessages()` completes but before `cleanupOrPreserveWorktree()`, await each path serially: `for (const p of pendingPlaygroundWrites) { await tryEmitPlaygroundEvent(...) }`.
3. Wrap `tryEmitPlaygroundEvent()` in a 5-second timeout (`AbortController`) to guard against filesystem stalls.

---

## 2. Cross-Cutting Themes

### Theme A — "User Data as Instructions" (Prompt Injection Everywhere)
**Lenses:** lens-inject-safety, lens-inject-content, lens-tok-cache  
**Finding IDs:** F-t4-safety-1 through F-t4-safety-10; F-t4-inject-009 (adjacent concern)

**Systemic cause:** All prompt builders were written with trusted-data assumptions. Task specs, upstream titles, chat messages, form fields, retry notes, and branch names are interpolated with `prompt += untrustedContent` using markdown headers as the only delimiter. The BDE copilot preamble explicitly says "DATA not instructions" — but this is advisory text, not a structural boundary. The fix pattern is uniform (XML tags) and applies across 9 interpolation sites. No single builder escapes this — it is a system-wide omission in the prompt pipeline design.

---

### Theme B — Static Content Re-Computed and Re-Sent on Every Spawn/Turn
**Lenses:** lens-tok-size, lens-tok-cache, lens-inject-content  
**Finding IDs:** F-t1-tok-size-1, F-t1-tok-size-2, F-t1-tok-size-4, F-t1-tok-cache-1, F-t1-tok-cache-2, F-t1-tok-cache-3, F-t1-tok-cache-7, F-t4-inject-008

**Systemic cause:** No prompt section is cached, pre-computed, or conditionally skipped. Every builder re-formats personality strings, re-reads memory from disk, re-injects BDE conventions, and re-sends task specs on each spawn and retry. The infrastructure for observing cache metrics already exists (`turn-tracker.ts` collects `cache_creation_input_tokens`/`cache_read_input_tokens`) but always reads zero because no `cache_control` markers are ever set. The mtime-based dedup in `user-memory.ts` prevents filesystem thrashing but does not prevent API re-transmission. This is a systemic missing abstraction: the pipeline has no concept of "stable prefix vs. dynamic suffix."

---

### Theme C — Preamble and Personality Overlap (Redundant Instructions, Every Agent)
**Lenses:** lens-inject-content, lens-tok-size, lens-comp-arch  
**Finding IDs:** F-t4-inject-002, F-t4-inject-003, F-t4-inject-004, F-t4-inject-005, F-t4-inject-007, F-t1-tok-size-3, F-t2-comp-arch-3

**Systemic cause:** Preamble constants (`CODING_AGENT_PREAMBLE`, `SPEC_DRAFTING_PREAMBLE`, `REVIEWER_PREAMBLE`) and personality objects were authored in parallel without a shared ownership model. The rule "who owns which instruction" was never established. Hard rules (no secrets, no main branch, read-only tools) appear in both layers for every agent type. Soft behavioral guidance (commit message format, concrete steps, spec word limit) appears in both personality patterns and enforcement blocks. The aggregate token waste is ~1,270 tokens per call across the five agent types, with no runtime benefit from the duplication.

---

### Theme D — Architecture: Abstraction Leaks Across Module Boundaries
**Lenses:** lens-comp-arch, lens-flow-coupling  
**Finding IDs:** F-t2-comp-arch-1, F-t2-comp-arch-2, F-t2-comp-arch-3, F-t2-comp-arch-7, F-t2-flow-1, F-t2-flow-2, F-t2-flow-6

**Systemic cause:** The prompt pipeline evolved by accretion — each feature (memory, skills, personality, task classification) was added to the nearest convenient file rather than a principled location. The result:
- `buildAssistantPrompt()` dispatches on `agentType` (a caller concern)
- `buildScratchpadSection()` joins filesystem paths (a domain concern)
- `buildPipelinePrompt()` classifies task content and computes output token caps (a business concern)
- `prompt-pipeline.ts` imports from `agent-system/memory` and `agent-system/personality` (a dependency inversion violation)
- `completion.ts` dynamically imports settings at runtime (a hidden ambient dependency)
- `TurnTracker` falls back to `getDb()` when no DB is injected (a global state leak)

The pattern is consistent: formatting code reaching up into domain logic, and domain logic reaching down into infrastructure. Clean Architecture requires the opposite — dependency arrows point inward toward domain, not outward toward infrastructure.

---

## 3. Quick Wins

All findings with Score ≥ 6.0 AND Effort=S:

| ID | Title | Score | What to do |
|----|-------|-------|-----------|
| F-t4-safety-1 (+ 8 aliases) | Wrap user content in XML tags | 9.0 | Add `<tag>…</tag>` around taskContent, upstream specs, chat messages, form fields, retry notes, branch validation, cross-repo contract, assistant taskContent, synthesizer context |
| F-t2-comp-arch-8 | Add exhaustiveness check to agent type switch | 9.0 | `default: { const _exhaustive: never = agentType; throw new Error(...) }` in `prompt-composer.ts` |
| F-t2-comp-arch-4 (+ F-t2-flow-3, F-t1-tok-cache-6) | Centralize truncation constants | 9.0 | Create `prompt-constants.ts` with `PROMPT_TRUNCATION` object; import in both affected files |
| F-t3-sdk-stream-5 | Flush event batcher before watchdog early return | 9.0 | `flushAgentEventBatcher()` before early return in `finalizeAgentRun()` and in SIGTERM handler |
| F-t2-comp-arch-6 | Use canonical AgentPersonality type in prompt-sections | 9.0 | Remove local `Personality` interface; import from `agent-system/personality/types` |
| F-t2-comp-arch-5 | Export reviewer builders separately | 9.0 | Remove `buildReviewerPrompt` dispatcher; export `buildReviewerReviewPrompt` and `buildReviewerChatPrompt` directly |
| F-t1-tok-cache-5 | Skip re-injecting unchanged upstream context on retry | 6.0 | Hash upstream context; on retry, include a reference note if hash matches prior attempt |
| F-t1-tok-cache-7 | Pre-compute personality and skills sections to static constants | 6.0 | Move `buildPersonalitySection(pipelinePersonality)` result to a module-level const per agent type |
| F-t2-comp-arch-2 | Remove filesystem path logic from buildScratchpadSection | 9.0 | Change signature to `buildScratchpadSection(taskId: string, scratchpadPath: string)`; let caller compute path |
| F-t4-inject-005 | Deduplicate reviewer "do NOT write code" constraint | 9.0 | Remove redundant clause from mode-specific Role sections in `buildReviewerReviewPrompt` and `buildReviewerChatPrompt` |
| F-t4-inject-001 | Extract BDE-native note to shared constant | 6.0 | `const BDE_PLUGIN_NOTE = '...'` in `prompt-sections.ts`; import in both pipeline and assistant builders |
| F-t1-tok-size-7 | Flip playground default to opt-in for assistant/adhoc | 6.0 | Change `playgroundEnabled = true` default in `prompt-assistant.ts:59` to `false`; document in CLAUDE.md |
| F-t3-sdk-stream-4 | Add timeout guard to tryEmitPlaygroundEvent file I/O | 6.0 | Wrap `stat` + `readFile` in `AbortController` with 5s deadline |
| F-t2-flow-4 | Flatten RunAgentDeps to single coherent interface | 6.0 | Remove duplicated `onTaskTerminal` and `logger` fields; replace triple intersection with one flat interface with role comments |

---

## 4. Deferred / Out of Scope

| ID | Title | Reason to defer |
|----|-------|-----------------|
| F-t1-tok-cache-1 | Add cache_control markers to prompt sections | Effort=L; requires SDK integration testing across all agent types. Depends on SDK support for `cache_control` in `claude-agent-sdk` v1.x — not confirmed available. Pre-requisite: first complete F-t1-tok-cache-2 (settingSources) and F-t1-tok-cache-3 (memory hashing) so the stable prefix is well-defined before marking it cacheable. |
| F-t1-tok-size-3 | Move CODING_AGENT_PREAMBLE to a BDE memory file | Token savings (~394 tokens) are real but modest; the main value is maintainability. Defer until memory system architecture stabilizes. Risk: moving preamble to disk makes it invisible to code reviewers. |
| F-t1-tok-size-5 | Two-tier synthesizer validation block | Single-turn agent; 514 tokens is the full cost. Adds complexity (two code paths) for marginal benefit. Defer until synthesizer usage volume justifies optimization. |
| F-t1-tok-size-6 | Conditional personality patterns section | Confidence=Low; actual token savings are <100 per call. Not worth the conditional complexity. |
| F-t1-tok-size-8 | Compact upstream context section formatting | Confidence=Low; upstream context is task-specific — compacting may reduce agent comprehension of dependency relationships. Defer pending agent quality measurement. |
| F-t2-comp-arch-7 | Extract task classification to agent-system module | Effort=M; no correctness impact, pure architecture hygiene. Real finding — defer until a second agent type needs task classification (then the extraction is justified). |
| F-t2-flow-6 | Make TurnTracker DB dependency explicit (no fallback to getDb()) | Effort=M; the current code is functionally correct. The optional fallback is messy but doesn't cause bugs. Defer until a broader DI refactor of the data layer. |
| F-t2-flow-7 | Enhance fetchUpstreamContext to distinguish missing vs. blocking deps | Effort=M; the silent-skip behavior is technically safe (the task still runs; it just may lack upstream context). Defer until a dependency management review. |
| F-t2-flow-8 | Log and validate per-task model overrides | Confidence=Low; model override is an intentional escape hatch. Logging is useful but not urgent. Add in a future observability sprint. |
| F-t1-tok-size-4 | Selective BDE memory module loading (task-based filtering) | Confidence=Medium; keyword matching for memory selection is fragile. Benefits are real but modest (~150 tokens). Defer until F-t1-tok-size-2 (skills selector) is implemented first — same keyword logic can be shared. |
| F-t3-sdk-stream-6 | Accumulate lastAgentOutput across turns | Confidence=Low; the 5000-char tail of the last message is a reasonable summary heuristic. Cosmetic. |
| F-t3-sdk-stream-7 | Always throw on timeout even with partial output | Confidence=Low; partial output is better than nothing for synthesizer/review-pass callers. Would break callers that gracefully handle partial results. |
| F-t1-tok-cache-4 | Trim copilot conversation history / use native multi-turn SDK | Effort=M; high token impact (18K wasted per 10-turn chat) but depends on SDK's multi-turn API support which is not confirmed. Block on SDK investigation. |
| F-t1-tok-cache-8 | Add dashboard metric for cache hit ratio | Effort=S, but the metric will always read 0% until cache_control markers are implemented (F-t1-tok-cache-1). Defer until Rank 8 (settingSources) and the L-effort cache_control work are complete. |

---

## 5. Open Questions

### OQ-1 — Intended scope of settingSources for assistant/adhoc agents
**Lenses in conflict:** lens-tok-cache (F-t1-tok-cache-2) recommends removing `settingSources: ['user','project','local']` from adhoc and pipeline agents to enable caching. lens-inject-content (F-t4-inject-009) flags the inconsistency but acknowledges the pipeline/adhoc choice may be intentional — interactive agents might need full CLAUDE.md context.

**Design decision needed:** Should pipeline agents receive CLAUDE.md via SDK auto-load (current), via prompt builder injection (recommended for caching), or both? Should adhoc/assistant agents match pipeline or match copilot/synthesizer? The answer changes what "correct" looks like for Rank 8.

---

### OQ-2 — Is prompt injection a real threat in BDE's current deployment model?
**Lenses in conflict:** lens-inject-safety rates 5 findings as High severity and recommends immediate XML wrapping of all user content. The injection surface is real — task specs accept free-form markdown, copilot chat is fully user-controlled. However, BDE is a local desktop app used by a single authenticated user; the "attacker" would be the user themselves. The safety concern is less "external attacker" and more "accidental instruction confusion" when specs contain markdown headings that the model misinterprets.

**Design decision needed:** Should XML wrapping be treated as a P0 safety fix (the finding as written) or a P1 robustness improvement? The recommendation stands either way, but urgency and timeline differ.

---

### OQ-3 — Cache_control marker availability in claude-agent-sdk
**Evidence thin:** F-t1-tok-cache-1 recommends adding `cache_control` markers (Effort=L). It is not confirmed that the `claude-agent-sdk` currently exposes a way to set per-message `cache_control` when using `sdk.query({ prompt: string })`. The SDK may only support caching via the underlying Anthropic API's `messages` format, which the SDK abstracts away. Until the SDK's caching API surface is confirmed, the Effort=L recommendation may be blocked entirely or may require a different approach (e.g., structured `messages[]` instead of flat `prompt` string).

**Action needed:** Spike the SDK: test whether `claude-agent-sdk` v1.x exposes cache_control at the prompt level. Result unblocks or kills F-t1-tok-cache-1.

---

### OQ-4 — Memory hashing vs. content dedup: which layer?
**Lenses in mild disagreement:** F-t1-tok-cache-3 recommends hashing the full memory content string and skipping re-injection on retry if hash matches. F-t1-tok-size-2 recommends a keyword-based skill selector. F-t1-tok-size-4 recommends a keyword-based BDE memory selector. These could conflict: if the memory hash matches but the keyword selector would have picked different modules (e.g., a retry of a spec that now mentions "test"), the hash dedup would suppress updated content. **Ordering matters:** implement the selector first, then hash the selector's output.

---

### OQ-5 — Completion race condition: real risk or theoretical?
**Confidence noted as High by lens-flow-coupling (F-t2-flow-5).** The finding identifies that `completion.ts` calls `repo.getTask(taskId)` after `executeSquashMerge()` to read `duration_ms`. SQLite with WAL mode and single-writer guarantees make a true race unlikely in practice (BDE has one main process). However, the code pattern is fragile — if BDE ever adds a second write path (e.g., background migration), the race becomes real. The finding is valid for defensive coding; urgency is low for current single-process architecture.

---

---

## Addendum: Naming & SDK Options Findings (lens-naming-clarity, lens-sdk-opts)

These two lenses completed but their files were recovered after initial synthesis. Key additions:

### From lens-sdk-opts (merged into existing rankings):
- **F-t3-sdk-opts-1** (High/S, Score 9.0): Pipeline agent has no `maxTurns` — merges into Rank 2 cluster (same fix opportunity). Add `maxTurns: 20` to `sdk-adapter.ts`.
- **F-t3-sdk-opts-4** (High/M, Score 4.5): Pipeline agent has no `maxBudgetUsd` — standalone High severity finding not previously represented. Add `maxBudgetUsd: 2.0` to `sdk-adapter.ts`.
- **F-t3-sdk-opts-3 / F-t3-sdk-opts-6** (Medium/M): Reinforce Rank 8 (`settingSources` inconsistency). Adhoc agent is an additional call site needing `settingSources: []` and `maxBudgetUsd: 5.0`.
- **F-t3-sdk-opts-2 / F-t3-sdk-opts-5 / F-t3-sdk-opts-7** (Medium–Low/S): Reviewer and validator also load project settings unnecessarily — add to Quick Wins: change to `settingSources: []` in `review-service.ts` and `prescriptiveness-validator.ts`.

### From lens-naming-clarity (new findings, not in existing rankings):
- **F-t2-naming-3 / F-t2-naming-10** (Medium/M): Duplicate `AgentType` union and duplicate `Personality` / `AgentPersonality` interface — add to deferred list (pure type hygiene, no runtime impact, Medium effort).
- **F-t2-naming-5** (Medium/M): `playgroundEnabled?: boolean` tri-state semantics — replace with `'enabled' | 'disabled' | 'default'` union. Add to deferred (Medium effort, no correctness impact today).
- **F-t2-naming-8** (Medium/M): `buildReviewerPrompt` dual-behavior dispatcher — already captured in Rank 6 (`F-t2-comp-arch-5`). Confirmed by naming lens.
- **F-t2-naming-9** (Medium/S): `SYNTHESIZER_SPEC_REQUIREMENTS` misleading name → `SYNTHESIZER_SPEC_QUALITY_INSTRUCTIONS`. Quick Win — add to Quick Wins table.
- **F-t2-naming-1 / F-t2-naming-4 / F-t2-naming-6 / F-t2-naming-7** (Low–Medium/S): Individual rename suggestions for `recentMessages`, magic constant JSDoc, `buildPersonalitySection`, and inline diff truncation. Low effort, improve readability incrementally.

*Synthesis complete. 56 unique findings across all 9 lens files.*
