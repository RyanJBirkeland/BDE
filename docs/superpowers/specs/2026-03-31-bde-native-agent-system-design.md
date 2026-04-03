# BDE Native Agent System

**Date:** 2026-03-31
**Status:** Approved
**Author:** Claude (Assistant Agent)

## Executive Summary

Replace all third-party agent plugins (superpowers, playground, frontend-design, etc.) with a native BDE agent system that provides:

- **Personality modules** — voice and role framing per agent type
- **Memory modules** — BDE-specific conventions (IPC, testing, architecture)
- **Skills modules** — actionable guidance for interactive agents

**Goal:** Transform agents from generic coding assistants into BDE-aware collaborators that understand sprint tasks, the agent manager, queue API, and BDE's opinionated patterns.

**Scope:**

- Pipeline agents: lightweight personality + memory (no interactive skills)
- Interactive agents (assistant/adhoc): full personality + memory + skills

## Problem Statement

### Current Pain Points

1. **Generic Guidance Doesn't Fit BDE Workflows**
   - Superpowers suggests "write tests" without knowing BDE's coverage thresholds (72% stmts, 66% branches)
   - Agents don't know about sprint tasks, dependencies, or the queue API
   - Generic worktree advice conflicts with agent manager's automated worktree handling

2. **Plugin Overhead and Conflicts**
   - 12 third-party plugins enabled (superpowers, playground, frontend-design, github, linear, greptile, typescript-lsp, agent-sdk-dev, ralph-loop, learning-output-style, claude-md-management, security-guidance)
   - Superpowers alone has 14 skills that fire on generic patterns
   - Skills overlap (multiple plugins try to guide git workflows, testing, code review)

3. **External Dependencies**
   - Plugin updates can break BDE workflows
   - Can't customize or extend plugin behavior
   - Plugin logic opaque (can't audit what agents receive)

4. **Missed Opportunities**
   - Interactive agents can't query SQLite to answer "how many tasks are blocked?"
   - Agents don't suggest creating sprint tasks for multi-step work
   - No awareness of BDE-specific code patterns (safeHandle(), Zustand conventions, panel system)

## Solution: Native Agent System

### Architecture

```
src/main/agent-system/
├── personality/
│   ├── pipeline-personality.ts    # Lightweight, task-focused
│   ├── assistant-personality.ts   # Rich, conversational, BDE-aware
│   └── types.ts                   # Shared interfaces
├── skills/
│   ├── types.ts                   # Skill interface
│   ├── task-orchestration.ts     # Create tasks, set deps, inspect queue
│   ├── system-introspection.ts   # Query logs, agents, diagnose issues
│   ├── code-patterns.ts           # Generate BDE-idiomatic code
│   └── index.ts                   # Skill registry
├── memory/
│   ├── ipc-conventions.ts         # safeHandle(), handler structure
│   ├── testing-patterns.ts        # Coverage thresholds, test organization
│   ├── architecture-rules.ts      # Process boundaries, data flow
│   └── index.ts                   # Memory consolidator
└── composer.ts                    # Enhanced prompt builder
```

### Core Components

#### 1. Personality System

**Interface:**

```typescript
export interface AgentPersonality {
  voice: string // Tone/style guidelines
  roleFrame: string // Identity framing
  constraints: string[] // Hard boundaries
  patterns: string[] // Communication patterns
}
```

**Pipeline Personality** (concise, execution-focused):

```typescript
{
  voice: "Be concise and action-oriented. Focus on execution, not explanation.",
  roleFrame: "You are a BDE pipeline agent executing a sprint task autonomously.",
  constraints: [
    "NEVER push to main - only to your assigned branch",
    "Run tests after changes: npm test && npm run typecheck",
    "Use TypeScript strict mode conventions"
  ],
  patterns: [
    "Report what you did, not what you plan to do",
    "If tests fail, fix them before pushing"
  ]
}
```

**Assistant Personality** (conversational, helpful):

```typescript
{
  voice: "Be conversational but concise. Proactively suggest BDE tools.",
  roleFrame: "You are an interactive BDE assistant helping users orchestrate work.",
  constraints: [
    "Full tool access - can read/write files, run commands, spawn subagents",
    "Can create sprint tasks via IPC",
    "Can query SQLite for system state"
  ],
  patterns: [
    "Suggest creating sprint tasks for multi-step work",
    "Recommend Dev Playground for visual/UI exploration",
    "Reference BDE conventions (safeHandle, Zustand patterns)"
  ]
}
```

#### 2. Memory System

Shared knowledge base of BDE conventions. All agents (pipeline + interactive) receive this.

**IPC Conventions:**

- Handler registration pattern (registerXHandlers)
- safeHandle() wrapper requirement
- Preload type declaration sync (index.ts + index.d.ts)
- execFileAsync over execSync

**Testing Patterns:**

- Coverage thresholds (72/66/70/74)
- Branch coverage focus (tightest threshold)
- Test organization (renderer, main, integration, e2e)
- Common gotchas (Zustand state before render, native module rebuilds)

**Architecture Rules:**

- Process boundaries (main/preload/renderer)
- IPC surface minimalism
- Zustand store rules (one per domain, no nested stores)
- File organization (shared/ for cross-process types)

#### 3. Skills System

Structured guidance for interactive agents only. Skills provide context the agent uses when relevant (not auto-executed).

**System Introspection Skill:**

- Query SQLite for queue health, task status, dependency chains
- Read logs (~/.bde/bde.log, ~/.bde/agent-manager.log)
- Check active agents (agent_runs table)
- Diagnose pipeline stalls (stuck tasks, worktree issues)

**Task Orchestration Skill:**

- Create tasks via sprint:create IPC
- Set dependencies (hard vs. soft)
- Bulk operations (parent + children pattern)
- Queue API alternative (http://localhost:18790)

**Code Patterns Skill:**

- IPC handler scaffolding (safeHandle wrapper)
- Zustand store conventions
- Panel view registration (6-step process)
- Testing patterns (coverage, conditional branches)

#### 4. Enhanced Prompt Composer

**Current Behavior:**

```typescript
buildAgentPrompt({
  agentType: 'pipeline',
  taskContent: 'Fix bug',
  branch: 'agent/fix-bug'
})
// → Universal preamble + role instructions + branch section + task content
```

**Enhanced Behavior:**

```typescript
buildAgentPrompt({
  agentType: 'assistant',
  taskContent: 'Help debug queue',
  useNativeSystem: true // NEW
})
// → Universal preamble
//   + personality (voice + role + constraints)
//   + memory (IPC + testing + architecture)
//   + skills (introspection + orchestration + patterns)
//   + task content
```

**New Sections:**

- `## Voice` — personality.voice
- `## Your Role` — personality.roleFrame
- `## Constraints` — personality.constraints
- `## BDE Conventions` — consolidated memory
- `## Available Skills` — consolidated skills (interactive only)

**Flag Gating:**
`useNativeSystem: boolean` in `BuildPromptInput` controls injection during migration.

### Integration Points

**Agent Spawning:**

- `adhoc-agent.ts` — passes `useNativeSystem` to prompt composer
- `run-agent.ts` (pipeline) — passes `useNativeSystem` to prompt composer
- `workbench.ts` (copilot) — gets minimal personality (text-only)

**Settings UI:**
New toggle in Settings > Agent Manager:

```
☐ Use Native Agent System (experimental)
  Custom BDE-specific agent personality and skills instead of third-party plugins
```

**Settings Storage:**

```typescript
// SQLite settings table
{
  key: 'agentManager.useNativeSystem',
  value: 'false'  // Default during migration
}
```

## Migration Plan

### Phase 1: Build (Week 1)

**Deliverables:**

- [ ] Directory structure: `src/main/agent-system/` with personality/, skills/, memory/
- [ ] Personality modules: pipeline-personality.ts, assistant-personality.ts
- [ ] Memory modules: ipc-conventions.ts, testing-patterns.ts, architecture-rules.ts
- [ ] Skills modules: system-introspection.ts, task-orchestration.ts, code-patterns.ts
- [ ] Enhanced composer: Update `prompt-composer.ts` with `useNativeSystem` flag
- [ ] Settings UI: Add toggle to Agent Manager tab

**Acceptance Criteria:**

- Building prompts with `useNativeSystem: true` injects all sections correctly
- Prompts remain under 8000 tokens (comparable to current system)
- Unit tests pass for personality, memory, skills, and composer

### Phase 2: Test (Week 2)

**Scope:**

- Enable native system for **interactive agents only** (assistant/adhoc)
- Keep pipeline agents on existing system
- User testing with 5-10 assistant sessions

**Test Scenarios:**

1. Spawn assistant, ask "how do I create a sprint task?" — should reference task orchestration skill
2. Spawn assistant, ask "check queue health" — should query SQLite directly
3. Spawn assistant, ask "generate an IPC handler" — should use safeHandle() wrapper
4. Spawn assistant for debugging — should reference logs and agent_runs table

**Feedback Collection:**

- Are skills relevant and helpful?
- Is personality tone appropriate?
- Are there missing skills/memory that would help?
- Does native system feel better than superpowers?

**Iterate:**

- Adjust skill guidance based on what agents do/don't reference
- Tune personality voice if too verbose or too terse
- Add missing memory items that agents should know

### Phase 3: Expand (Week 3)

**Scope:**

- Enable native system for **pipeline agents**
- Monitor agent manager logs for issues
- Add 2-3 more skills based on Phase 2 feedback

**Potential Skills to Add:**

- Debugging workflow (correlate logs, trace failures)
- Playground guidance (when to use, how to structure HTML)
- Dependency management (visualize dependency chains, detect cycles)

**Monitor:**

- Pipeline agent success rate (should remain ≥95%)
- Average task completion time (should not regress)
- Fast-fail rate (should remain low)

### Phase 4: Default (Week 4)

**Changes:**

- [ ] Flip Settings default: `agentManager.useNativeSystem: true`
- [ ] Update `default-claude-settings.json`: disable superpowers, playground, frontend-design
- [ ] Keep plugins installed but disabled (easy rollback)
- [ ] Document native system in CLAUDE.md

**Verification:**

- New BDE installs use native system by default
- Existing users can opt-in via Settings toggle
- Third-party plugins remain disabled unless user manually re-enables

### Phase 5: Remove (Week 5+)

**Scope:**

- [ ] Remove `useNativeSystem` flag (always enabled)
- [ ] Remove third-party plugin configs from `default-claude-settings.json`
- [ ] Update BDE_FEATURES.md to document native agent system
- [ ] Clean up old ROLE_INSTRUCTIONS (migrate to personality modules)

**Documentation:**

- Add section to CLAUDE.md about agent personality system
- Update BDE_FEATURES.md > Agent Types to mention native skills
- Add examples of skill usage to docs/

## Testing Strategy

### Unit Tests

**Personality System:**

```typescript
describe('Personality System', () => {
  it('should return pipeline personality for pipeline agents', () => {
    const p = getPersonality('pipeline')
    expect(p.voice).toContain('concise')
    expect(p.roleFrame).toContain('pipeline agent')
  })

  it('should return assistant personality for interactive agents', () => {
    const p = getPersonality('assistant')
    expect(p.voice).toContain('conversational')
    expect(p.patterns).toContain('sprint tasks')
  })
})
```

**Skills System:**

```typescript
describe('Skills System', () => {
  it('should consolidate all skill guidance', () => {
    const skills = getAllSkills()
    expect(skills).toContain('System Introspection')
    expect(skills).toContain('Task Orchestration')
  })

  it('should include capabilities metadata', () => {
    expect(taskOrchestrationSkill.capabilities).toContain('ipc-sprint-create')
  })
})
```

**Prompt Composer:**

```typescript
describe('Prompt Composer - Native System', () => {
  it('should inject personality for all agents', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Fix bug',
      useNativeSystem: true
    })
    expect(prompt).toContain('You are a BDE pipeline agent')
    expect(prompt).toContain('Be concise and action-oriented')
  })

  it('should inject skills for interactive agents only', () => {
    const assistantPrompt = buildAgentPrompt({
      agentType: 'assistant',
      taskContent: 'Help',
      useNativeSystem: true
    })
    expect(assistantPrompt).toContain('Available Skills')

    const pipelinePrompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Fix',
      useNativeSystem: true
    })
    expect(pipelinePrompt).not.toContain('Available Skills')
  })

  it('should inject memory for all agents', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Task',
      useNativeSystem: true
    })
    expect(prompt).toContain('IPC Conventions')
    expect(prompt).toContain('Testing Patterns')
    expect(prompt).toContain('Architecture Rules')
  })
})
```

### Integration Tests

**Agent Spawning:**

```typescript
describe('Agent Spawning - Native System', () => {
  it('should spawn assistant with native skills', async () => {
    const result = await spawnAdhocAgent({
      task: 'Check queue health',
      repoPath: '/path/to/bde',
      assistant: true,
      useNativeSystem: true
    })

    expect(result.agentId).toBeDefined()
    // Verify personality was injected (check logs or capture prompt)
  })
})
```

### Manual Testing Checklist

**Interactive Agents:**

- [ ] Ask "how do I create a sprint task?" — should reference task orchestration skill
- [ ] Ask "check queue health" — should query SQLite (SELECT COUNT(\*) FROM sprint_tasks GROUP BY status)
- [ ] Ask "generate an IPC handler for foo" — should include safeHandle() wrapper
- [ ] Ask "why is a task stuck in blocked?" — should check depends_on field and dependency chain

**Pipeline Agents:**

- [ ] Run task with `useNativeSystem: true` — should complete without skill references
- [ ] Check prompt length — should be comparable to existing system
- [ ] Verify no third-party skill conflicts when both systems enabled

**Settings UI:**

- [ ] Toggle "Use Native Agent System" on/off — agents should reflect change
- [ ] Default value should be false during migration
- [ ] Setting should persist across app restarts

## Success Metrics

### Quantitative

**Prompt Efficiency:**

- Native system prompts ≤ 10% larger than current prompts
- Target: 6000-8000 tokens (within Claude's optimal window)

**Task Completion Rate:**

- Pipeline agents with native system: ≥95% success rate (same as current)
- Monitor fast-fail rate (should remain low)

**Agent Spawn Time:**

- No regression in spawn time (≤500ms difference from current)

### Qualitative

**Relevance:**

- Interactive agents reference BDE-specific patterns (not generic advice)
- Agents proactively suggest sprint tasks for multi-step work
- Agents query SQLite instead of asking user for system state

**Accuracy:**

- Code generated follows BDE conventions (safeHandle, Zustand patterns, panel registration)
- IPC handlers use correct structure (registerXHandlers, safeHandle wrapper)
- Tests follow coverage patterns (branch coverage focus)

**User Confidence:**

- User reports agents "understand BDE" vs. "generic coding assistant"
- Users don't re-enable third-party plugins after trying native system
- Reduced need to correct agents on BDE-specific patterns

### Signals of Success

- ✅ Agents suggest creating sprint tasks instead of doing all work inline
- ✅ Agents query `~/.bde/bde.db` directly to answer system state questions
- ✅ Agents generate IPC handlers with safeHandle() without being told
- ✅ Agents reference BDE_FEATURES.md sections (Task System, Agent Manager, etc.)
- ✅ Users disable third-party plugins and don't miss them

### Signals of Failure

- ❌ Agents confused about BDE workflows (create tasks wrong way, ignore conventions)
- ❌ Native system prompts bloat beyond 10k tokens
- ❌ Pipeline agents slower or less successful with native system
- ❌ Users re-enable superpowers because native skills insufficient

## Rollback Plan

If issues arise during any phase:

**Immediate Rollback:**

1. Flip Settings toggle to `useNativeSystem: false`
2. Re-enable superpowers plugin in `~/.claude/settings.json`
3. Restart BDE to pick up new agent system

**Investigate:**

- Check agent manager logs for errors
- Review prompts being generated (capture via logger)
- Identify which memory/skills/personality sections cause issues

**Fix and Re-Test:**

- Iterate on problematic sections
- Re-test with small group of users
- Only re-enable after verification

**Safety Net:**

- Keep third-party plugins installed (just disabled) through Phase 4
- Don't remove plugin configs until Phase 5 (after 4 weeks of stability)

## Future Enhancements

### Phase 6+ (Optional)

**Advanced Skills:**

- **Dependency Visualization**: Generate Mermaid diagrams of task dependency chains
- **Pipeline Health Dashboard**: Interactive HTML playground showing queue metrics
- **Agent Performance Analysis**: Correlate agent runs with success/failure patterns

**Personality Tuning:**

- User-configurable personality traits (verbosity level, suggestion frequency)
- Per-repo personality overrides (different tone for internal vs. client projects)

**Memory Expansion:**

- Neon design system conventions (use CSS classes, not inline styles)
- Panel system patterns (view registration, lazy loading, keyboard shortcuts)
- Git workflow patterns (worktree lifecycle, branch naming, PR flow)

**Skill Marketplace:**

- User-contributed skills (add to `src/main/agent-system/skills/community/`)
- Skill enable/disable per user preference
- Skill versioning (migrate skills without breaking old agents)

## Appendix: Skill Details

### System Introspection Skill

**Trigger:** User asks about queue health, active agents, task status, or logs

**Guidance:**

````markdown
# System Introspection

You can directly inspect BDE's internal state:

## Check Queue Health

Query SQLite:

```sql
SELECT status, COUNT(*) FROM sprint_tasks GROUP BY status;
```
````

Look for:

- High blocked count → dependency issues
- Stalled active tasks → check started_at (>1hr)

## View Active Agents

```sql
SELECT id, status, task, started_at
FROM agent_runs
WHERE status='running';
```

Cross-reference with ~/.bde/agent-manager.log for output.

## Inspect Task Status

```sql
SELECT * FROM sprint_tasks WHERE id='...';
```

Check depends_on field for dependency chains.

## Diagnose Pipeline Stalls

- Tasks stuck in 'active' for >1hr (check started_at)
- Check ~/.bde/agent-manager.log for watchdog timeouts
- Verify worktrees exist: ls ~/worktrees/bde/agent-\*

````

**Capabilities:**
- `sqlite-query` — direct DB access
- `file-read-logs` — read ~/.bde/ logs

### Task Orchestration Skill

**Trigger:** User wants to create tasks, set dependencies, or manage queue

**Guidance:**
```markdown
# Task Orchestration

## Creating Tasks
Use sprint:create IPC channel:
- Requires: title, repo, prompt or spec
- spec = structured markdown with ## headings (for status='queued')
- prompt = freeform text (for backlog)

## Setting Dependencies
- Hard: downstream blocked until upstream succeeds
- Soft: downstream unblocks regardless
- Format: `depends_on: [{id: 'task-id', type: 'hard'}]`
- Cycles rejected at creation

## Bulk Operations
1. Create parent task with full spec
2. Create child tasks with depends_on → parent
3. Soft deps between siblings if order doesn't matter

## Queue API Alternative
http://localhost:18790/queue/tasks
- POST /queue/tasks — create
- PATCH /queue/tasks/:id/dependencies — update deps
- Auth: Bearer token from Settings > Agent Manager
````

**Capabilities:**

- `ipc-sprint-create` — create tasks via IPC
- `queue-api-call` — HTTP API access

### Code Patterns Skill

**Trigger:** User asks to generate BDE-idiomatic code (IPC, Zustand, panels)

**Guidance:**

````markdown
# BDE Code Patterns

## IPC Handlers

All handlers must use safeHandle() wrapper:

```typescript
import { safeHandle } from '../handlers-shared'

export function registerMyHandlers() {
  safeHandle('my:channel', async (payload) => {
    // Handler logic
    return result
  })
}
```
````

Register in src/main/index.ts.
Update preload: src/preload/index.ts AND src/preload/index.d.ts.

## Zustand Stores

- One store per domain concern
- Use useShallow for 5+ field selections
- Never use Map as state (breaks equality)
- Selector pattern: `const x = useStore(s => s.x)`

## Panel Views

1. Add to View union in panelLayout.ts
2. Update ALL maps: VIEW_ICONS, VIEW_LABELS, VIEW_SHORTCUTS
3. Create ViewName.tsx in src/renderer/src/views/
4. Add lazy import in view-resolver.tsx
5. Register in resolveView() switch

## Testing

- Thresholds: 72% stmts, 66% branches, 70% functions, 74% lines
- Focus on branch coverage (tightest threshold)
- Test all conditionals (if/else, ternaries, error/loading states)

````

**Capabilities:**
- `code-generation` — scaffold patterns

## Appendix: Memory Details

### IPC Conventions

```markdown
## IPC Conventions

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
````

### Testing Patterns

```markdown
## Testing Patterns

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

- Renderer: src/renderer/src/\*\*/**tests**/
- Main: src/main/**tests**/
- Integration: src/main/**tests**/integration/
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
```

### Architecture Rules

```markdown
## Architecture Rules

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
```

---

**End of Specification**
