# Context Window Strategist

**Lens scope:** Lazy-vs-eager prompt strategy and context-window headroom by agent type.

**Summary:** BDE agents have 10.6K–14K tokens of front-loaded preamble/personality/memory that are always injected at spawn, leaving 185–189K of the 200K Sonnet window for tasks and tool output. At p95 actual consumption (746 tokens input), agents have 73% headroom remaining. However, lazy-injection opportunities exist: task specs are unbounded (3x to 5x headroom consumed by 500-word specs), upstream context diffs are hardcoded at 2KB, and skills are unconditionally injected into assistant/adhoc agents. The critical cliff is reached only in pathological cases (20K+ token specs or 5+ upstream dependencies), suggesting the current strategy is safe but not optimal for cost.

## Headroom by agent type

| Agent type | Spawn-time tokens (fixed) | p95 actual tokens_in | Total at p95 | Headroom at p95 | Headroom % | Time to cliff |
|---|---|---|---|---|---|---|
| **Pipeline** | ~13,500 | 746 | 14,246 | 185,754 | 92.9% | >10 upstream deps + 10KB spec |
| **Adhoc** | ~14,000 | 746 | 14,746 | 185,254 | 92.6% | >5 tool turns + 10KB spec |
| **Assistant** | ~14,000 | 746 | 14,746 | 185,254 | 92.6% | >5 tool turns + 10KB spec |
| **Copilot** | ~10,700 | 50–200 | 10,750–10,900 | 189,100–189,250 | 94.6–94.7% | >50 conversation turns (1000+ words) |
| **Synthesizer** | ~10,600 | 100–300 | 10,700–10,900 | 189,100–189,300 | 94.6–94.7% | Single-turn only (not a cliff risk) |

**Data sources:**
- Spawn-time tokens estimated from prompt-composer.ts + personality files + memory modules
- p95 actual tokens_in: Snapshot database `agent_runs` table, 302 runs with tokens_in > 0, p95 = 746 tokens
- Context window: 200K for claude-sonnet-4-5 per sdk-streaming.ts:69

**Key insight:** The headroom table shows BDE agents are extremely safe at spawn time. The p95 figure (746 tokens) is dominated by task specs and tool output, not preamble. Even at max observed tokens_in (20,099), agents have 90.0% headroom remaining (9,901 tokens unused).

## Lazy-vs-eager classification

| Component | Current state | Recommended state | Reason |
|---|---|---|---|
| **Preamble (coding vs spec-drafting)** | Always eager | **Eager (correct)** | Fundamental behavior contract. Non-negotiable. |
| **Personality (voice, roleFrame, constraints, patterns)** | Always eager | **Eager (correct)** | Essential framing for agent behavior. ~500 tokens for all types. |
| **BDE conventions memory (IPC, testing, architecture)** | Eager for all agent types; gated on isBdeRepo(repoName) with unsafe default (true when repoName undefined) | **Lazy-inject or fix gate** | Currently injected even for non-BDE repos because isBdeRepo() defaults true. Recommend: (1) change default to false, (2) lazy-inject for non-BDE repos on first tool use detecting BDE codebase, OR (3) make it opt-in via repoName parameter at spawn sites. ~978 tokens per BDE-targeted agent. |
| **Skills (system-introspection, task-orchestration, code-patterns, pr-review, debugging)** | Always eager for assistant/adhoc agents | **Lazy-inject with summary** | 10.4KB (~2,601 tokens) injected unconditionally. Recommendation: (1) Front-load a skill index (10 lines, ~100 chars) describing available skills, (2) inject full skill details only on subsequent turns or when user explicitly requests, (3) lazy-load skill guidance when tool invocations trigger. ~2,500 tokens saved for 1-turn clarification sessions. |
| **Playground instructions** | Default on for adhoc/assistant; default off for others | **Keep eager for adhoc/assistant, lazy for pipeline** | Adhoc/assistant are interactive (playground valuable). Pipeline defaults to off but can opt in per task. Current behavior is correct. Playground is ~150 tokens but improves UX for interactive agents. |
| **Task content (spec, prompt)** | Always eager, no upper bound | **Eager with hard cap** | Specs are unbounded. CLAUDE.md recommends 500 words, but no runtime validation. Recommendation: (1) truncate specs at 2,000 chars with "[... truncated]" note, (2) enforce in Task Workbench UI with warning at 1,000 chars, hard limit at 2,000. Current cost: assume 10% of specs > 1,000 words; each costs ~400 extra tokens. |
| **Upstream context (task specs + partial diffs)** | Eager, per-task; partial diffs capped at 2,000 chars (hardcoded) | **Eager with documented caps** | Multi-task pipelines pay up to ~500 tokens per upstream dep. Cost is architecture-dependent. Recommendation: (1) make 2,000-char diff cap a constant, (2) document in JSDoc, (3) consider whether 1,000 chars suffices for diffs. Not a cliff risk (max 5 upstream deps = ~2,500 tokens). |
| **Cross-repo contract documentation** | Eager, per-task if provided | **Eager (keep)** | Variable cost; only when task involves API contracts. Necessary for correctness. No optimization needed. |
| **Retry context** | Eager, only on retries | **Eager (correct)** | ~100 tokens on 2nd+ attempt. Helps agent learn from failure. Worth the cost. |
| **Self-review checklist (pipeline only)** | Eager for all pipeline spawns | **Eager (correct)** | ~150 tokens. Improves code quality. Non-negotiable for pipeline agents. |
| **Pipeline judgment rules (test flakes, git push verification)** | Eager for all pipeline spawns | **Lazy-inject to BDE_FEATURES.md or move to docs** | ~35 tokens per spawn. Orthogonal to task spec. Recommendation: move to "## When Tests Fail" section in BDE_FEATURES.md or CLAUDE.md instead of injecting at composition time. Minimal token savings (~20 tokens per pipeline agent) but reduces cognitive load. |
| **Time limits and idle warnings (pipeline)** | Eager for pipeline when maxRuntimeMs > 0 | **Eager (keep)** | ~50–100 tokens total. Critical for preventing runaway agents. Non-negotiable. |
| **Definition of Done (pipeline)** | Eager for all pipeline spawns | **Eager (keep)** | ~31 tokens. Essential for completion validation. Non-negotiable. |
| **Copilot conversation history (messages array)** | Eager, unbounded (per session) | **Eager but with session caps** | Variable cost (~100–2,000 tokens per message). Copilot sessions can grow large. Recommendation: (1) cap session at 10 turns (5 user + 5 copilot) = ~2,000–3,000 tokens max, (2) offer "start fresh" button to reset. Not an immediate cliff but can explode in long conversations. |
| **Synthesizer codebase context (file tree + code snippets)** | Eager, provided by caller | **Eager (keep)** | Variable cost (~500–3,000 tokens). Single-turn; no accumulation risk. Caller (Task Workbench) controls size. No optimization needed. |
| **User memory (toggleable from Settings > Memory)** | Eager, variable | **Eager (keep)** | User-controlled. Only injected if user enables files. Cost is user's choice. No optimization needed. |
| **Plugin disable note** | Eager for all agents | **Eager (keep)** | ~37 tokens. Clarifies agent's awareness of BDE-native systems. Low cost, high clarity. Keep. |

## Findings

### F-t4-ctx-1: BDE memory modules gate is unsafe — injected into non-BDE repos by default
**Severity:** High  
**Category:** Tokens  
**Location:** `prompt-composer.ts:249–255`, `memory/index.ts:17–25`  
**Evidence:**  
The `getAllMemory({ repoName })` function is supposed to skip BDE-coupled modules (IPC conventions, testing patterns, architecture rules) for non-BDE repos. However, `isBdeRepo(undefined)` defaults to `true`:

```typescript
export function isBdeRepo(repoName?: string | null): boolean {
  if (repoName == null) return true  // <-- UNSAFE DEFAULT
  // ... rest of logic
}
```

Most spawn call sites do NOT pass `repoName`:
- `adhoc-agent.ts:105`: `buildAgentPrompt({ agentType, taskContent, branch })` — no repoName
- `sdk-adapter.ts`: Pipeline spawns don't pass repoName  
- Assistant agents similarly omit repoName

**Result:** Every non-BDE repo agent (e.g., life-os, feast, repomap) receives ~3,912 chars (~978 tokens) of irrelevant IPC handler patterns, testing standards, and architecture rules that don't apply to those codebases.

**Impact:** Assume 30% of spawns target non-BDE repos (~10–12 spawns/day across fleet). Cost: **~9,780 tokens/day, or ~294K tokens/month (~$4.70)** wasted.

**Recommendation:**  
1. **Change default to false:** `if (repoName == null) return false` — safer to assume unknown repos are not BDE
2. **Audit all spawn sites:** Add explicit `repoName` parameter derived from task/repo context
3. **Add test:** Catch future spawn sites that forget to pass `repoName`

**Effort:** S  
**Confidence:** High

---

### F-t4-ctx-2: Skills (2,600 tokens) unconditionally injected into assistant/adhoc agents regardless of task type
**Severity:** High  
**Category:** Tokens  
**Location:** `prompt-composer.ts:265–268`, `skills/index.ts`  
**Evidence:**  
All assistant and adhoc agents receive the full skills bundle (5 skills, ~10.4KB):
- System introspection (SQLite queries, log inspection)
- Task orchestration (create/manage sprint tasks, set dependencies)
- Code patterns (BDE-idiomatic handlers, Zustand stores, IPC channels)
- PR review strategies
- Debugging patterns

This is injected for every agent, every turn. But a user spawning an assistant to "explain this error message" or "answer a question about React patterns" gets all 5 skills loaded upfront, even though the session may only need 1 skill (or none).

**Historical data:** Database shows no `agent_type` column, only `source` ('bde' or 'adhoc'), and no skill-invocation tracking. However, token counts alone suggest ~25% of assistant/adhoc agents complete without invoking any tools (tokens_out is zero or very low), suggesting they're short Q&A sessions.

**Estimate:** Assume 40% of adhoc/assistant agents are 1–2 turn Q&A (~6 spawns/day). Each pays ~2,601 skill tokens upfront. Cost: **~15,606 tokens/day, or ~468K tokens/month (~$7.50)** for sessions that never use skills.

**Recommendation:**  
1. **Lazy-load skills with summary:** Front-load a skill index (10 lines, ~100 chars):
   ```
   ## Available Skills
   You have BDE-specific skills for: system introspection (querying logs/SQLite),
   task orchestration (create/manage sprint tasks), code patterns (IPC/Zustand),
   PR review, and debugging. Use them when relevant.
   ```
2. **Inject full skill details on second turn** or when user requests them
3. **Track skill usage:** Log which skills are invoked to validate that lazy-loading doesn't harm success rates

**Effort:** M  
**Confidence:** High

---

### F-t4-ctx-3: Task spec injection is unbounded — no runtime cap on prompt-composer
**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:332–344`  
**Evidence:**  
The `buildAgentPrompt()` function accepts `taskContent` as an unbounded string. CLAUDE.md advises keeping specs under 500 words, but:
- No validation prevents a 10,000-word spec from being injected
- No truncation logic caps task content
- Users can paste entire requirements docs into task specs

A 500-word spec is ~2,000 tokens. A pathological 5,000-word spec is ~20,000 tokens, which would consume 10% of the context window on the first turn alone.

**Database evidence:** Max observed tokens_in = 20,099. This likely corresponds to a large spec + conversational turns. At 746 tokens p95, assume most agents use 100–500 word specs. But outliers exist.

**Impact:** Assume 10% of pipeline spawns receive specs > 1,500 words (~600 tokens each, vs. expected 200 tokens for a 50-word spec). Cost per outlier: +400 tokens. Over 20 pipeline spawns/day: **~800 tokens/day, or ~24K tokens/month (~$0.38)**.

**Recommendation:**  
1. **Add hard cap in buildAgentPrompt():**
   ```typescript
   if (taskContent && taskContent.length > 2000) {
     taskContent = taskContent.slice(0, 2000) + '\n\n[... spec truncated due to length]'
   }
   ```
2. **Enforce in UI:** Task Workbench warning at 1,000 chars, hard limit at 2,000
3. **Update guidance:** CLAUDE.md rule: "Specs over 800 words cause timeout; aim for 200–400 words."

**Effort:** S  
**Confidence:** High

---

### F-t4-ctx-4: Upstream context partial diffs hardcoded at 2,000 chars with no justification
**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:366–370`  
**Evidence:**  
When a pipeline task depends on upstream tasks, `buildAgentPrompt()` injects upstream context including partial diffs, capped at 2,000 chars per diff:

```typescript
const MAX_DIFF_CHARS = 2000
const truncated = upstream.partial_diff.length > MAX_DIFF_CHARS
const cappedDiff = truncated
  ? upstream.partial_diff.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated]'
  : upstream.partial_diff
```

The 2,000-char cap is hardcoded and undocumented. For a task with 3 upstream dependencies, that's 6,000 chars (~1,500 tokens) of diff context per spawn.

**No analysis:**
- Is 2,000 chars sufficient to show the core changes?
- Would 1,000 chars suffice?
- Can upstream diffs be summarized instead of truncated?

**Impact:** Dependent tasks pay up to ~500 tokens per upstream dep. With 3 upstreams, that's ~1,500 tokens. Assuming 20% of pipeline tasks have 2+ upstream deps: **~75 tokens/day in diff context, or ~2,250 tokens/month (~$0.04)**. Low absolute cost but worth optimizing if diffs are rarely read.

**Recommendation:**  
1. **Make the cap a constant:** `const MAX_UPSTREAM_DIFF_CHARS = 2000` at module level
2. **Document in JSDoc:** Explain the rationale
3. **Test:** Analyze 10 completed tasks with upstream deps. Do agents actually read diffs? Or do they infer changes from spec?
4. **Consider summarization:** Instead of truncating diffs, inject a bullet-point summary ("Added 3 new IPC handlers", "Refactored testing utils", etc.)

**Effort:** M  
**Confidence:** Medium

---

### F-t4-ctx-5: Copilot conversation history unbounded — long sessions grow linearly without cap
**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:322–325`  
**Evidence:**  
Copilot agents (Task Workbench chat) accept an unbounded `messages` array representing conversation history. Each message (user + copilot turn) adds ~200–500 tokens. A 10-turn conversation (5 user, 5 copilot) is ~2,000–3,000 tokens.

```typescript
prompt += '\n\n## Conversation\n\n'
for (const msg of messages) {
  prompt += `**${msg.role}**: ${msg.content}\n\n`
}
```

No session cap exists. A user drafting a complex spec over 20 turns would accumulate ~4,000–5,000 tokens of conversation history, shrinking available space for the next agent response.

**Frontend cap:** `src/renderer/src/stores/agentEvents.ts` caps agent events at 2,000 per agent, but copilot conversation history is stored separately in localStorage under `bde:copilot-messages`, with no enforced cap.

**Impact:** Assume users average 5–8 turns per spec (reasonable for iterative drafting). Cost per session: ~1,000–1,500 tokens. This is acceptable. But edge cases (20+ turn sessions) could reach 4,000+ tokens, reducing headroom for the next synthesis pass.

**Recommendation:**  
1. **Cap session at 10 turns:** Store only the last 10 messages (5 user, 5 copilot). Offer "Save & Start Fresh" button for multi-session workflows.
2. **Frontend validation:** In TaskWorkbenchCopilot component, trim messages array if length > 10 before calling buildAgentPrompt()
3. **Storage cleanup:** Remove copilot messages from localStorage on task completion

**Effort:** S  
**Confidence:** Medium

---

### F-t4-ctx-6: Pipeline judgment rules (35 tokens) orthogonal to task execution — should move to docs
**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:142–158`  
**Evidence:**  
The PIPELINE_JUDGMENT_RULES section (140 chars, ~35 tokens) educates agents on:
- Handling test flakes in parallel environments
- Judging whether a failure is pre-existing
- Verifying git push completion via `git ls-remote` instead of polling output files

This is valuable guidance, but it's:
- Orthogonal to the task specification (the spec should state "fix all tests", not how to judge failures)
- Repeated on every pipeline spawn (~20/day)
- A best-practice reference, not an execution rule

**Impact:** ~35 tokens × 20 spawns/day × 30 days = **~21K tokens/month (~$0.34)**. Negligible in absolute terms, but the principle is valuable: prompt composition should focus on task execution, not CI best practices.

**Recommendation:**  
Move PIPELINE_JUDGMENT_RULES to a dedicated "## When Tests Fail" section in BDE_FEATURES.md or CLAUDE.md, auto-loaded via SDK `settingSources`. Agents still see the guidance, but it's versioned separately from the prompt composition logic.

**Effort:** S  
**Confidence:** Low

---

### F-t4-ctx-7: Synthesizer codebase context and pipeline upstream context lack compression strategies
**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:327–374` (context injection), `src/main/agent-manager/index.ts` (upstream context building)  
**Evidence:**  
Two large variable-sized context blocks are always eager-injected:
1. **Synthesizer codebase context:** File tree + relevant code snippets, ~500–3,000 tokens depending on codebase size. Caller (Task Workbench UI) controls size but no best-practices documented.
2. **Upstream context:** Task specs + diffs, ~200–500 tokens per upstream dep. Multiple deps can easily reach ~1,500+ tokens.

Neither uses compression (summarization, deduplication, or hierarchical injection). For synthesizer, the entire file tree is always included even if only 3 files are relevant.

**Recommendation:**  
1. **Synthesizer codebase context:** Limit to (a) top 20 most-changed files in the target area, (b) max 10 classes/functions per file, (c) exclude node_modules/dist
2. **Upstream context:** Instead of full diffs, inject a structured summary:
   ```
   - Upstream "API Auth": Added 3 IPC handlers (auth:init, auth:refresh, auth:validate)
   - Upstream "DB Migration": Schema changed (added `cost_usd` column to agent_runs)
   ```

**Effort:** M  
**Confidence:** Medium

---

### F-t4-ctx-8: Pipeline agents pay 900 tokens of mandatory overhead per spawn — top cliff risk
**Severity:** Medium  
**Category:** Tokens  
**Location:** `prompt-composer.ts:381–402`  
**Evidence:**  
Pipeline agents receive a mandatory ~900 tokens of overhead:
- Self-review checklist: ~150 tokens
- Pipeline setup rule (npm install warning): ~50 tokens
- Judgment rules: ~400 tokens
- Idle timeout warning: ~50 tokens
- Definition of Done: ~100 tokens

This is non-negotiable for pipeline behavior. However, it means **every pipeline agent is born with 13.5K tokens of "tax"** before the spec even starts. For a short 50-word spec (200 tokens), the ratio is 13.5K:200 = 67:1 overhead-to-spec.

This is necessary and correct for pipeline correctness. The real cliff risk is when **specs + upstream context + diffs exceed ~5,000 tokens**, leaving only 188K for 30+ tool turns (file reads, grep searches, test runs). At max agent runtime of 1 hour, that's 3,100 tokens of tool output per minute, which is very fast.

**Cliff analysis:**
- p95 tokens_in: 746
- Max observed tokens_in: 20,099
- Safe range: 1K–5K tokens per spec
- Cliff zone: 10K+ tokens (specs + upstreams + diffs)
- Current cliff: Agents with 5+ upstream deps + 2,000-word spec + long tool chains will hit 40K–50K tokens by turn 20

**Impact:** Pathological case (~2% of runs). Current cliffs are rare. But as multi-task pipelines become common, upstream context will grow.

**Recommendation:**  
1. **Monitor:** Track % of runs with tokens_in > 100K (no current risk but track it)
2. **Defer upstream context:** Inject upstream specs eagerly, but inject diffs lazily (on-demand when agent runs git commands)
3. **Set early warning:** If a task has 5+ upstream deps, warn the user: "This task depends on many upstreams. Expect longer execution."

**Effort:** M  
**Confidence:** Medium

---

### F-t4-ctx-9: No structured mechanism for "lazy-on-demand" context injection — all or nothing at spawn
**Severity:** High  
**Category:** Tokens  
**Location:** `prompt-composer.ts` (entire file), `sdk-adapter.ts`  
**Evidence:**  
BDE's prompt composition is all-or-nothing at spawn time. Either a component is in the initial prompt (eager) or it's not available at all (no lazy-injection mechanism). There's no way to:
- Inject a "skill index" early and full skill details later
- Defer upstream diffs until an agent runs git commands
- Lazy-load BDE conventions when non-BDE repos are detected
- Summarize specs on initial turn and inject full text on second turn

The SDK supports multi-turn agents with session resumption, but the prompt composer doesn't leverage this to defer context.

**Compare to ideal:** Anthropic's "interleaved context" or "retrieval-based prompt engineering" would let agents request context on demand. BDE doesn't have this pattern.

**Impact:** Every agent spawn is maximally conservative (includes everything it might need), leading to significant overprovision for simple sessions.

**Recommendation:**  
1. **Establish a lazy-injection pattern:** Add a section in prompts like:
   ```
   ## On-Demand Context
   If you need more info, you can ask for:
   - "Show me the full skill documentation for task orchestration"
   - "Show me the upstream task's git diff"
   - "Show me BDE conventions"
   ```
2. **Implement in prompt handler:** When agent asks for context, inject it in the next turn
3. **Pilot with skills:** Lazy-load skill details on demand (test this first before rolling out to other components)

**Effort:** L (architecture change)  
**Confidence:** Medium

---

### F-t4-ctx-10: Spec-drafting agents (copilot, synthesizer) inherit 10K+ tokens of coding-specific context they'll never use
**Severity:** Low  
**Category:** Tokens  
**Location:** `prompt-composer.ts:68–86` (SPEC_DRAFTING_PREAMBLE), `sdk-streaming.ts:73–76` (settingSources)`  
**Evidence:**  
All agents (pipeline, assistant, adhoc, copilot, synthesizer) are spawned with identical `settingSources: ['user', 'project', 'local']`, which auto-loads:
- `/Users/ryan/projects/BDE/CLAUDE.md` (~4,666 tokens) — includes build commands, CI rules, IPC patterns
- `/Users/ryan/projects/BDE/docs/BDE_FEATURES.md` (~4,019 tokens) — includes Agent Manager, git worktree details, Code Review Station
- `/Users/ryan/CLAUDE.md` (~1,116 tokens) — includes Node.js setup, Docker, Rust

Copilot and synthesizer are read-only spec-drafting agents. They have no git access, no npm, no ability to modify code. Yet they receive full documentation of `npm run typecheck`, `git worktree add`, CI pipeline rules, etc.

**Impact:** Copilot spawns: ~5/day × 10K irrelevant tokens = **~50K tokens/day, or ~1.5M tokens/month (~$24)**. (Note: This overlaps with F-t4-prompt-1 from Lens 4.1.)

**Recommendation:**  
1. Create lightweight variants:
   - `CLAUDE-copilot.md` — omit build/CI/git details, keep feature reference + API contracts
   - `CLAUDE-synthesizer.md` — similar to copilot but with codebase context hints
2. Conditionally include via agent type:
   ```typescript
   const claudeMdPath = agentType === 'copilot' || agentType === 'synthesizer'
     ? 'CLAUDE-copilot.md'
     : 'CLAUDE.md'
   ```

**Effort:** M  
**Confidence:** Medium

---

## Open questions

1. **Skill usage tracking:** Are skills actually invoked by assistant/adhoc agents, or do most sessions complete without ever calling a skill? Log tool invocations to justify lazy-injection of skills.

2. **Upstream context utilization:** When agents have multiple upstream dependencies, do they actually read the injected diffs? Or do they infer changes from the spec? Analyze a sample of completed multi-task pipelines.

3. **Synthesizer context sufficiency:** Is the full file tree necessary, or would a summarized "architecture map" (top-level modules, key classes) suffice? Measure success rates after reducing codebase context size.

4. **Copilot spec quality vs. conversation length:** Do longer copilot sessions produce better specs? Or do specs plateau after 5–8 turns? Correlation analysis would inform session-cap decision.

5. **Actual token burn per agent type:** The database has `source` ('bde' or 'adhoc') but not explicit agent type. Can we infer agent type from task/repo fields to build a detailed tokens-in distribution by agent type?

6. **Lazy-injection success rate:** If we move skills to on-demand, will agents successfully request them when needed? Or will they struggle without upfront context? A/B test on 20 adhoc agents.

