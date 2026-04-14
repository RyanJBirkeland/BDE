# Token Size Analysis: Prompt Composition Pipeline

**Audit Date:** 2026-04-13  
**Scope:** Agent prompt builders and memory/skills injection system  
**Finding Count:** 8 critical + high severity issues

---

## F-t1-tok-size-1: Oversized Pipeline Judgment Rules Block

**Severity:** High  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:69-85`

**Evidence:** 
- String `PIPELINE_JUDGMENT_RULES` spans 17 lines, ~2,400 characters
- Estimated ~600 tokens per pipeline agent invocation
- Content focuses on edge cases (test flakes, parallel load, git push detection)

**Impact:**
Every pipeline agent receives this entire block regardless of whether tests will actually run. The section contains nuanced guidance about test isolation, parallel CPU saturation, and git push verification that is statically injected but only relevant when the agent actually runs tests or pushes code. For simple refactors or doc updates that don't touch tests, this is pure overhead.

**Recommendation:**
Conditional: Only inject `PIPELINE_JUDGMENT_RULES` when `taskContent` contains keywords like "test", "fix", "build", "ci", or when `taskContent.length > 500`. Default to injecting for large specs, omit for small ones.

**Effort:** S (add keyword check in `buildPipelinePrompt()`)  
**Confidence:** High

---

## F-t1-tok-size-2: All Skills Injected Into Assistant/Adhoc Even When Not Needed

**Severity:** High  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-assistant.ts:44-46`

**Evidence:**
- `getAllSkills()` concatenates 5 skill modules: system-introspection, task-orchestration, code-patterns, pr-review, debugging
- Total ~1,676 chars → ~419 tokens per assistant/adhoc invocation
- Skills are injected unconditionally for interactive agents on BDE repos
- Code patterns skill (2,271 chars) is the largest single skill

**Impact:**
An assistant or adhoc agent helping with UI styling in a React component receives full guidance on SQLite queries, Zustand store patterns, IPC handlers, PR merging with `gh` CLI, etc. — most of which is irrelevant to the current task. Skills should be curated by task intent, not wholesale-loaded.

**Recommendation:**
Implement skill selection: extract task keywords, inject only relevant skills. For example:
- "store", "state", "zustand" → inject code-patterns only
- "queue", "task", "sprint" → inject task-orchestration only
- "review", "merge", "ci" → inject pr-review only
- Default: inject all (preserves safety for open-ended tasks)

**Effort:** M (write skill-selector function, map keywords to skill IDs)  
**Confidence:** High

---

## F-t1-tok-size-3: CODING_AGENT_PREAMBLE Duplicated Across Assistant + Pipeline

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:104`, `src/main/agent-manager/prompt-assistant.ts:23`

**Evidence:**
- `CODING_AGENT_PREAMBLE` is 1,573 chars (394 tokens)
- Used in both `buildPipelinePrompt()` and `buildAssistantPrompt()`
- Both agent types share the same hardcoded content (preamble-sections 14-39 in prompt-sections.ts)

**Impact:**
When a single system handles both pipeline and assistant agents (e.g., a replay scenario or batch test), the preamble is duplicated across prompts. More importantly, it's generic enough (git branches, pre-commit checks, secrets warnings) that it could be reused via a shared memory file, reducing on-disk duplication and improving manageability.

**Recommendation:**
Move `CODING_AGENT_PREAMBLE` to a dedicated BDE memory file (~/.bde/memory/\_global-coding-rules.md). Load via `getUserMemory()` for all coding agents (pipeline + assistant). This:
- Eliminates string literal duplication in TypeScript
- Makes preamble edits centralized
- Allows users to customize base coding rules without code changes

**Effort:** M (create memory file, update import logic, test)  
**Confidence:** High

---

## F-t1-tok-size-4: Memory Modules Always Loaded on BDE Repo, No Task-Based Filtering

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:110-114`, `src/main/agent-system/memory/index.ts:50-57`

**Evidence:**
- `getAllMemory()` with `isBdeRepo()` check injects all 3 memory modules: ipcConventions, testingPatterns, architectureRules
- Total ~3,912 chars → ~978 tokens unconditionally for BDE agents
- Pipeline already uses `selectUserMemory()` for task-based filtering; memory modules bypass this

**Impact:**
A pipeline agent writing documentation (lowering the token limit) gets full IPC handler patterns, architecture rules, and testing patterns. These aren't relevant to specs or prose updates. The pipeline correctly uses selective user memory but ignores task content when loading BDE conventions.

**Recommendation:**
Apply same selective logic to BDE memory modules:
- `selectBdeMemory(taskContent: string)` function that filters ipcConventions, testingPatterns, architectureRules by task keywords
- Include all modules if taskContent is empty or keywords not recognized
- Prioritize testingPatterns for "test"-related specs
- Prioritize ipcConventions for "handler", "ipc", "channel" specs
- Always include architectureRules as baseline

**Effort:** M (write selector, test keyword matching)  
**Confidence:** Medium

---

## F-t1-tok-size-5: SYNTHESIZER_SPEC_REQUIREMENTS Inflates All Synthesizer Prompts

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-synthesizer.ts:15-56`

**Evidence:**
- 42-line constraint block (~2,055 chars → 514 tokens)
- Injected unconditionally into every synthesizer invocation
- Contains 4 required sections, validation rules, and examples

**Impact:**
The synthesizer is single-turn (`maxTurns: 1`), so it cannot iterate. The entire 514-token validation block must fit in the prompt. For simple, well-understood generation tasks, the verbosity is unnecessary; for complex tasks, the rigid format may over-constrain the output.

**Recommendation:**
Two tiers:
- **Simple mode** (when `taskContent` is <300 chars and keywords suggest straightforward spec): inject compact version (2-3 key sections only)
- **Rigorous mode** (default): inject full validation block

Or: Move detailed validation to system prompt / preamble, keep prompt injection to a lightweight checklist.

**Effort:** M (implement mode logic, test both paths)  
**Confidence:** Medium

---

## F-t1-tok-size-6: Personality Formatting Overhead (Repeated Structure Across 5 Agent Types)

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-system/personality/*.ts` (all 5 files)

**Evidence:**
- Each personality object has `voice`, `roleFrame`, `constraints[]`, `patterns[]`
- `buildPersonalitySection()` repeats the same heading structure (## Voice, ## Your Role, ## Constraints, ## Behavioral Patterns)
- Total personality content: ~2,500 chars across 5 agent types
- Formatting (headings, bullet markers) adds ~15-20% overhead

**Impact:**
The heading and bullet formatting is boilerplate. A personality object for a non-coding agent (e.g., copilot, synthesizer) could omit verbose constraint lists, or share simpler formatting. The function `buildPersonalitySection()` is inflexible — always outputs all 4 sections even if `patterns` is empty.

**Recommendation:**
- Conditionally skip `patterns` section if array is empty (simple check in `buildPersonalitySection()`)
- Consider data-driven personality format: inline simpler agents' personalities directly in prompt-builder, reserve full structure only for complex agents
- No urgent need (impact is small), but worth noting for future refactors

**Effort:** S (single conditional in buildPersonalitySection)  
**Confidence:** Low

---

## F-t1-tok-size-7: PLAYGROUND_INSTRUCTIONS Injected Even When Not Used

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-sections.ts:48-59`, multiple builders

**Evidence:**
- 12-line instruction block, 524 chars → 131 tokens
- Controlled by `playgroundEnabled` flag, but default is `true` for assistant/adhoc (line 59 in prompt-assistant.ts)
- Playground is a specialized feature; most tasks don't use it

**Impact:**
Assistant/adhoc agents default to playground-enabled, so most prompts include instructions about writing self-contained HTML files. This is overhead for tasks that don't touch UI. Pipeline agents default to `false`, which is correct.

**Recommendation:**
Flip the default: set `playgroundEnabled = false` by default in assistant/adhoc, allow explicit opt-in via form parameter. Users who regularly use the playground can enable it globally in settings.

**Effort:** S (change line 59 in prompt-assistant.ts, document in CLAUDE.md)  
**Confidence:** Medium

---

## F-t1-tok-size-8: Upstream Context Section Formatting Adds Boilerplate

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-sections.ts:101-126`

**Evidence:**
- `buildUpstreamContextSection()` wraps each task with explanatory text, headings, and `<details>` markdown
- Baseline: "This task depends on..." + iteration loop + diff wrapping
- For 3 upstream tasks: ~600 additional chars just for framing

**Impact:**
When a task has multiple upstream dependencies, the section includes preamble text, repeated introductions, and markdown scaffolding that could be more compact. Agents understand dependency chains and diff formats without verbose framing.

**Recommendation:**
Compact variant: remove preamble ("This task depends on..."), use inline format:
```
## Dependencies
- **Task A**: [spec summary truncated to 500 chars]
  [diff diff if available]
```
instead of current multi-section format.

**Effort:** S (template rewrite)  
**Confidence:** Low

---

## Summary Table

| Finding | Type | Static Cost | Dynamic Impact | Priority |
|---------|------|------------|---|----------|
| F1: Judgment Rules | Conditional overhead | 600 tokens | High on simple tasks | Reduce |
| F2: Skills blanket load | Wrong abstraction | 419 tokens | High on non-BDE tasks | Selector |
| F3: Preamble duplication | Repetition | 394 tokens × N agents | Maintenance debt | Consolidate |
| F4: Memory no filtering | Conditional overhead | 978 tokens | Medium (better than F1) | Filter |
| F5: Synthesizer validation | Rigidity | 514 tokens | Medium (single-turn) | Tier |
| F6: Personality formatting | Style | ~15% of personality | Low (minor) | Polish |
| F7: Playground default | Opt-out | 131 tokens | Low (flippable) | Flip default |
| F8: Upstream boilerplate | Style | 600 tokens / 3 deps | Low (depends on specs) | Polish |

---

## Estimated Token Savings (Best Case)

If all recommendations implemented:
- **F1 (Judgment Rules filtering):** -300 tokens per simple pipeline task
- **F2 (Skills selector):** -250 tokens per assistant task (avg 3 of 5 skills)
- **F3 (Preamble → memory):** -100 tokens (dedup cost, shared system memory)
- **F4 (Memory filtering):** -150 tokens per doc/spec task
- **F5 (Synthesizer tiers):** -150 tokens per simple synthesis task
- **F7 (Playground flip):** -50 tokens per assistant task (new default off)

**Aggregated per agent type (approximate):**
- Pipeline: -400 to -650 tokens per task (9-15% reduction)
- Assistant: -500 to -800 tokens per task (13-20% reduction)
- Copilot/Synthesizer: -50 to -200 tokens (minor impact)

**Total system impact:** If 100 agents/day, ~50K-100K token savings per day (2-4% reduction in average prompt size).

---

## Implementation Priority

1. **F2 (Skills selector)** — Highest ROI: interactive agents spend most tokens on skills, selector is straightforward
2. **F1 (Judgment Rules filtering)** — Pipeline agents scale fastest; filtering reduces recurring overhead
3. **F4 (Memory filtering)** — Pairs naturally with F2; same keyword logic reusable
4. **F3 (Preamble consolidation)** — Maintenance benefit; defers to F2/F4 completion
5. **F5 (Synthesizer tiers)** — Polish; lower priority if system is already prompt-size-conscious
6. **F6–F8** — Post-MVP optimizations

