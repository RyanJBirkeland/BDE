# BDE Native Agent System

BDE's native agent system replaces generic third-party plugin scripts with custom, BDE-specific infrastructure. This system provides agents with deep knowledge of BDE's architecture, conventions, and workflows.

## Overview

The agent system consists of four core modules:

1. **Personality** — Voice, role framing, constraints, and behavioral patterns per agent type
2. **Memory** — Shared conventions (IPC patterns, testing standards, architecture rules) all agents should know
3. **Skills** — Actionable guidance for interactive agents (system introspection, task orchestration, code generation)
4. **Prompt Composer** — Universal prompt builder that injects native system content conditionally

## Architecture

```
src/main/agent-system/
├── personality/
│   ├── types.ts                    # AgentPersonality interface
│   ├── pipeline-personality.ts     # Pipeline agent personality
│   ├── adhoc-personality.ts        # Adhoc (user-spawned executor)
│   ├── assistant-personality.ts    # Interactive assistant
│   ├── copilot-personality.ts     # Workbench spec-drafting copilot
│   └── synthesizer-personality.ts # Single-turn spec generator
├── memory/
│   ├── ipc-conventions.ts          # IPC handler patterns, safeHandle() usage
│   ├── testing-patterns.ts         # Coverage workflow, test organization
│   ├── architecture-rules.ts       # Process boundaries, Zustand conventions
│   └── index.ts                    # getAllMemory() aggregator (repo-aware)
└── skills/
    ├── types.ts                    # BDESkill interface
    ├── system-introspection.ts     # Skill for querying SQLite, reading logs
    ├── task-orchestration.ts       # Skill for creating tasks, setting dependencies
    ├── code-patterns.ts            # Skill for generating BDE-idiomatic code
    └── index.ts                    # getAllSkills() and getSkillList() exports
```

## Agent Types

BDE spawns five types of agents, each with tailored personalities:

| Type        | Spawned by           | Interactive | Tool access | Worktree       | Personality               |
| ----------- | -------------------- | ----------- | ----------- | -------------- | ------------------------- |
| Pipeline    | Agent Manager (auto) | No          | Full        | Yes (isolated) | Concise, action-oriented  |
| Adhoc       | User (Agents view)   | Yes         | Full        | No (repo dir)  | Same as pipeline          |
| Assistant   | User (Agents view)   | Yes         | Full        | No (repo dir)  | Conversational, proactive |
| Copilot     | Task Workbench       | Yes         | None        | No             | Minimal (text-only)       |
| Synthesizer | Task Workbench       | No          | None        | No             | Minimal (spec generation) |

**Pipeline agents** execute sprint tasks autonomously. They work in isolated git worktrees, commit changes, push branches, and open PRs. Their personality is concise and execution-focused.

**Assistant agents** are interactive helpers. They're more conversational, proactively suggest BDE tools (Dev Playground, sprint tasks), and help users understand the codebase.

**Skills** are only injected for assistant and adhoc agents. Pipeline agents execute specs, not open-ended exploration, so they don't receive interactive skills.

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

Memory modules document BDE conventions that all agents should internalize:

- **IPC Conventions** — `safeHandle()` wrapper usage, handler registration patterns, testing IPC handlers
- **Testing Patterns** — Coverage workflow (`npm run test:coverage` runs the same checks CI enforces; thresholds live in `vitest.config.ts`, never hardcoded in prompts), test organization
- **Architecture Rules** — Process boundaries (main/preload/renderer), Zustand store patterns, IPC surface minimalism

Call `getAllMemory({ repoName })` to get the concatenated convention text for
the agent's target repo. Pass `repoName: 'bde'` (or omit it) to receive all
modules; pass any other repo name to receive an empty string:

```typescript
import { getAllMemory } from './agent-system/memory'

const bdeConventions = getAllMemory({ repoName: 'bde' })
// "IPC Conventions\n...\n\n---\n\nTesting Patterns\n...\n\n---\n\nArchitecture Rules\n..."

const nonBdeConventions = getAllMemory({ repoName: 'life-os' })
// ""
```

## Skills Module

Skills provide actionable guidance for interactive agents:

| Skill                | Trigger                                         | Capabilities                 |
| -------------------- | ----------------------------------------------- | ---------------------------- |
| System Introspection | Agent needs to query system state               | sqlite-query, file-read-logs |
| Task Orchestration   | Agent needs to create tasks or set dependencies | ipc-sprint-create            |
| Code Patterns        | Agent needs to generate BDE-idiomatic code      | code-generation              |

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

`buildAgentPrompt()` is the universal prompt builder. All agent spawning paths (pipeline, adhoc, assistant, copilot, synthesizer) use this function.

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

The native agent system is always active. Every prompt produced by
`buildAgentPrompt()` includes:

- The universal preamble (hard rules, npm install, pre-commit verification)
- The agent-type personality (voice, role frame, constraints, behavioral patterns)
- Memory modules — but only when targeting the BDE repo (`repoName === 'bde'` or
  unset for legacy callers). Non-BDE repos skip BDE-specific guidance to avoid
  misleading agents working elsewhere.
- Skills — ONLY for assistant/adhoc agents. Pipeline agents execute specs and
  don't need open-ended exploration guidance.
- Conditional sections: branch info, playground instructions, retry context,
  upstream task context, cross-repo contract docs, time budget, idle timeout
  warning, and a definition-of-done checklist (pipeline only).

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
and `src/main/agent-system/memory/__tests__/memory.test.ts`:

- Verify personality module exports for all agent types
- Verify memory aggregation returns all conventions for BDE and an empty
  string for non-BDE repos
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
3. Import in `prompt-composer.ts` and add case to `getPersonality()` switch
4. Add test coverage in `integration.test.ts`

### Adding a New Memory Module

1. Create `src/main/agent-system/memory/new-convention.ts`
2. Export string constant with convention documentation
3. Import in `memory/index.ts` and add to `getAllMemory()` return array
4. Verify it appears in prompts via test

### Adding a New Skill

1. Create `src/main/agent-system/skills/new-skill.ts`
2. Export `BDESkill` object with id, trigger, description, guidance, capabilities
3. Import in `skills/index.ts`
4. Add to `getSkillList()` array and `getAllSkills()` concatenation
5. Add test coverage for skill object structure

## FAQ

**Q: Why not just improve CLAUDE.md?**

A: CLAUDE.md is loaded by the SDK for all sessions. The native agent system allows us to inject different contexts per agent type (pipeline vs assistant), control skill availability, and target memory modules to specific repos.

**Q: Do pipeline agents get skills?**

A: No. Skills are only for assistant and adhoc agents. Pipeline agents execute specs, so they don't need open-ended exploration guidance.

**Q: Why doesn't a non-BDE agent see BDE Conventions?**

A: The IPC, testing, and architecture memory modules are tightly coupled to the BDE codebase. Injecting them into agents working on other repos wastes tokens and produces irrelevant guidance. The composer checks `repoName` via `isBdeRepo()` and skips those modules outside BDE.

**Q: How do I know an agent is using the native system?**

A: All agent prompts use it — there is no opt-out. Check the agent's initial prompt in the Agents view console. You should see `## Voice`, `## Your Role`, `## Constraints`, and (for BDE tasks) `## BDE Conventions` sections.

---

For spec and plan documents, see:

- `docs/superpowers/specs/2026-03-31-bde-native-agent-system-design.md`
- `docs/superpowers/plans/2026-03-31-bde-native-agent-system.md`
