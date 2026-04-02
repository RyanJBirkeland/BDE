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
│   └── assistant-personality.ts    # Assistant/adhoc agent personality
├── memory/
│   ├── ipc-conventions.ts          # IPC handler patterns, safeHandle() usage
│   ├── testing-patterns.ts         # Coverage thresholds, test organization
│   ├── architecture-rules.ts       # Process boundaries, Zustand conventions
│   └── index.ts                    # getAllMemory() aggregator
└── skills/
    ├── types.ts                    # BDESkill interface
    ├── system-introspection.ts     # Skill for querying SQLite, reading logs
    ├── task-orchestration.ts       # Skill for creating tasks, setting dependencies
    ├── code-patterns.ts            # Skill for generating BDE-idiomatic code
    └── index.ts                    # getAllSkills() and getSkillList() exports
```

## Agent Types

BDE spawns five types of agents, each with tailored personalities:

| Type | Spawned by | Interactive | Tool access | Worktree | Personality |
|------|-----------|------------|-------------|----------|-------------|
| Pipeline | Agent Manager (auto) | No | Full | Yes (isolated) | Concise, action-oriented |
| Adhoc | User (Agents view) | Yes | Full | No (repo dir) | Same as pipeline |
| Assistant | User (Agents view) | Yes | Full | No (repo dir) | Conversational, proactive |
| Copilot | Task Workbench | Yes | None | No | Minimal (text-only) |
| Synthesizer | Task Workbench | No | None | No | Minimal (spec generation) |

**Pipeline agents** execute sprint tasks autonomously. They work in isolated git worktrees, commit changes, push branches, and open PRs. Their personality is concise and execution-focused.

**Assistant agents** are interactive helpers. They're more conversational, proactively suggest BDE tools (Dev Playground, sprint tasks), and help users understand the codebase.

**Skills** are only injected for assistant and adhoc agents. Pipeline agents execute specs, not open-ended exploration, so they don't receive interactive skills.

## Personality Module

Each personality defines four fields:

```typescript
export interface AgentPersonality {
  voice: string          // Tone and style guidelines (concise, conversational, etc.)
  roleFrame: string      // Identity framing ("You are a BDE pipeline agent...")
  constraints: string[]  // Hard boundaries (never push to main, run tests, etc.)
  patterns: string[]     // Communication and behavior patterns
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
    'NEVER push to main - only to your assigned branch',
    'NEVER commit secrets or .env files',
    'Run npm install if node_modules/ is missing',
    'Run tests after changes: npm test && npm run typecheck',
    'Use TypeScript strict mode conventions'
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
- **Testing Patterns** — Coverage thresholds (72% stmts, 66% branches, 70% functions, 74% lines), test organization
- **Architecture Rules** — Process boundaries (main/preload/renderer), Zustand store patterns, IPC surface minimalism

Call `getAllMemory()` to get concatenated convention text:

```typescript
import { getAllMemory } from './agent-system/memory'

const conventions = getAllMemory()
// Returns: "IPC Conventions\n...\n\n---\n\nTesting Patterns\n...\n\n---\n\nArchitecture Rules\n..."
```

## Skills Module

Skills provide actionable guidance for interactive agents:

| Skill | Trigger | Capabilities |
|-------|---------|--------------|
| System Introspection | Agent needs to query system state | sqlite-query, file-read-logs |
| Task Orchestration | Agent needs to create tasks or set dependencies | ipc-sprint-create, queue-api-call |
| Code Patterns | Agent needs to generate BDE-idiomatic code | code-generation |

Each skill defines:

```typescript
export interface BDESkill {
  id: string
  trigger: string         // When to use this skill
  description: string     // What it does
  guidance: string        // Step-by-step instructions + examples
  capabilities?: string[] // What it enables
}
```

Call `getAllSkills()` to get formatted guidance text, or `getSkillList()` for skill objects:

```typescript
import { getAllSkills, getSkillList } from './agent-system/skills'

const skillsText = getAllSkills()      // For prompt injection
const skillObjects = getSkillList()    // For programmatic access
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
  taskContent?: string                 // Spec, prompt, or user message
  branch?: string                      // Git branch for pipeline/adhoc agents
  playgroundEnabled?: boolean          // Whether to include playground instructions
  messages?: Array<{ role: string; content: string }>  // For copilot chat
  formContext?: { title: string; repo: string; spec: string }  // For copilot
  codebaseContext?: string             // For synthesizer (file tree, relevant files)
  useNativeSystem?: boolean            // Enable BDE-native personality + memory + skills (default: false)
}
```

**Behavior:**

- **When `useNativeSystem` is `true`:**
  - Injects personality (voice, role, constraints) for the agent type
  - Injects all memory modules (IPC conventions, testing patterns, architecture rules)
  - Injects skills ONLY for assistant/adhoc agents (not pipeline)
  - Adds note: "You have BDE-native skills and conventions loaded..."

- **When `useNativeSystem` is `false` or `undefined`:**
  - Uses legacy `ROLE_INSTRUCTIONS` per agent type
  - No personality, memory, or skills injection
  - Backward compatible with existing behavior

**Example usage (pipeline agent):**

```typescript
import { buildAgentPrompt } from './agent-manager/prompt-composer'
import { getSettingJson } from './settings'

const useNativeSystem = getSettingJson<boolean>('agentManager.useNativeSystem') ?? false

const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent: task.spec || task.prompt || '',
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled,
  useNativeSystem
})
```

**Example usage (adhoc agent):**

```typescript
const useNativeSystem = getSettingJson<boolean>('agentManager.useNativeSystem') ?? false

const prompt = buildAgentPrompt({
  agentType: args.assistant ? 'assistant' : 'adhoc',
  taskContent: args.task,
  useNativeSystem
})
```

## Migration Guide

### Phase 1: Gradual Rollout (Current)

The `useNativeSystem` flag defaults to **false**. All existing agents use legacy prompts. Users can opt-in via **Settings > Agent Manager > Use native agent system**.

**How to enable:**
1. Open BDE Settings (Cmd+7)
2. Navigate to Agent Manager tab
3. Check "Use native agent system"
4. Click Save
5. Restart BDE

After restart, all spawned agents (pipeline, adhoc, assistant) will receive BDE-specific personality, memory, and skills.

### Phase 2: Monitor and Iterate

- Collect feedback from agents running with native system enabled
- Refine personality voice and constraints based on agent behavior
- Expand memory modules with new conventions as patterns emerge
- Add new skills for common agent tasks (e.g., PR review, dependency analysis)

### Phase 3: Deprecate Legacy (Future)

Once native system is proven stable:
1. Flip default to `useNativeSystem: true` in migration v19
2. Remove toggle from Settings UI
3. Delete `ROLE_INSTRUCTIONS` map from prompt-composer.ts
4. Remove `useNativeSystem` parameter (always inject native system)

## Testing

Integration tests live in `src/main/agent-manager/__tests__/integration.test.ts`:

- Verify personality module exports for all agent types
- Verify memory aggregation returns all conventions
- Verify skills system exports formatted guidance and skill objects
- Verify prompt composer conditionally injects native system based on flag
- Verify backward compatibility when flag is false/undefined

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

A: CLAUDE.md is loaded by the SDK for all sessions. The native agent system allows us to inject different contexts per agent type (pipeline vs assistant), control skill availability, and gradually migrate without affecting all agents at once.

**Q: Do pipeline agents get skills?**

A: No. Skills are only for assistant and adhoc agents. Pipeline agents execute specs, so they don't need open-ended exploration guidance.

**Q: Can I force an agent to use native system without changing settings?**

A: Yes. When calling `buildAgentPrompt()` directly, pass `useNativeSystem: true`. The setting is just a convenience for user-spawned agents.

**Q: What happens if I enable native system mid-sprint?**

A: Active pipeline agents keep their original prompt. Only newly spawned agents (after the setting change + app restart) will use native system.

**Q: How do I know if an agent is using native system?**

A: Check the agent's initial prompt in the Agents view console. Native system prompts have `## Voice`, `## Your Role`, `## Constraints`, and `## BDE Conventions` sections. Legacy prompts have `## Your Mission`.

---

For spec and plan documents, see:
- `docs/superpowers/specs/2026-03-31-bde-native-agent-system-design.md`
- `docs/superpowers/plans/2026-03-31-bde-native-agent-system.md`
