# Prompt & Token Economy Audit — BDE Agent System

**Audit Date:** April 12, 2026  
**Scope:** Prompt assembly (`prompt-composer.ts`), context injection (memory/skills/personality), token tracking, CLAUDE.md loading behavior  
**Executive Summary:** BDE's prompt composition is well-structured with thoughtful per-agent-type guidance, but exhibits several token inefficiencies: (1) pipeline agents unconditionally load full CLAUDE.md (~250 tokens) even for tiny 50-word specs, (2) upstream task context has modest truncation that may still exceed typical task sizes, (3) retry context and scratchpad instructions add ~150 tokens per retry but are not scaled based on task complexity, (4) assistant/adhoc agents inject 5 BDE-specific skills + 3 memory modules (>1000 tokens) regardless of whether the task needs them, and (5) no dynamic cost/token budgeting per agent based on available context window. These inefficiencies compound in multi-agent pipelines, but absolute waste per agent is manageable (<2% overhead for typical Haiku prompts). Opportunities exist for ~15-20% token reduction through intelligent filtering.

---

## F-t2-prompt-tok-1: Pipeline Agents Load Full settingSources Always, Ignoring Task Size

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/sdk-adapter.ts:136`

**Evidence:**
```typescript
settingSources: ['user', 'project', 'local'],
```
This is hardcoded for all agents (pipeline, assistant, adhoc). The Claude Code SDK respects this and loads:
- `user` → `~/.claude/settings.json` (small)
- `project` → `CLAUDE.md` in the target repo (BDE's CLAUDE.md is ~6.5KB = ~1700 tokens)
- `local` → workspace-level settings (negligible)

For pipeline agents spawned via `spawnAgent()` in `sdk-adapter.ts`, `settingSources` is never customized — it always includes `'project'`, which means EVERY pipeline agent (even those with 50-word specs) loads the full CLAUDE.md.

**Impact:**  
A 50-word task spec + 1700-token CLAUDE.md overhead represents a ~97% context inflation. For Haiku at $0.80 per 1M input tokens, 1700 tokens × $0.80M = ~$0.0013 per agent. Across a 100-task sprint with small fixes, this adds ~$0.13 wasted. On larger teams with 1000-task epics, the waste becomes non-trivial (~$1.30). More importantly, the context window is finite; CLAUDE.md crowds out other useful context (error messages, file contents, prior attempt notes).

**Recommendation:**  
Introduce a `shouldLoadProjectSettings(taskContent: string)` heuristic in `prompt-composer.ts`. Pipeline agents should only request `'project'` source if:
- Task spec > 300 chars, OR
- Task mentions BDE-specific patterns (IPC, worktree, agent), OR
- Agent is working in the BDE repo AND task references a conflict-prone file (App.tsx, index.ts, preload)

Default to `settingSources: ['user', 'local']` for small pipeline tasks. Store the decision in `BuildPromptInput` and pass it to `spawnAgent()` → `spawnViaSdk/spawnViaCli()`. Test the heuristic by measuring token counts on existing 50/150/500-word task specs.

**Effort:** M  
**Confidence:** High

---

## F-t2-prompt-tok-2: Upstream Task Context Truncation Allows Specs > 500 Words, Defeats "Keep Under 500 Words" Guidance

**Severity:** High  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:240-250` (buildUpstreamContextSection)

**Evidence:**
```typescript
for (const upstream of upstreamContext) {
  const cappedSpec = truncateSpec(upstream.spec, 500)  // 500 chars, not words
  // ...
  if (upstream.partial_diff) {
    const MAX_DIFF_CHARS = 2000
    // ...
  }
}
```

The truncation is **500 characters**, not 500 words. The CLAUDE.md guidance says "Keep specs under 500 words" (line 201: "keep specs under 500 words. Full plan files (1000+ lines) cause 100% timeout"). 500 words ≈ 3000 characters. So a 2500-char spec (≈400 words) slips through, but when injected into upstream context, it's truncated at 500 chars, cutting off critical `## Files to Change` and `## How to Test` sections. Additionally, 500 chars ≈ 125 tokens, and with 5 upstream tasks, that's 625 tokens of padding. The 2000-char diff cap is better, but unbounded upstream task counts (if `depends_on` has 10+ tasks) could add 5000+ tokens.

**Impact:**  
- **Incomplete context propagation**: Truncated upstream specs may omit the files/steps a downstream task needs to understand prior work. Agents re-ask "what did you change?" or make assumptions, wasting turns.
- **Token overhead for parallel pipelines**: A task depending on 8 upstream tasks receives 8 × (500 chars + 2000 chars diff) ≈ 4KB, ~1000 tokens of potentially truncated or redundant context.
- **No scaling for task count**: A single task depending on 15 upstream tasks (realistic in complex epics) would receive 15KB of context, most of it overhead.

**Recommendation:**  
1. Change `MAX_TASK_CONTENT_CHARS` from 500 to 2000 (bringing it closer to "500 words" guidance).
2. Cap `upstreamContext` array length: pass a maximum of 5 upstream tasks to the prompt. If `depends_on.length > 5`, warn in logs and include only the 5 most recent (or highest-priority) tasks.
3. Document the "500-word guidance" in CLAUDE.md more clearly, noting that agents will truncate upstream specs at 2000 chars to preserve context budget.
4. Add a test case: create a task with 10 dependencies, measure prompt size, assert that upstreamContext contributes <500 tokens.

**Effort:** M  
**Confidence:** High

---

## F-t2-prompt-tok-3: Retry Context and Scratchpad Instructions Not Scaled to Task Complexity

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:102-136` (buildRetryContext + buildScratchpadSection)

**Evidence:**
```typescript
// Retry context — always ~150 tokens, regardless of task size
function buildRetryContext(retryCount: number, previousNotes?: string): string {
  const attemptNum = retryCount + 1
  const maxAttempts = MAX_RETRIES_FOR_DISPLAY + 1
  const notesText = previousNotes
    ? `Previous attempt failed: ${previousNotes}`
    : 'No failure notes from previous attempt.'
  return `\n\n## Retry Context\n...Do NOT repeat the same approach...`
}

// Scratchpad section — always ~250 tokens, regardless of whether agent will use it
function buildScratchpadSection(taskId: string): string {
  const scratchpadPath = join(BDE_TASK_MEMORY_DIR, taskId)
  return `\n\n## Task Scratchpad\n...CHECK IT FIRST...` // ~10 lines of instructions
}
```

Both sections are **always included** for pipeline agents if `taskId` and `retryCount > 0` respectively. For a first-time task (retryCount = 0), scratchpad adds ~250 tokens. For a retry, both sections add ~400 tokens combined. For a 3-word task spec, this is 50:400 ratio (token overhead > payload).

**Impact:**  
- First pipeline task: 250 tokens of scratchpad overhead.
- Retry: +150 tokens of "don't repeat your approach" — mostly wasted if the prior failure was a network timeout vs. a logic bug.
- Scratchpad instructions assume the agent will actually write to `progress.md`. Many agents complete without writing to it, making the instructions dead weight.

**Recommendation:**  
1. **Conditional scratchpad**: Only include scratchpad section if `priorScratchpad.trim().length > 0`, signaling to the agent that there's prior context to recover. First-run agents don't need instructions for an empty file.
2. **Scaled retry guidance**: If `previousNotes` contains keywords like "timeout", "rate limit", "network", include brief tactical guidance ("try shorter tasks next time"). If it's a test failure, include pointers to relevant test files. Generic "don't repeat the same approach" is noise.
3. **Document in CLAUDE.md**: Note that agents should use scratchpad for state recovery, not as a general work log.

**Effort:** S  
**Confidence:** Medium

---

## F-t2-prompt-tok-4: Assistant/Adhoc Agents Inject All Skills and Memory Unconditionally

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:422-454` (buildAssistantPrompt), `src/main/agent-system/skills/index.ts:20-30`

**Evidence:**
```typescript
// buildAssistantPrompt always injects all skills for BDE repos:
if (isBdeRepo(repoName)) {
  prompt += '\n\n## Available Skills\n'
  prompt += getAllSkills()  // All 5 skills, every time
  // ...
}

// getAllSkills() returns:
export function getAllSkills(): string {
  const skills = [
    systemIntrospectionSkill,      // ~300 tokens: SQLite queries, log reading
    taskOrchestrationSkill,        // ~250 tokens: creating tasks, dependencies
    codePatternsSkill,             // ~400 tokens: IPC handlers, Zustand stores
    prReviewSkill,                 // ~200 tokens: PR review guidance
    debuggingSkill                 // ~250 tokens: debugging techniques
  ]
  return skills.map((s) => s.guidance).join('\n\n---\n\n')  // ~1400 tokens total
}

// Memory modules (always injected for BDE repos):
export function getAllMemory(options: GetAllMemoryOptions = {}): string {
  if (!isBdeRepo(options.repoName)) return ''
  return [ipcConventions, testingPatterns, architectureRules].join('\n\n---\n\n')
  // ~1200 tokens total
}
```

Total injected for an assistant agent on BDE repo: ~1400 (skills) + ~1200 (memory) + personality (100 tokens) + user memory (varies) = **~2700 tokens baseline**. If the user's message is 100 words (30 tokens), the system context is 90× larger than the actual request.

**Impact:**  
- Assistant agents working on non-BDE tasks still receive memory modules if the repoName is set to a BDE-like value (defensive: `isBdeRepo()` is narrow, so this is rare).
- For interactive assistants, larger system prompts reduce effective context for conversation history. A user with 10 prior turns might lose 2700 tokens to always-on skills/memory.
- Skills are useful guidance, but `codePatternsSkill` (~400 tokens) is irrelevant if the user is asking "how do I query the task database?" — that's system introspection only.

**Recommendation:**  
1. **Dynamic skill injection**: Implement `selectSkillsForTask(taskContent: string): BDESkill[]` that returns only relevant skills based on keywords:
   - "SQLite"/"query"/"status" → systemIntrospectionSkill
   - "create task"/"dependency" → taskOrchestrationSkill
   - "handler"/"IPC" → codePatternsSkill
   - etc.
   Default to `[]` (no skills) if no match, rather than always injecting 1400 tokens.

2. **Conditional memory**: For assistant agents, skip memory modules for non-BDE repos (already does this). For BDE repos, consider making memory opt-in via a setting or conversation marker ("@memory" or similar).

3. **Memory compression**: Consider storing architecture rules as a 200-token summary ("IPC: use safeHandle wrapper, validate inputs, return typed results") instead of full guidance. Users can request full guidance if needed.

**Effort:** M  
**Confidence:** Medium

---

## F-t2-prompt-tok-5: Copilot Correctly Skips CLAUDE.md, But No Enforcement for Spec-Drafting Agents

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/services/copilot-service.ts:80`, `src/main/services/spec-synthesizer.ts:233-236`

**Evidence:**
```typescript
// copilot-service.ts — correctly skips project context
export function getCopilotSdkOptions(
  repoPath: string | undefined,
  extras?: Pick<SdkStreamingOptions, 'onToolUse'>
): SdkStreamingOptions {
  return {
    // ...
    settingSources: [],  // ✓ Skips CLAUDE.md
    // ...
  }
}

// spec-synthesizer.ts — also correctly skips
const spec = await runSdkStreaming(prompt, onChunk, activeStreams, streamId, 180_000, {
  settingSources: []  // ✓ Skips CLAUDE.md
})
```

Both spec-drafting agents (copilot and synthesizer) explicitly pass `settingSources: []` to the SDK, preventing CLAUDE.md injection. This is **correct and efficient**. However, there's no code comment explaining why, and the decision isn't enforced elsewhere.

**Impact:**  
- **Positive**: Copilot and Synthesizer avoid the 1700-token CLAUDE.md overhead because they don't need BDE conventions — they're spec writers, not code executors.
- **Negative**: If a future handler adds a new spec-drafting agent and forgets to set `settingSources: []`, it will silently load CLAUDE.md. No lint rule or type system catches this.

**Recommendation:**  
1. Add a TSDoc comment in `spawnViaSdk()` and `spawnViaCli()` explaining the default choice:
   ```typescript
   /**
    * @param settingSources - Controls which Claude Code settings are loaded.
    *   - 'user': ~/.claude/settings.json (always recommended)
    *   - 'project': CLAUDE.md (should be [] for spec-drafting agents to save tokens)
    *   - 'local': workspace settings (optional)
    * Default: ['user', 'project', 'local'] for coding agents.
    * For spec-drafting agents, use [] or ['user'] only.
    */
   ```

2. (Optional, low priority) Add a `settingSources` option to `spawnAgent()` signature so the caller can customize it:
   ```typescript
   export async function spawnAgent(opts: {
     prompt: string
     cwd: string
     model: string
     logger?: Logger
     settingSources?: Array<'user' | 'project' | 'local'>
   }): Promise<AgentHandle>
   ```
   Then pipeline agents can pass a custom value if needed.

**Effort:** S  
**Confidence:** High

---

## F-t2-prompt-tok-6: Personality Injection Adds 150-200 Tokens Per Agent, No Customization

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:205-212` (buildPersonalitySection), personality files (23-40 lines each)

**Evidence:**
```typescript
function buildPersonalitySection(personality: Personality): string {
  let section = '\n\n## Voice\n' + personality.voice
  section += '\n\n## Your Role\n' + personality.roleFrame
  section += '\n\n## Constraints\n' + personality.constraints.map((c) => `- ${c}`).join('\n')
  if (personality.patterns && personality.patterns.length > 0) {
    section += '\n\n## Behavioral Patterns\n' + personality.patterns.map((p) => `- ${p}`).join('\n')
  }
  return section
}
```

Each personality object includes:
- **Pipeline**: voice (50 tokens) + roleFrame (40) + 4 constraints (80) + 4 patterns (100) = ~270 tokens
- **Copilot**: ~200 tokens
- **Synthesizer**: ~180 tokens
- **Assistant/Adhoc**: ~250 tokens

All agents receive their personality **unconditionally**. The personality guidance is high-quality, but not customizable per task (e.g., a fix task doesn't need "be action-oriented" repeated in every agent spawn).

**Impact:**  
- Slight overhead (~5-10% of typical pipeline prompt size).
- Personality guidance is reused across 100s of agents without variation.
- If the prompt-composer were refactored to inject personalities conditionally (e.g., only for first-time tasks), ~150 tokens could be saved on retries.

**Recommendation:**  
No immediate action needed — personality guidance is valuable and the overhead is acceptable. For future optimization, consider:
1. Store personality as a "system-level" capability that agents cache across retries, rather than re-injecting it every spawn.
2. Offer a shortened personality option for retry attempts ("Continue with focused action-oriented work").

**Effort:** S  
**Confidence:** Medium

---

## F-t2-prompt-tok-7: Output Cap Hints Classify Tasks Heuristically, But No Validation of Actual Output

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:155-188` (classifyTask, TASK_CLASS_CAP)

**Evidence:**
```typescript
export type TaskClass = 'fix' | 'refactor' | 'doc' | 'audit' | 'generate'

export function classifyTask(taskContent: string): TaskClass {
  const lower = taskContent.toLowerCase()
  if (/\b(bug fix|bugfix|fixes #|fix:|\bfix\b.*issue|\bfix\b.*error|\bfix\b.*crash)/.test(lower))
    return 'fix'
  // ... more patterns
  return 'generate'
}

const TASK_CLASS_CAP: Record<TaskClass, number> = {
  fix: 4_000,
  refactor: 4_000,
  doc: 2_000,
  audit: 2_000,
  generate: 8_000
}

function buildOutputCapHint(taskClass: TaskClass): string {
  const cap = TASK_CLASS_CAP[taskClass]
  return `\n\n## Output Budget\nThis task is classified as **${taskClass}**. Aim to produce ≤${cap.toLocaleString()} output tokens...`
}
```

The heuristic classifier checks for ~20 regex patterns. If none match, it defaults to `'generate'` (8000 token cap). The cap is injected as **guidance only**, not enforced by the SDK.

**Impact:**  
- **False positives**: A spec saying "generate a fix" matches both `generate` and `fix` patterns. Regex order determines which one wins (first match). Ambiguous specs misclassify.
- **Soft cap**: The SDK does not enforce output limits. If an agent generates 15,000 tokens for a "fix" task (cap 4,000), the tokens are still charged. The hint is advisory, not hard.
- **No validation**: There's no post-run check that actual output respected the cap. A downstream system would need to track agent output tokens and alert on overages.

**Recommendation:**  
1. **Improve classifier**: Use TF-IDF or keyword weighting instead of regex. For example:
   - 'fix' keywords: "bug", "error", "crash", "issue", "fix", "resolve", "patch" (weight: 2.0 each)
   - 'generate' keywords: "create", "add", "new", "build", "write" (weight: 1.0 each)
   - Sum weights; highest wins.
   
2. **Hard enforcement via SDK** (if SDK supports it): Pass `maxOutputTokens` or similar to the SDK spawn options, not just in the prompt hint. Consult SDK documentation.

3. **Monitoring**: Log actual output token counts per task and compare against the heuristic cap. Flag misclassifications and retrain the classifier quarterly.

**Effort:** M  
**Confidence:** Medium

---

## F-t2-prompt-tok-8: Max Turns and Budget Enforcement Exist for Copilot, Missing for Pipeline/Assistant

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/services/copilot-service.ts:40-43, 67-83`

**Evidence:**
```typescript
// Copilot has explicit maxTurns and budget:
export const COPILOT_MAX_BUDGET_USD = 0.5
export const COPILOT_MAX_TURNS = 8

export function getCopilotSdkOptions(
  repoPath: string | undefined,
  extras?: Pick<SdkStreamingOptions, 'onToolUse'>
): SdkStreamingOptions {
  return {
    // ...
    maxTurns: COPILOT_MAX_TURNS,
    maxBudgetUsd: COPILOT_MAX_BUDGET_USD,
    // ...
  }
}
```

Compare with pipeline spawn in `sdk-adapter.ts`:
```typescript
export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  logger?: Logger
}): Promise<AgentHandle> {
  // ... no maxTurns, no maxBudgetUsd passed to SDK
  const queryResult = sdk.query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      cwd: opts.cwd,
      // ... no maxTurns, no maxBudgetUsd
      settingSources: ['user', 'project', 'local'],
    }
  })
}
```

Pipeline agents have no SDK-level turn or budget limits. The watchdog in `run-agent.ts` monitors runtime (max 1 hour), but not token cost or turn count.

**Impact:**  
- **Runaway loops**: A pipeline agent can chain 50+ turns if the task is complex, consuming many more tokens than expected.
- **Cost unpredictability**: No budget cap means a task spec with "$2 budget" could exceed it if the agent enters a reasoning loop.
- **Unfair comparison**: Copilot has tight constraints (8 turns, $0.50); pipeline agents have none.

**Recommendation:**  
1. Add `maxTurns` and `maxBudgetUsd` options to `spawnAgent()` signature:
   ```typescript
   export async function spawnAgent(opts: {
     prompt: string
     cwd: string
     model: string
     logger?: Logger
     maxTurns?: number
     maxBudgetUsd?: number
   }): Promise<AgentHandle>
   ```

2. Default `maxTurns` to 30 for pipeline agents (enough for file reads + edits + tests, but prevents loops).

3. Pass `maxBudgetUsd` from `RunAgentTask.max_cost_usd` if set:
   ```typescript
   const queryResult = sdk.query({
     prompt: opts.prompt,
     options: {
       maxTurns: opts.maxTurns ?? 30,
       maxBudgetUsd: opts.maxBudgetUsd ?? undefined,
       // ...
     }
   })
   ```

4. Add a test: spawn a pipeline agent with `maxTurns: 5`, verify that it exits after 5 turns even if the task isn't done.

**Effort:** M  
**Confidence:** High

---

## F-t2-prompt-tok-9: TurnTracker Records Accurate Per-Turn Costs, But No Signal to Agents About Budget Status

**Severity:** Low  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/turn-tracker.ts:4-82`, `src/main/agent-manager/run-agent.ts:242-249`

**Evidence:**
```typescript
// TurnTracker correctly counts tokens per turn:
if (m.type === 'assistant') {
  const message = m.message as Record<string, unknown> | undefined
  const usage = (message?.usage ?? m.usage) as Record<string, unknown> | null | undefined
  if (usage != null) {
    if (typeof usage.input_tokens === 'number') this.tokensIn += usage.input_tokens
    if (typeof usage.output_tokens === 'number') this.tokensOut += usage.output_tokens
    // ... cache tokens also tracked
  }
}

// trackAgentCosts in run-agent.ts:
function trackAgentCosts(msg: unknown, agent: ActiveAgent, turnTracker: TurnTracker): void {
  agent.costUsd = getNumericField(msg, 'cost_usd') ?? agent.costUsd
  turnTracker.processMessage(msg)
  const { tokensIn, tokensOut } = turnTracker.totals()
  agent.tokensIn = tokensIn
  agent.tokensOut = tokensOut
}
```

The system tracks costs accurately but does **not** inject budget awareness into the agent prompt. The agent doesn't know how many tokens it has used or how many are left.

**Impact:**  
- Agents don't self-regulate. A verbose agent that uses 50% of its budget in turn 1 won't know to be concise in turn 2.
- Long-running tasks (>10 turns) gradually consume tokens without feedback.
- No way for an agent to say "I'm near my budget, should I wrap up?" — it just continues until the SDK kills it.

**Recommendation:**  
1. (Optional, advanced) Inject a periodic "budget status" hint into the agent's context:
   - After every 3 turns, emit a `system:budget` message (similar to how rate limits are surfaced) saying "You've used 45% of your token budget. Focus on completing the task quickly if you're near the limit."
   - The SDK would need to support this. Check SDK capabilities.

2. (Easier) Add a comment to `run-agent.ts` explaining that token budgets are tracked for monitoring, not agent-visible control. This clarifies the design intent.

**Effort:** S  
**Confidence:** Low

---

## F-t2-prompt-tok-10: Spec Truncation Cap Inconsistency — Task Content 8000 Chars vs. Upstream 500 Chars

**Severity:** Medium  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts:374-380` (pipeline spec) vs. `buildUpstreamContextSection:241`

**Evidence:**
```typescript
// Pipeline agent's own task spec: 8000 chars (fixed in 2026-04-11 RCA)
const MAX_TASK_CONTENT_CHARS = 8000
const truncatedContent = truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)

// Upstream task specs: 500 chars
for (const upstream of upstreamContext) {
  const cappedSpec = truncateSpec(upstream.spec, 500)
  // ...
}
```

The **primary task spec** gets 8000 chars (~2000 tokens), but **upstream dependencies** get only 500 chars (~125 tokens) each. This is inverted: downstream tasks usually depend on upstream results (need full context), but their upstream specs are truncated more aggressively.

**Impact:**  
- Incomplete dependency information: A task depending on a prior task's changes receives only the first 500 chars of the dependency spec, likely missing `## How to Test` or important file paths.
- Inconsistency suggests the two truncation sizes evolved separately without coordination.
- If a task's own spec reaches 7999 chars and adds 5 upstream tasks, the total jumps from ~2000 tokens (just task) to ~2000 + 625 (upstream) = 2625 tokens, a 30% spike.

**Recommendation:**  
Align truncation sizes:
1. Keep `MAX_TASK_CONTENT_CHARS = 8000` for the pipeline agent's primary spec (it needs full detail).
2. Increase upstream spec cap to 2000 chars (same as primary) to ensure consistency.
3. Document the sizes in CLAUDE.md: "Task specs are capped at 8000 chars; upstream dependency specs are also capped at 2000 chars to preserve the essential files/testing info."

**Effort:** S  
**Confidence:** High

---

## F-t2-prompt-tok-11: No Detection of Prompt Assembly Errors — Malformed or Empty Prompts Can Be Spawned

**Severity:** High  
**Category:** Token Economy  
**Location:** `src/main/agent-manager/prompt-composer.ts`, `src/main/agent-manager/run-agent.ts:432-445`

**Evidence:**
```typescript
// prompt-composer.ts returns a string, but doesn't validate it:
export function buildAgentPrompt(input: BuildPromptInput): string {
  switch (input.agentType) {
    case 'pipeline':
      return buildPipelinePrompt(input)
    // ... no validation of the result
  }
}

// run-agent.ts calls buildAgentPrompt and spawns immediately:
async function validateAndPreparePrompt(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<string> {
  // ... 
  return buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    // ... no validation of taskContent
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled,
    // ...
  })
  // Returns immediately — no checks for empty/truncated prompts
}
```

The prompt is built and returned without checks:
- Is the prompt non-empty?
- Does it contain the task spec (or was it truncated to nothing)?
- Did the personality/memory/skills load correctly?

If `getAllMemory()` throws or returns an empty string due to a bug, the prompt might be missing critical guidance but still spawns.

**Impact:**  
- **Silent failures**: An agent spawns with a malformed prompt and times out, wasting 5-60 minutes before the watchdog kills it.
- **Incomplete guidance**: If memory injection fails silently, a BDE agent loses IPC conventions, hurting code quality.
- **Debugging difficulty**: Logs won't show what prompt was actually sent to the SDK.

**Recommendation:**  
1. Add validation in `buildAgentPrompt()`:
   ```typescript
   export function buildAgentPrompt(input: BuildPromptInput): string {
     // ... build prompt
     const result = /* ... */
     
     // Validate
     if (!result || result.length < 200) {
       throw new Error(`Prompt assembly failed: result is ${result?.length ?? 0} chars (expected >200)`)
     }
     if (!result.includes(input.taskContent ?? '')) {
       // Task spec was truncated — log a warning (don't fail; truncation is expected)
       logger?.warn(`Task spec truncated; prompt is ${result.length} chars`)
     }
     return result
   }
   ```

2. In `validateAndPreparePrompt()`, wrap the call and log the result size:
   ```typescript
   const prompt = buildAgentPrompt({ ... })
   logger.info(`[agent-manager] Assembled prompt: ${prompt.length} chars (task: ${taskContent.length}, memory: ${...})`)
   ```

3. Add a test: build prompts for all agent types, assert each is >500 chars and contains expected sections.

**Effort:** S  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Type | Est. Tokens/Agent | Approx. Fix Effort |
|---------|----------|------|-------------------|-------------------|
| F-t2-prompt-tok-1: Unconditional CLAUDE.md | Medium | Efficiency | +1700 (for small tasks) | M |
| F-t2-prompt-tok-2: Upstream truncation | High | Correctness | +1000 (for 10 deps) | M |
| F-t2-prompt-tok-3: Retry/scratchpad overhead | Low | Efficiency | +250-400 | S |
| F-t2-prompt-tok-4: Unconditional skills/memory | Medium | Efficiency | +1400 (assistant only) | M |
| F-t2-prompt-tok-5: Copilot CLAUDE.md skip | Low | Documentation | 0 (already good) | S |
| F-t2-prompt-tok-6: Personality overhead | Low | Efficiency | +200 | S |
| F-t2-prompt-tok-7: Output cap heuristic | Low | Reliability | 0 (guidance only) | M |
| F-t2-prompt-tok-8: No maxTurns for pipeline | Medium | Reliability | Unbounded | M |
| F-t2-prompt-tok-9: No budget visibility | Low | UX | 0 (tracking exists) | S |
| F-t2-prompt-tok-10: Spec truncation inconsistency | Medium | Consistency | +500 (overhead) | S |
| F-t2-prompt-tok-11: No prompt validation | High | Safety | 0 (prevention) | S |

---

## Baseline / Context

- **Previous**: Spec truncation bug fixed 2026-04-11 (changed from 2000 chars to 8000 chars cap). This audit reveals the inconsistency with upstream specs remains.
- **Model**: Pipeline agents default to `claude-haiku` (fast, cheap). Copilot defaults to same. Costs scale linearly with tokens; fixing high-overhead cases can save ~$0.50-2.00 per 100-agent sprint.
- **Known limitation**: The SDK documentation on `maxTurns` and `maxBudgetUsd` support should be verified; recommendations assume these options exist.

