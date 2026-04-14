# Lens: Naming & Clarity — Prompt Pipeline Audit

**Persona:** Naming & Clarity Reviewer  
**Scope:** Function names, variable names, comment-to-code ratio in the prompt pipeline. Standard: code reads like well-written prose. Comments explain *why*, not *what*.

---

## F-t2-naming-1: Misleading Variable Name `recentMessages`
**Severity:** Medium
**Category:** Naming / Clarity
**Location:** `src/main/agent-manager/prompt-copilot.ts:68-71`
**Evidence:**
```typescript
const MAX_HISTORY_TURNS = 10
const recentMessages =
  messages.length > MAX_HISTORY_TURNS
    ? messages.slice(messages.length - MAX_HISTORY_TURNS)
    : messages
```
**Impact:** `recentMessages` suggests it always contains the most recent messages, but the variable contains a slice that may or may not be truncated. The intent is to cap conversation history at 10 turns — the name doesn't communicate this cap.
**Recommendation:** Rename to `cappedConversationHistory` or `conversationHistoryWithCap` to clarify a max-length cap is applied.
**Effort:** S
**Confidence:** High

---

## F-t2-naming-2: Comments Explain *What* Not *Why* in prompt-pipeline.ts
**Severity:** Medium
**Category:** Clarity / Comment Ratio
**Location:** `src/main/agent-manager/prompt-pipeline.ts:63`
**Evidence:** Comment blocks above section-building function calls (e.g., `// Output budget hint`, `// Time limit section`) explain what the adjacent function call does. The function names `buildOutputCapHint()`, `buildTimeLimitSection()` already name their purpose.
**Impact:** Comments add noise without adding information. Violates the rule that comments explain *why*, not *what*.
**Recommendation:** Remove explanatory comments above section-building calls where the function name is self-documenting.
**Effort:** S
**Confidence:** Medium

---

## F-t2-naming-3: Duplicate `AgentType` Definition Across Two Files
**Severity:** Medium
**Category:** Naming / DRY
**Location:** `src/main/agent-manager/prompt-composer.ts:14` and `src/main/agent-system/personality/types.ts:11`
**Evidence:**
```typescript
// Both files define:
export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer' | 'reviewer'
```
**Impact:** Two identical type definitions can drift. Adding a new agent type requires updating both files; missing one causes a silent type gap. Also, `AgentType` is a generic name — in BDE context it specifically means "which prompt-builder variant".
**Recommendation:** Consolidate to a single definition in `agent-system/personality/types.ts` and import in `prompt-composer.ts`. Consider renaming to `BDEAgentType` or `PromptVariant` to signal domain specificity.
**Effort:** M
**Confidence:** High

---

## F-t2-naming-4: Magic Constant Rationale Buried in Inline Comment
**Severity:** Low
**Category:** Naming / Magic Numbers
**Location:** `src/main/agent-manager/prompt-pipeline.ts:167`
**Evidence:**
```typescript
const MAX_TASK_CONTENT_CHARS = 8000
// 8000 chars (~2000 words) covers the CLAUDE.md 'under 500 words' guideline...
const truncatedContent = truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)
```
**Impact:** The *why* for 8000 is explained in a floating inline comment that readers may miss. The constant declaration and its rationale are separated.
**Recommendation:** Move the rationale into a JSDoc comment directly above the constant declaration:
```typescript
/** 8000 chars (~2000 words) covers the CLAUDE.md "under 500 words" guideline with headroom. */
const MAX_TASK_CONTENT_CHARS = 8000
```
**Effort:** S
**Confidence:** High

---

## F-t2-naming-5: Boolean `playgroundEnabled` Has Ambiguous Tri-State Semantics
**Severity:** Medium
**Category:** Naming / Type Design
**Location:** `src/main/agent-manager/prompt-composer.ts:20` and multiple builders
**Evidence:**
```typescript
playgroundEnabled?: boolean  // optional boolean

// In prompt-assistant.ts:59
const effectivePlayground = playgroundEnabled ?? true  // default on for assistant/adhoc

// In prompt-pipeline.ts:136
if (playgroundEnabled) {  // default off for pipeline
```
**Impact:** `undefined`, `true`, and `false` map to three states but the property is typed as `boolean?`. Different agent types apply different defaults, making call sites confusing. Negation reads poorly.
**Recommendation:** Replace with explicit union type:
```typescript
playgroundMode?: 'enabled' | 'disabled' | 'default'
```
This makes agent-specific defaults explicit and removes the `?? true` / `?? false` scattered defaults.
**Effort:** M
**Confidence:** High

---

## F-t2-naming-6: `buildPersonalitySection()` Doesn't Signal It Produces Markdown
**Severity:** Low
**Category:** Naming
**Location:** `src/main/agent-manager/prompt-sections.ts:76`
**Evidence:**
```typescript
export function buildPersonalitySection(personality: Personality): string {
  let section = '\n\n## Voice\n' + personality.voice
  section += '\n\n## Your Role\n' + personality.roleFrame
  // ...
  return section  // returns a formatted markdown string
}
```
**Impact:** "Personality section" is ambiguous — could mean a section about personality traits or a formatted prompt block. The name doesn't signal it produces markdown with hardcoded headings.
**Recommendation:** Rename to `formatPersonalityAsPromptBlock()` or `buildPersonalityPromptSection()` to signal it is producing a formatted prompt string.
**Effort:** S
**Confidence:** Medium

---

## F-t2-naming-7: Inconsistent Truncation Helpers — `truncateSpec()` vs. Inline Logic
**Severity:** Low
**Category:** Naming / Consistency
**Location:** `src/main/agent-manager/prompt-sections.ts:112-120`
**Evidence:**
```typescript
const cappedSpec = truncateSpec(upstream.spec, 2000)   // uses helper

const truncated = upstream.partial_diff.length > MAX_DIFF_CHARS  // boolean
const cappedDiff = truncated
  ? upstream.partial_diff.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated]'
  : upstream.partial_diff
```
**Impact:** Two truncation operations in adjacent lines use inconsistent patterns. The boolean variable `truncated` sounds like the truncated content, not a predicate. A reader must parse the ternary to understand what `cappedDiff` is.
**Recommendation:** Extract a `truncateDiff(diff, maxChars)` helper matching `truncateSpec`. Rename the boolean to `exceedsDiffLimit`.
**Effort:** M
**Confidence:** High

---

## F-t2-naming-8: `buildReviewerPrompt()` Dispatches Two Orthogonal Behaviors
**Severity:** Medium
**Category:** Naming / Design Ambiguity
**Location:** `src/main/agent-manager/prompt-composer-reviewer.ts:25-112`
**Evidence:**
```typescript
function buildReviewerReviewPrompt(input: BuildPromptInput): string { ... }   // structured JSON output
function buildReviewerChatPrompt(input: BuildPromptInput): string { ... }     // conversational markdown

export function buildReviewerPrompt(input: BuildPromptInput): string {
  if (input.reviewerMode === 'chat') return buildReviewerChatPrompt(input)
  return buildReviewerReviewPrompt(input)
}
```
**Impact:** `buildReviewerReviewPrompt` is redundant ("reviewer review"). The public dispatcher hides two unrelated output formats behind one name. Callers must read source to know which format is returned.
**Recommendation:** Export both builders directly with clearer names: `buildStructuredReviewPrompt` and `buildInteractiveReviewPrompt`. Remove the wrapper dispatcher (or keep it with explicit documentation of the dual return format).
**Effort:** M
**Confidence:** High

---

## F-t2-naming-9: `SYNTHESIZER_SPEC_REQUIREMENTS` Sounds Like a Validation Schema
**Severity:** Medium
**Category:** Naming / Scope Ambiguity
**Location:** `src/main/agent-manager/prompt-synthesizer.ts:15-56`
**Evidence:**
```typescript
const SYNTHESIZER_SPEC_REQUIREMENTS = `
## Spec Quality Requirements
You MUST produce a spec with ALL four of the following sections...
`
```
**Impact:** "Requirements" sounds like a data structure used for validation. In reality this is a multi-paragraph prompt instruction block injected verbatim into the system prompt. Readers may expect this to be tested or enforced at runtime.
**Recommendation:** Rename to `SYNTHESIZER_SPEC_QUALITY_INSTRUCTIONS` or `SYNTHESIZER_OUTPUT_GUIDANCE_BLOCK` to signal it is a prompt fragment, not validation logic.
**Effort:** S
**Confidence:** High

---

## F-t2-naming-10: Local `Personality` Interface Shadows Exported `AgentPersonality`
**Severity:** Medium
**Category:** Naming / Consistency
**Location:** `src/main/agent-manager/prompt-sections.ts:65` vs. `src/main/agent-system/personality/types.ts:4`
**Evidence:**
```typescript
// prompt-sections.ts (private, local)
interface Personality {
  voice: string
  roleFrame: string
  constraints: string[]
  patterns?: string[]   // optional
}

// agent-system/personality/types.ts (exported)
export interface AgentPersonality {
  voice: string
  roleFrame: string
  constraints: string[]
  patterns: string[]    // required
}
```
**Impact:** Two nearly identical interfaces co-exist. They can diverge silently. The `patterns` field is optional in one and required in the other — a subtle difference that can cause runtime bugs when new personality objects are constructed.
**Recommendation:** Delete the local `Personality` interface. Import and use `AgentPersonality` from `agent-system/personality/types`. Standardize `patterns` field nullability across both.
**Effort:** M
**Confidence:** High
