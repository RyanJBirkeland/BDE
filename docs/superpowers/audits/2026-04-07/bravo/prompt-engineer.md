# Prompt Engineer — Team Bravo — BDE Audit 2026-04-07

## Summary

The non-pipeline agent surfaces (adhoc, assistant, native agent system) share a universal preamble that was clearly written for pipeline agents and leaks pipeline-specific constraints into interactive sessions — most damagingly a MANDATORY "run `npm install` as your FIRST action before reading any files" rule that applies to any adhoc/assistant session regardless of task. Several personalities contradict the actual runtime behavior (assistant personality claims "not in worktrees" but `adhoc-agent.ts` now puts it in one; adhoc tells the agent "Do NOT run git push" while the universal preamble teaches it to push to its branch). The memory module is not scoped by repo for adhoc/assistant spawns because `spawnAdhocAgent` never passes `repoName`, so BDE-specific IPC/Zustand/safeHandle memory is injected into adhoc agents working on non-BDE repos. Skills contain stale references (PR Station, ⌘5) that conflict with BDE_FEATURES.md's current Code Review Station wording and a PR workflow that adhoc agents are explicitly forbidden to perform. Overall the native agent system is stylistically clean but the composition logic and personality/preamble alignment have real bugs that will confuse agents in production.

## Findings

### [CRITICAL] Universal preamble forces `npm install` before reading any files — hostile to adhoc/assistant use cases

- **Category:** Conflicting Guidance / Scope Drift
- **Location:** `src/main/agent-manager/prompt-composer.ts:51-52`
- **Prompt excerpt:** `"Your worktree has NO node_modules. Run \`npm install\` as your FIRST action before reading any files or running any commands. If \`npm install\` fails, report the error clearly and exit immediately. Do not proceed without dependencies."`
- **Observation:** This string is in `UNIVERSAL_PREAMBLE` and is therefore prepended to every adhoc, assistant, copilot, and synthesizer prompt, not just pipeline runs. A user asking the Assistant "explain how the IPC router is wired up" will be told its first action must be `npm install` and to exit immediately on failure. Copilot agents have no tool access at all, so this instruction is impossible to obey.
- **Why it matters:** Adhoc/assistant sessions often just read code, answer questions, or prototype HTML in the Dev Playground. Forcing a multi-minute `npm install` on every session wastes tokens, wall time, and user trust. The "exit immediately" escape hatch also gives an agent a plausible excuse to bail on any conversation when install is slow.
- **Recommendation:** Move the `npm install` rule out of `UNIVERSAL_PREAMBLE` and into a pipeline-only appendix (next to `DEFINITION_OF_DONE`). Adhoc worktrees inherit `node_modules` from the main checkout in most flows anyway; if some don't, gate this on `agentType === 'pipeline'`.

### [CRITICAL] MANDATORY pre-commit verification applied to every agent, including non-coding ones

- **Category:** Scope Drift / Conflicting Guidance
- **Location:** `src/main/agent-manager/prompt-composer.ts:57-68`
- **Prompt excerpt:** `"## MANDATORY Pre-Commit Verification (DO NOT SKIP)\nBefore EVERY commit, you MUST run ALL of these and they MUST pass:\n1. \`npm run typecheck\`\n2. \`npm test\` — All renderer tests must pass (currently 2563+ tests)\n3. \`npm run lint\` ... This is non-negotiable."`
- **Observation:** Also lives in the universal preamble. Copilot (no tools) and synthesizer (single-turn, no tools) get this block. Assistant agents explicitly told to answer questions get it. Adhoc agents told in their personality to "Do NOT run `git push`" are told via the preamble that pre-commit verification and CI rejection are the mental model.
- **Why it matters:** A chatty "non-negotiable" rule about tests an agent can't run will be obeyed by defensive agents by refusing to respond, or ignored, training the agent to ignore other "non-negotiable" rules. The `2563+ tests` magic number also drifts (BDE CLAUDE.md explicitly warns: "coverage thresholds enforced in vitest config — don't hardcode them elsewhere").
- **Recommendation:** Move to a new `PIPELINE_CODE_DISCIPLINE` appendix applied only when `agentType === 'pipeline'`. Drop the hardcoded `2563+` count — reference the CI command instead (the testing-patterns memory module already models this correctly).

### [CRITICAL] Assistant personality contradicts the actual runtime: says "not in worktrees", but `spawnAdhocAgent` puts it in one

- **Category:** Conflicting Guidance
- **Location:** `src/main/agent-system/personality/assistant-personality.ts:11-12` vs `src/main/adhoc-agent.ts:85-109`
- **Prompt excerpt:** `"You work in the repo directory directly (not in worktrees)."`
- **Observation:** `spawnAdhocAgent` calls `setupWorktree` for both `adhoc` and `assistant` (the only differentiator is the `assistant` boolean flag passed to `buildAgentPrompt`). The prompt also includes the branch appendix (`"You are working on branch ... Commit and push ONLY to this branch"`). So the assistant is told three conflicting things: (1) "you work in the repo directly", (2) you have a branch, and (3) push only to that branch.
- **Why it matters:** An assistant agent trying to help the user reason about files on `main` will end up modifying an isolated worktree the user cannot see without checking the Code Review queue. `docs/agent-system-guide.md:42-48` also asserts Adhoc/Assistant run in "No (repo dir)" — the docs and personality drifted from the code.
- **Recommendation:** Update `assistant-personality.roleFrame` to match the new worktree-backed reality, or (cleaner) stop putting assistants into worktrees and keep them in the repo dir as documented.

### [MAJOR] Adhoc personality forbids `git push`, but the branch appendix actively instructs how to push

- **Category:** Conflicting Guidance
- **Location:** `src/main/agent-system/personality/adhoc-personality.ts:16` vs `src/main/agent-manager/prompt-composer.ts:74-81`
- **Prompt excerpt:** Personality: `"Do NOT run \`git push\` — your work is reviewed locally; pushing is the user's decision"`. Branch appendix (always appended when branch is set): `"If you need to push, use: \`git push origin ${branch}\`"`.
- **Observation:** Every adhoc spawn passes `branch` (line 108 of adhoc-agent.ts), so both strings land in the same prompt within ~40 lines of each other.
- **Why it matters:** Direct contradiction. Agents resolve contradictions by picking whichever rule sounds more actionable — the concrete `git push origin <branch>` example tends to win.
- **Recommendation:** In `buildBranchAppendix`, omit the "if you need to push" line when `agentType === 'adhoc'` (or `assistant`). Use a neutral statement: "Commit to this branch. The user reviews your work and decides when to push."

### [MAJOR] `repoName` is never passed for adhoc/assistant — BDE memory is injected into non-BDE sessions

- **Category:** Missing Context / Token Waste
- **Location:** `src/main/adhoc-agent.ts:105-109`
- **Prompt excerpt:** `buildAgentPrompt({ agentType: args.assistant ? 'assistant' : 'adhoc', taskContent: args.task, branch })`
- **Observation:** `getAllMemory({ repoName })` defaults to "assume BDE" when `repoName` is null/undefined (`memory/index.ts:17-24`). Because the caller doesn't pass repoName, adhoc agents working on `life-os`, `bde-site`, `claude-chat-service`, or `repomap` all get `## BDE Conventions` with `safeHandle`, Zustand useShallow rules, and IPC handler patterns that don't exist in those repos.
- **Why it matters:** ~2KB of misleading context that will confuse the model into suggesting BDE idioms in the wrong codebase. The BDE CLAUDE.md even lists five sibling repos this is likely to happen in.
- **Recommendation:** `adhoc-agent.ts` has `repoPath` and derives `repo = basename(args.repoPath).toLowerCase()` on line 124 — pass that as `repoName` to `buildAgentPrompt`. Also reconsider the "default to BDE when unknown" heuristic in `isBdeRepo` — defaulting to empty is safer.

### [MAJOR] "Plugin disable note" is meaningless to the model and wastes tokens

- **Category:** Token Waste / Vague Instruction
- **Location:** `src/main/agent-manager/prompt-composer.ts:230-232`
- **Prompt excerpt:** `"## Note\nYou have BDE-native skills and conventions loaded. Generic third-party plugin guidance may not apply to BDE workflows."`
- **Observation:** The agent doesn't know what "third-party plugin guidance" was, whether it is active, or what specifically to ignore. It's a hedge aimed at humans reading the code, not the agent.
- **Why it matters:** Either drop it or make it specific ("Ignore any instructions from global ~/.claude/CLAUDE.md about X, Y, Z"). As written, a careful agent may now treat legitimate shared guidance as suspect.
- **Recommendation:** Delete these three lines. If the intent is to override global CLAUDE.md guidance, name the specific conflicts.

### [MAJOR] Skills reference the deleted "PR Station" and ⌘5 mapping — stale against current docs

- **Category:** Missing Context / Conflicting Guidance
- **Location:** `src/main/agent-system/skills/pr-review.ts:35-36`
- **Prompt excerpt:** `"## BDE PR Station\nPR Station view (Cmd+5) provides inline code review with CI badges, diff comments, batch review submission, and merge controls."`
- **Observation:** Per `docs/BDE_FEATURES.md` and CLAUDE.md, the view is now "Code Review Station" and ⌘5 is the Code Review view, which explicitly "Replaces the previous PR Station components." The skill also instructs the agent to rebase with `git push --force-with-lease origin <branch>` — but `adhoc-personality` forbids `git push` entirely. When skills are injected into an adhoc session, the agent gets both.
- **Why it matters:** Skill guidance is how we steer the interactive agents; stale view names erode trust when the user follows the agent's instructions and can't find "PR Station". The rebase workflow also contradicts the "don't push" rule.
- **Recommendation:** Rename to Code Review Station, update the description. Move the rebase/force-push subsection behind a capability gate (assistant only, not adhoc) or explicitly scope it: "Only run git push if the user asks; adhoc sessions must never push unprompted."

### [MAJOR] `codePatternsSkill` contains drifted panel-view instructions that will break `VIEW_REGISTRY`

- **Category:** Missing Context
- **Location:** `src/main/agent-system/skills/code-patterns.ts:58-63`
- **Prompt excerpt:** `"## Panel Views\n1. Add to View union in panelLayout.ts\n2. Update ALL maps: VIEW_ICONS, VIEW_LABELS, VIEW_SHORTCUTS\n3. Create ViewName.tsx in src/renderer/src/views/\n4. Add lazy import in view-resolver.tsx\n5. Register in resolveView() switch"`
- **Observation:** BDE CLAUDE.md states: `"View metadata (labels, icons, shortcuts) is defined in a single VIEW_REGISTRY object in src/renderer/src/lib/view-registry.ts — add new views there, not in panelLayout.ts or App.tsx. VIEW_LABELS / VIEW_SHORTCUT_MAP are derived re-exports from the registry."` The skill is guiding the agent to edit derived files and the wrong source of truth.
- **Why it matters:** Any assistant that follows this skill will produce a PR that fails review because it touches derived re-exports instead of `VIEW_REGISTRY`. CLAUDE.md explicitly calls out this exact anti-pattern.
- **Recommendation:** Replace the 5-step list with a one-liner pointing to `VIEW_REGISTRY` in `src/renderer/src/lib/view-registry.ts`.

### [MAJOR] `taskOrchestrationSkill` teaches `window.api.sprint.create` for main-process agents

- **Category:** Missing Context / Conflicting Guidance
- **Location:** `src/main/agent-system/skills/task-orchestration.ts:14-24`
- **Prompt excerpt:** ` \`\`\`typescript\n// Example: Create task via IPC\nawait window.api.sprint.create({ ... })\n\`\`\` `
- **Observation:** Adhoc and assistant agents run via the Agent SDK in the **main process** (cwd is a worktree on disk) — they have no `window` object, no renderer bridge, no `window.api`. The only way they could create tasks is `sqlite3 ~/.bde/bde.db ...` or shelling through another mechanism, and even that bypasses the dependency validation this skill claims the IPC layer provides.
- **Why it matters:** An agent asked "create three follow-up tasks for this work" will attempt `window.api.sprint.create` in a bash/typescript context, see it fail, and either give up or hallucinate paths. There is no working way to satisfy the instruction as written.
- **Recommendation:** Either (a) document the SQLite insertion path with the known caveats ("bypasses IPC validation — only use for rescue"), or (b) expose a real CLI/MCP tool for task creation and reference that. As-is, delete the TypeScript example; keep the conceptual hard/soft description.

### [MAJOR] Synthesizer and copilot agents receive the same "worktree / pre-commit / npm install" rules despite having no tools

- **Category:** Missing Context / Token Waste
- **Location:** `src/main/agent-manager/prompt-composer.ts:41-68`
- **Prompt excerpt:** (full `UNIVERSAL_PREAMBLE`)
- **Observation:** Per `BDE_FEATURES.md` copilot has "None (text-only)" tool access and synthesizer has "None" tools and is single-turn. Yet they receive the entire hard-rules block: "You work in git worktrees", "run `npm install` as your first action", "MANDATORY Pre-Commit Verification", "Use TypeScript strict mode conventions". None of these apply.
- **Why it matters:** For copilot this is ~600 tokens on every turn of a multi-turn chat. The copilot also risks telling the user things like "I'll run npm install first" because it's been told this is mandatory, even though it physically cannot.
- **Recommendation:** Split `UNIVERSAL_PREAMBLE` into three layers: (1) identity ("you are a BDE agent, safety rules: never commit secrets"), applied universally; (2) pipeline code discipline (npm install, pre-commit, typescript strict); (3) interactive code discipline (commit format, branch hygiene). Apply 2 to pipeline only and 3 to adhoc/assistant.

### [MAJOR] `copilotPersonality` used for copilot path but `repoName` is not threaded through workbench copilot either (risk sibling bug)

- **Category:** Missing Context
- **Location:** `src/main/agent-manager/prompt-composer.ts:210` (`repoName: repoName ?? undefined`)
- **Observation:** Memory injection for the copilot path depends on whether the copilot caller passes `repoName`. If the workbench IPC doesn't pipe through `formContext.repo` as `repoName`, copilots drafting specs for life-os will be handed BDE conventions. Not verified here (Team Alpha territory), but the `formContext` already contains `repo`, so using `repo` for both `formContext` and `repoName` would be trivial. Flagging because the same plumbing bug exists in adhoc and is easy to replicate.
- **Why it matters:** Spec drafts for sibling repos will contain BDE-isms that the pipeline agent then dutifully implements.
- **Recommendation:** When `formContext.repo` is provided, also set `repoName: formContext.repo`. Enforce it in a type guard.

### [MINOR] `SELF_REVIEW_CHECKLIST` is pipeline-only, but could help adhoc too

- **Category:** Missing Example
- **Location:** `src/main/agent-manager/prompt-composer.ts:341-350`
- **Observation:** The `## Self-Review Checklist` (no console.log left behind, no hardcoded colors, commit messages explain WHY) is valuable for any coding session. Gating it to pipeline means adhoc users get worse commits from their interactive agent than from the pipeline agent doing the same work.
- **Why it matters:** Inconsistent quality bar between adhoc and pipeline produces review churn when the user promotes adhoc work to Code Review.
- **Recommendation:** Apply the checklist to adhoc when a branch is set (pipeline and adhoc both commit).

### [MINOR] Adhoc personality constraint contradicts CLAUDE.md's mandatory pre-commit rules

- **Category:** Conflicting Guidance
- **Location:** `src/main/agent-system/personality/adhoc-personality.ts:17`
- **Prompt excerpt:** `"Run tests after changes: npm test && npm run typecheck"`
- **Observation:** CLAUDE.md mandates `typecheck && test && lint` before EVERY commit. The adhoc constraint omits lint and reorders the sequence. So the preamble says "lint is mandatory", the personality says "test + typecheck". Pick one.
- **Recommendation:** Either remove this line (covered by preamble) or make it authoritative and align with the preamble. Personalities should not contradict universal rules.

### [MINOR] `debuggingSkill` tells agents to edit SQLite directly to reset tasks — bypasses the data-layer contract

- **Category:** Conflicting Guidance
- **Location:** `src/main/agent-system/skills/debugging.ts:23-27`
- **Prompt excerpt:** `"## Reset Errored Tasks\nMust clear BOTH status AND claimed_by via SQLite: \`UPDATE sprint_tasks SET status='queued', claimed_by=NULL, notes=NULL, started_at=NULL, completed_at=NULL, fast_fail_count=0 WHERE id='...';\`"`
- **Observation:** CLAUDE.md states: `"Single writer to sprint_tasks: BDE main process via SQLite (IPC handlers in sprint-local.ts). Status transitions are guarded in sprint-queries.ts."` Raw UPDATEs bypass `isValidTransition` and dependency resolution (per CLAUDE.md: `"Direct SQLite writes bypass this — always use IPC handlers"`).
- **Why it matters:** An agent following this skill will happily reset tasks in a way that leaves dependents permanently blocked and the audit trail empty.
- **Recommendation:** Replace with an IPC-backed reset command or at minimum call out that `resolveDependents()` must also run and the `task_changes` audit row must be inserted.

### [MINOR] `voice` and `patterns` fields use vague qualifiers with no examples

- **Category:** Vague Instruction
- **Location:** `src/main/agent-system/personality/adhoc-personality.ts:4-5`, `assistant-personality.ts:4-6`
- **Prompt excerpt:** adhoc: `"Be terse and execution-focused. Do the work first, explain after."` assistant: `"Be conversational but concise. Explain your reasoning briefly."`
- **Observation:** "Terse", "concise", "briefly" are notoriously fuzzy to models. Assistant is told both "conversational" and "concise" — these push in opposite directions with no concrete target (sentence count, word budget, etc.).
- **Why it matters:** Without a concrete anchor (e.g., "≤3 short paragraphs per reply unless the user asks for depth"), the same model will produce wildly different response lengths across sessions.
- **Recommendation:** Add one concrete anchor per voice. Example for adhoc: `"Default to ≤5 lines of narration per action; skip it entirely for routine file reads."`

### [MINOR] `PLAYGROUND_INSTRUCTIONS` mentions "the BDE chat" without defining it for adhoc sessions

- **Category:** Missing Context
- **Location:** `src/main/agent-manager/prompt-composer.ts:98-109`
- **Prompt excerpt:** `"The preview will automatically appear inline in the BDE chat when you write .html files"`
- **Observation:** Adhoc agents may think "chat" means a chat message they emit. The actual mechanism is the PlaygroundCard in the agent console (per BDE_FEATURES.md). "The BDE chat" isn't a feature name.
- **Recommendation:** Say "the Agents view console in BDE" and reference PlaygroundCard by name — matches BDE_FEATURES.md terminology.

### [MINOR] `IDLE_TIMEOUT_WARNING` and `buildTimeLimitSection` are pipeline-only, but adhoc also has a watchdog in practice

- **Category:** Missing Context
- **Location:** `src/main/agent-manager/prompt-composer.ts:115-122`, applied only on line 354-357
- **Observation:** Adhoc sessions run multi-turn in the main process and are subject to SDK-level timeouts (and the user closing the app). The agent is never told about any time budget, so it may undertake open-ended exploration that never finishes.
- **Recommendation:** Add a soft "budget your work; if a step takes >10 min report progress" hint to the adhoc personality, or emit `IDLE_TIMEOUT_WARNING` unconditionally.

### [MINOR] `getAllSkills()` concatenates all 5 skills unconditionally — no routing by trigger

- **Category:** Token Waste
- **Location:** `src/main/agent-system/skills/index.ts:20-30`
- **Observation:** The `BDESkill.trigger` field exists precisely so skills can be conditionally injected ("User asks about PR review..."), but `getAllSkills()` throws away the triggers and concatenates every skill's full markdown on every adhoc/assistant spawn. Total is ~6KB of skill text per session, most of it irrelevant to any given conversation.
- **Why it matters:** Tokens are billed per turn in multi-turn sessions. A 10-turn adhoc session pays for the full skill blob 10 times.
- **Recommendation:** Either (a) delete the `trigger` field if it's dead, or (b) implement skill selection: inject only the system-introspection + debugging skills by default, and have the agent pull additional skill guidance via a tool (`bde:getSkill(id)`) when needed.

### [MINOR] `taskContent` for adhoc/assistant is appended with no header — contrasted with pipeline's explicit `## Task Specification`

- **Category:** Missing Example
- **Location:** `src/main/agent-manager/prompt-composer.ts:291-303`
- **Prompt excerpt:** `"// For assistant, adhoc: append task content as-is\nprompt += '\\n\\n' + taskContent"`
- **Observation:** Pipeline gets: `"## Task Specification\n\nRead this entire specification before writing any code. Address every section.\n\n" + taskContent`. Adhoc/assistant get raw paste with a blank line. The user's first message just floats at the bottom of a 3000-token preamble without a heading to mark where the actual request starts.
- **Why it matters:** Instruction-following models anchor on the last clear heading. With no heading, the agent may treat the user message as continuation of the skills section.
- **Recommendation:** Wrap adhoc/assistant task content in `## User Request` (or `## Task` for adhoc). Costs 3 tokens, prevents boundary confusion.

### [MINOR] `agent-event-mapper.ts` silently drops `result` messages and logs unknown types via `console.debug`

- **Category:** No Failure Path
- **Location:** `src/main/agent-event-mapper.ts:47-70`
- **Observation:** Not strictly a prompt smell but related to agent supervision: when the SDK wire protocol evolves (e.g., adds a new message type like `thinking` or `sidechain`), this mapper silently drops the event and only emits a `console.debug` that nobody will see in production. There is no escape hatch for the agent to tell the user "I did work but it wasn't captured."
- **Recommendation:** At minimum upgrade `console.debug` to the module logger used elsewhere in main, and consider emitting an `agent:warning` event for unknown message types so supervisors notice when new SDK versions break mapping.
