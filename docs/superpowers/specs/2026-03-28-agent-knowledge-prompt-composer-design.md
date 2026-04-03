# Agent Knowledge & Prompt Composer — Design Spec

**Date**: 2026-03-28
**Status**: Approved

## Problem

BDE has 5 separate SDK spawn points that each assemble agent prompts independently. None pass `settingSources` to the SDK, so agents never receive CLAUDE.md context from the machine's directory hierarchy. The spec synthesizer works around this by manually reading CLAUDE.md via `fs.readFile`. There is no shared agent identity, no shared conventions injection, and no way to spawn a general-purpose BDE assistant agent.

### Current Spawn Points

| File                                    | Purpose                         | Gets CLAUDE.md?         | Gets preamble? |
| --------------------------------------- | ------------------------------- | ----------------------- | -------------- |
| `src/main/agent-manager/sdk-adapter.ts` | Pipeline task agents            | No                      | No             |
| `src/main/adhoc-agent.ts`               | User-spawned interactive agents | No                      | No             |
| `src/main/handlers/workbench.ts`        | Spec chat/generation (copilot)  | No                      | No             |
| `src/main/services/spec-synthesizer.ts` | AI spec synthesis               | Manual fs.readFile hack | No             |
| `src/main/spec-semantic-check.ts`       | Spec validation                 | No                      | No             |

## Solution

Two changes:

1. **`settingSources: ['user', 'project', 'local']`** on all SDK `query()` calls — the SDK loads the full CLAUDE.md hierarchy automatically (global `~/CLAUDE.md`, project-level, any subdirectory-level, plus settings files)
2. **`prompt-composer.ts`** — a single module that builds agent prompts with a universal preamble + role-specific instructions + task context + operational appendix

### Architecture

```
SDK query() with settingSources: ['user', 'project', 'local']
  → Automatically loads ~/CLAUDE.md, ~/projects/BDE/CLAUDE.md, etc.
  → Loads ~/.claude/settings.json, .claude/settings.json, .claude/settings.local.json
  (Layer 2: repo/machine knowledge — handled entirely by SDK)

prompt-composer.ts: buildAgentPrompt({ agentType, task?, branch?, ... })
  ├── Layer 1: Universal preamble + role-specific instructions
  ├── Layer 3: Task context (spec, prompt, messages, etc.)
  └── Operational appendix (git branch, npm install, playground)
```

### Agent Types

| Type          | Role                      | Used by               | Tools? | Interactive? |
| ------------- | ------------------------- | --------------------- | ------ | ------------ |
| `pipeline`    | Autonomous task execution | `run-agent.ts`        | Yes    | No           |
| `assistant`   | Interactive BDE helper    | `adhoc-agent.ts`      | Yes    | Yes          |
| `adhoc`       | User-spawned single task  | `adhoc-agent.ts`      | Yes    | Yes          |
| `copilot`     | Workbench spec helper     | `workbench.ts`        | No     | No           |
| `synthesizer` | Spec generation           | `spec-synthesizer.ts` | No     | No           |

### Preamble Content

**Universal section** (all agents):

- Identity: "You are a BDE agent"
- Hard rules: never push to main, never commit secrets, run tests, use project commit format
- Environment: npm install if needed, project uses TypeScript strict mode

**Role-specific sections**:

- `pipeline`: Execute the sprint task spec. Commit, push to assigned branch. Run tests before pushing.
- `assistant`: Interactive helper. Help the user understand the codebase, debug, explore, answer questions. Full tool access.
- `adhoc`: Execute the user's request. Commit, push to assigned branch.
- `copilot`: Text-only assistant for crafting task specs. No tool access. Keep responses under 500 words.
- `synthesizer`: Generate task spec markdown from codebase context. Output markdown only.

## Integration Changes

### sdk-adapter.ts

Add `settingSources` to both `spawnViaSdk()` and ensure CLI fallback also benefits:

```typescript
options: {
  ...existing,
  settingSources: ['user', 'project', 'local']
}
```

### run-agent.ts

Replace inline prompt augmentation (lines 152-166) with:

```typescript
import { buildAgentPrompt } from './prompt-composer'

const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent: task.spec || task.prompt || task.title || '',
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled
})
```

### adhoc-agent.ts

Add assistant mode, use prompt composer:

```typescript
const prompt = buildAgentPrompt({
  agentType: args.assistant ? 'assistant' : 'adhoc',
  taskContent: args.task
})
```

### workbench.ts

Replace `buildChatPrompt()` internals to delegate to composer for the preamble, keeping the message history formatting.

### spec-synthesizer.ts

Remove manual `fs.readFile` of CLAUDE.md — `settingSources` handles this. Use composer for prompt structure.

## BDE Assistant Agent

The assistant is an adhoc agent spawned with `agentType: 'assistant'`. No new spawn infrastructure needed. Differences from regular adhoc:

- Preamble includes assistant-specific instructions (explore, explain, debug)
- Gets full CLAUDE.md hierarchy via `settingSources`
- Full tool access, multi-turn via `streamInput()`

**UI**: "Launch BDE Assistant" option in Agents view + command palette.

## File Changes Summary

| File                                        | Change                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `src/main/agent-manager/prompt-composer.ts` | **New** — buildAgentPrompt() + preamble templates    |
| `src/main/agent-manager/sdk-adapter.ts`     | Add `settingSources` to SDK options                  |
| `src/main/agent-manager/run-agent.ts`       | Use buildAgentPrompt(), remove inline augmentation   |
| `src/main/adhoc-agent.ts`                   | Use buildAgentPrompt(), add assistant flag           |
| `src/main/handlers/workbench.ts`            | Use buildAgentPrompt() for copilot preamble          |
| `src/main/services/spec-synthesizer.ts`     | Use buildAgentPrompt(), remove manual CLAUDE.md read |
| `src/shared/types.ts`                       | Add `AgentType` type, `assistant` flag to spawn args |
| `src/preload/index.ts` + `.d.ts`            | Expose assistant spawn option                        |

## YAGNI — Explicitly Out of Scope

- No per-repo knowledge directories (CLAUDE.md is sufficient)
- No dynamic context selection or RAG
- No knowledge versioning beyond git
- No embedding-based retrieval
