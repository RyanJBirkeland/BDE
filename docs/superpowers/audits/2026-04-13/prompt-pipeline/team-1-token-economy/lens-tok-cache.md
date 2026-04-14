# Prompt Caching Audit: BDE Agent SDK Pipeline
**Date:** 2026-04-13  
**Scope:** Prompt composition, multi-turn history, cache control, repeated content analysis  
**Severity Distribution:** 3 Critical, 2 High, 3 Medium

---

## F-t1-tok-cache-1: No prompt_cache_control Markers in Any Agent Type
**Severity:** Critical  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/sdk-adapter.ts:128-142`, `src/main/sdk-streaming.ts:80-99`, `src/main/agent-manager/prompt-*.ts` (all builders)  
**Evidence:**
```typescript
// sdk-adapter.ts:128-142 (spawnViaSdk)
const queryResult = sdk.query({
  prompt: opts.prompt,  // Single flat string, no cache_control markers
  options: {
    model: opts.model,
    cwd: opts.cwd,
    settingSources: ['user', 'project', 'local'],
    canUseTool: async () => ({ behavior: 'allow' as const })
  }
})

// sdk-streaming.ts:80-99 (runSdkStreaming)
const queryHandle = sdk.query({
  prompt,  // No cache_control breakpoints
  options: { ... settingSources: options.settingSources ?? ['user', 'project', 'local'] }
})
```
The prompt is built as a single concatenated string with no cache_control boundaries. When the same personality, memory, or skill sections are injected on subsequent turns (especially in interactive agents like copilot), the full context re-sends without any caching strategy.

**Impact:**
- **Repeated sections re-transmitted:** Personality (50-200 tokens), BDE memory (300-500 tokens when in BDE repo), user memory (variable, often 500-2000 tokens), and playground instructions (100+ tokens) are sent on every turn of copilot chats and every retry of pipeline agents
- **Estimated waste per copilot chat:** 3-10 turns × (500+ repeated tokens) = 1.5K–5K wasted input tokens per user interaction
- **No leveraging of Claude API v1.5's 5M-context-window capability:** Prompt caching could save 50%+ of repeated prompt cost on multi-turn interactions

**Recommendation:**
1. Refactor prompt builders to return a `{ cached: string[]; dynamic: string }` structure, or
2. Use Anthropic SDK's native cache_control support (if available in claude-agent-sdk v1.x) to mark stable sections (preamble, personality, static memory) with `type: 'ephemeral'` or persistent cache breakpoints
3. For pipeline agents, mark CLAUDE.md/memory sections as cacheable since they change infrequently across retries
4. For copilot/interactive agents, cache personality + user memory sections across turns since those rarely change within a 10-turn session

**Effort:** L (requires prompt builder refactor + SDK integration testing)  
**Confidence:** High

---

## F-t1-tok-cache-2: settingSources=['user','project','local'] Forces CLAUDE.md Re-Read Every Spawn
**Severity:** Critical  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/sdk-adapter.ts:137`, `src/main/sdk-streaming.ts:89`, `src/main/handlers/workbench.ts:80`, `src/main/adhoc-agent.ts:142`  
**Evidence:**
```typescript
// sdk-adapter.ts:137 (pipeline agents)
settingSources: ['user', 'project', 'local'],

// sdk-streaming.ts:89 (copilot/synthesizer fallback)
settingSources: options.settingSources ?? ['user', 'project', 'local'],

// handlers/workbench.ts:80 (copilot chat via getCopilotSdkOptions)
settingSources: [],  // ← Good! Only copilot explicitly disables this
```
Pipeline agents (`sdk-adapter.ts`), adhoc agents (`adhoc-agent.ts:142`), and generic SDK streaming (`sdk-streaming.ts`) **all** pass `settingSources: ['user', 'project', 'local']` to the SDK. This tells Claude Code to load and parse the `CLAUDE.md` project file on **every single spawn or turn**.

The SDK then injects the parsed settings as system context in the prompt. If CLAUDE.md is 1–2KB, this is 200–500 tokens re-sent per spawn. Critically, **this is not cacheable** because settingSources is resolved dynamically by the SDK *inside* the query() call — the BDE code never sees the resolved content.

**Impact:**
- **Pipeline agent spawns:** 8 agents/hour × 4 retries average = 32 re-reads/hour of CLAUDE.md (if 200 tokens each = 6,400 tokens/hour wasted on settings re-parsing alone)
- **Copilot chats:** Up to 8 turns × 5+ concurrent copilot chat sessions = high thrashing if CLAUDE.md is loaded on every turn (mitigated: copilot explicitly uses `settingSources: []`)
- **Cache miss amplification:** Even if prompt_cache_control were added, settingSources breaks cache hits because SDK re-reads CLAUDE.md fresh on every call, invalidating the cached content upstream

**Recommendation:**
1. **Pipeline agents:** Pass `settingSources: []` (or `settingSources: ['user']` if user-level hooks are needed). Inject CLAUDE.md content **in BDE's prompt composer** (where it can be cached), not via SDK
2. **Adhoc agents:** Same as pipeline — read CLAUDE.md in prompt builder, cache it, pass empty settingSources
3. **Spec-drafting agents (copilot/synthesizer):** Already correct — `settingSources: []`
4. If SDK-level settings are needed, cache them by detecting mtime changes (similar to user-memory caching) and only re-send when CLAUDE.md actually changes

**Effort:** M (extract CLAUDE.md reading to prompt composers, test SDK behavior change)  
**Confidence:** High

---

## F-t1-tok-cache-3: Memory Loaded Unconditionally on Every Turn, Even When Unchanged
**Severity:** High  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:110-121`, `src/main/agent-manager/prompt-assistant.ts:30-41`, `src/main/agent-system/memory/user-memory.ts:35-85`  
**Evidence:**
```typescript
// prompt-pipeline.ts:110-121 (called on every spawn/retry)
const memoryText = getAllMemory({ repoName: repoName ?? undefined })
if (memoryText.trim()) {
  prompt += '\n\n## BDE Conventions\n'
  prompt += memoryText
}

const userMem = taskContent ? selectUserMemory(taskContent) : getUserMemory()
if (userMem.fileCount > 0) {
  prompt += '\n\n## User Knowledge\n'
  prompt += userMem.content  // ← Added to prompt string
}

// user-memory.ts:35-85 (getUserMemory called per turn)
export function getUserMemory(): UserMemoryResult {
  const activeFiles = getSettingJson<Record<string, boolean>>(SETTING_KEY)
  // ... readFileSync on each active file
  // Per-file mtime cache helps avoid re-reading, but content is ALWAYS re-injected into prompt
}
```

**mtime-based caching exists** (user-memory.ts:11–16), but it only avoids **filesystem reads**. The memory content is still concatenated into the prompt string on every turn, and the full string is resent to the API without cache markers. 

For a pipeline agent that retries 3 times, or a copilot chat with 8 turns:
- BDE memory (IPC conventions, testing patterns, architecture rules) ~350 tokens: sent 3–8 times
- User memory (if active) ~500–1000 tokens: sent 3–8 times

**Impact:**
- **Estimated waste per pipeline retry:** 350 × (retries - 1) = 700+ tokens wasted on IPC/testing/arch rules
- **Estimated waste per copilot chat:** 500–1500 × 8 turns = 4K–12K tokens if user memory is active
- **Opportunity lost:** mtime-based dedup prevents filesystem thrashing but doesn't prevent API re-sends

**Recommendation:**
1. Add a **prompt content hash** to the agent run record. If hash matches the prior attempt, omit the stable memory sections on retry and send a note: `[Memory sections unchanged from prior attempt — see turn 1]`
2. For copilot, track memory hash across turns; only inject memory on turn 1, then reference it with cache_control on later turns
3. Consider a session-level memory cache (keyed by repoName + hash of active memory files) so concurrent agents reuse the same memory block
4. If claude-agent-sdk v2+ supports ephemeral cache_control, mark all memory sections with it

**Effort:** M (hash computation, session cache, turn-tracking refactor)  
**Confidence:** High

---

## F-t1-tok-cache-4: Conversation History Re-Concatenated with Full Prior Turns on Every Copilot Message
**Severity:** High  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/prompt-copilot.ts:66–80`, `src/main/handlers/workbench.ts:132`, `src/main/services/copilot-service.ts:48–59`  
**Evidence:**
```typescript
// prompt-copilot.ts:66–80 (buildChatPrompt called on every turn)
if (messages) {
  const MAX_HISTORY_TURNS = 10
  const recentMessages =
    messages.length > MAX_HISTORY_TURNS
      ? messages.slice(messages.length - MAX_HISTORY_TURNS)
      : messages
  // ... then for EVERY message in recentMessages:
  for (const msg of recentMessages) {
    prompt += `**${msg.role}**: ${msg.content}\n\n`  // ← Entire history concatenated
  }
}

// handlers/workbench.ts:132
const prompt = buildChatPrompt(input.messages, input.formContext, repoPath)
// Called on every keystroke / message send
```

**The problem:** On turn N, the prompt includes all prior messages (up to 10 turns). On turn N+1, the prompt includes all turns 1 to N+1. This means:
- Turn 1: 0 prior turns
- Turn 2: 1 prior turn re-sent
- Turn 3: 2 prior turns re-sent
- Turn 10: 9 prior turns re-sent

If each message averages 200 tokens, by turn 10 the prompt has accumulated ~900 tokens of prior history that are re-sent. **This is a classic multi-turn accumulation problem with no trimming or caching mitigation.**

**Impact:**
- **Per copilot chat:** Sum(1..10) = 55 message re-sends for a 10-turn chat. If avg message = 200 tokens, that's 11K tokens of redundant history
- **Compounded by personality + memory:** Add another 800+ tokens of stable content re-sent on every turn = 18K+ wasted tokens per typical 10-turn copilot session
- **Cost per user:** 1–2 copilot chats/day × 18K tokens × $0.003/1K = ~$0.05–0.10/day per user (minor individually, significant at scale)

**Recommendation:**
1. **Use SDK's native multi-turn handling:** If claude-agent-sdk v1.5+ supports `messages` parameter (like the Anthropic SDK's conversations), pass messages as a list instead of concatenating them into the prompt
2. **If concatenation is required:** Only send the **last N turns** (e.g., 3–5) in the prompt text, and mark the prior turns as `cache_control: 'ephemeral'` if supported, or document that they are in the SDK's internal turn buffer (not re-sent)
3. **Trim to sliding window:** After turn 5, drop turns 1–2 from the prompt (keep them in the local history store, but don't re-concatenate them)
4. **Add a "context summary" turn:** Every 5 turns, add an assistant message that summarizes prior decisions, so the full history can be safely dropped

**Effort:** M (requires SDK message format change or sliding-window trim logic)  
**Confidence:** High

---

## F-t1-tok-cache-5: Upstream Context and Cross-Repo Contracts Sent Unchanged on Every Retry
**Severity:** Medium  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/run-agent.ts:271–296`, `src/main/agent-manager/prompt-pipeline.ts:176–182`, `src/main/agent-manager/prompt-sections.ts:101–126`  
**Evidence:**
```typescript
// run-agent.ts:271–296 (fetchUpstreamContext — called per spawn)
const upstreamContext = fetchUpstreamContext(task.depends_on, repo, logger)

// prompt-pipeline.ts:176–182
if (crossRepoContract && crossRepoContract.trim()) {
  prompt += '\n\n## Cross-Repo Contract\n\n'
  prompt += 'This task involves API contracts with other repositories. '
  prompt += 'Follow these contract specifications exactly:\n\n'
  prompt += crossRepoContract  // ← Fetched from task, concatenated into prompt
}

// prompt-sections.ts:101–126 (buildUpstreamContextSection)
for (const upstream of upstreamContext) {
  const cappedSpec = truncateSpec(upstream.spec, 2000)
  section += `### ${upstream.title}\n\n${cappedSpec}\n\n`
  // ... partial diffs also added
}
```

For a task with 3 upstream dependencies + a 1KB cross-repo contract:
- Upstream specs: ~500 tokens
- Partial diffs: ~300 tokens
- Cross-repo contract: ~200 tokens
- **Total per retry: ~1000 tokens**

On a 3-retry agent run, this content is identical but re-sent 3 times = **2000+ wasted tokens**.

**Impact:**
- **Multi-dependency chains:** A task depending on 5 prior tasks can easily accumulate 2–3KB of upstream context, which × 3 retries = 6KB wasted
- **Complex API contracts:** Large contract docs (e.g., gRPC/GraphQL schemas) easily hit 2–5KB, magnified by retries
- **Opportunity:** Upstream context is **never modified** during execution — it's a pure read-only reference. Prime candidate for caching

**Recommendation:**
1. Hash the upstream context (spec + diff + contract) and store it in the agent run record
2. On retry, only include a note: `[Upstream context unchanged — see turn 1 for full specs]`
3. If cache_control is available, mark upstream context section with `type: 'ephemeral'`
4. For copilot/interactive agents that may request upstream context in chat, cache it per session

**Effort:** S (hash + conditional include)  
**Confidence:** Medium

---

## F-t1-tok-cache-6: Task Specification Truncated, Then Entire Truncated Spec Sent on Every Retry
**Severity:** Medium  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:157–173`, `src/main/agent-manager/prompt-sections.ts:90–95`  
**Evidence:**
```typescript
// prompt-pipeline.ts:157–173 (called on every spawn/retry)
const MAX_TASK_CONTENT_CHARS = 8000
const truncatedContent = truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)
const wasTruncated = taskContent.length > MAX_TASK_CONTENT_CHARS
prompt += truncatedContent  // ← 8000 chars = ~2000 tokens per retry
if (wasTruncated) {
  prompt += `\n\n[spec truncated at ${MAX_TASK_CONTENT_CHARS} chars — see full spec in task DB]`
}
```

The spec is truncated to 8000 chars (2000 tokens) and concatenated into the prompt. On a 3-retry run, this is 6000 tokens of spec re-sent (albeit with a note that the full spec is in the DB).

**Impact:**
- **3-retry run:** 2000 × 3 = 6000 tokens wasted
- **Spec-heavy tasks:** Tasks with detailed file listings, code examples, or long test instructions easily hit the 8000-char limit and get truncated
- **No indication of what was truncated:** The truncation note doesn't tell the agent what was cut off, so important tail content (often "How to Test" or "Out of Scope") may be lost

**Recommendation:**
1. Store a hash of the task spec and only re-inject on retry if a flag is set (e.g., `retryCount > 0 && specHash matches prior`)
2. If spec was truncated, add a note: `[Spec was truncated — review full spec in task DB or request sections from prior attempt]`
3. Consider raising MAX_TASK_CONTENT_CHARS to 15000 (3750 tokens) to avoid truncating "How to Test" sections; pair with cache_control to offset cost

**Effort:** S (hash + conditional include + optional char limit increase)  
**Confidence:** Medium

---

## F-t1-tok-cache-7: Personality & Skills Always Injected as Text, Never Cached or Referenced
**Severity:** Medium  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/prompt-pipeline.ts:107`, `src/main/agent-manager/prompt-assistant.ts:26–27`, `src/main/agent-manager/prompt-composer.ts:76–84`  
**Evidence:**
```typescript
// prompt-pipeline.ts:107
prompt += buildPersonalitySection(pipelinePersonality)

// prompt-assistant.ts:26–27
const personality = input.agentType === 'assistant' ? assistantPersonality : adhocPersonality
prompt += buildPersonalitySection(personality)

// prompt-sections.ts:76–84 (buildPersonalitySection)
export function buildPersonalitySection(personality: Personality): string {
  let section = '\n\n## Voice\n' + personality.voice
  section += '\n\n## Your Role\n' + personality.roleFrame
  section += '\n\n## Constraints\n' + personality.constraints.map((c) => `- ${c}`).join('\n')
  // ... returns ~150–300 tokens
}
```

Each agent type has a fixed personality object (e.g., `pipelinePersonality`, `assistantPersonality`) that is **never modified** per-task. Yet it's re-formatted into a markdown string and concatenated on every spawn.

**Impact:**
- **150–300 tokens per spawn** (personality) + **100–200 tokens per spawn** (skills for assistant/adhoc in BDE repo) on every agent
- **8 agents/hour × 150 tokens = 1200 tokens/hour just on personality**
- **Opportunity:** These are the most static content in the entire prompt pipeline

**Recommendation:**
1. Pre-compute personality and skills sections to static strings (constants), not dynamic functions
2. If personality varies by agent type, create typed constants: `const PIPELINE_PERSONALITY_TEXT = '...'`, `const ASSISTANT_PERSONALITY_TEXT = '...'`
3. Concatenate pre-built strings instead of calling buildPersonalitySection every time
4. If personality is ever dynamic (which it isn't currently), cache it separately with mtime detection

**Effort:** S (move to constants, refactor concatenation)  
**Confidence:** Medium

---

## F-t1-tok-cache-8: Turn Tracker Correctly Observes Cache Metrics But No Cache Optimization Actions Taken
**Severity:** Low  
**Category:** Token Caching  
**Location:** `src/main/agent-manager/turn-tracker.ts:7–8, 32–35, 56–57`  
**Evidence:**
```typescript
// turn-tracker.ts (correctly instrumented)
private cacheTokensCreated = 0
private cacheTokensRead = 0

// In processMessage:
if (typeof usage.cache_creation_input_tokens === 'number')
  this.cacheTokensCreated += usage.cache_creation_input_tokens
if (typeof usage.cache_read_input_tokens === 'number')
  this.cacheTokensRead += usage.cache_read_input_tokens
```

**Positive finding:** Turn tracker already collects `cache_creation_input_tokens` and `cache_read_input_tokens` from API responses and persists them to the database (run-agent.ts:543–544). This is good instrumentation.

**But:** No cache_control markers are being **set** in the prompt, so `cache_creation_input_tokens` and `cache_read_input_tokens` will always be 0 (or near-zero). The metrics are ready to measure caching benefits, but no caching is happening yet.

**Impact:**
- **Misleading telemetry:** Agents report 0 cache reads even though they could benefit from caching
- **No feedback loop:** Operations can't see that caching was disabled, so there's no pressure to enable it

**Recommendation:**
1. Once cache_control is added to prompts (F-t1-tok-cache-1), monitor agent_runs.cacheRead to confirm caching is working
2. Add a dashboard metric: `(cacheRead / (inputTokens + cacheRead)) × 100` = cache hit ratio
3. Set a target: 30–50% of repeated agent runs should have 30–50% cache hit ratio
4. Quarterly review: if cache hit ratio is <20%, investigate whether prompt structure is preventing effective caching

**Effort:** S (no code changes; add observability/dashboards)  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Category | Tokens Wasted (Estimate) | Fix Effort |
|---------|----------|----------|------------------------|-----------|
| F-t1-tok-cache-1: No cache_control markers | Critical | Caching | 1.5K–5K per copilot chat | L |
| F-t1-tok-cache-2: settingSources re-reads CLAUDE.md | Critical | Caching | 200–500 per spawn | M |
| F-t1-tok-cache-3: Memory re-injected every turn | High | Caching | 700–2000 per retry/chat | M |
| F-t1-tok-cache-4: History re-concatenated on every turn | High | Caching | 4K–12K per 10-turn chat | M |
| F-t1-tok-cache-5: Upstream context unchanged but re-sent | Medium | Caching | 2K per 3-retry run | S |
| F-t1-tok-cache-6: Task spec truncated and resent | Medium | Caching | 6K per 3-retry run | S |
| F-t1-tok-cache-7: Personality/skills always injected | Medium | Caching | 1.2K per 8 agents/hour | S |
| F-t1-tok-cache-8: Cache metrics collected but unused | Low | Caching | — (no waste, just missed opportunity) | S |

---

## Quick Wins (Effort=S)

1. **Extract personality and skills to constants** (F-t1-tok-cache-7) — move string formatting out of critical path
2. **Hash upstream context and task spec; skip re-injection on retry** (F-t1-tok-cache-5, F-t1-tok-cache-6) — requires 3–5 lines of conditional logic
3. **Add observability for cache metrics** (F-t1-tok-cache-8) — no code change, just dashboard queries

---

## Medium-Effort Wins (Effort=M)

1. **Stop loading CLAUDE.md via settingSources; inject in prompt builder instead** (F-t1-tok-cache-2) — move CLAUDE.md reading to prompt composers where it can be cached
2. **Add memory hash tracking; skip re-injection on unchanged memory** (F-t1-tok-cache-3) — extend mtime cache to prompt level
3. **Trim conversation history to sliding window; use SDK's native multi-turn if available** (F-t1-tok-cache-4) — refactor copilot prompt builder

---

## Long-Term (Effort=L)

1. **Refactor prompt builders to mark stable sections with cache_control** (F-t1-tok-cache-1) — requires SDK integration and testing across all agent types

---

