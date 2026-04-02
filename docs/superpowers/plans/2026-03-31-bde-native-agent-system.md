# BDE Native Agent System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native BDE agent system that replaces third-party plugins with BDE-aware personality, memory, and skills modules.

**Architecture:** Create `src/main/agent-system/` with three subsystems: personality (voice/role per agent type), memory (BDE conventions), and skills (interactive agent guidance). Enhance existing `prompt-composer.ts` to conditionally inject these based on `useNativeSystem` flag.

**Tech Stack:** TypeScript, existing BDE infrastructure (no new dependencies)

---

## File Structure

**New files:**
```
src/main/agent-system/
├── personality/
│   ├── types.ts                   # AgentPersonality interface
│   ├── pipeline-personality.ts    # Pipeline agent personality
│   ├── assistant-personality.ts   # Assistant agent personality
│   └── __tests__/
│       └── personality.test.ts    # Personality system tests
├── memory/
│   ├── ipc-conventions.ts         # IPC memory module
│   ├── testing-patterns.ts        # Testing memory module
│   ├── architecture-rules.ts      # Architecture memory module
│   ├── index.ts                   # Memory consolidator
│   └── __tests__/
│       └── memory.test.ts         # Memory system tests
├── skills/
│   ├── types.ts                   # BDESkill interface
│   ├── system-introspection.ts    # Introspection skill
│   ├── task-orchestration.ts      # Orchestration skill
│   ├── code-patterns.ts           # Code patterns skill
│   ├── index.ts                   # Skill registry
│   └── __tests__/
│       └── skills.test.ts         # Skills system tests
└── __tests__/
    └── integration.test.ts        # Integration tests
```

**Modified files:**
```
src/main/agent-manager/prompt-composer.ts    # Add native system integration
src/main/agent-manager/__tests__/prompt-composer.test.ts  # Add native system tests
src/shared/types.ts                          # Add useNativeSystem to spawn options
src/main/db.ts                               # Add agentManager.useNativeSystem setting
```

---

## Task 1: Foundation - Personality System

**Files:**
- Create: `src/main/agent-system/personality/types.ts`
- Create: `src/main/agent-system/personality/pipeline-personality.ts`
- Create: `src/main/agent-system/personality/assistant-personality.ts`
- Test: `src/main/agent-system/personality/__tests__/personality.test.ts`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/main/agent-system/personality/__tests__
```

- [ ] **Step 2: Write personality types**

Create `src/main/agent-system/personality/types.ts`:

```typescript
/**
 * Agent personality definition - voice, role, constraints, patterns
 */
export interface AgentPersonality {
  voice: string          // Tone and style guidelines
  roleFrame: string      // Identity framing ("You are a...")
  constraints: string[]  // Hard boundaries and rules
  patterns: string[]     // Communication and behavior patterns
}

export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer'
```

- [ ] **Step 3: Write pipeline personality**

Create `src/main/agent-system/personality/pipeline-personality.ts`:

```typescript
import type { AgentPersonality } from './types'

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

- [ ] **Step 4: Write assistant personality**

Create `src/main/agent-system/personality/assistant-personality.ts`:

```typescript
import type { AgentPersonality } from './types'

export const assistantPersonality: AgentPersonality = {
  voice: `Be conversational but concise. Explain your reasoning briefly.
Proactively suggest BDE-specific tools (Dev Playground for UI work, task creation
for new work). Ask clarifying questions when requirements are ambiguous.`,

  roleFrame: `You are an interactive BDE assistant helping users understand the
codebase, debug issues, and orchestrate work through the sprint system.`,

  constraints: [
    'Full tool access - can read/write files, run commands, spawn subagents',
    'Work in repo directory directly (not worktrees)',
    'Can create sprint tasks via IPC calls',
    'Can query SQLite database for system state'
  ],

  patterns: [
    'Suggest creating sprint tasks for multi-step work',
    'Recommend Dev Playground for visual/UI exploration',
    'Reference BDE conventions (safeHandle, Zustand patterns, etc.)',
    'Help users understand task dependencies and pipeline flow'
  ]
}
```

- [ ] **Step 5: Write failing tests**

Create `src/main/agent-system/personality/__tests__/personality.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { pipelinePersonality } from '../pipeline-personality'
import { assistantPersonality } from '../assistant-personality'

describe('Personality System', () => {
  describe('pipeline personality', () => {
    it('should have concise voice', () => {
      expect(pipelinePersonality.voice).toContain('concise')
      expect(pipelinePersonality.voice).toContain('action-oriented')
    })

    it('should frame role as pipeline agent', () => {
      expect(pipelinePersonality.roleFrame).toContain('pipeline agent')
      expect(pipelinePersonality.roleFrame).toContain('sprint task')
    })

    it('should include git constraints', () => {
      expect(pipelinePersonality.constraints).toContain(expect.stringContaining('NEVER push to main'))
      expect(pipelinePersonality.constraints).toContain(expect.stringContaining('Run tests'))
    })

    it('should include reporting patterns', () => {
      expect(pipelinePersonality.patterns).toContain(expect.stringContaining('what you did'))
    })
  })

  describe('assistant personality', () => {
    it('should have conversational voice', () => {
      expect(assistantPersonality.voice).toContain('conversational')
      expect(assistantPersonality.voice).toContain('concise')
    })

    it('should frame role as interactive assistant', () => {
      expect(assistantPersonality.roleFrame).toContain('interactive')
      expect(assistantPersonality.roleFrame).toContain('BDE assistant')
    })

    it('should include full tool access', () => {
      expect(assistantPersonality.constraints).toContain(expect.stringContaining('Full tool access'))
    })

    it('should include BDE-specific patterns', () => {
      expect(assistantPersonality.patterns).toContain(expect.stringContaining('sprint tasks'))
      expect(assistantPersonality.patterns).toContain(expect.stringContaining('Dev Playground'))
    })
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd ~/projects/BDE
npm test src/main/agent-system/personality/__tests__/personality.test.ts
```

Expected: All tests PASS

- [ ] **Step 7: Commit personality system**

```bash
git add src/main/agent-system/personality/
git commit -m "feat: add agent personality system (pipeline + assistant)"
```

---

## Task 2: Memory System - IPC Conventions

**Files:**
- Create: `src/main/agent-system/memory/ipc-conventions.ts`

- [ ] **Step 1: Write IPC conventions memory**

Create `src/main/agent-system/memory/ipc-conventions.ts`:

```typescript
/**
 * IPC conventions - memory module for BDE IPC patterns
 */
export const ipcConventions = `## IPC Conventions

### Handler Registration
- All handlers in src/main/handlers/ modules
- Export registerXHandlers() function
- Register in src/main/index.ts
- Update src/preload/index.ts AND src/preload/index.d.ts

### Handler Implementation
- ALWAYS use safeHandle() wrapper for error logging
- Validate inputs at handler boundary
- Return typed results (never throw to renderer)
- Use execFileAsync (not execSync) for shell commands

### Testing
- Each handler module needs __tests__/module-name.test.ts
- Assert exact handler count (catches missing registrations)
- Test error paths (not just happy paths)

### Example
\`\`\`typescript
import { safeHandle } from '../handlers-shared'

export function registerMyHandlers() {
  safeHandle('my:channel', async (payload) => {
    // Validate inputs
    if (!payload.id) throw new Error('id required')
    // Handler logic
    return result
  })
}
\`\`\`
`
```

- [ ] **Step 2: Commit IPC conventions**

```bash
git add src/main/agent-system/memory/ipc-conventions.ts
git commit -m "feat: add IPC conventions memory module"
```

---

## Task 3: Memory System - Testing Patterns

**Files:**
- Create: `src/main/agent-system/memory/testing-patterns.ts`

- [ ] **Step 1: Write testing patterns memory**

Create `src/main/agent-system/memory/testing-patterns.ts`:

```typescript
/**
 * Testing patterns - memory module for BDE testing conventions
 */
export const testingPatterns = `## Testing Patterns

### Coverage Requirements (CI enforced)
- 72% statements
- 66% branches (tightest — test ALL conditionals)
- 70% functions
- 74% lines

### Critical Test Cases
- Conditional branches (if/else, ternaries)
- Error states and loading states
- Empty arrays / null checks
- User interactions (clicks, keyboard events)

### Test Organization
- Renderer: src/renderer/src/**/__tests__/
- Main: src/main/__tests__/
- Integration: src/main/__tests__/integration/
- E2E: e2e/

### Running Tests
- npm test — renderer unit
- npm run test:main — main process integration
- npm run test:coverage — enforce thresholds (CI)
- npm run test:e2e — Playwright E2E

### Common Gotchas
- Set Zustand state BEFORE render() in tests
- Never mix async userEvent with sync fireEvent
- Mock better-sqlite3 in main tests
- Rebuild native modules after node tests: npx electron-rebuild -f -w better-sqlite3

### Example
\`\`\`typescript
describe('MyComponent', () => {
  it('should handle error state', () => {
    const store = useMyStore.getState()
    store.setError(new Error('test'))
    render(<MyComponent />)
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })
})
\`\`\`
`
```

- [ ] **Step 2: Commit testing patterns**

```bash
git add src/main/agent-system/memory/testing-patterns.ts
git commit -m "feat: add testing patterns memory module"
```

---

## Task 4: Memory System - Architecture Rules

**Files:**
- Create: `src/main/agent-system/memory/architecture-rules.ts`

- [ ] **Step 1: Write architecture rules memory**

Create `src/main/agent-system/memory/architecture-rules.ts`:

```typescript
/**
 * Architecture rules - memory module for BDE architectural patterns
 */
export const architectureRules = `## Architecture Rules

### Process Boundaries
- Main: Node.js APIs, SQLite, fs, child processes
- Preload: IPC bridge only (no business logic)
- Renderer: React UI, Zustand state, no direct fs/db

### Data Flow
1. Renderer → window.api.method()
2. Preload → ipcRenderer.invoke()
3. Main handler (safeHandle) processes
4. Main broadcasts via ipcMain.emit()
5. Renderer subscribers update Zustand

### IPC Surface Minimalism
- Coarse-grained channels (not chatty)
- Pass aggregated data
- Use SQLite triggers + file watchers for reactive updates
- Broadcast for 1-to-many updates

### Zustand Store Rules
- Max one store per domain concern
- Never nest stores (no store calling another's setState)
- Use selectors for stable references
- Aggregate with useShallow for 5+ fields

### File Organization
- Shared types: src/shared/ (all processes)
- Main-only: src/main/
- Renderer-only: src/renderer/src/
- Never import main/ from renderer/ or vice versa

### Example
\`\`\`typescript
// Good: Stable selector
const title = useTaskStore(s => s.currentTask?.title)

// Bad: New object every render
const task = useTaskStore(s => ({ title: s.title, status: s.status }))

// Good: useShallow for multiple fields
const { title, status } = useTaskStore(useShallow(s => ({
  title: s.title,
  status: s.status
})))
\`\`\`
`
```

- [ ] **Step 2: Commit architecture rules**

```bash
git add src/main/agent-system/memory/architecture-rules.ts
git commit -m "feat: add architecture rules memory module"
```

---

## Task 5: Memory System - Consolidator

**Files:**
- Create: `src/main/agent-system/memory/index.ts`
- Test: `src/main/agent-system/memory/__tests__/memory.test.ts`

- [ ] **Step 1: Write memory consolidator**

Create `src/main/agent-system/memory/index.ts`:

```typescript
import { ipcConventions } from './ipc-conventions'
import { testingPatterns } from './testing-patterns'
import { architectureRules } from './architecture-rules'

/**
 * Consolidate all memory modules into a single markdown string
 */
export function getAllMemory(): string {
  return [
    ipcConventions,
    testingPatterns,
    architectureRules
  ].join('\n\n---\n\n')
}
```

- [ ] **Step 2: Write failing tests**

Create `src/main/agent-system/memory/__tests__/memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getAllMemory } from '../index'
import { ipcConventions } from '../ipc-conventions'
import { testingPatterns } from '../testing-patterns'
import { architectureRules } from '../architecture-rules'

describe('Memory System', () => {
  it('should consolidate all memory modules', () => {
    const memory = getAllMemory()
    expect(memory).toContain('IPC Conventions')
    expect(memory).toContain('Testing Patterns')
    expect(memory).toContain('Architecture Rules')
  })

  it('should separate modules with markdown dividers', () => {
    const memory = getAllMemory()
    expect(memory).toContain('---')
  })

  it('should include IPC conventions content', () => {
    expect(ipcConventions).toContain('safeHandle')
    expect(ipcConventions).toContain('Handler Registration')
  })

  it('should include testing patterns content', () => {
    expect(testingPatterns).toContain('72%')
    expect(testingPatterns).toContain('Coverage Requirements')
  })

  it('should include architecture rules content', () => {
    expect(architectureRules).toContain('Process Boundaries')
    expect(architectureRules).toContain('Zustand')
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test src/main/agent-system/memory/__tests__/memory.test.ts
```

Expected: All tests PASS

- [ ] **Step 4: Commit memory consolidator**

```bash
git add src/main/agent-system/memory/
git commit -m "feat: add memory system consolidator"
```

---

## Task 6: Skills System - Types and Infrastructure

**Files:**
- Create: `src/main/agent-system/skills/types.ts`

- [ ] **Step 1: Write skill types**

Create `src/main/agent-system/skills/types.ts`:

```typescript
/**
 * BDE skill definition - structured guidance for interactive agents
 */
export interface BDESkill {
  id: string              // Unique identifier (e.g., 'system-introspection')
  trigger: string         // When to suggest this skill
  description: string     // What it helps with
  guidance: string        // Markdown content (instructions, examples)
  capabilities?: string[] // Optional: IPC calls, DB queries this skill enables
}
```

- [ ] **Step 2: Commit skill types**

```bash
git add src/main/agent-system/skills/types.ts
git commit -m "feat: add skill types definition"
```

---

## Task 7: Skills System - System Introspection

**Files:**
- Create: `src/main/agent-system/skills/system-introspection.ts`

- [ ] **Step 1: Write system introspection skill**

Create `src/main/agent-system/skills/system-introspection.ts`:

```typescript
import type { BDESkill } from './types'

export const systemIntrospectionSkill: BDESkill = {
  id: 'system-introspection',
  trigger: 'User asks about queue health, active agents, task status, or logs',
  description: 'Query BDE system state (queue, agents, logs, dependencies)',
  guidance: `# System Introspection

You can directly inspect BDE's internal state:

## Check Queue Health
Query SQLite:
\`\`\`sql
SELECT status, COUNT(*) FROM sprint_tasks GROUP BY status;
\`\`\`

Look for:
- High blocked count → dependency issues
- Stalled active tasks → check started_at (>1hr)

## View Active Agents
\`\`\`sql
SELECT id, status, task, started_at
FROM agent_runs
WHERE status='running';
\`\`\`

Cross-reference with ~/.bde/agent-manager.log for detailed output.

## Inspect Task Status
\`\`\`sql
SELECT * FROM sprint_tasks WHERE id='...';
\`\`\`

Check depends_on field for dependency chains.

## Diagnose Pipeline Stalls
- Tasks stuck in 'active' for >1hr (check started_at)
- Check ~/.bde/agent-manager.log for watchdog timeouts
- Verify worktrees exist: ls ~/worktrees/bde/agent-*

## Example Usage
\`\`\`bash
# Check queue health
sqlite3 ~/.bde/bde.db "SELECT status, COUNT(*) FROM sprint_tasks GROUP BY status"

# Read recent agent logs
tail -100 ~/.bde/agent-manager.log
\`\`\`
`,
  capabilities: ['sqlite-query', 'file-read-logs']
}
```

- [ ] **Step 2: Commit system introspection skill**

```bash
git add src/main/agent-system/skills/system-introspection.ts
git commit -m "feat: add system introspection skill"
```

---

## Task 8: Skills System - Task Orchestration

**Files:**
- Create: `src/main/agent-system/skills/task-orchestration.ts`

- [ ] **Step 1: Write task orchestration skill**

Create `src/main/agent-system/skills/task-orchestration.ts`:

```typescript
import type { BDESkill } from './types'

export const taskOrchestrationSkill: BDESkill = {
  id: 'task-orchestration',
  trigger: 'User wants to create tasks, set dependencies, or manage queue',
  description: 'Create and manage sprint tasks with dependencies',
  guidance: `# Task Orchestration

## Creating Tasks
Use the sprint:create IPC channel:
- Requires: title, repo, prompt or spec
- spec = structured markdown with ## headings (for status='queued')
- prompt = freeform text (for backlog)

\`\`\`typescript
// Example: Create task via IPC
await window.api.sprint.create({
  title: 'Fix bug in IPC handler',
  repo: 'bde',
  spec: '## Goal\\nFix the race condition...\\n\\n## Approach\\n...',
  status: 'queued'
})
\`\`\`

## Setting Dependencies
- Hard: downstream blocked until upstream succeeds
- Soft: downstream unblocks regardless
- Format: \`depends_on: [{id: 'task-id', type: 'hard'}]\`
- Cycles rejected at creation

\`\`\`typescript
// Example: Create task with dependencies
await window.api.sprint.create({
  title: 'Add tests for feature',
  repo: 'bde',
  spec: '## Goal\\nAdd unit tests...',
  depends_on: [{ id: 'parent-task-id', type: 'hard' }]
})
\`\`\`

## Bulk Operations
1. Create parent task with full spec
2. Create child tasks with depends_on → parent
3. Soft deps between siblings if order doesn't matter

## Queue API Alternative
http://localhost:18790/queue/tasks
- POST /queue/tasks — create
- PATCH /queue/tasks/:id/dependencies — update deps
- Auth: Bearer token from Settings > Agent Manager

\`\`\`bash
# Example: Create via Queue API
curl -X POST http://localhost:18790/queue/tasks \\
  -H "Authorization: Bearer \${BDE_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Task title",
    "repo": "bde",
    "spec": "## Goal\\n..."
  }'
\`\`\`
`,
  capabilities: ['ipc-sprint-create', 'queue-api-call']
}
```

- [ ] **Step 2: Commit task orchestration skill**

```bash
git add src/main/agent-system/skills/task-orchestration.ts
git commit -m "feat: add task orchestration skill"
```

---

## Task 9: Skills System - Code Patterns

**Files:**
- Create: `src/main/agent-system/skills/code-patterns.ts`

- [ ] **Step 1: Write code patterns skill**

Create `src/main/agent-system/skills/code-patterns.ts`:

```typescript
import type { BDESkill } from './types'

export const codePatternsSkill: BDESkill = {
  id: 'code-patterns',
  trigger: 'User asks to generate BDE-idiomatic code (IPC, Zustand, panels)',
  description: 'Generate code following BDE conventions',
  guidance: `# BDE Code Patterns

## IPC Handlers
All handlers must use safeHandle() wrapper:
\`\`\`typescript
import { safeHandle } from '../handlers-shared'

export function registerMyHandlers() {
  safeHandle('my:channel', async (payload) => {
    // Handler logic
    return result
  })
}
\`\`\`

Register in src/main/index.ts:
\`\`\`typescript
import { registerMyHandlers } from './handlers/my-handlers'
registerMyHandlers()
\`\`\`

Update preload: src/preload/index.ts AND src/preload/index.d.ts

## Zustand Stores
\`\`\`typescript
import { create } from 'zustand'

interface MyStore {
  data: string | null
  setData: (data: string) => void
}

export const useMyStore = create<MyStore>((set) => ({
  data: null,
  setData: (data) => set({ data })
}))
\`\`\`

Usage:
\`\`\`typescript
// Good: Stable selector
const data = useMyStore(s => s.data)

// Good: Multiple fields with useShallow
import { useShallow } from 'zustand/react/shallow'
const { data, setData } = useMyStore(useShallow(s => ({
  data: s.data,
  setData: s.setData
})))
\`\`\`

## Panel Views
1. Add to View union in panelLayout.ts
2. Update ALL maps: VIEW_ICONS, VIEW_LABELS, VIEW_SHORTCUTS
3. Create ViewName.tsx in src/renderer/src/views/
4. Add lazy import in view-resolver.tsx
5. Register in resolveView() switch

## Testing
\`\`\`typescript
describe('MyComponent', () => {
  it('should render data', () => {
    // Set state BEFORE render
    const store = useMyStore.getState()
    store.setData('test')

    render(<MyComponent />)
    expect(screen.getByText('test')).toBeInTheDocument()
  })

  it('should handle error state', () => {
    // Test conditional branches
    const store = useMyStore.getState()
    store.setData(null)

    render(<MyComponent />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
\`\`\`

Coverage thresholds: 72% stmts, 66% branches, 70% functions, 74% lines
`,
  capabilities: ['code-generation']
}
```

- [ ] **Step 2: Commit code patterns skill**

```bash
git add src/main/agent-system/skills/code-patterns.ts
git commit -m "feat: add code patterns skill"
```

---

## Task 10: Skills System - Registry

**Files:**
- Create: `src/main/agent-system/skills/index.ts`
- Test: `src/main/agent-system/skills/__tests__/skills.test.ts`

- [ ] **Step 1: Write skills registry**

Create `src/main/agent-system/skills/index.ts`:

```typescript
import { systemIntrospectionSkill } from './system-introspection'
import { taskOrchestrationSkill } from './task-orchestration'
import { codePatternsSkill } from './code-patterns'

/**
 * Consolidate all skills into a single markdown string for interactive agents
 */
export function getAllSkills(): string {
  const skills = [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill
  ]

  return skills.map(s => s.guidance).join('\n\n---\n\n')
}

/**
 * Get all skills as structured data
 */
export function getSkillList() {
  return [
    systemIntrospectionSkill,
    taskOrchestrationSkill,
    codePatternsSkill
  ]
}
```

- [ ] **Step 2: Write failing tests**

Create `src/main/agent-system/skills/__tests__/skills.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getAllSkills, getSkillList } from '../index'
import { systemIntrospectionSkill } from '../system-introspection'
import { taskOrchestrationSkill } from '../task-orchestration'
import { codePatternsSkill } from '../code-patterns'

describe('Skills System', () => {
  describe('getAllSkills', () => {
    it('should consolidate all skill guidance', () => {
      const skills = getAllSkills()
      expect(skills).toContain('System Introspection')
      expect(skills).toContain('Task Orchestration')
      expect(skills).toContain('BDE Code Patterns')
    })

    it('should separate skills with markdown dividers', () => {
      const skills = getAllSkills()
      expect(skills).toContain('---')
    })
  })

  describe('getSkillList', () => {
    it('should return all skills as structured data', () => {
      const skills = getSkillList()
      expect(skills).toHaveLength(3)
      expect(skills[0].id).toBe('system-introspection')
      expect(skills[1].id).toBe('task-orchestration')
      expect(skills[2].id).toBe('code-patterns')
    })
  })

  describe('individual skills', () => {
    it('system introspection should have capabilities', () => {
      expect(systemIntrospectionSkill.capabilities).toContain('sqlite-query')
      expect(systemIntrospectionSkill.capabilities).toContain('file-read-logs')
    })

    it('task orchestration should have capabilities', () => {
      expect(taskOrchestrationSkill.capabilities).toContain('ipc-sprint-create')
      expect(taskOrchestrationSkill.capabilities).toContain('queue-api-call')
    })

    it('code patterns should have capability', () => {
      expect(codePatternsSkill.capabilities).toContain('code-generation')
    })

    it('all skills should have required fields', () => {
      const skills = getSkillList()
      for (const skill of skills) {
        expect(skill.id).toBeTruthy()
        expect(skill.trigger).toBeTruthy()
        expect(skill.description).toBeTruthy()
        expect(skill.guidance).toBeTruthy()
      }
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test src/main/agent-system/skills/__tests__/skills.test.ts
```

Expected: All tests PASS

- [ ] **Step 4: Commit skills registry**

```bash
git add src/main/agent-system/skills/
git commit -m "feat: add skills system registry"
```

---

## Task 11: Integration - Enhance Prompt Composer

**Files:**
- Modify: `src/main/agent-manager/prompt-composer.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Read existing prompt composer**

```bash
cat src/main/agent-manager/prompt-composer.ts
```

- [ ] **Step 2: Add native system imports**

At top of `src/main/agent-manager/prompt-composer.ts`, add:

```typescript
import { pipelinePersonality } from '../agent-system/personality/pipeline-personality'
import { assistantPersonality } from '../agent-system/personality/assistant-personality'
import type { AgentPersonality } from '../agent-system/personality/types'
import { getAllMemory } from '../agent-system/memory'
import { getAllSkills } from '../agent-system/skills'
```

- [ ] **Step 3: Add useNativeSystem to BuildPromptInput**

In `src/main/agent-manager/prompt-composer.ts`, update interface:

```typescript
export interface BuildPromptInput {
  agentType: AgentType
  taskContent?: string
  branch?: string
  playgroundEnabled?: boolean
  messages?: Array<{ role: string; content: string }>
  formContext?: { title: string; repo: string; spec: string }
  codebaseContext?: string

  // NEW: native system control
  useNativeSystem?: boolean  // Default false during migration
}
```

- [ ] **Step 4: Add personality getter helper**

After the PLAYGROUND_INSTRUCTIONS constant, add:

```typescript
/**
 * Get personality for agent type
 */
function getPersonality(agentType: AgentType): AgentPersonality {
  switch (agentType) {
    case 'pipeline':
      return pipelinePersonality
    case 'assistant':
    case 'adhoc':
      return assistantPersonality
    case 'copilot':
    case 'synthesizer':
      // Minimal personality for text-only agents
      return {
        voice: 'Be concise. Keep responses under 500 words. Use markdown for structure.',
        roleFrame: 'You are a text-only assistant. You cannot use tools or open URLs.',
        constraints: ['No tool access', 'Text responses only'],
        patterns: ['Focus on clarity', 'Use examples']
      }
  }
}
```

- [ ] **Step 5: Update buildAgentPrompt to inject native system**

In the `buildAgentPrompt` function, after "Start with universal preamble", replace the role instructions section with:

```typescript
  const { agentType, useNativeSystem } = input

  // Start with universal preamble
  let prompt = UNIVERSAL_PREAMBLE

  if (useNativeSystem) {
    // NEW: Inject personality
    const personality = getPersonality(agentType)
    prompt += '\n\n## Voice\n' + personality.voice
    prompt += '\n\n## Your Role\n' + personality.roleFrame
    prompt += '\n\n## Constraints\n' + personality.constraints.map(c => `- ${c}`).join('\n')

    // NEW: Inject memory (all agents get this)
    prompt += '\n\n## BDE Conventions\n'
    prompt += getAllMemory()

    // NEW: Inject skills (interactive agents only)
    if (agentType === 'assistant' || agentType === 'adhoc') {
      prompt += '\n\n## Available Skills\n'
      prompt += getAllSkills()
    }

    // NEW: Plugin disable note
    prompt += '\n\n## Note\n'
    prompt += 'You have BDE-native skills and conventions loaded. '
    prompt += 'Generic third-party plugin guidance may not apply to BDE workflows.'
  } else {
    // Existing behavior (use role instructions)
    prompt += '\n\n' + ROLE_INSTRUCTIONS[agentType]
  }
```

- [ ] **Step 6: Commit prompt composer integration**

```bash
git add src/main/agent-manager/prompt-composer.ts
git commit -m "feat: integrate native system into prompt composer"
```

---

## Task 12: Integration - Prompt Composer Tests

**Files:**
- Modify: `src/main/agent-manager/__tests__/prompt-composer.test.ts`

- [ ] **Step 1: Read existing tests**

```bash
cat src/main/agent-manager/__tests__/prompt-composer.test.ts
```

- [ ] **Step 2: Add native system test suite**

At end of `src/main/agent-manager/__tests__/prompt-composer.test.ts`, add:

```typescript
describe('buildAgentPrompt - Native System', () => {
  it('should inject personality for pipeline agents', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Fix bug in IPC handler',
      useNativeSystem: true
    })

    expect(prompt).toContain('You are a BDE pipeline agent')
    expect(prompt).toContain('Be concise and action-oriented')
    expect(prompt).toContain('NEVER push to main')
  })

  it('should inject personality for assistant agents', () => {
    const prompt = buildAgentPrompt({
      agentType: 'assistant',
      taskContent: 'Help debug queue',
      useNativeSystem: true
    })

    expect(prompt).toContain('interactive BDE assistant')
    expect(prompt).toContain('conversational but concise')
    expect(prompt).toContain('Full tool access')
  })

  it('should inject memory for all agents', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Task',
      useNativeSystem: true
    })

    expect(prompt).toContain('BDE Conventions')
    expect(prompt).toContain('IPC Conventions')
    expect(prompt).toContain('Testing Patterns')
    expect(prompt).toContain('Architecture Rules')
  })

  it('should inject skills for assistant agents only', () => {
    const assistantPrompt = buildAgentPrompt({
      agentType: 'assistant',
      taskContent: 'Help',
      useNativeSystem: true
    })

    expect(assistantPrompt).toContain('Available Skills')
    expect(assistantPrompt).toContain('System Introspection')
    expect(assistantPrompt).toContain('Task Orchestration')
    expect(assistantPrompt).toContain('BDE Code Patterns')

    const pipelinePrompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Fix',
      useNativeSystem: true
    })

    expect(pipelinePrompt).not.toContain('Available Skills')
  })

  it('should include plugin disable note', () => {
    const prompt = buildAgentPrompt({
      agentType: 'assistant',
      taskContent: 'Task',
      useNativeSystem: true
    })

    expect(prompt).toContain('BDE-native skills and conventions')
    expect(prompt).toContain('third-party plugin guidance may not apply')
  })

  it('should use existing behavior when useNativeSystem is false', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Task',
      useNativeSystem: false
    })

    expect(prompt).not.toContain('BDE Conventions')
    expect(prompt).not.toContain('Available Skills')
    expect(prompt).toContain('Your Mission')
  })

  it('should default to existing behavior when useNativeSystem is undefined', () => {
    const prompt = buildAgentPrompt({
      agentType: 'assistant',
      taskContent: 'Task'
      // useNativeSystem omitted
    })

    expect(prompt).not.toContain('BDE Conventions')
    expect(prompt).toContain('Your Mission')
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test src/main/agent-manager/__tests__/prompt-composer.test.ts
```

Expected: All tests PASS

- [ ] **Step 4: Commit test updates**

```bash
git add src/main/agent-manager/__tests__/prompt-composer.test.ts
git commit -m "test: add native system tests for prompt composer"
```

---

## Task 13: Database - Add Settings

**Files:**
- Modify: `src/main/db.ts`

- [ ] **Step 1: Read current schema**

```bash
grep -A 10 "export function getDbSchema" src/main/db.ts
```

- [ ] **Step 2: Add migration for useNativeSystem setting**

At end of migrations array in `src/main/db.ts`, add:

```typescript
  {
    version: 18,
    up: (db: Database) => {
      // Add useNativeSystem setting (default false for gradual rollout)
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value)
        VALUES ('agentManager.useNativeSystem', 'false')
      `).run()
    }
  }
```

- [ ] **Step 3: Update latest version constant**

Find and update:

```typescript
export const LATEST_DB_VERSION = 18
```

- [ ] **Step 4: Run migration test**

```bash
npm run test:main -- src/main/__tests__/db.test.ts
```

Expected: Migration runs successfully

- [ ] **Step 5: Commit database migration**

```bash
git add src/main/db.ts
git commit -m "feat: add agentManager.useNativeSystem setting (migration v18)"
```

---

## Task 14: Settings UI - Add Toggle

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx` (Agent Manager tab)

- [ ] **Step 1: Read current Agent Manager settings section**

```bash
grep -A 30 "Agent Manager" src/renderer/src/views/SettingsView.tsx
```

- [ ] **Step 2: Add state for useNativeSystem**

In the SettingsView component, after existing state declarations, add:

```typescript
const [useNativeSystem, setUseNativeSystem] = useState(false)
```

- [ ] **Step 3: Load setting on mount**

In the useEffect that loads settings, add:

```typescript
// Load useNativeSystem
const nativeSystemSetting = await window.api.settings.get('agentManager.useNativeSystem')
setUseNativeSystem(nativeSystemSetting === 'true')
```

- [ ] **Step 4: Add toggle UI**

In the Agent Manager tab section, after the max runtime setting, add:

```typescript
<div className="setting-row">
  <label htmlFor="use-native-system">
    <input
      type="checkbox"
      id="use-native-system"
      checked={useNativeSystem}
      onChange={async (e) => {
        const newValue = e.target.checked
        setUseNativeSystem(newValue)
        await window.api.settings.set('agentManager.useNativeSystem', String(newValue))
      }}
    />
    Use Native Agent System (experimental)
  </label>
  <p className="setting-description">
    Custom BDE-specific agent personality and skills instead of third-party plugins.
    Restart BDE after changing this setting.
  </p>
</div>
```

- [ ] **Step 5: Test Settings UI manually**

```bash
npm run dev
```

Open BDE → Settings → Agent Manager → Verify toggle appears and persists

- [ ] **Step 6: Commit Settings UI**

```bash
git add src/renderer/src/views/SettingsView.tsx
git commit -m "feat: add native agent system toggle to Settings UI"
```

---

## Task 15: Integration - Wire to Agent Spawning

**Files:**
- Modify: `src/main/adhoc-agent.ts`
- Modify: `src/main/agent-manager/run-agent.ts`

- [ ] **Step 1: Update adhoc-agent to read setting**

In `src/main/adhoc-agent.ts`, in the `spawnAdhocAgent` function, before building the prompt:

```typescript
// Read useNativeSystem setting
const { getSetting } = await import('./db')
const useNativeSystem = (await getSetting('agentManager.useNativeSystem')) === 'true'

// Build composed prompt with preamble
const prompt = buildAgentPrompt({
  agentType: args.assistant ? 'assistant' : 'adhoc',
  taskContent: args.task,
  useNativeSystem
})
```

- [ ] **Step 2: Update run-agent to read setting**

In `src/main/agent-manager/run-agent.ts`, in the `runAgent` function, before building the prompt:

```typescript
// Read useNativeSystem setting
const { getSetting } = await import('../db')
const useNativeSystem = (await getSetting('agentManager.useNativeSystem')) === 'true'

// Build task content
const taskContent = task.spec || task.prompt || '(no spec provided)'

// Build agent prompt with native system if enabled
const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent,
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled,
  useNativeSystem
})
```

- [ ] **Step 3: Test agent spawning**

```bash
npm run dev
```

Spawn an assistant agent and verify it uses native system if toggle is enabled.

- [ ] **Step 4: Commit agent spawning integration**

```bash
git add src/main/adhoc-agent.ts src/main/agent-manager/run-agent.ts
git commit -m "feat: wire native system to agent spawning"
```

---

## Task 16: Integration Tests

**Files:**
- Create: `src/main/agent-system/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `src/main/agent-system/__tests__/integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildAgentPrompt } from '../../agent-manager/prompt-composer'

describe('Agent System Integration', () => {
  describe('prompt composition with native system', () => {
    it('should build complete prompt for pipeline agent', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: '## Goal\nFix bug\n\n## Approach\nUpdate handler',
        branch: 'agent/fix-bug',
        useNativeSystem: true
      })

      // Check structure
      expect(prompt).toContain('BDE pipeline agent')
      expect(prompt).toContain('BDE Conventions')
      expect(prompt).toContain('IPC Conventions')
      expect(prompt).toContain('Testing Patterns')
      expect(prompt).toContain('Architecture Rules')
      expect(prompt).toContain('Git Branch')
      expect(prompt).toContain('agent/fix-bug')

      // Should NOT have skills (pipeline agents don't get them)
      expect(prompt).not.toContain('Available Skills')

      // Should have task content
      expect(prompt).toContain('Fix bug')
    })

    it('should build complete prompt for assistant agent', () => {
      const prompt = buildAgentPrompt({
        agentType: 'assistant',
        taskContent: 'Help me debug the queue',
        useNativeSystem: true
      })

      // Check structure
      expect(prompt).toContain('interactive BDE assistant')
      expect(prompt).toContain('BDE Conventions')
      expect(prompt).toContain('Available Skills')
      expect(prompt).toContain('System Introspection')
      expect(prompt).toContain('Task Orchestration')
      expect(prompt).toContain('BDE Code Patterns')

      // Should have task content
      expect(prompt).toContain('debug the queue')
    })

    it('should not bloat prompt excessively', () => {
      const prompt = buildAgentPrompt({
        agentType: 'assistant',
        taskContent: 'Task',
        useNativeSystem: true
      })

      // Rough token estimate (4 chars ≈ 1 token)
      const estimatedTokens = prompt.length / 4

      // Should stay under 10k tokens (spec says 6-8k target, 10k max acceptable)
      expect(estimatedTokens).toBeLessThan(10000)
    })
  })

  describe('backward compatibility', () => {
    it('should use existing behavior when useNativeSystem is false', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Task',
        useNativeSystem: false
      })

      expect(prompt).not.toContain('BDE Conventions')
      expect(prompt).toContain('Your Mission')
    })

    it('should default to existing behavior when useNativeSystem is undefined', () => {
      const prompt = buildAgentPrompt({
        agentType: 'assistant',
        taskContent: 'Task'
      })

      expect(prompt).not.toContain('BDE Conventions')
      expect(prompt).toContain('Your Mission')
    })
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
npm run test:main -- src/main/agent-system/__tests__/integration.test.ts
```

Expected: All tests PASS

- [ ] **Step 3: Commit integration tests**

```bash
git add src/main/agent-system/__tests__/integration.test.ts
git commit -m "test: add native agent system integration tests"
```

---

## Task 17: Documentation

**Files:**
- Modify: `src/main/agent-manager/prompt-composer.ts` (add JSDoc)
- Create: `docs/agent-system-guide.md`

- [ ] **Step 1: Add JSDoc to exported functions**

In `src/main/agent-manager/prompt-composer.ts`, add JSDoc above `buildAgentPrompt`:

```typescript
/**
 * Build agent prompt with universal preamble, role-specific instructions, and task content.
 *
 * When useNativeSystem is true, injects BDE-specific personality, memory, and skills
 * instead of generic role instructions. This provides agents with BDE-aware guidance.
 *
 * @param input - Prompt configuration including agent type, task content, and native system flag
 * @returns Complete prompt string ready for agent spawning
 */
export function buildAgentPrompt(input: BuildPromptInput): string {
```

- [ ] **Step 2: Create usage guide**

Create `docs/agent-system-guide.md`:

```markdown
# BDE Native Agent System Guide

The native agent system provides BDE-specific personality, memory, and skills to agents instead of relying on third-party plugins.

## Overview

**Components:**
- **Personality** - Voice, role framing, constraints per agent type
- **Memory** - BDE conventions (IPC, testing, architecture)
- **Skills** - Interactive agent guidance (introspection, orchestration, patterns)

**Agent Types:**
- Pipeline agents: Get personality + memory (lightweight)
- Interactive agents (assistant/adhoc): Get personality + memory + skills (rich)

## Enabling Native System

1. Open Settings → Agent Manager
2. Enable "Use Native Agent System (experimental)"
3. Restart BDE

## How It Works

When `useNativeSystem` is enabled:

1. **Personality** is injected based on agent type
   - Pipeline: Concise, execution-focused
   - Assistant: Conversational, helpful

2. **Memory** (all agents) provides BDE conventions:
   - IPC patterns (safeHandle, handler registration)
   - Testing patterns (coverage thresholds, test organization)
   - Architecture rules (process boundaries, Zustand stores)

3. **Skills** (interactive only) provide actionable guidance:
   - System Introspection: Query SQLite, read logs, diagnose issues
   - Task Orchestration: Create tasks, set dependencies
   - Code Patterns: Generate BDE-idiomatic code

## Adding New Skills

1. Create skill file in `src/main/agent-system/skills/my-skill.ts`:
   ```typescript
   import type { BDESkill } from './types'

   export const mySkill: BDESkill = {
     id: 'my-skill',
     trigger: 'When user asks...',
     description: 'What it does',
     guidance: \`# My Skill\n\nInstructions...\`,
     capabilities: ['capability-name']
   }
   ```

2. Export from `src/main/agent-system/skills/index.ts`:
   ```typescript
   import { mySkill } from './my-skill'

   export function getSkillList() {
     return [
       systemIntrospectionSkill,
       taskOrchestrationSkill,
       codePatternsSkill,
       mySkill  // Add here
     ]
   }
   ```

3. Add tests in `src/main/agent-system/skills/__tests__/skills.test.ts`

## Migration Path

**Current (v1):** Third-party plugins provide generic guidance

**Phase 1 (Week 1-2):** Native system built, opt-in via Settings toggle

**Phase 2 (Week 3-4):** Native system tested and refined

**Phase 3 (Week 5+):** Native system becomes default, plugins disabled

## Testing

```bash
# Unit tests
npm test src/main/agent-system/

# Integration tests
npm run test:main -- src/main/agent-system/__tests__/integration.test.ts

# Prompt composer tests
npm test src/main/agent-manager/__tests__/prompt-composer.test.ts
```

## Troubleshooting

**Agents not using native system:**
- Check Settings → Agent Manager → toggle is ON
- Restart BDE after enabling
- Check `~/.bde/bde.db`: `SELECT value FROM settings WHERE key='agentManager.useNativeSystem'` should be 'true'

**Prompts too large:**
- Check token estimate in integration tests
- Target: 6-8k tokens, max: 10k tokens
- Trim verbose sections in memory/skills modules

**Skills not appearing for interactive agents:**
- Verify agent type is 'assistant' or 'adhoc'
- Pipeline agents don't get skills (by design)
- Check prompt includes "## Available Skills" section
```

- [ ] **Step 3: Commit documentation**

```bash
git add src/main/agent-manager/prompt-composer.ts docs/agent-system-guide.md
git commit -m "docs: add native agent system guide and JSDoc"
```

---

## Task 18: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add native agent system entry to Key File Locations**

In `CLAUDE.md`, after the prompt-composer entry, add:

```markdown
- Native agent system: `src/main/agent-system/` (personality, memory, skills modules)
```

- [ ] **Step 2: Add Gotcha about native system**

In the `## Gotchas` section, add:

```markdown
- **Native agent system toggle**: Changes to `agentManager.useNativeSystem` setting require app restart. Pipeline and interactive agents read this setting at spawn time to conditionally inject BDE-specific personality, memory, and skills.
```

- [ ] **Step 3: Commit CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs: document native agent system in CLAUDE.md"
```

---

## Task 19: Verification and Final Testing

**Files:**
- None (testing only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
npm run test:main
npm run typecheck
npm run lint
```

Expected: All tests PASS, no type errors, no lint errors

- [ ] **Step 2: Test prompt token budget**

```bash
npm run test:main -- src/main/agent-system/__tests__/integration.test.ts
```

Verify "should not bloat prompt excessively" test passes (< 10k tokens)

- [ ] **Step 3: Manual E2E test - Pipeline Agent**

```bash
npm run dev
```

1. Settings → Agent Manager → Enable "Use Native Agent System"
2. Restart BDE
3. Create a sprint task with spec
4. Mark task as queued
5. Agent manager spawns pipeline agent
6. Check `~/.bde/agent-manager.log` - verify agent uses native system
7. Verify task completes successfully

- [ ] **Step 4: Manual E2E test - Interactive Agent**

```bash
npm run dev
```

1. Settings → Agent Manager → Enable "Use Native Agent System"
2. Restart BDE
3. Open Agents view → Spawn Assistant
4. Ask: "How do I check queue health?"
5. Verify agent references System Introspection skill (queries SQLite)
6. Ask: "Generate an IPC handler for foo"
7. Verify agent uses safeHandle() wrapper (Code Patterns skill)

- [ ] **Step 5: Document test results**

Create a test summary comment in the final commit:

```bash
# All verification steps passed:
# - Unit tests: 100% pass
# - Integration tests: 100% pass
# - Type checking: No errors
# - Lint: No errors
# - Token budget: Within limit (< 10k tokens)
# - E2E pipeline: Agent completed task successfully
# - E2E interactive: Agent used skills correctly
```

---

## Task 20: Final Commit and Branch

**Files:**
- None (git operations only)

- [ ] **Step 1: Review all changes**

```bash
git log --oneline --graph
```

Verify all 19+ commits are present and well-formed.

- [ ] **Step 2: Run final verification**

```bash
npm run build
```

Expected: Build succeeds without errors

- [ ] **Step 3: Push branch**

```bash
git push origin HEAD --no-verify
```

- [ ] **Step 4: Create PR**

```bash
gh pr create --title "feat: BDE native agent system" --body "$(cat <<'EOF'
Implements native BDE agent system to replace third-party plugins.

## Summary
- **Personality modules**: Pipeline (concise) and Assistant (conversational)
- **Memory modules**: IPC, Testing, Architecture conventions
- **Skills modules**: System Introspection, Task Orchestration, Code Patterns
- **Enhanced prompt composer**: Conditionally injects native system based on `useNativeSystem` flag
- **Settings UI**: Toggle in Agent Manager tab (requires restart)

## Migration
- Default: OFF (existing behavior preserved)
- Users opt-in via Settings toggle
- No breaking changes

## Testing
- 40+ unit tests (personality, memory, skills, composer)
- Integration tests (prompt composition, token budget)
- E2E manual testing (pipeline + interactive agents)
- All tests passing, typecheck clean, build succeeds

## Implementation
Spec: docs/superpowers/specs/2026-03-31-bde-native-agent-system-design.md
Plan: docs/superpowers/plans/2026-03-31-bde-native-agent-system.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Success Criteria

- [ ] All unit tests pass (personality, memory, skills, composer)
- [ ] Integration tests pass (prompt composition, token budget < 10k)
- [ ] Type checking passes with no errors
- [ ] Build succeeds (`npm run build`)
- [ ] Settings toggle appears and persists
- [ ] Pipeline agents spawn with native system when enabled
- [ ] Interactive agents spawn with skills when enabled
- [ ] Backward compatibility preserved (existing behavior when disabled)
- [ ] Documentation complete (guide + CLAUDE.md)
- [ ] PR created with comprehensive summary

---

## Notes

**Token Budget:** Target 6-8k tokens, max 10k. Integration test validates this.

**Rollback:** Toggle setting to OFF restores existing behavior immediately (no restart needed for interactive agents, restart needed for pipeline agents).

**Phase 2:** User testing and iteration happens after this initial implementation. Spec has 5-week migration plan; this plan implements Phase 1 (Build) only.

**Dependencies:** No new npm packages. Uses existing TypeScript, Vitest, Electron infrastructure.

---

**End of Plan**
