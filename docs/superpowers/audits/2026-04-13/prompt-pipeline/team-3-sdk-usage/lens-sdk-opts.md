# Lens: SDK Options — Prompt Pipeline Audit

**Persona:** SDK Options Auditor  
**Scope:** Every SDK call site — `query()`, `stream()`, options objects, `settingSources`, `maxTurns`, `maxBudgetUsd`, `resume` semantics, model selection, tool configuration.

---

## F-t3-sdk-opts-1: Pipeline Agent Has No `maxTurns` (Unbounded Loops)
**Severity:** High
**Category:** SDK Configuration
**Location:** `src/main/agent-manager/sdk-adapter.ts:128-143`
**Evidence:**
```typescript
const queryResult = sdk.query({
  prompt: opts.prompt,
  options: {
    model: opts.model,
    cwd: opts.cwd,
    settingSources: ['user', 'project', 'local'],
    canUseTool: async () => ({ behavior: 'allow' as const })
    // no maxTurns
  }
})
```
**Impact:** No `maxTurns` means pipeline agents use the SDK default (unbounded or very high). An agent that loops on tool errors, reasoning failures, or test retry loops can consume arbitrary tokens. The watchdog provides a time ceiling but not a turn ceiling — a fast-looping agent can exhaust budget before the watchdog triggers.
**Recommendation:** Add `maxTurns: 20` (or derive from task type — complex refactors may warrant higher; simple fixes lower).
**Effort:** S
**Confidence:** High

---

## F-t3-sdk-opts-2: Pipeline Agent Loads Project Settings Despite Receiving Conventions via Prompt
**Severity:** Medium
**Category:** SDK Configuration
**Location:** `src/main/agent-manager/sdk-adapter.ts:137`
**Evidence:**
```typescript
settingSources: ['user', 'project', 'local'],
```
**Impact:** `'project'` causes the SDK to read and inject CLAUDE.md (5–10KB) on every spawn and retry. The pipeline agent's prompt is already built by `buildPipelinePrompt()` which injects BDE conventions explicitly. The two sources may conflict or double-inject guidance. Copilot and synthesizer correctly use `settingSources: []` with the explicit reasoning: "spec-drafting agents skip CLAUDE.md — they receive conventions via their prompt."
**Recommendation:** Change pipeline to `settingSources: ['user', 'local']` (keep user hooks, skip project-level CLAUDE.md re-parse). Verify `buildPipelinePrompt` covers all BDE conventions currently only in CLAUDE.md.
**Effort:** S
**Confidence:** Medium

---

## F-t3-sdk-opts-3: Inconsistent `settingSources` Across Agent Types
**Severity:** Medium
**Category:** SDK Configuration
**Location:** Multiple files:
- `sdk-adapter.ts:137` — pipeline: `['user', 'project', 'local']`
- `sdk-streaming.ts:89` — workbench/reviewer default: `['user', 'project', 'local']`
- `copilot-service.ts:80` — copilot: `[]` (correct, with explicit rationale)
- `spec-synthesizer.ts:234` — synthesizer: `[]` (correct)
- `adhoc-agent.ts:142` — adhoc: `['user', 'project', 'local']`
**Evidence:** Copilot and synthesizer both document their choice: "spec-drafting agents skip CLAUDE.md — they receive conventions via their prompt instead." Adhoc agents also draft specs interactively but load CLAUDE.md anyway.
**Impact:** Inconsistency means there is no intentional policy — each module made its own choice. Adhoc agents load CLAUDE.md unnecessarily (~5–10KB extra per spawn). The reviewer loads it despite being an opinion agent that does not execute code.
**Recommendation:** Establish and document a policy:
- Pipeline (autonomous execution): `['user', 'local']`
- Adhoc/assistant (interactive spec drafting): `[]`
- Copilot/synthesizer (spec generation): `[]` (already correct)
- Reviewer (opinion, no code execution): `[]`
**Effort:** M
**Confidence:** High

---

## F-t3-sdk-opts-4: Pipeline Agent Has No `maxBudgetUsd` (Unbounded Cost)
**Severity:** High
**Category:** SDK Configuration
**Location:** `src/main/agent-manager/sdk-adapter.ts:128-143`
**Evidence:**
```typescript
const queryResult = sdk.query({
  prompt: opts.prompt,
  options: {
    // ... no maxBudgetUsd
    canUseTool: async () => ({ behavior: 'allow' as const })
  }
})
```
**Impact:** Pipeline agents run unattended with all tools permitted. No per-query cost ceiling exists at the SDK level. Copilot has `maxBudgetUsd: 0.5` (interactive, user-present). Pipeline agents — autonomous, background, no user oversight — lack even this basic protection. A looping agent on a complex task can spend $10–$50 before the watchdog's time ceiling triggers.
**Recommendation:** Add `maxBudgetUsd: 2.0` as a default, optionally overridable by a `task.max_cost_usd` field. This ensures the SDK stops the agent before catastrophic cost, independent of the watchdog.
**Effort:** M
**Confidence:** High

---

## F-t3-sdk-opts-5: Reviewer Uses Hardcoded Opus Model and Loads Project Settings
**Severity:** Medium
**Category:** SDK Configuration
**Location:** `src/main/services/review-service.ts:224-228`
**Evidence:**
```typescript
raw = await runSdkOnce(prompt, {
  model: REVIEWER_MODEL,  // hardcoded 'claude-opus-4-6'
  maxTurns: 1,
  tools: []
})
```
`runSdkOnce` defaults to `settingSources: ['user', 'project', 'local']` from `sdk-streaming.ts:89`.
**Impact:** Reviewer correctly disables tools and sets `maxTurns: 1`. But:
1. Model hardcoded — no way to downgrade to Sonnet if review quality is sufficient, preventing cost optimization
2. `settingSources` default loads CLAUDE.md for an opinion-generation call that has no need for project implementation guidelines
**Recommendation:** Pass `settingSources: []` in reviewer options. Make `REVIEWER_MODEL` a configurable setting (fall through to a default like Sonnet, with Opus as explicit opt-in).
**Effort:** S
**Confidence:** Medium

---

## F-t3-sdk-opts-6: Adhoc Agent Missing `maxTurns` and `maxBudgetUsd`
**Severity:** Medium
**Category:** SDK Configuration
**Location:** `src/main/adhoc-agent.ts:216, 226`
**Evidence:**
```typescript
const baseOptions = {
  model,
  cwd: worktreePath,
  settingSources: ['user', 'project', 'local'],
  // no maxTurns, no maxBudgetUsd
}
const queryHandle = sdk.query({ prompt, options })
```
**Impact:** Each `runTurn()` call is a separate `query()` with no per-query ceiling. A user error ("keep iterating until tests pass" in a slow repo) or a prompt injection in an adversarial task spec can cause runaway spending across many interactive turns. User is present but may not be watching.
**Recommendation:**
```typescript
const baseOptions = {
  model,
  cwd: worktreePath,
  settingSources: [],     // skip project settings
  maxTurns: 50,           // high for interactive, but bounded
  maxBudgetUsd: 5.0       // ceiling for multi-turn interactive work
}
```
**Effort:** S
**Confidence:** High

---

## F-t3-sdk-opts-7: Spec Quality Validator Loads Project Settings Unnecessarily
**Severity:** Low
**Category:** SDK Configuration
**Location:** `src/main/services/spec-quality/validators/prescriptiveness-validator.ts:27-38`
**Evidence:**
```typescript
const queryHandle = sdk.query({
  prompt,
  options: {
    model: 'claude-haiku-4-5-20251001',
    maxTurns: 1,
    settingSources: ['user', 'project', 'local'],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  },
})
```
**Impact:** Haiku model and `maxTurns: 1` are correct choices for a cheap, fast validation call. But loading CLAUDE.md via `settingSources` is unnecessary for structural spec validation. The `bypassPermissions` flags also lack a comment explaining why they're needed.
**Recommendation:** Change to `settingSources: []`. Add `maxBudgetUsd: 0.05` (Haiku is cheap; a hard ceiling is still good practice). Add comment: `// bypassPermissions: validator needs no tool access, skip all prompts`.
**Effort:** S
**Confidence:** Medium
