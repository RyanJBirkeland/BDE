# BDE Native Agent System

BDE's native agent system provides BDE-specific prompt infrastructure — personalities, skills, and a universal prompt composer. Shared codebase conventions are no longer injected by this subsystem (see [Memory Module](#memory-module) for the history).

## Overview

The agent system consists of four modules:

1. **Personality** — Voice, role framing, constraints, and behavioral patterns per agent type
2. **Memory** — User-authored memory selection. Does NOT inject BDE codebase conventions — those live in `CLAUDE.md` when present
3. **Skills** — Actionable guidance for interactive agents (debugging, PR review, system introspection, task orchestration, code generation)
4. **Prompt Composer** — Universal prompt builder dispatched from `src/main/lib/prompt-composer.ts`

## Architecture

```
src/main/agent-system/
├── personality/
│   ├── types.ts                      # AgentPersonality interface + AgentType union
│   ├── pipeline-personality.ts       # Pipeline agent personality
│   ├── adhoc-personality.ts          # Adhoc (user-spawned executor)
│   ├── assistant-personality.ts      # Interactive assistant
│   ├── bde-advisor-personality.ts    # Floating BDE Advisor
│   ├── copilot-personality.ts        # Workbench spec-drafting copilot
│   └── synthesizer-personality.ts    # Single-turn spec generator
├── memory/
│   ├── index.ts                      # getAllMemory() — returns '' (see below)
│   ├── select-user-memory.ts         # Scans ~/.bde/memory/ for user-authored notes
│   └── user-memory.ts                # User memory types + selection helpers
└── skills/
    ├── types.ts                      # BDESkill interface
    ├── debugging.ts                  # Skill for diagnosing failures
    ├── pr-review.ts                  # Skill for reviewer agents
    ├── system-introspection.ts       # Skill for querying SQLite, reading logs
    ├── task-orchestration.ts         # Skill for creating tasks, setting dependencies
    ├── code-patterns.ts              # Skill for generating BDE-idiomatic code
    └── index.ts                      # getAllSkills() and getSkillList() exports
```

Reviewer prompt builders live next door in `src/main/agent-manager/prompt-composer-reviewer.ts` (`buildStructuredReviewPrompt`, `buildInteractiveReviewPrompt`).

## Agent Types

`AgentType` is a union of six values (see `personality/types.ts`):

| Type        | Spawned by             | Interactive      | Tool access | Worktree              | Personality               |
| ----------- | ---------------------- | ---------------- | ----------- | --------------------- | ------------------------- |
| Pipeline    | Agent Manager (auto)   | No               | Full        | Yes (isolated)        | Concise, action-oriented  |
| Adhoc       | User (Agents view)     | Yes (multi-turn) | Full        | Yes (adhoc worktree)  | Same as pipeline          |
| Assistant   | User (Agents view)     | Yes              | Full        | Yes (adhoc worktree)  | Conversational, proactive |
| Reviewer    | Code Review Station    | Configurable     | Read + comment | Yes (review worktree) | Focused on diff critique |
| Copilot     | Task Workbench         | Yes (chat)       | None        | No                    | Minimal (text-only)       |
| Synthesizer | Task Workbench         | No (single-turn) | None        | No                    | Minimal (spec generation) |

(The floating **BDE Advisor** uses the `bde-advisor-personality` profile on top of the `assistant` agent type — it is not a separate `AgentType`.)

**Pipeline agents** execute sprint tasks autonomously. They work in isolated git worktrees, commit changes, and stop at `review` status.

**Assistant agents** are interactive helpers. They're more conversational, proactively suggest BDE tools (Dev Playground, sprint tasks), and help users understand the codebase.

**Reviewer agents** are dispatched from Code Review Station against a completed agent's worktree to produce either a structured JSON review or a conversational review.

**Skills** are only injected for assistant and adhoc agents. Pipeline, reviewer, copilot, and synthesizer agents don't receive open-ended interactive skills.

## Personality Module

Each personality defines four fields:

```typescript
export interface AgentPersonality {
  voice: string // Tone and style guidelines (concise, conversational, etc.)
  roleFrame: string // Identity framing ("You are a BDE pipeline agent...")
  constraints: string[] // Hard boundaries (never push to main, run tests, etc.)
  patterns: string[] // Communication and behavior patterns
}
```

**Example** (pipeline agent):

```typescript
export const pipelinePersonality: AgentPersonality = {
  voice: `Be concise and action-oriented. Focus on execution, not explanation.
Report progress briefly. Don't ask for confirmation on routine operations.`,

  roleFrame: `You are a BDE pipeline agent executing a sprint task autonomously.
Your work will be reviewed via PR before merging to main.`,

  constraints: [
    'NEVER commit secrets or .env files',
    'Stay within spec scope — do not refactor unrelated code',
    'If the spec lists ## Files to Change, restrict modifications to those files'
  ],

  patterns: [
    'Report what you did, not what you plan to do',
    'If tests fail, fix them before pushing',
    'Commit with format: {type}: {description}'
  ]
}
```

## Memory Module

> **History:** Earlier versions of this subsystem injected BDE codebase conventions (IPC patterns, testing rules, architecture rules) as memory modules. These were removed in the **Option A debranding decision** — they were tightly coupled to BDE internals and actively misled agents working on non-BDE repos. See commit history around `src/main/agent-system/memory/` for the removal.

`getAllMemory()` is kept as a call-site stub and **always returns an empty string**:

```typescript
import { getAllMemory } from './agent-system/memory'

getAllMemory()                          // ''
getAllMemory({ repoName: 'bde' })       // ''
getAllMemory({ repoName: 'life-os' })   // ''
```

Where codebase conventions come from now:

- **Cross-cutting rules** (commit format, pre-commit verification, branch naming, npm install) are in the universal preamble emitted by the prompt composer.
- **Per-repo conventions** live in `CLAUDE.md` at the repo root. The SDK loads it automatically for pipeline agents (which use `settingSources: ['user', 'local']`) via Claude Code's own CLAUDE.md resolution.
- **User-authored memory** still exists: `selectUserMemory()` scans `~/.bde/memory/` for user notes, and relevant entries are appended to agent prompts. Memory files are per-machine and do not sync.

Do not add a new memory module expecting it to be injected. New conventions belong in `CLAUDE.md`, in a per-agent prompt builder, or in the universal preamble.

## Skills Module

Skills provide actionable guidance for interactive agents:

| Skill                | Trigger                                         | Capabilities                 |
| -------------------- | ----------------------------------------------- | ---------------------------- |
| System Introspection | Agent needs to query system state               | sqlite-query, file-read-logs |
| Task Orchestration   | Agent needs to create tasks or set dependencies | ipc-sprint-create            |
| Code Patterns        | Agent needs to generate BDE-idiomatic code      | code-generation              |
| Debugging            | Agent needs to diagnose a failure               | log-inspection, failure-classification |
| PR Review            | Reviewer agent inspecting a worktree            | diff-analysis, commit-critique |

Each skill defines:

```typescript
export interface BDESkill {
  id: string
  trigger: string // When to use this skill
  description: string // What it does
  guidance: string // Step-by-step instructions + examples
  capabilities?: string[] // What it enables
}
```

Call `getAllSkills()` to get formatted guidance text, or `getSkillList()` for skill objects:

```typescript
import { getAllSkills, getSkillList } from './agent-system/skills'

const skillsText = getAllSkills() // For prompt injection
const skillObjects = getSkillList() // For programmatic access
```

## Prompt Composer

`buildAgentPrompt()` is the universal prompt builder. All agent spawning paths (pipeline, adhoc, assistant, copilot, synthesizer) use this function. Reviewer agents use dedicated builders in `prompt-composer-reviewer.ts`. The dispatcher lives at `src/main/lib/prompt-composer.ts`; per-agent section builders remain under `src/main/agent-manager/`.

**Signature:**

```typescript
export function buildAgentPrompt(input: BuildPromptInput): string
```

**Input interface:**

```typescript
export interface BuildPromptInput {
  agentType: AgentType
  taskContent?: string // Spec, prompt, or user message
  branch?: string // Git branch for pipeline/adhoc agents
  playgroundEnabled?: boolean // Whether to include playground instructions
  messages?: Array<{ role: string; content: string }> // For copilot chat
  formContext?: { title: string; repo: string; spec: string } // For copilot
  codebaseContext?: string // For synthesizer (file tree, relevant files)
  retryCount?: number // 0-based retry count
  previousNotes?: string // failure notes from previous attempt
  maxRuntimeMs?: number | null // max runtime in ms — emits time budget warning
  upstreamContext?: Array<{ title: string; spec: string; partial_diff?: string }>
  crossRepoContract?: string | null
  repoName?: string | null // target repo — scopes BDE-specific memory injection
}
```

**Behavior:**

Every prompt produced by `buildAgentPrompt()` includes:

- The universal preamble (hard rules, npm install, pre-commit verification)
- The agent-type personality (voice, role frame, constraints, behavioral patterns)
- Skills — ONLY for assistant/adhoc agents. Pipeline, reviewer, copilot, and synthesizer agents don't need open-ended exploration guidance.
- User memory — entries matched from `~/.bde/memory/` when relevant.
- Conditional sections: branch info, playground instructions, retry context, upstream task context, cross-repo contract docs, time budget, idle timeout warning, and a definition-of-done checklist (pipeline only).

BDE-specific codebase conventions (IPC patterns, testing rules, architecture rules) are **no longer** injected by this subsystem — they are loaded by the SDK from `CLAUDE.md` at the repo root for agent types that use `settingSources: ['user', 'local']`.

**Example usage (pipeline agent):**

```typescript
import { buildAgentPrompt } from './agent-manager/prompt-composer'

const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent: task.spec || task.prompt || '',
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled,
  maxRuntimeMs: task.max_runtime_ms ?? undefined,
  repoName: task.repo
})
```

**Example usage (adhoc agent):**

```typescript
const prompt = buildAgentPrompt({
  agentType: args.assistant ? 'assistant' : 'adhoc',
  taskContent: args.task
})
```

## Testing

Integration tests live in `src/main/agent-manager/__tests__/integration.test.ts`
and `src/main/agent-system/memory/__tests__/`:

- Verify personality module exports for all agent types (including reviewer and bde-advisor)
- Verify `getAllMemory()` returns `''` regardless of `repoName`
- Verify user memory selection via `selectUserMemory()`
- Verify skills system exports formatted guidance and skill objects
- Verify prompt composer wraps pipeline task content in `## Task Specification`

Run with:

```bash
npm run test:main -- src/main/agent-manager/__tests__/integration.test.ts
```

## Extending the System

### Adding a New Personality

1. Create `src/main/agent-system/personality/new-agent-personality.ts`
2. Export `AgentPersonality` object with voice, roleFrame, constraints, patterns
3. If it's a new top-level `AgentType`, add it to the union in `types.ts`
4. Import in the prompt composer and add a case to `getPersonality()`
5. Add test coverage in `integration.test.ts`

### Adding a New Convention

Do NOT add a memory module — convention injection has been removed (see [Memory Module](#memory-module)).

- **Repo-specific conventions:** add to `CLAUDE.md` at the repo root.
- **Cross-cutting rules:** extend the universal preamble in the prompt composer.
- **Agent-specific guidance:** extend the relevant `prompt-<agent>.ts` builder in `src/main/agent-manager/`.

### Adding a New Skill

1. Create `src/main/agent-system/skills/new-skill.ts`
2. Export `BDESkill` object with id, trigger, description, guidance, capabilities
3. Import in `skills/index.ts`
4. Add to `getSkillList()` array and `getAllSkills()` concatenation
5. Add test coverage for skill object structure

## FAQ

**Q: Why not just rely on CLAUDE.md?**

A: The native agent system layers per-agent-type context on top of CLAUDE.md — personality (pipeline vs. assistant), conditional sections (retry context, time budget, playground hints), and skill injection for interactive agents. CLAUDE.md sets the baseline; the composer tailors it per agent type and per spawn.

**Q: Do pipeline agents get skills?**

A: No. Skills are only for assistant and adhoc agents. Pipeline agents execute specs, so they don't need open-ended exploration guidance.

**Q: Why don't I see `## BDE Conventions` in agent prompts anymore?**

A: It was removed in the Option A debranding decision. The old memory modules (IPC conventions, testing patterns, architecture rules) were tightly coupled to BDE internals and misled agents working on other repos. Those same rules live in `CLAUDE.md` at the repo root — pipeline agents pick them up via the SDK's CLAUDE.md resolution.

**Q: How do I know an agent is using the native system?**

A: All agent prompts use it — there is no opt-out. Check the agent's initial prompt in the Agents view console. You should see `## Voice`, `## Your Role`, and `## Constraints` sections emitted by the personality module.

---

For spec and plan documents, see:

- `docs/superpowers/specs/2026-03-31-bde-native-agent-system-design.md`
- `docs/superpowers/plans/2026-03-31-bde-native-agent-system.md`
