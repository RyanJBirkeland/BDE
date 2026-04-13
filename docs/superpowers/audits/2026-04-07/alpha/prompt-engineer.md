# Prompt Engineer — Team Alpha — BDE Audit 2026-04-07

## Summary

The pipeline-agent prompt is well-structured at the macro level (universal preamble → personality → memory → task spec → time/idle/DoD), but the actual instruction text contains several footguns: hard-coded test counts that will go stale, directly conflicting guidance about pre-commit checks vs the Definition of Done, an `npm install` "first action" rule that contradicts BDE's own guidance about not exploring before reading the spec, and a retry context that fires only on retries (so attempt #1 is never told it's part of a retry chain). Spec generation prompts (`buildQuickSpecPrompt`, `buildSpecPrompt`) are decent but the templates seeded into `DEFAULT_TASK_TEMPLATES` are filled with placeholder language that pipeline agents are known to thrash on. The semantic readiness check is brittle (no JSON schema enforcement, silent fall-through to "pass") and the synthesizer prompt re-derives a prompt from scratch instead of reusing `buildAgentPrompt`, so the synthesizer never sees the universal preamble or BDE conventions. There is also a meaningful structural issue: `task.prompt` takes precedence over `task.spec`, which means agents that should be receiving a structured spec instead receive a freeform prompt with no header — silently bypassing the "## Task Specification — Read this entire specification" framing. 16 findings below, ordered by severity.

## Findings

### [CRITICAL] Hard-coded test count in pre-commit instructions will go stale

- **Category:** Vague Instruction
- **Location:** `src/main/agent-manager/prompt-composer.ts:60`
- **Prompt excerpt:** `"npm test — All renderer tests must pass (currently 2563+ tests)"`
- **Observation:** The number "2563+" is baked into the universal preamble. Agents receive this as ground truth. Every time the test count drops below 2563 (e.g. tests removed in a refactor), a literal-minded agent may believe the suite is broken and refuse to commit.
- **Why it matters:** This is the same kind of drift that the testing-patterns memory module explicitly warns against ("Coverage thresholds are enforced by CI via vitest config — do NOT hardcode threshold numbers in code, prompts, or docs (they drift)"). The preamble is violating its own rule, in the very prompt that injects the rule.
- **Recommendation:** Drop the parenthetical entirely. `"npm test — All tests must pass"` is sufficient.

### [CRITICAL] `task.prompt` silently bypasses the spec wrapper

- **Category:** Conflicting Guidance / Missing Context
- **Location:** `src/main/agent-manager/run-agent.ts:207` and `src/main/agent-manager/prompt-composer.ts:295-303`
- **Prompt excerpt (composer):** `"## Task Specification\n\nRead this entire specification before writing any code. Address every section."`
- **Observation:** `run-agent.ts` builds `taskContent = (task.prompt || task.spec || task.title || '').trim()`. The composer wraps `taskContent` in the `## Task Specification` header for `agentType === 'pipeline'` regardless of which field it came from. So if a task has BOTH `prompt` and `spec` set (which is common in BDE — the workbench writes specs but legacy code uses prompts), the agent sees the `prompt` (freeform text) wrapped as if it were a structured spec, and the actual spec is never sent at all. The pipeline-personality constraint `"If the spec lists ## Files to Change, restrict modifications to those files"` then has nothing to apply to.
- **Why it matters:** Tasks created via Task Workbench live in `spec`. Tasks created via legacy paths or older sprint flows use `prompt`. Whichever was set first wins, silently. Agents are working off the wrong content with no signal that they are.
- **Recommendation:** Either (a) prefer `spec` over `prompt` in run-agent.ts, or (b) concatenate them with explicit headers (`## Spec\n…\n\n## Additional Prompt Instructions\n…`), or (c) reject tasks that have both set at validation time.

### [CRITICAL] Definition of Done duplicates and slightly contradicts the Pre-Commit Verification block

- **Category:** Conflicting Guidance
- **Location:** `src/main/agent-manager/prompt-composer.ts:57-68` vs `122`
- **Prompt excerpt (preamble):** `"Before EVERY commit, you MUST run ALL of these and they MUST pass: 1. npm run typecheck … 2. npm test … 3. npm run lint"`
- **Prompt excerpt (DoD):** `"Your task is complete when ALL of these are true: 1. All changes are committed to your branch 2. npm run typecheck passes … 3. npm test passes 4. npm run lint passes … Do NOT exit without running all four checks."`
- **Observation:** Both blocks tell the agent to run the same three checks. The preamble says "before EVERY commit." The DoD says "before exit." A literal reading is "run them after every commit AND again at exit," which an agent will dutifully do — wasting 2-3 minutes per task on a redundant test pass. Worse, the DoD says "ALL four" but only lists three checks plus "committed to branch," so the numbering is misleading.
- **Why it matters:** Token waste in instructions, runtime waste in execution. Pipeline agents are time-budgeted (15-30 min target per BDE_FEATURES.md guidance) and a duplicate full test run is significant.
- **Recommendation:** Delete the `DEFINITION_OF_DONE` block. The pre-commit instructions already cover verification. Replace with a single line: "Your task is done when your final commit is pushed to your branch and the pre-commit checks passed."

### [CRITICAL] `npm install` as MANDATORY first action contradicts spec-first guidance

- **Category:** Conflicting Guidance / Token Waste
- **Location:** `src/main/agent-manager/prompt-composer.ts:51-52`
- **Prompt excerpt:** `"Your worktree has NO node_modules. Run \`npm install\` as your FIRST action before reading any files or running any commands."`
- **Observation:** This rule says: do not Read any file before npm install. But the very next thing the agent is told (line 297) is `"Read this entire specification before writing any code. Address every section."` Reading the spec is reading a file. The agent has to pick one rule to break.
- **Why it matters:** The intent is "before running tests/typecheck," not "before any Read tool call." A coding agent will either burn 2-3 minutes installing before even reading the task, or will be confused about which rule wins. Either way, it's a bad opening turn.
- **Recommendation:** `"Run npm install before invoking npm test, npm run typecheck, or npm run lint. You may read the spec and source files first to plan."`

### [MAJOR] Retry context is omitted on attempt #1, so the agent never sees the retry budget

- **Category:** Missing Context
- **Location:** `src/main/agent-manager/prompt-composer.ts:336`
- **Prompt excerpt (guard):** `if (agentType === 'pipeline' && retryCount && retryCount > 0)`
- **Observation:** The retry block ("This is attempt 1 of 4") is only injected when `retryCount > 0`. On the first attempt, the agent is never told the task can be retried up to 3 more times if it fails — so it has no incentive to bail out gracefully on a hard error vs flailing for the full time budget. Conversely, on attempt 4 it has no idea this is its LAST shot.
- **Why it matters:** Knowing "this is attempt N of M" is useful context on every attempt, not just retries. On attempt 1 it tells the agent "if this fails, you'll get another chance — don't burn the time budget on edge cases." On attempt M it tells the agent "this is your last shot — be conservative."
- **Recommendation:** Always inject the attempt counter. Vary the tone by attempt number.

### [MAJOR] "Currently 2563+ tests" + DoD checklist contradicts the test-pattern memory module

- **Category:** Conflicting Guidance
- **Location:** Preamble + DoD vs `src/main/agent-system/memory/testing-patterns.ts:6-13`
- **Prompt excerpt (memory):** `"do NOT hardcode threshold numbers in code, prompts, or docs (they drift). To verify your changes meet the bar, run: npm run test:coverage"`
- **Observation:** The memory module says "use `npm run test:coverage`." The preamble says "use `npm test`." The DoD says "use `npm test`." None of the three pipeline agent instruction blocks tell the agent to use `test:coverage`, but the injected memory module insists `test:coverage` is the way. Pipeline agents will see a contradiction and pick one — usually the louder one (the preamble), which means coverage thresholds are not actually verified before commit.
- **Why it matters:** CI runs `test:coverage`. If the agent only ran `npm test`, the PR will fail CI on coverage drop and bounce back as a retry. This is a measurable cause of pipeline thrashing.
- **Recommendation:** Use `npm run test:coverage` consistently in the pipeline preamble and DoD, OR have the memory module say `npm test` for fast-loop dev. Pick one. Don't ship both.

### [MAJOR] Self-Review checklist hidden after the spec, easy to skip

- **Category:** Missing Example / Token Waste
- **Location:** `src/main/agent-manager/prompt-composer.ts:342-349`
- **Prompt excerpt:** `"## Self-Review Checklist\nBefore your final push, verify:\n- [ ] Every changed file is required by the spec\n- [ ] No console.log, commented-out code, or TODO left behind …"`
- **Observation:** This checklist is appended AFTER the task spec and BEFORE the time/idle/DoD blocks. By the time the agent reads down to here, it has already mentally committed to its plan. Markdown checkboxes also cue the agent to render them as output (LLMs love filling in checkboxes) instead of actually doing the verification. There is no instruction to say HOW to verify each item — "No console.log" requires a grep but the prompt doesn't say so.
- **Why it matters:** The checklist looks rigorous but is performative. Agents will tick boxes in their commit message without grepping.
- **Recommendation:** Either move it adjacent to the pre-commit block at the top (so it's read before planning), or convert each line to an actionable command: `"Run rg 'console\\.log' src/ — must return zero matches in your changed files."`

### [MAJOR] Synthesizer prompt bypasses `buildAgentPrompt` entirely

- **Category:** Missing Context
- **Location:** `src/main/services/spec-synthesizer.ts:121-180` (`buildSpecPrompt`)
- **Prompt excerpt:** `"You are an expert software engineer writing a precise, actionable coding task specification."`
- **Observation:** `spec-synthesizer.ts` constructs its own prompt string and ships it to the SDK directly via `runSdkStreaming`. It never calls `buildAgentPrompt({ agentType: 'synthesizer', … })`. The synthesizer personality file (`synthesizer-personality.ts`) — which was created specifically to drive this agent — is never injected. Neither is the BDE memory module, the universal preamble, or the cross-repo contract.
- **Why it matters:** A whole layer of carefully designed prompt engineering exists and is bypassed for the synthesizer. The synthesizer-personality.ts file is dead code.
- **Recommendation:** Either route the synthesizer through `buildAgentPrompt` (preferred) or delete `synthesizer-personality.ts` and document that the synthesizer uses a hand-built prompt.

### [MAJOR] Semantic readiness check has no schema enforcement and silently passes on parse failure

- **Category:** No Failure Path
- **Location:** `src/main/spec-semantic-check.ts:80-130`
- **Prompt excerpt:** `"Return ONLY valid JSON (no markdown fencing). … Return JSON: {\"clarity\":{\"status\":\"…\"…}}"`
- **Observation:** The model is told to return JSON, but if it returns markdown fencing (which Haiku frequently does), the `JSON.parse(raw)` throws and the catch block returns `passed: true` with all warnings. So a malformed model response → spec is marked ready. The validation profile language `"Adjust expectations accordingly"` is also vague — what does "adjust" mean for a model?
- **Why it matters:** This is the gate that prevents bad specs from being queued. A failing JSON parse should not be a green light. Worse, it means a specific class of model regression (Haiku starts wrapping JSON in fences) silently disables the entire readiness check.
- **Recommendation:** (1) Strip markdown fences before parse (\`\`\`json...\`\`\` is trivially detectable). (2) On parse failure, return `hasFails: true` with a clear message, not pass-through. (3) Replace "Adjust expectations accordingly" with concrete rules per spec type.

### [MAJOR] `buildQuickSpecPrompt` template scaffold is too sparse to produce useful specs

- **Category:** Missing Example
- **Location:** `src/main/handlers/sprint-spec.ts:80-92`
- **Prompt excerpt:** `bugfix: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test'`
- **Observation:** The scaffold given to the spec generator is just empty `## headings`. Compare to `DEFAULT_TASK_TEMPLATES` in `constants.ts` which has rich placeholders ("File: `src/.../file.ts`", "Function: `functionName()`"). Two parallel template systems — the one wired through `getTemplateScaffold()` is the impoverished one. The richer one is only used as form-prefill text in the renderer.
- **Why it matters:** The model has to invent the structure of every section from a one-line section header. The generated specs are then thin and trigger downstream agent thrashing — exactly the failure mode `feedback_task_spec_quality.md` warns about.
- **Recommendation:** Have `getTemplateScaffold()` pull from `DEFAULT_TASK_TEMPLATES` so both paths use the rich scaffolds.

### [MAJOR] Copilot is told it has Read/Grep/Glob but the prompt never shows it WHERE to ground

- **Category:** Vague Instruction
- **Location:** `src/main/handlers/workbench.ts:351` (built via `buildAgentPrompt → copilotPersonality`)
- **Prompt excerpt:** `"Use them proactively to ground every piece of advice in the actual code rather than guessing."`
- **Observation:** The copilot prompt does eventually inject `repoPath` ("All your tool calls operate inside this repository: `…`") which is good. But the personality says "proactively use Grep/Glob" without any concrete trigger conditions. In practice the copilot tends to chatter without ever using its tools. There's also no example like "When the user mentions a function name, always Grep for it before answering."
- **Why it matters:** The whole point of giving the copilot tools is forcing it to ground answers. Soft language like "proactively" doesn't get enforced behavior from a model.
- **Recommendation:** Add a concrete decision rule to the copilot prompt: `"Before suggesting any file path, you MUST run Glob to confirm it exists. Before referencing a function, you MUST Grep for its definition. If the user asks 'where does X live,' your first action is Grep, not an answer."`

### [MAJOR] "Stay within spec scope" constraint has no enforcement teeth

- **Category:** Vague Instruction
- **Location:** `src/main/agent-system/personality/pipeline-personality.ts:13-14`
- **Prompt excerpt:** `"If the spec lists ## Files to Change, restrict modifications to those files unless you document the reason for additional changes in the commit message"`
- **Observation:** "Unless you document the reason in the commit message" is a 100% escape hatch. Any LLM can produce a one-line justification. This is exactly the scope-drift that BDE has had problems with historically.
- **Why it matters:** Spec scope is the #1 reason pipeline agents thrash. A soft escape hatch defeats the purpose.
- **Recommendation:** Replace with hard rule: `"If you find you need to modify a file not listed in ## Files to Change, STOP. Add a brief note to the task and exit. Do not modify the file."` Let the human decide whether to expand the spec.

### [MAJOR] Synthesizer prompt instructs "no preamble" but also "starting with a title" — literal-minded models break

- **Category:** Conflicting Guidance
- **Location:** `src/main/services/spec-synthesizer.ts:160`
- **Prompt excerpt:** `"6. **No preamble**: Output ONLY the spec markdown, starting with a title"`
- **Observation:** "No preamble" + "starting with a title" can produce output like `# (untitled)\n\n## Problem...` because the model strips its own title to obey "no preamble." Or the model interprets "title" as `# Title:` and "preamble" loosely.
- **Why it matters:** Generated specs sometimes have malformed titles, which trip the structural validator (`MIN_HEADING_COUNT = 2`).
- **Recommendation:** `"Output ONLY the spec markdown. The first line must be a # H1 title derived from the user's task."`

### [MINOR] Universal preamble repeats "your work will be reviewed via PR"

- **Category:** Token Waste
- **Location:** `src/main/agent-manager/prompt-composer.ts:46` and `src/main/agent-system/personality/pipeline-personality.ts:8`
- **Prompt excerpt:** `"Your work will be reviewed via PR before merging to main"` (in both places, near-verbatim)
- **Observation:** Same sentence injected twice within ~20 lines of the prompt. Same for "NEVER push to main" (preamble line 49) vs the branch appendix (line 79: "Do NOT checkout, merge to, or push to main").
- **Why it matters:** Minor token waste, but more importantly: when an agent sees the same rule three times, it can interpret the repetition as emphasis on a different aspect each time, leading to over-cautious behavior.
- **Recommendation:** Pick one location for each rule. The universal preamble is the right home; remove the duplicates from personality and branch appendix.

### [MINOR] Cross-repo contract block has no example of what a contract looks like

- **Category:** Missing Example
- **Location:** `src/main/agent-manager/prompt-composer.ts:307-312`
- **Prompt excerpt:** `"## Cross-Repo Contract\n\nThis task involves API contracts with other repositories. Follow these contract specifications exactly:"`
- **Observation:** The block says "follow these contract specifications exactly" but the contract content is whatever string the caller passes — could be anything. There's no framing for what level of strictness applies (function signatures? types? wire format?). Without an example the agent doesn't know what "exactly" means.
- **Why it matters:** This is a feature designed to prevent cross-repo breakage but the prompt language doesn't anchor the model on what to actually preserve.
- **Recommendation:** Reframe: `"## Cross-Repo Contract\n\nThe following types and function signatures are referenced from other repositories. You MUST NOT change their shape, field names, or types. You may only change implementation details that are not visible across the contract."`

### [MINOR] Idle timeout warning's "emit a progress message" is non-actionable for an LLM

- **Category:** Vague Instruction
- **Location:** `src/main/agent-manager/prompt-composer.ts:120`
- **Prompt excerpt:** `"You will be TERMINATED if you produce no output for 15 minutes. If running long commands (npm install, test suites), emit a progress message before and after."`
- **Observation:** "Emit a progress message" is unclear — does that mean print to stdout, write a chat message, or something else? An LLM in tool-use mode can't always interleave "messages" with shell commands; it's actively executing tools. The natural way to "emit" is to send an assistant text turn, but that requires interrupting the tool loop.
- **Why it matters:** Agents that take this literally will issue Bash echo commands as "progress messages" which doesn't help with the watchdog. Agents that don't take it literally will be killed mid-`npm install`.
- **Recommendation:** Either describe the actual mechanism (`"Before any command expected to take more than 2 minutes, send a brief assistant text message describing what you're about to do."`), or drop the instruction and rely on a longer idle timeout for known-long commands.

### [MINOR] `prompt-composer` injects "## Note: third-party plugin guidance may not apply" but agents have no third-party plugins

- **Category:** Token Waste
- **Location:** `src/main/agent-manager/prompt-composer.ts:230-232`
- **Prompt excerpt:** `"You have BDE-native skills and conventions loaded. Generic third-party plugin guidance may not apply to BDE workflows."`
- **Observation:** This block is injected into every agent prompt unconditionally. It refers to "third-party plugin guidance" which doesn't exist in the agent's context — the SDK doesn't load arbitrary plugins. The note is leftover from the migration off plugin scripts (per CLAUDE.md). To a fresh model it's a confusing reference to something it never had.
- **Why it matters:** Confuses the agent about what knowledge it does/doesn't have. Also burns ~30 tokens per spawn × every agent type.
- **Recommendation:** Delete the block. If something specific needs to be turned off, reference it concretely.

## Notes for other personas

- The sprint-queries `taskContent` precedence (`prompt || spec`) crosses into Data/IPC reviewer territory — mentioned here because it directly invalidates the prompt composer's spec wrapper.
- The `npm test` vs `npm run test:coverage` mismatch also affects CI/QA persona findings — the agent is actively running the wrong verification command.
