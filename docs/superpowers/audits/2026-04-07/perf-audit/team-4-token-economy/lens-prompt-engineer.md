# Prompt Engineer

**Lens scope:** Per-agent-type prompt composition; what every agent is "born" with.

**Summary:** BDE injects identical context (CLAUDE.md + BDE_FEATURES.md + user memory) into all five agent types via SDK `settingSources`, then adds type-specific preambles, personalities, and optional sections in `buildAgentPrompt()`. Memory modules (IPC, testing, architecture) are injected for coding agents only when targeting the BDE repo. Skills are injected only for assistant/adhoc agents. Significant redundancy exists across agent types due to personality overlap, and the SPEC_DRAFTING_PREAMBLE is substantially longer than necessary for the copilot's lightweight scope.

## Per-agent-type breakdown tables

### Pipeline Agent (Autonomous task execution)

| Component                                 | Source                                                                                          | Size              | Approx Tokens      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| SDK auto-loaded: Project CLAUDE.md        | `/Users/ryan/projects/BDE/CLAUDE.md` (via `settingSources: ['user','project','local']`)         | 18,662 chars      | ~4,666             |
| SDK auto-loaded: User CLAUDE.md           | `/Users/ryan/CLAUDE.md` (via `settingSources: ['user','project','local']`)                      | 4,463 chars       | ~1,116             |
| SDK auto-loaded: BDE_FEATURES.md          | `/Users/ryan/projects/BDE/docs/BDE_FEATURES.md` (via @ directive in project CLAUDE.md)          | 16,075 chars      | ~4,019             |
| Composed system prompt (preamble)         | `CODING_AGENT_PREAMBLE` in prompt-composer.ts                                                   | 327 chars         | ~81                |
| Personality: voice                        | `pipelinePersonality.voice`                                                                     | ~200 chars        | ~50                |
| Personality: roleFrame                    | `pipelinePersonality.roleFrame`                                                                 | ~120 chars        | ~30                |
| Personality: constraints (4 items)        | `pipelinePersonality.constraints`                                                               | ~400 chars        | ~100               |
| Personality: patterns (4 items)           | `pipelinePersonality.patterns`                                                                  | ~700 chars        | ~175               |
| BDE conventions (memory)                  | `getAllMemory()` injected for BDE repo: ipc-conventions + testing-patterns + architecture-rules | 3,912 chars       | ~978               |
| User memory (toggleable)                  | `getUserMemory()` when user enables files in Settings > Memory                                  | variable          | variable           |
| Branch appendix                           | `buildBranchAppendix(branch)` if branch provided                                                | ~150 chars        | ~37                |
| Pipeline setup rule                       | `PIPELINE_SETUP_RULE` (npm install warning)                                                     | 54 chars          | ~13                |
| Pipeline judgment rules                   | `PIPELINE_JUDGMENT_RULES` (test flake handling + push completion verification)                  | 140 chars         | ~35                |
| Time limit section                        | `buildTimeLimitSection(maxRuntimeMs)` if maxRuntimeMs > 0                                       | ~150 chars        | ~37                |
| Idle timeout warning                      | `IDLE_TIMEOUT_WARNING` (15-minute inactivity threshold)                                         | 187 chars         | ~46                |
| Self-review checklist                     | Hardcoded in buildAgentPrompt (5 items)                                                         | ~300 chars        | ~75                |
| Definition of Done                        | `DEFINITION_OF_DONE` (5 required conditions)                                                    | 127 chars         | ~31                |
| Task specification                        | `taskContent` parameter (spec or prompt)                                                        | variable          | variable           |
| Retry context                             | `buildRetryContext()` if retryCount > 0                                                         | variable          | variable           |
| Upstream context                          | `upstreamContext` array (completed task specs + diffs, capped)                                  | variable          | variable           |
| Cross-repo contract                       | `crossRepoContract` documentation if provided                                                   | variable          | variable           |
| Plugin disable note                       | Boilerplate footer                                                                              | ~150 chars        | ~37                |
| **TOTAL (excluding variable components)** |                                                                                                 | **~50,500 chars** | **~12,630 tokens** |

### Adhoc Agent (User-spawned task executor)

| Component                                 | Source                                                                                                     | Size              | Approx Tokens      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| SDK auto-loaded: Project CLAUDE.md        | `settingSources: ['user','project','local']` in adhoc-agent.ts                                             | 18,662 chars      | ~4,666             |
| SDK auto-loaded: User CLAUDE.md           | `settingSources: ['user','project','local']` in adhoc-agent.ts                                             | 4,463 chars       | ~1,116             |
| SDK auto-loaded: BDE_FEATURES.md          | Via @ directive in project CLAUDE.md                                                                       | 16,075 chars      | ~4,019             |
| Composed system prompt (preamble)         | `CODING_AGENT_PREAMBLE` in prompt-composer.ts                                                              | 327 chars         | ~81                |
| Personality: voice                        | `adhocPersonality.voice`                                                                                   | ~150 chars        | ~37                |
| Personality: roleFrame                    | `adhocPersonality.roleFrame`                                                                               | ~260 chars        | ~65                |
| Personality: constraints (4 items)        | `adhocPersonality.constraints`                                                                             | ~350 chars        | ~87                |
| Personality: patterns (5 items)           | `adhocPersonality.patterns`                                                                                | ~350 chars        | ~87                |
| BDE conventions (memory)                  | `getAllMemory()` for BDE repo: ipc-conventions + testing-patterns + architecture-rules                     | 3,912 chars       | ~978               |
| User memory                               | `getUserMemory()` if enabled                                                                               | variable          | variable           |
| Branch appendix                           | `buildBranchAppendix(branch)` (always provided for adhoc)                                                  | ~150 chars        | ~37                |
| Playground instructions                   | `PLAYGROUND_INSTRUCTIONS` (default enabled for adhoc)                                                      | 395 chars         | ~98                |
| Task content                              | `taskContent` (user's task description)                                                                    | variable          | variable           |
| Available skills                          | `getAllSkills()` (5 skills: system-introspection, task-orchestration, code-patterns, pr-review, debugging) | ~10,405 chars     | ~2,601             |
| Plugin disable note                       | Boilerplate footer                                                                                         | ~150 chars        | ~37                |
| **TOTAL (excluding variable components)** |                                                                                                            | **~55,800 chars** | **~13,960 tokens** |

### Assistant Agent (Interactive helper)

| Component                                 | Source                                                                                                     | Size              | Approx Tokens      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| SDK auto-loaded: Project CLAUDE.md        | `settingSources: ['user','project','local']` in adhoc-agent.ts (same path)                                 | 18,662 chars      | ~4,666             |
| SDK auto-loaded: User CLAUDE.md           | `settingSources: ['user','project','local']` in adhoc-agent.ts (same path)                                 | 4,463 chars       | ~1,116             |
| SDK auto-loaded: BDE_FEATURES.md          | Via @ directive in project CLAUDE.md                                                                       | 16,075 chars      | ~4,019             |
| Composed system prompt (preamble)         | `CODING_AGENT_PREAMBLE` in prompt-composer.ts                                                              | 327 chars         | ~81                |
| Personality: voice                        | `assistantPersonality.voice`                                                                               | ~200 chars        | ~50                |
| Personality: roleFrame                    | `assistantPersonality.roleFrame`                                                                           | ~400 chars        | ~100               |
| Personality: constraints (2 items)        | `assistantPersonality.constraints`                                                                         | ~200 chars        | ~50                |
| Personality: patterns (4 items)           | `assistantPersonality.patterns`                                                                            | ~280 chars        | ~70                |
| BDE conventions (memory)                  | `getAllMemory()` for BDE repo: ipc-conventions + testing-patterns + architecture-rules                     | 3,912 chars       | ~978               |
| User memory                               | `getUserMemory()` if enabled                                                                               | variable          | variable           |
| Branch appendix                           | `buildBranchAppendix(branch)` if branch provided                                                           | ~150 chars        | ~37                |
| Playground instructions                   | `PLAYGROUND_INSTRUCTIONS` (default enabled for assistant)                                                  | 395 chars         | ~98                |
| Task content                              | `taskContent` (user's initial request)                                                                     | variable          | variable           |
| Available skills                          | `getAllSkills()` (5 skills: system-introspection, task-orchestration, code-patterns, pr-review, debugging) | ~10,405 chars     | ~2,601             |
| Plugin disable note                       | Boilerplate footer                                                                                         | ~150 chars        | ~37                |
| **TOTAL (excluding variable components)** |                                                                                                            | **~55,600 chars** | **~13,905 tokens** |

### Copilot Agent (Spec drafting assistant, read-only)

| Component                                 | Source                                                         | Size              | Approx Tokens      |
| ----------------------------------------- | -------------------------------------------------------------- | ----------------- | ------------------ |
| SDK auto-loaded: Project CLAUDE.md        | `settingSources: ['user','project','local']` in Task Workbench | 18,662 chars      | ~4,666             |
| SDK auto-loaded: User CLAUDE.md           | `settingSources: ['user','project','local']` in Task Workbench | 4,463 chars       | ~1,116             |
| SDK auto-loaded: BDE_FEATURES.md          | Via @ directive in project CLAUDE.md                           | 16,075 chars      | ~4,019             |
| Composed system prompt (preamble)         | `SPEC_DRAFTING_PREAMBLE` in prompt-composer.ts                 | 1,076 chars       | ~269               |
| Personality: voice                        | `copilotPersonality.voice`                                     | ~220 chars        | ~55                |
| Personality: roleFrame                    | `copilotPersonality.roleFrame`                                 | ~550 chars        | ~137               |
| Personality: constraints (8 items)        | `copilotPersonality.constraints`                               | ~700 chars        | ~175               |
| Personality: patterns (8 items)           | `copilotPersonality.patterns`                                  | ~770 chars        | ~192               |
| Target repository path                    | `repoPath` injected as context                                 | ~100 chars        | ~25                |
| Form context                              | `formContext` (title, repo, spec draft) if provided            | variable          | variable           |
| Mode framing                              | Hardcoded "Spec Drafting" mode explanation                     | ~250 chars        | ~62                |
| Conversation history                      | `messages` array (user + copilot turns)                        | variable          | variable           |
| Plugin disable note                       | Boilerplate footer                                             | ~150 chars        | ~37                |
| **TOTAL (excluding variable components)** |                                                                | **~43,000 chars** | **~10,750 tokens** |

### Synthesizer Agent (Single-turn spec generator)

| Component                                 | Source                                                              | Size              | Approx Tokens      |
| ----------------------------------------- | ------------------------------------------------------------------- | ----------------- | ------------------ |
| SDK auto-loaded: Project CLAUDE.md        | `settingSources: ['user','project','local']` in spec-synthesizer.ts | 18,662 chars      | ~4,666             |
| SDK auto-loaded: User CLAUDE.md           | `settingSources: ['user','project','local']` in spec-synthesizer.ts | 4,463 chars       | ~1,116             |
| SDK auto-loaded: BDE_FEATURES.md          | Via @ directive in project CLAUDE.md                                | 16,075 chars      | ~4,019             |
| Composed system prompt (preamble)         | `SPEC_DRAFTING_PREAMBLE` in prompt-composer.ts                      | 1,076 chars       | ~269               |
| Personality: voice                        | `synthesizerPersonality.voice`                                      | ~150 chars        | ~37                |
| Personality: roleFrame                    | `synthesizerPersonality.roleFrame`                                  | ~200 chars        | ~50                |
| Personality: constraints (4 items)        | `synthesizerPersonality.constraints`                                | ~300 chars        | ~75                |
| Personality: patterns (4 items)           | `synthesizerPersonality.patterns`                                   | ~250 chars        | ~62                |
| Codebase context                          | `codebaseContext` (file tree + relevant code snippets)              | variable          | variable           |
| Generation instructions                   | `taskContent` (structured task + user answers)                      | variable          | variable           |
| Plugin disable note                       | Boilerplate footer                                                  | ~150 chars        | ~37                |
| **TOTAL (excluding variable components)** |                                                                     | **~42,400 chars** | **~10,625 tokens** |

## Findings

### F-t4-prompt-1: Redundant SDK-sourced context across all agent types

**Severity:** High  
**Category:** Tokens  
**Location:** `sdk-streaming.ts:73-76`, `sdk-adapter.ts:73-76`, `adhoc-agent.ts:119`  
**Evidence:**  
All five agent types (pipeline, assistant, adhoc, copilot, synthesizer) are spawned with identical `settingSources: ['user', 'project', 'local']`, which causes the Claude Agent SDK to auto-load:

- `/Users/ryan/projects/BDE/CLAUDE.md` (~18.6KB)
- `/Users/ryan/CLAUDE.md` (~4.5KB)
- `/Users/ryan/projects/BDE/docs/BDE_FEATURES.md` (~16KB, via @ directive)

**Total injected twice per spawn:** ~39.2KB (~9,800 tokens)

This content is duplicated across **all five agent types, every spawn**. Even copilot and synthesizer (spec drafting agents) receive the full feature reference, which is unnecessary for their read-only scope.

**Impact:** At current spawn rates (assume 20 pipeline agents/day + 5 adhoc/day + 5 copilot/day + 2 synthesizer/day = ~32 spawns/day), this redundancy costs **~313,600 tokens/day** across the fleet. Over a 30-day month: **~9.4M tokens (~$150 at Sonnet pricing)** wasted.

**Recommendation:**

1. Create lightweight variants of CLAUDE.md for spec-drafting agents (copilot/synthesizer) that omit irrelevant sections (e.g., build commands, CI pipeline).
2. Lazy-inject BDE_FEATURES.md only when agent type supports tools (pipeline/adhoc/assistant exclude it from CLAUDE.md @ directive, load it conditionally in `buildAgentPrompt()` for coding agents only).
3. Cache the SDK-loaded context in memory to avoid re-reading files on each spawn.

**Effort:** M  
**Confidence:** High

---

### F-t4-prompt-2: BDE memory modules (3.9KB) injected into all non-BDE repos unnecessarily

**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:249-255`, `memory/index.ts:17-56`  
**Evidence:**  
The `getAllMemory({ repoName })` function gates BDE-specific memory (IPC conventions, testing patterns, architecture rules) on repo name. However:

- `repoName` is **only set when explicitly passed to `buildAgentPrompt()`**
- Most spawn callers do NOT pass `repoName`, defaulting to `true` in `isBdeRepo()` — meaning memory is injected even for non-BDE repos
- Example in `adhoc-agent.ts` line 105: `buildAgentPrompt({ agentType, taskContent, branch })` — **no `repoName` passed**

**Impact:** Every adhoc/assistant agent spawned outside BDE gets ~3.9KB of irrelevant IPC/testing/architecture guidance. If 30% of spawns target non-BDE repos (~10 spawns/day), that's **~39KB (~9,750 tokens/day)** of dead weight.

**Recommendation:**

1. Change `isBdeRepo(undefined)` default from `true` to `false` — safer assumption that unknown repos are not BDE.
2. Audit all spawn call sites and explicitly pass `repoName` (derive it from `repoPath` basename if needed).
3. Add a test to catch future call sites that forget `repoName`.

**Effort:** S  
**Confidence:** High

---

### F-t4-prompt-3: Copilot SPEC_DRAFTING_PREAMBLE is 5.3x longer than needed

**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:68-86`  
**Evidence:**  
The copilot preamble (1,076 chars, ~269 tokens) is extremely defensive:

- 2 paragraphs on what the copilot is NOT
- 3 sections warning against executing code, treating file contents as data, and checking for embedded instructions
- This matches the threat model of a general-purpose system prompt, not a scoped spec-drafting tool in a single-player GUI

The copilot:

- Runs in a browser window under user control
- Has zero tool access (read-only Read/Grep/Glob only)
- Works in a dedicated Task Workbench UI, not a terminal
- Cannot modify any code or run commands
- Never receives untrusted input from files

**Impact:** Every copilot spawn (~5/day) loads ~269 unused defensive tokens. Over 30 days: **~40,350 tokens (~$0.64)**.

**Recommendation:**

1. Replace SPEC_DRAFTING_PREAMBLE with a short, focused "Task Workbench Copilot" preamble (~200 chars):
   - Identify as a spec-drafting assistant
   - State that it helps refine specs through conversation
   - Remove defensive language about embedded instructions and file content interpretation
2. Keep the guardrails specific to copilot's scope (read-only tools, no execution, 500-word limit).

**Effort:** S  
**Confidence:** Medium

---

### F-t4-prompt-4: Skills (10.4KB) injected into assistant agents even for non-implementation tasks

**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:265-268`, `skills/index.ts:20-30`  
**Evidence:**  
Skills are injected into assistant and adhoc agents unconditionally via `getAllSkills()`. The skills cover:

- System introspection (querying SQLite, reading logs)
- Task orchestration (creating sprint tasks, setting dependencies)
- Code patterns (generating BDE-idiomatic IPC handlers, Zustand stores)
- PR review strategies
- Debugging patterns

However, a user spawning an assistant to "explain this error" or "answer a question about the codebase" gets all 5 skills injected (10.4KB, ~2,601 tokens) regardless of relevance. The assistant may never need code pattern guidance or task orchestration in a single clarification request.

**Impact:** Assume 50% of adhoc/assistant agents are for short clarifications (1-2 turn). Those agents carry ~2,601 unused skill tokens on first turn. With ~10 such spawns/day, that's **~26,010 tokens/day, or ~780,300 tokens/month (~$12.50)**.

**Recommendation:**

1. Change skills from "always-on" to "on-demand" — add a prompt note: "You have access to BDE skills (system introspection, task orchestration, code patterns, PR review, debugging) — use them when relevant."
2. Alternatively, lazy-load a summary/index of available skills (10 lines, ~100 chars) on first turn, then full guidance on subsequent turns if the user asks.
3. Track which skills are actually used (via tool invocation logging) to validate that trimming them saves tokens without harming task success.

**Effort:** M  
**Confidence:** Medium

---

### F-t4-prompt-5: Pipeline PIPELINE_JUDGMENT_RULES (140 chars) is orthogonal to agent execution

**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:142-158`  
**Evidence:**  
The PIPELINE_JUDGMENT_RULES section (140 chars, ~35 tokens) educates the agent on how to handle test flakes, judge failures, and verify git push completion via `git ls-remote` instead of polling output files. This guidance is:

- Valuable for human code reviewers and CI debugging
- Orthogonal to the agent's task specification
- Repeated on every pipeline spawn
- A violation of "task spec drives behavior" principle — the spec should instruct what to do, not how to judge test quality

**Impact:** ~1 token per pipeline spawn × ~20 spawns/day × 30 days = **~600 tokens/month (~$0.01)**. Negligible cost but unnecessary cognitive load.

**Recommendation:**
Move PIPELINE_JUDGMENT_RULES to a separate "CI Best Practices" document that's auto-loaded via BDE_FEATURES.md or CLAUDE.md under a section like "## When Tests Fail" — not injected at prompt composition time. Agents working on specs that explicitly require "fix all failing tests" already have the right guidance.

**Effort:** S  
**Confidence:** Low

---

### F-t4-prompt-6: Personality overlap between adhoc and assistant agents (shared core)

**Severity:** Low  
**Category:** Tokens  
**Location:** `personality/adhoc-personality.ts`, `personality/assistant-personality.ts`  
**Evidence:**  
Both adhoc and assistant personalities share the same constraint: "Full tool access — can read/write files, run commands, spawn subagents" and the same foundational pattern: "You work in an isolated git worktree on your assigned branch."

The personalities differ only in tone (adhoc = "terse and execution-focused", assistant = "conversational but concise") and role framing (adhoc = executor, assistant = helper).

If the two agent types are semantically similar (both interactive, both in worktrees, both have full tools), they could share a base personality template and override only the voice/roleFrame fields.

**Impact:** Minimal (personalities are ~1.3KB each, so consolidation saves ~100 chars, ~25 tokens per spawn). Over 30 days at ~15 adhoc+assistant spawns/day: **~11,250 tokens (~$0.18)**.

**Recommendation:**
Create a shared personality base for adhoc and assistant:

- Define `baseInteractivePersonality` with the common constraints and patterns
- Have adhoc and assistant import and extend it, overriding only voice and roleFrame
- Reduces future maintenance burden if these agent types continue to evolve together

**Effort:** S  
**Confidence:** Low

---

### F-t4-prompt-7: Task spec injection (variable, unbounded) lacks upper-bound guidance

**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:332-344`  
**Evidence:**  
`buildAgentPrompt()` accepts `taskContent` (the spec or prompt) as an unbounded string parameter. The CLAUDE.md file advises keeping specs under 500 words, but:

- No runtime validation prevents a 10,000-word spec from being injected
- No truncation logic caps task content at a safe size
- Users can create sprint tasks with arbitrarily large specs, and agents pay the full token cost

Example scenario: A user pastes a 2,000-line requirements document into a task. The pipeline agent's first turn pays ~500 tokens just to read the spec.

**Impact:** Assume 10% of pipeline spawns receive specs > 1,000 words (~400 tokens per spec). Over 20 pipeline spawns/day: **~800 tokens/day, or ~24,000 tokens/month (~$0.38)**.

**Recommendation:**

1. Add a check in `buildAgentPrompt()` to cap taskContent at 2,000 chars (~500 tokens), with a truncation note if exceeded:
   ```typescript
   if (taskContent && taskContent.length > 2000) {
     taskContent = taskContent.slice(0, 2000) + '\n\n[... spec truncated due to length]'
   }
   ```
2. Enforce this in the Task Workbench UI with a warning at 1,000 chars and a hard limit at 2,000.
3. Consider stricter guidance in CLAUDE.md: "Specs over 800 words cause timeout; aim for 200-400 words."

**Effort:** S  
**Confidence:** Medium

---

### F-t4-prompt-8: Upstream context partial diffs (variable, up to 2KB each) not documented

**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:356-374`  
**Evidence:**  
When a pipeline task depends on upstream tasks, `buildAgentPrompt()` injects upstream context including partial diffs (capped at 2,000 chars per diff). The cap is hardcoded and not documented anywhere in the codebase. If an agent has 3 upstream dependencies with diffs, that's 6,000 chars (~1,500 tokens) of diff context per spawn.

The `upstreamContext` parameter is built by the agent manager but the prompt composer doesn't know the semantics or the cap's rationale.

**Impact:** Dependent tasks pay this cost; independent tasks pay zero. Impact is architecture-dependent and hard to quantify without historical data.

**Recommendation:**

1. Document the 2,000-char diff cap in `buildAgentPrompt()` JSDoc.
2. Make it a constant: `const MAX_DIFF_CHARS = 2000` (not hardcoded).
3. Consider whether 2,000 chars is enough for partial diffs to be useful, or if a lower cap (e.g., 1,000 chars showing the core changes) would suffice.

**Effort:** S  
**Confidence:** Low

---

### F-t4-prompt-9: User memory (toggleable) duplicated in composition but not in SDK context

**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:257-262`, `memory/user-memory.ts`  
**Evidence:**  
User memory is injected via `getUserMemory()` in `buildAgentPrompt()` for all agent types. However, the SDK also loads settings from `~/.claude/settings.json` (via `settingSources`), which may include user-toggled knowledge files. This creates ambiguity:

- Are user memory files being injected twice (once by SDK, once by `buildAgentPrompt()`)?
- Or does `getUserMemory()` read a separate source (e.g., BDE's SQLite settings table)?

Reading the code: `getUserMemory()` is in `src/main/agent-system/memory/user-memory.ts` and loads from BDE's settings table, NOT the SDK's `~/.claude/settings.json`. So there's no duplication, but the separation is confusing.

**Impact:** Low risk of actual token waste, but high risk of future bugs if someone assumes the SDK settings and BDE settings are synchronized.

**Recommendation:**

1. Rename `getUserMemory()` to `getBDEUserMemory()` to clarify that it's reading from BDE's settings, not the global Claude Code settings.
2. Document in `buildAgentPrompt()` that user memory comes from BDE settings, not from the SDK's auto-loaded context.

**Effort:** S  
**Confidence:** Low

---

### F-t4-prompt-10: Time limit section (150 chars, variable) injected only for pipeline but should be copilot-aware

**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:397-399`  
**Evidence:**  
The time limit section is injected only for pipeline agents when `maxRuntimeMs > 0`. Copilot and synthesizer agents are single-turn (implicit 5-minute limit from the UI), but there's no reminder of this constraint in their prompts.

Copilot agents might produce specs that are too ambitious ("implement a 10,000-line architecture refactor") without realizing they only have 5 minutes to draft the spec, not execute it. A brief "You have 5 minutes to draft this spec" note in the copilot preamble could prevent overambitious outputs.

**Impact:** Minimal token cost (< 50 tokens to add a line to copilot preamble), but moderate UX improvement.

**Recommendation:**
Add a time constraint reminder to the copilot preamble:

```
"This is a live conversation — keep responses under 500 words and aim to help the user
draft a complete, actionable spec within 5-10 minutes."
```

**Effort:** S  
**Confidence:** Low

---

## Open questions

1. **Spawn rate assumption valid?** This audit assumes ~20 pipeline + 5 adhoc + 5 copilot + 2 synthesizer + 5 assistant = ~37 spawns/day. What are actual spawn rates from the database?

2. **SDK context auto-loading cacheable?** Could BDE cache the SDK-loaded CLAUDE.md + BDE_FEATURES.md in memory across spawns, reducing redundant file I/O?

3. **Personality as a tool, not inline text?** Should agent personalities be defined as structured data (voice, roleFrame, constraints as arrays) and composed by the SDK, rather than embedded as string constants in the prompt?

4. **Skills performance tracking?** Are there metrics on which skills are actually invoked by assistant/adhoc agents? This would validate whether the ~2,600-token skill injection is justified.

5. **Synthesizer's use of `maxTurns: 1`:** Why is synthesizer single-turn while adhoc/assistant are multi-turn? Does the single-turn constraint produce worse specs, or does the codebase context compensate?
