# Clean Code Function Design Audit — Team 1

**Audit Date:** 2026-04-13
**Scope:** Large functions (750+ lines) analyzed for Uncle Bob's Clean Code principles (Chapters 3 & 6)
**Auditor:** Claude Code Analysis Agent

---

## F-t1-funcs-1: runAgent — Too Large, Mixed Levels of Abstraction
**Severity:** Critical  
**Category:** Function Design  
**Location:** `src/main/agent-manager/run-agent.ts:714-769`  
**Evidence:**
```typescript
export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger } = deps
  const effectiveModel = task.model || deps.defaultModel

  // Phase 1: Validate and prepare prompt
  let prompt: string
  try {
    prompt = await validateAndPreparePrompt(task, worktree, repoPath, deps)
  } catch {
    return // Early exit — validation failed and cleaned up
  }

  // Phase 2: Spawn and wire agent
  let agent: ActiveAgent, agentRunId: string, turnTracker: TurnTracker
  try {
    const result = await spawnAndWireAgent(task, prompt, worktree, repoPath, effectiveModel, deps)
    agent = result.agent
    agentRunId = result.agentRunId
    turnTracker = result.turnTracker
  } catch {
    return // Early exit — spawn failed and cleaned up
  }

  // Phase 3: Consume messages
  const { exitCode, lastAgentOutput, streamError } = await consumeMessages(
    agent.handle, agent, task, worktree.worktreePath, agentRunId, turnTracker, logger
  )
  if (streamError) {
    logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  }

  // Phase 4: Finalize
  await finalizeAgentRun(
    task, worktree, repoPath, agent, agentRunId, turnTracker, exitCode, lastAgentOutput, deps
  )
}
```

**Impact:**  
While this function reads linearly (good!), it is **orchestrating 4 distinct phases with radically different concerns at different abstraction levels**:
- Phase 1: business logic (task validation, prompt assembly)
- Phase 2: process management (spawning, tracking, IPC wiring)
- Phase 3: streaming and cost tracking
- Phase 4: completion handling (git rebase, PR creation, retry logic)

The function acts as a 4-way state machine that doesn't clearly show that each phase has its own error handling contract and side effects. Callers can't tell that a silent `return` in phase 1 is different semantically from phase 2.

**Recommendation:**  
Extract each phase into its own high-level domain function, then compose them:
```typescript
async function phase1_ValidateAndPreparePrompt(...): Promise<string>
async function phase2_SpawnAndWireAgent(...): Promise<AgentContext>
async function phase3_ConsumeMessages(...): Promise<Completion>
async function phase4_FinalizeRun(...): Promise<void>

export async function runAgent(...) {
  const prompt = await phase1_ValidateAndPreparePrompt(...)
  const context = await phase2_SpawnAndWireAgent(...)
  const completion = await phase3_ConsumeMessages(...)
  await phase4_FinalizeRun(...)
}
```

This makes the 4-phase choreography explicit at the top level.

**Effort:** M  
**Confidence:** High

---

## F-t1-funcs-2: finalizeAgentRun — Multiple Levels of Concern, Weak Cohesion
**Severity:** High  
**Category:** Function Design  
**Location:** `src/main/agent-manager/run-agent.ts:660-712`  
**Evidence:**
```typescript
async function finalizeAgentRun(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  agent: ActiveAgent,
  agentRunId: string,
  turnTracker: TurnTracker,
  exitCode: number | undefined,
  lastAgentOutput: string,
  deps: RunAgentDeps
): Promise<void> {
  // emit completion event
  emitAgentEvent(agentRunId, { type: 'agent:completed', ... })
  
  // check if watchdog cleaned up
  if (!activeAgents.has(task.id)) { ... return }
  
  // persist telemetry
  persistAgentRunTelemetry(...)
  
  // classify exit and resolve
  await resolveAgentExit(...)
  
  // remove from active map
  activeAgents.delete(task.id)
  
  // cleanup or preserve worktree
  await cleanupOrPreserveWorktree(...)
}
```

**Impact:**  
This function orchestrates 6 distinct sub-concerns:
1. **Telemetry emission** (event system notification)
2. **Watchdog interaction** (checking if another process cleaned up)
3. **Persistence** (writing costs/tokens to DB)
4. **Exit classification** (fast-fail detection, status transitions)
5. **State management** (removing from active map)
6. **Resource cleanup** (worktree disposal or preservation)

These operate at different levels of abstraction and have separate error handling needs. A reader cannot tell the logical flow without detailed knowledge of each sub-function.

**Recommendation:**  
Extract a "finalization orchestrator" that makes the flow explicit:
```typescript
async function finalizeAgentRun(...) {
  emitAgentEvent(agentRunId, { type: 'agent:completed', ... })
  
  if (await isCleanedUpByWatchdog(task.id, activeAgents)) {
    await capturePartialDiffAndCleanup(...)
    return
  }
  
  await persistTelemetry(agentRunId, agent, exitCode, turnTracker, ...)
  await classifyExitAndResolveTask(task, exitCode, lastAgentOutput, agent, ...)
  
  activeAgents.delete(task.id)
  await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-funcs-3: _drainLoop — Too Many Arguments, Multiple Concerns Bundled
**Severity:** High  
**Category:** Function Design  
**Location:** `src/main/agent-manager/index.ts:413-440`  
**Evidence:**
```typescript
async _drainLoop(): Promise<void> {
  this.logger.info(`...`)
  if (!this._validateDrainPreconditions()) return
  
  this._metrics.increment('drainLoopCount')
  const drainStart = Date.now()
  
  const taskStatusMap = this._refreshDependencyIndex()
  
  const available = availableSlots(this._concurrency, this._activeAgents.size)
  if (available <= 0) return
  
  try {
    const tokenOk = await checkOAuthToken(this.logger)
    if (!tokenOk) return
    
    await this._drainQueuedTasks(available, taskStatusMap)
  } catch (err) {
    this.logger.error(`[agent-manager] Drain loop error: ${err}`)
  }
  
  this._metrics.setLastDrainDuration(Date.now() - drainStart)
  this._concurrency = tryRecover(this._concurrency, Date.now())
}
```

**Impact:**  
The function performs 6 distinct checks/actions at different levels:
1. Precondition validation (state machine logic)
2. Metrics recording (instrumentation)
3. Dependency index refresh (data layer)
4. Slot availability calculation (concurrency logic)
5. OAuth token validation (auth concern)
6. Task draining (business logic)
7. Metrics update and concurrency recovery (state mutation)

The early returns for different reasons (preconditions, available slots, token ok) make it hard to understand the overall control flow. A reader must trace through all conditions to understand when the main work happens.

**Recommendation:**  
Extract guard checks and metrics wrapping:
```typescript
async _drainLoop(): Promise<void> {
  if (!this._validateDrainPreconditions()) return
  if (!await this._checkAuthAndConcurrency()) return
  
  const drainMetrics = new DrainMetrics()
  const taskStatusMap = this._refreshDependencyIndex()
  
  await this._drainQueuedTasks(available, taskStatusMap)
  
  drainMetrics.recordCompletion(Date.now() - drainStart)
  this._concurrency = tryRecover(this._concurrency, Date.now())
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-funcs-4: resolveSuccess — Command-Query Separation Violation (Hidden State Mutation)
**Severity:** High  
**Category:** Function Design  
**Location:** `src/main/agent-manager/completion.ts:321-426`  
**Evidence:**
```typescript
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  // Guard: worktree must exist
  if (!existsSync(worktreePath)) {
    await failTaskWithError(...) // SIDE EFFECT: updates DB, broadcasts event
    return
  }
  
  // Detect branch
  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    await failTaskWithError(...) // SIDE EFFECT
    return
  }
  
  // Auto-commit
  await autoCommitIfDirty(...) // SIDE EFFECT: modifies git
  
  // Rebase
  const rebaseResult = await rebaseOntoMain(...) // SIDE EFFECT: modifies git
  
  // Check commits
  const hasCommits = await hasCommitsAheadOfMain({...}) // SIDE EFFECT: may call resolveFailure
  if (!hasCommits) return
  
  // Transition to review
  await transitionToReview({...}) // SIDE EFFECT: updates DB
  
  // Auto-merge
  await attemptAutoMerge({...}) // SIDE EFFECT: may merge, update DB, call onTaskTerminal
}
```

**Impact:**  
The function **claims to "resolve success"** but actually:
- Detects and transitions to "review" status (not success)
- May transition to "failed" or "error" status (via failTaskWithError)
- May auto-merge and transition to "done" (hidden inside attemptAutoMerge)
- Calls multiple terminal callbacks (onTaskTerminal)

The function name and signature (`Promise<void>`) hide that it's **mutating DB state, triggering git operations, and managing the entire post-completion flow**. A caller cannot tell from the signature that calling this function will:
1. Rebase the branch
2. Auto-commit changes
3. Possibly merge the PR
4. Trigger cascading downstream task dependency updates

This is **Command-Query Separation violation** — the function claims to "resolve" but performs massive side effects.

**Recommendation:**  
Break into clearly named phases:
```typescript
export async function completeAgentRun(opts: ResolveSuccessOpts, logger: Logger): Promise<CompletionResult> {
  const branch = await detectBranch(opts.worktreePath)
  const rebaseResult = await rebaseOntoMain(opts.worktreePath, env, logger)
  const hasCommits = await hasCommitsAheadOfMain({...})
  
  return { branch, rebaseResult, hasCommits }
}

export async function transitionToReviewAndMaybeAutoMerge(
  completion: CompletionResult,
  opts: ResolveSuccessOpts,
  logger: Logger
): Promise<void> {
  // DB mutations and auto-merge logic here
}
```

Or rename to be explicit: `async function finalize_rebase_commit_transition_and_maybe_merge(...)`.

**Effort:** L  
**Confidence:** High

---

## F-t1-funcs-5: _processQueuedTask — Excessive Arguments, Mixed Concerns
**Severity:** High  
**Category:** Function Design  
**Location:** `src/main/agent-manager/index.ts:257-346`  
**Evidence:**
```typescript
async _processQueuedTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<void> {
  const taskId = raw.id as string
  if (this._processingTasks.has(taskId)) return
  this._processingTasks.add(taskId)
  
  try {
    // 1. Map raw task
    const task = mapQueuedTask(raw, this.logger)
    if (!task) return
    
    // 2. Check dependencies
    if (checkAndBlockDeps(...)) return
    
    // 3. Resolve repo path
    const repoPath = this.resolveRepoPath(task.repo)
    if (!repoPath) {
      // ... error handling, DB update, terminal notification ...
      return
    }
    
    // 4. Claim task
    const claimed = this.claimTask(task.id)
    if (!claimed) return
    
    // 5. Refresh task status snapshot
    const freshTasks = this.repo.getTasksWithDependencies()
    taskStatusMap.clear()
    for (const t of freshTasks) {
      taskStatusMap.set(t.id, t.status)
    }
    
    // 6. Setup worktree
    let wt: { worktreePath: string; branch: string }
    try {
      wt = await setupWorktree({...})
    } catch (err) {
      // ... error handling, DB update, terminal notification ...
      return
    }
    
    // 7. Spawn agent
    this._spawnAgent(task, wt, repoPath)
  } finally {
    this._processingTasks.delete(taskId)
  }
}
```

**Impact:**  
This function performs 7 sequential sub-steps at radically different levels of abstraction:
1. **Data mapping** (raw → typed)
2. **Constraint checking** (dependencies)
3. **Configuration resolution** (repo mapping)
4. **Locking** (claim task)
5. **Cache refresh** (snapshot update)
6. **Resource provisioning** (worktree setup)
7. **Process spawning** (agent start)

Each step has different error handling semantics (silent skip, error+terminal, error only). The function is 90 lines of deeply nested control flow that makes it hard to understand when/why steps are skipped.

**Recommendation:**  
Extract into a sequence of guards and a main handler:
```typescript
async _processQueuedTask(raw: Record<string, unknown>, taskStatusMap: Map<string, string>): Promise<void> {
  const guard = this._validateTaskForProcessing(raw)
  if (!guard.ok) return guard.handle()
  
  const { task, repoPath } = guard.result
  
  this._refreshTaskStatusSnapshot(taskStatusMap)
  
  try {
    const wt = await setupWorktree({...})
    this._spawnAgent(task, wt, repoPath)
  } catch (err) {
    await this._handleWorktreeSetupFailure(task, err)
  }
}

private _validateTaskForProcessing(raw: unknown): GuardResult<{task, repoPath}> {
  // All 5 validation checks (map, deps, repo, claim, reentrancy)
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-funcs-6: buildPipelinePrompt — Too Many Conditional Sections, Low Cohesion
**Severity:** Medium  
**Category:** Function Design  
**Location:** `src/main/agent-manager/prompt-composer.ts:299-423`  
**Evidence:**
```typescript
function buildPipelinePrompt(input: BuildPromptInput): string {
  let prompt = CODING_AGENT_PREAMBLE
  
  // Inject personality
  prompt += buildPersonalitySection(pipelinePersonality)
  
  // Inject memory
  const memoryText = getAllMemory({ repoName: repoName ?? undefined })
  if (memoryText.trim()) {
    prompt += '\n\n## BDE Conventions\n'
    prompt += memoryText
  }
  
  // Inject user memory (selective)
  const userMem = taskContent ? selectUserMemory(taskContent) : getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }
  
  // Plugin disable note
  if (isBdeRepo(repoName)) {
    prompt += '\n\n## Note\n'
    prompt += 'You have BDE-native skills...'
  }
  
  // Branch appendix
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }
  
  // Playground
  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }
  
  // Prior attempt context
  if (priorScratchpad) {
    prompt += '\n\n## Prior Attempt Context\n\n'
    prompt += priorScratchpad
  }
  
  // Scratchpad instructions
  if (taskId) {
    prompt += buildScratchpadSection(taskId)
  }
  
  // Output budget hint
  if (taskContent) {
    const taskClass = classifyTask(taskContent)
    prompt += buildOutputCapHint(taskClass)
    prompt += '\n\n## Task Specification\n\n'
    prompt += truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)
    if (wasTruncated) {
      prompt += `\n\n[spec truncated...]`
    }
  }
  
  // Cross-repo contract
  if (crossRepoContract && crossRepoContract.trim()) {
    prompt += '\n\n## Cross-Repo Contract\n\n'
    prompt += crossRepoContract
  }
  
  // Upstream context
  prompt += buildUpstreamContextSection(upstreamContext)
  
  // Retry context
  if (retryCount && retryCount > 0) {
    prompt += buildRetryContext(retryCount, previousNotes)
  }
  
  // Self-review checklist
  prompt += `\n\n## Self-Review Checklist...`
  
  // Pipeline-only operational sections
  prompt += PIPELINE_SETUP_RULE
  prompt += CONTEXT_EFFICIENCY_HINT
  prompt += PIPELINE_JUDGMENT_RULES
  if (maxRuntimeMs && maxRuntimeMs > 0) {
    prompt += buildTimeLimitSection(maxRuntimeMs)
  }
  prompt += IDLE_TIMEOUT_WARNING
  prompt += DEFINITION_OF_DONE
  
  return prompt
}
```

**Impact:**  
This function is **25+ string concatenations** with 15+ conditional blocks building different "sections" of a prompt. The function does one thing (build a prompt) but has so many variations and optional sections that it's hard to understand:
- What sections are always included?
- What's the intended order?
- What sections depend on other sections being present?
- How does it work for pipeline vs assistant vs synthesizer?

The function is 124 lines of mostly string formatting with conditional wrapping. This violates the **Single Responsibility Principle** — it's responsible for both "deciding which sections to include" AND "formatting and concatenating strings".

**Recommendation:**  
Extract a "section builder" pattern:
```typescript
function buildPipelinePrompt(input: BuildPromptInput): string {
  const sections: PromptSection[] = [
    { type: 'preamble', content: CODING_AGENT_PREAMBLE },
    { type: 'personality', content: buildPersonalitySection(pipelinePersonality) },
  ]
  
  if (input.branch) {
    sections.push({ type: 'branch', content: buildBranchAppendix(input.branch) })
  }
  
  if (input.priorScratchpad) {
    sections.push({ type: 'prior-context', content: buildPriorContext(input.priorScratchpad) })
  }
  
  // ... more conditional sections ...
  
  sections.push(
    { type: 'operational', content: PIPELINE_SETUP_RULE },
    { type: 'operational', content: CONTEXT_EFFICIENCY_HINT },
    { type: 'definition-of-done', content: DEFINITION_OF_DONE }
  )
  
  return sections.map(s => s.content).join('')
}
```

This makes the section inclusion logic explicit and separates section building from concatenation.

**Effort:** M  
**Confidence:** Medium

---

## F-t1-funcs-7: EpicDetail Component — Too Many State Variables, Complex Interdependencies
**Severity:** High  
**Category:** Function Design  
**Location:** `src/renderer/src/components/planner/EpicDetail.tsx:43-165`  
**Evidence:**
```typescript
export function EpicDetail({
  group, tasks, allGroups, onAddDependency, onRemoveDependency,
  onUpdateDependencyCondition, loading, onQueueAll, onAddTask, onEditTask,
  onEditGroup, onDeleteGroup, onToggleReady, onReorderTasks, onMarkCompleted
}: EpicDetailProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState('')
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<HTMLButtonElement[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = usePrompt()
  
  // useEffect for menu click-outside
  // useEffect for keyboard navigation
  // useMemo for status counts
  // useMemo for tasks needing specs
  // useMemo for tasks ready to queue
  // useMemo for progress percent
  // useMemo for progress color
  // useMemo for split tasks (terminal vs outstanding)
  // ... handler functions ...
}
```

**Impact:**  
The component declares **15+ state variables and computed values** with complex interdependencies:
- `draggedTaskId` + `dragOverTaskId` form a drag state machine
- `editingTaskId` + `editingSpec` + `saving` form an edit state machine
- `showOverflowMenu` + `menuRef` + `menuItemsRef` manage UI state
- Multiple `useMemo` blocks compute derived state from `tasks`

The function doesn't make clear which state variables are independent vs which form sub-machines. A reader must mentally trace through all 15+ variables to understand the component's behavior.

**Recommendation:**  
Extract state machines into custom hooks:
```typescript
function useDragState() {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  return { draggedTaskId, dragOverTaskId, setDraggedTaskId, setDragOverTaskId }
}

function useEditState() {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState('')
  const [saving, setSaving] = useState(false)
  return { editingTaskId, editingSpec, saving, setEditingTaskId, setEditingSpec, setSaving }
}

function useMenuState() {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<HTMLButtonElement[]>([])
  // ... click-outside and keyboard logic ...
  return { showOverflowMenu, setShowOverflowMenu, menuRef, menuItemsRef }
}

export function EpicDetail(props: EpicDetailProps) {
  const dragState = useDragState()
  const editState = useEditState()
  const menuState = useMenuState()
  const { counts, progress } = useStatusCounts(props.tasks)
  
  return (...)
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-funcs-8: consumeMessages — Too Many Arguments, Unclear Separation of Concerns
**Severity:** Medium  
**Category:** Function Design  
**Location:** `src/main/agent-manager/run-agent.ts:167-220`  
**Evidence:**
```typescript
export async function consumeMessages(
  handle: AgentHandle,
  agent: ActiveAgent,
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger
): Promise<ConsumeMessagesResult> {
  let exitCode: number | undefined
  let lastAgentOutput = ''
  
  try {
    for await (const msg of handle.messages) {
      const result = processSDKMessage(
        msg, agent, task, worktreePath, agentRunId, turnTracker, logger,
        exitCode, lastAgentOutput
      )
      exitCode = result.exitCode
      lastAgentOutput = result.lastAgentOutput
    }
  } catch (err) {
    logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
    // ... error handling, event emission, OAuth refresh ...
    return { exitCode, lastAgentOutput, streamError: ... }
  }
  
  return { exitCode, lastAgentOutput }
}
```

**Impact:**  
The function takes **7 parameters** with unclear ownership:
- `handle`: the message stream source
- `agent`: the agent state to mutate (costs, tokens)
- `task`: the task context (for error reporting)
- `worktreePath`: resource path (for playground event detection)
- `agentRunId`: event emitter parameter (for event system)
- `turnTracker`: accumulated state (for token counting)
- `logger`: infrastructure

This is **too many parameters** bundling together concerns that should be clearer. The function doesn't read as "consume messages and extract result" — it reads as "consume messages while mutating agent state, emitting events, refreshing tokens, and handling OAuth".

**Recommendation:**  
Group related parameters into domain objects:
```typescript
interface MessageConsumerContext {
  agentRunId: string
  task: RunAgentTask
  worktreePath: string
  logger: Logger
}

interface MessageConsumerState {
  agent: ActiveAgent
  turnTracker: TurnTracker
}

export async function consumeMessages(
  handle: AgentHandle,
  context: MessageConsumerContext,
  state: MessageConsumerState
): Promise<ConsumeMessagesResult>
```

This reduces from 7 to 3 parameters and makes the semantic grouping explicit.

**Effort:** S  
**Confidence:** Medium

---

## F-t1-funcs-9: processSDKMessage — Output Parameter Violation
**Severity:** Medium  
**Category:** Function Design  
**Location:** `src/main/agent-manager/run-agent.ts:129-162`  
**Evidence:**
```typescript
function processSDKMessage(
  msg: unknown,
  agent: ActiveAgent,          // <-- MUTATED (costs, tokens, rate limits)
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,    // <-- MUTATED (token tracking)
  logger: Logger,
  exitCode: number | undefined,
  lastAgentOutput: string
): { exitCode: number | undefined; lastAgentOutput: string } {
  agent.lastOutputAt = Date.now()
  
  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++           // MUTATION 1
  }
  
  trackAgentCosts(msg, agent, turnTracker)  // MUTATIONS 2-5
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode
  
  // ... event emission, playground event detection ...
  
  return { exitCode, lastAgentOutput }
}
```

**Impact:**  
The function **mutates two passed-in objects** (`agent`, `turnTracker`) while also **returning output values**. This is an **Output Parameter violation** — the function claims to return a result but actually:
1. Updates `agent.costUsd`, `agent.tokensIn`, `agent.tokensOut`, `agent.rateLimitCount`, `agent.lastOutputAt`
2. Updates `turnTracker` internal state
3. Mutates `logger` indirectly (log calls have side effects)
4. Returns a struct with only 2 of the computed values

A caller cannot tell from the signature that passing `agent` will mutate it. This makes testing harder (you need to verify both the return value AND the side effects on `agent`) and makes the code less composable.

**Recommendation:**  
Return all computed values, let caller decide how to mutate state:
```typescript
interface MessageUpdate {
  costUsd: number
  tokensIn: number
  tokensOut: number
  rateLimitCount: number
  lastOutputAt: number
  exitCode: number | undefined
  lastAgentOutput: string
}

function processSDKMessage(msg: unknown, turnTracker: TurnTracker): MessageUpdate {
  const costUsd = getNumericField(msg, 'cost_usd') ?? 0
  const { tokensIn, tokensOut } = turnTracker.processMessage(msg)
  const rateLimitCount = isRateLimitMessage(msg) ? 1 : 0
  
  return { costUsd, tokensIn, tokensOut, rateLimitCount, lastOutputAt: Date.now(), ... }
}

// In caller:
const update = processSDKMessage(msg, turnTracker)
agent.costUsd = update.costUsd
agent.tokensIn = update.tokensIn
// ... etc ...
```

**Effort:** M  
**Confidence:** Medium

---

## F-t1-funcs-10: attemptAutoMerge — Too Many Levels of Nesting, Unclear Error Handling
**Severity:** Medium  
**Category:** Function Design  
**Location:** `src/main/agent-manager/completion.ts:201-263`  
**Evidence:**
```typescript
async function attemptAutoMerge(opts: AutoMergeOpts): Promise<void> {
  const { taskId, title, branch, worktreePath, repo, logger, onTaskTerminal } = opts
  const { getSettingJson } = await import('../settings')
  const rules = getSettingJson<AutoReviewRule[]>('autoReview.rules')
  
  if (!rules || rules.length === 0) {
    return
  }
  
  try {
    const files = await getDiffFileStats(worktreePath)
    if (!files) {
      return
    }
    
    const { evaluateAutoReviewRules } = await import('../services/auto-review')
    const result = evaluateAutoReviewRules(rules, files)
    
    if (result && result.action === 'auto-merge') {
      logger.info(`[completion] Task ${taskId} qualifies for auto-merge...`)
      
      const repoConfig = await getRepoConfig(taskId, repo, logger)
      if (!repoConfig) {
        return
      }
      
      const mergeResult = await executeSquashMerge({...})
      
      if (mergeResult === 'merged') {
        const reviewTask = repo.getTask(taskId)
        repo.updateTask(taskId, {
          status: 'done',
          completed_at: nowIso(),
          worktree_path: null,
          ...(reviewTask?.duration_ms !== undefined ? { duration_ms: reviewTask.duration_ms } : {})
        })
        logger.info(`[completion] Task ${taskId} auto-merged successfully`)
        await onTaskTerminal(taskId, 'done')
      } else if (mergeResult === 'dirty-main') {
        logger.warn(`[completion] Task ${taskId} auto-merge skipped: main repo has uncommitted changes...`)
      } else {
        logger.error(`[completion] Task ${taskId} auto-merge failed...`)
      }
    }
  } catch (err) {
    logger.warn(`[completion] Auto-review check failed for task ${taskId}: ${err}`)
  }
}
```

**Impact:**  
The function has **4 levels of nesting** with **5 different early returns** at different levels:
1. No rules configured → return silently
2. No diff files → return silently
3. Rule doesn't qualify → return silently
4. Repo config not found → return silently
5. Merge result has different branches → different log levels

The error handling is **inconsistent**:
- Some failures are `logger.warn` (rule check, repo config)
- Some are `logger.info` (no rules, no files, no qualification)
- Some are `logger.error` (merge failed)
- Some call `onTaskTerminal('done')`, some don't

A reader cannot easily understand: "What happens if auto-merge is disabled? What if it fails? What's the task status afterward?"

**Recommendation:**  
Separate validation, evaluation, and execution:
```typescript
async function attemptAutoMerge(opts: AutoMergeOpts): Promise<AutoMergeResult> {
  const rules = await loadAutoMergeRules()
  if (!rules) return { action: 'skip', reason: 'rules-disabled' }
  
  const files = await getDiffFileStats(opts.worktreePath)
  if (!files) return { action: 'skip', reason: 'no-changes' }
  
  const evaluation = evaluateAutoReviewRules(rules, files)
  if (!evaluation || evaluation.action !== 'auto-merge') {
    return { action: 'skip', reason: 'rule-mismatch' }
  }
  
  const mergeResult = await executeSquashMerge(...)
  return { action: 'attempted', result: mergeResult }
}

// Caller handles all cases:
const result = await attemptAutoMerge(opts)
switch (result.action) {
  case 'skip':
    logger.info(`Skipped auto-merge: ${result.reason}`)
    break
  case 'attempted':
    if (result.result === 'merged') {
      await onTaskTerminal(taskId, 'done')
    }
    break
}
```

**Effort:** M  
**Confidence:** Medium

---

## Summary

**Total Findings:** 10  
**Critical:** 1  
**High:** 5  
**Medium:** 4  

### Root Causes

1. **Orchestration functions doing too much** — `runAgent`, `_drainLoop`, `resolveSuccess` orchestrate 4–6 sub-concerns at different abstraction levels without extracting them to named helpers.

2. **Too many arguments bundling unrelated concerns** — `consumeMessages`, `_processQueuedTask`, `finalizeAgentRun` pass 6–9 parameters that could be grouped into domain objects.

3. **Conditional section-building without structure** — `buildPipelinePrompt` concatenates 25+ strings with 15+ conditionals; missing a higher-level "section registry" pattern.

4. **State machines scattered across component state** — `EpicDetail` declares 15+ state variables without extracting sub-machines into custom hooks.

5. **Output parameters and hidden mutations** — `processSDKMessage`, `attemptAutoMerge`, `resolveSuccess` mutate passed objects while returning values, violating CQS and making callers' intent unclear.

### Recommended Focus Areas

- **Priority 1:** Extract phase orchestration in `runAgent` (F-t1-funcs-1) — this unblocks readability for the entire agent-manager module.
- **Priority 2:** Reduce arguments in `consumeMessages` and `_processQueuedTask` using domain objects (F-t1-funcs-3, F-t1-funcs-8) — makes error handling clearer.
- **Priority 3:** Refactor `buildPipelinePrompt` section-building pattern (F-t1-funcs-6) — reduces cognitive load on future prompt changes.

