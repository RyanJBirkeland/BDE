# Composition Architecture Audit: Prompt Pipeline System
**Date:** 2026-04-13  
**Scope:** SRP, abstraction cohesion, Clean Architecture adherence in prompt-composer, prompt builders, and agent-system modules

---

## F-t2-comp-arch-1: Mixed Abstraction Levels in prompt-assistant.ts — Personality Selection Logic

**Severity:** High  
**Category:** Architecture / SRP  
**Location:** `prompt-assistant.ts:26`  
**Evidence:**
```typescript
export function buildAssistantPrompt(input: BuildPromptInput): string {
  const { taskContent, branch, playgroundEnabled, upstreamContext, crossRepoContract, repoName } =
    input

  let prompt = CODING_AGENT_PREAMBLE

  // Inject personality (assistant or adhoc)
  const personality = input.agentType === 'assistant' ? assistantPersonality : adhocPersonality
  prompt += buildPersonalitySection(personality)
```

**Impact:** This builder does two unrelated things at different abstraction levels:
1. **Domain logic:** Decides which personality to use based on agentType (a business rule)
2. **Formatting logic:** Builds the personality section string (a pure formatting concern)

The agentType dispatch is a higher-level concern that belongs in `prompt-composer.ts` (the dispatcher), but it leaks down into the builder itself. This violates the Stepdown Rule—the caller (prompt-composer) should make the personality decision and pass the resolved personality object, not pass the raw agentType and force each builder to re-dispatch.

**Recommendation:** Move personality dispatch to `prompt-composer.ts`. Split `buildAssistantPrompt` into two versions with explicit signatures: `buildAssistantPrompt(personality: AgentPersonality, input: BuildPromptInput)` and `buildAdhocPrompt(personality: AgentPersonality, input: BuildPromptInput)`. Alternatively, create `selectPersonalityForType(agentType)` in agent-system/personality and have prompt-composer call it once, then pass the resolved personality to each builder.

**Effort:** M  
**Confidence:** High

---

## F-t2-comp-arch-2: Tangled Concerns in prompt-sections.ts — Formatting + Domain Truncation Rules

**Severity:** High  
**Category:** Architecture / SRP  
**Location:** `prompt-sections.ts:160–178` (buildScratchpadSection)  
**Evidence:**
```typescript
export function buildScratchpadSection(taskId: string): string {
  const scratchpadPath = join(BDE_TASK_MEMORY_DIR, taskId)  // File system path construction
  return `\n\n## Task Scratchpad
...
You have a persistent scratchpad at: \`${scratchpadPath}/\`
...`
```

**Impact:** This pure formatting function imports `{ join } from 'node:path'` and uses `BDE_TASK_MEMORY_DIR` constant to compute a file system path. This is an abstraction leak—file system layout logic (a domain concern) bleeds into prompt text generation (a presentation concern). If the scratchpad path convention changes, this function must change, even though its semantic purpose is only to format a prompt section.

Better practice: Have the caller (prompt-pipeline or run-agent) compute the scratchpadPath and pass it as a string parameter. The builder should be pure text formatting.

**Recommendation:** Remove `join` import and `BDE_TASK_MEMORY_DIR` reference. Change signature to `buildScratchpadSection(taskId: string, scratchpadPath: string): string`. Let the caller compute and inject the path. This makes the builder testable in isolation and pure.

**Effort:** S  
**Confidence:** High

---

## F-t2-comp-arch-3: Inline Prompt Construction vs. Function Builders — Inconsistent Abstraction Layers

**Severity:** Medium  
**Category:** Architecture / SRP  
**Location:** `prompt-pipeline.ts:104–213`  
**Evidence:**
```typescript
export function buildPipelinePrompt(input: BuildPromptInput): string {
  let prompt = CODING_AGENT_PREAMBLE
  prompt += buildPersonalitySection(pipelinePersonality)
  const memoryText = getAllMemory({ repoName: repoName ?? undefined })
  if (memoryText.trim()) {
    prompt += '\n\n## BDE Conventions\n'  // <-- Inline formatting
    prompt += memoryText
  }
  // ...
  prompt += '\n\n## Task Specification\n\n'  // <-- Inline section header
  prompt += 'Read this entire specification before writing any code. '
  prompt += 'Address every section — especially **Files to Change**, **How to Test**, ...'
  prompt += truncatedContent
  // ...
  prompt += `\n\n## Self-Review Checklist\n...`  // <-- More inline headers
```

**Impact:** The function mixes abstraction levels:
- **High level:** Compose memory, personality, context sections (what goes into a pipeline prompt)
- **Low level:** Inline string concatenation of boilerplate headers like `## BDE Conventions` and `## Task Specification`

Some sections (personality, upstream context) use builders (`buildPersonalitySection`, `buildUpstreamContextSection`). Others (BDE Conventions header, Task Specification preamble, Self-Review Checklist) are inlined raw strings with newline management (`'\n\n## ...'`). This mixing makes the function harder to reason about—you can't tell at a glance which strings are reusable builders vs. one-off formatting.

**Recommendation:** Extract all inline prompt sections (BDE Conventions header, Task Specification intro, Self-Review Checklist, Self-Limits, Idle Timeout Warning, Definition of Done) into named builder functions in `prompt-sections.ts`. Examples:
- `buildBdeConventionsHeader(memoryText: string): string`
- `buildTaskSpecificationSection(taskContent: string, maxChars: number): string`
- `buildSelfReviewChecklist(): string`

This makes `buildPipelinePrompt` read like a high-level composition and makes reuse/testing easier.

**Effort:** M  
**Confidence:** High

---

## F-t2-comp-arch-4: Specification Truncation Logic Scattered Across Layers

**Severity:** Medium  
**Category:** Architecture / SRP  
**Location:** `prompt-pipeline.ts:167–173`, `prompt-sections.ts:90–95`, `prompt-sections.ts:112–120`  
**Evidence:**
```typescript
// In prompt-pipeline.ts:
const MAX_TASK_CONTENT_CHARS = 8000
const truncatedContent = truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)
const wasTruncated = taskContent.length > MAX_TASK_CONTENT_CHARS
prompt += truncatedContent
if (wasTruncated) {
  prompt += `\n\n[spec truncated at ${MAX_TASK_CONTENT_CHARS} chars — see full spec in task DB]`
}

// In prompt-sections.ts buildUpstreamContextSection():
const cappedSpec = truncateSpec(upstream.spec, 2000)
const MAX_DIFF_CHARS = 2000
const truncated = upstream.partial_diff.length > MAX_DIFF_CHARS
```

**Impact:** Truncation decisions (max 8000 chars for task spec, max 2000 for upstream spec, max 2000 for diffs) are **hard-coded in multiple locations** without a single source of truth. If a truncation limit needs to change (e.g., extend task specs to 10000 chars), you must find and update all three places. This violates DRY and creates maintenance risk.

**Recommendation:** Create a `prompt-constants.ts` or extend `prompt-sections.ts` with an exported object:
```typescript
export const PROMPT_TRUNCATION_LIMITS = {
  TASK_SPEC_CHARS: 8000,
  UPSTREAM_SPEC_CHARS: 2000,
  UPSTREAM_DIFF_CHARS: 2000
}
```
Then use these in both `prompt-pipeline.ts` and `prompt-sections.ts`. Better yet, create dedicated builders:
- `buildTaskSpecificationSection(taskContent, limit)` that internally uses the constant
- `buildUpstreamSpecSection(upstreamSpec, limit)` that internally uses the constant

This centralizes the logic and makes limits reviewable in one place.

**Effort:** S  
**Confidence:** High

---

## F-t2-comp-arch-5: Reviewer Prompt Builders as "And" Function — Two Modes in One Export

**Severity:** Medium  
**Category:** Architecture / SRP  
**Location:** `prompt-composer-reviewer.ts:109–112`  
**Evidence:**
```typescript
export function buildReviewerPrompt(input: BuildPromptInput): string {
  if (input.reviewerMode === 'chat') return buildReviewerChatPrompt(input)
  return buildReviewerReviewPrompt(input)
}
```

**Impact:** This is a classic "and" function: it does two unrelated things depending on a flag. The function reads as "build reviewer prompt AND switch on mode," but those are orthogonal concerns:
1. **Review mode:** Structured JSON output for a one-shot analysis
2. **Chat mode:** Conversational markdown output with tool access

Each mode:
- Has different preambles and role frames
- Expects different output formats (JSON vs. markdown)
- Has different tool requirements (review is read-only JSON output; chat has Read/Grep/Glob)
- Uses different instruction sets

A caller reading the code sees one export `buildReviewerPrompt` and doesn't know it bifurcates internally. If you want to use chat mode, the API doesn't make it obvious—you pass `reviewerMode: 'chat'` in a generic field.

**Recommendation:** Export both builders directly:
```typescript
export function buildReviewerReviewPrompt(input: BuildPromptInput): string { ... }
export function buildReviewerChatPrompt(input: BuildPromptInput): string { ... }
```

Then in `prompt-composer.ts`, dispatch explicitly:
```typescript
case 'reviewer':
  if (input.reviewerMode === 'chat') {
    prompt = buildReviewerChatPrompt(input)
  } else {
    prompt = buildReviewerReviewPrompt(input)
  }
  break
```

This makes the two modes explicit in the caller and follows the pattern of other agent-type dispatches. (Note: this moves the dispatch responsibility one layer up, which is appropriate since the dispatch itself is about agent-type selection, not about composing a single prompt.)

**Effort:** S  
**Confidence:** High

---

## F-t2-comp-arch-6: `prompt-sections.ts` — Storage/Presentation Concern Mixing

**Severity:** Medium  
**Category:** Architecture / SRP  
**Location:** `prompt-sections.ts:65–84` (buildPersonalitySection)  
**Evidence:**
```typescript
interface Personality {
  voice: string
  roleFrame: string
  constraints: string[]
  patterns?: string[]
}

export function buildPersonalitySection(personality: Personality): string {
  let section = '\n\n## Voice\n' + personality.voice
  section += '\n\n## Your Role\n' + personality.roleFrame
  section += '\n\n## Constraints\n' + personality.constraints.map((c) => `- ${c}`).join('\n')
  if (personality.patterns && personality.patterns.length > 0) {
    section += '\n\n## Behavioral Patterns\n' + personality.patterns.map((p) => `- ${p}`).join('\n')
  }
  return section
}
```

**Impact:** This formatter defines its own `Personality` interface (local to prompt-sections.ts) instead of importing the canonical `AgentPersonality` from `agent-system/personality/types.ts`. This creates two sources of truth:
- Storage schema: `AgentPersonality` in personality/types.ts
- Presentation layer: local `Personality` interface in prompt-sections.ts

They happen to have the same shape, but there's no guarantee they'll stay in sync. If someone adds a field to `AgentPersonality`, this local interface won't change automatically.

**Recommendation:** Remove the local `Personality` interface and import `AgentPersonality`:
```typescript
import type { AgentPersonality } from '../agent-system/personality/types'

export function buildPersonalitySection(personality: AgentPersonality): string { ... }
```

This ties the formatter directly to the domain model and ensures they can never diverge.

**Effort:** S  
**Confidence:** High

---

## F-t2-comp-arch-7: Task Classification Logic Tightly Coupled to Pipeline Prompt

**Severity:** Low  
**Category:** Architecture / SRP  
**Location:** `prompt-pipeline.ts:31–56` (classifyTask, TASK_CLASS_CAP)  
**Evidence:**
```typescript
export type TaskClass = 'fix' | 'refactor' | 'doc' | 'audit' | 'generate'

export function classifyTask(taskContent: string): TaskClass { ... }

const TASK_CLASS_CAP: Record<TaskClass, number> = {
  fix: 4_000,
  refactor: 4_000,
  doc: 2_000,
  audit: 2_000,
  generate: 8_000
}

function buildOutputCapHint(taskClass: TaskClass): string { ... }
```

**Impact:** Task classification and output token budgeting are **domain concerns** that live in `prompt-pipeline.ts` but are **only used by that one builder**. They don't belong in a prompt-composition file; they belong in a task-classification module in the domain layer (perhaps `agent-system/task-classification`). This makes the concern-level of prompt-pipeline.ts ambiguous—is it about prompt composition or task semantics?

Currently, if another agent type needs task classification (e.g., a future "supervisor" agent that routes tasks by class), it has to import from `prompt-pipeline.ts`, which is semantically odd.

**Recommendation:** Extract to a new module `src/main/agent-system/task-classification/index.ts`:
```typescript
export type TaskClass = 'fix' | 'refactor' | 'doc' | 'audit' | 'generate'
export function classifyTask(taskContent: string): TaskClass { ... }
export const TASK_CLASS_CAP: Record<TaskClass, number> = { ... }
```

Then import and re-export from `prompt-pipeline.ts` if needed (for backward compatibility), or update the call site to import directly. This makes the domain logic discoverable and reusable.

**Effort:** M  
**Confidence:** Medium

---

## F-t2-comp-arch-8: `buildAgentPrompt()` Type Safety — Missing Exhaustiveness Check

**Severity:** Low  
**Category:** Architecture / SRP  
**Location:** `prompt-composer.ts:41–73`  
**Evidence:**
```typescript
export function buildAgentPrompt(input: BuildPromptInput): string {
  const { agentType } = input

  let prompt: string
  switch (agentType) {
    case 'pipeline':
      prompt = buildPipelinePrompt(input)
      break
    case 'assistant':
    case 'adhoc':
      prompt = buildAssistantPrompt(input)
      break
    case 'copilot':
      prompt = buildCopilotPrompt(input)
      break
    case 'synthesizer':
      prompt = buildSynthesizerPrompt(input)
      break
    case 'reviewer':
      prompt = buildReviewerPrompt(input)
      break
  }

  if (prompt.length < MIN_PROMPT_LENGTH) {
    throw new Error(
      `[prompt-composer] Assembled prompt is too short (${prompt.length} chars) — check agent type '${agentType}' configuration`
    )
  }
```

**Impact:** The variable `prompt` is declared but **not initialized** (`let prompt: string`). If the switch misses a case (e.g., a new agent type is added to `AgentType` but the switch isn't updated), `prompt` will be `undefined` and `prompt.length` will throw at runtime. TypeScript in strict mode doesn't catch this pattern because the variable is declared (just not initialized).

This is a latent bug. Adding `// @ts-expect-error` or a `default: throw new Error(...)` would catch it at compile-time.

**Recommendation:** Add an explicit exhaustiveness check:
```typescript
switch (agentType) {
  case 'pipeline': prompt = buildPipelinePrompt(input); break
  case 'assistant':
  case 'adhoc': prompt = buildAssistantPrompt(input); break
  case 'copilot': prompt = buildCopilotPrompt(input); break
  case 'synthesizer': prompt = buildSynthesizerPrompt(input); break
  case 'reviewer': prompt = buildReviewerPrompt(input); break
  default: {
    const _exhaustive: never = agentType
    throw new Error(`Unknown agent type: ${_exhaustive}`)
  }
}
```

Or initialize prompt inside each case. This guarantees a compile-time error if an agent type is added without a handler.

**Effort:** S  
**Confidence:** High

---

## Summary

**Total Findings:** 8  
**Critical:** 1 (F-t2-comp-arch-1)  
**High:** 2 (F-t2-comp-arch-2, F-t2-comp-arch-3)  
**Medium:** 4 (F-t2-comp-arch-4, F-t2-comp-arch-5, F-t2-comp-arch-6, F-t2-comp-arch-7)  
**Low:** 1 (F-t2-comp-arch-8)

### Key Architectural Issues

1. **Personality selection logic leaks from dispatcher into builder** (F-t2-comp-arch-1): Violates Stepdown Rule. Move dispatch to prompt-composer.
2. **File system path logic in pure prompt formatter** (F-t2-comp-arch-2): Abstraction leak. Pass scratchpadPath as parameter.
3. **Mixed abstraction levels in buildPipelinePrompt** (F-t2-comp-arch-3): Inline strings vs. builders inconsistently. Extract all inline sections into named builders.
4. **Truncation limits hard-coded in multiple places** (F-t2-comp-arch-4): Violates DRY. Centralize in constants or dedicated builders.
5. **Reviewer prompt builder is a classic "and" function** (F-t2-comp-arch-5): Exports single function that bifurcates on mode. Export both builders separately.
6. **Local Personality type duplicates AgentPersonality** (F-t2-comp-arch-6): Two sources of truth. Import canonical type from agent-system.
7. **Task classification logic buried in prompt-pipeline** (F-t2-comp-arch-7): Domain concern misplaced. Extract to agent-system/task-classification.
8. **Missing exhaustiveness check in switch** (F-t2-comp-arch-8): Runtime-safe but not compile-safe. Add default: never clause.

### Positive Observations

- **Clean separation of agent types:** Each agent type (pipeline, assistant, copilot, synthesizer, reviewer) has its own builder. This is good.
- **Shared section builders:** `buildPersonalitySection`, `buildUpstreamContextSection`, `buildBranchAppendix` avoid duplication. 
- **No files > 500 LOC (except tests):** All prompt builders are lean and focused.
- **Clear dispatcher pattern:** `prompt-composer.ts` is thin and readable.
- **agent-system modules are well-separated:** personality, memory, and skills are cleanly partitioned.

### Most Impactful Fixes (Effort/Value)

1. **F-t2-comp-arch-4 (S effort):** Centralize truncation limits → eliminates maintenance risk
2. **F-t2-comp-arch-2 (S effort):** Remove file-system logic from buildScratchpadSection → enables pure testing
3. **F-t2-comp-arch-8 (S effort):** Add exhaustiveness check → prevents latent runtime bug
4. **F-t2-comp-arch-5 (S effort):** Export reviewer builders separately → makes API clearer
5. **F-t2-comp-arch-1 (M effort):** Move personality dispatch → restores Stepdown Rule

