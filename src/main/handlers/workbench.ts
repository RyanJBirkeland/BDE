/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { randomUUID } from 'node:crypto'
import { safeHandle } from '../ipc-utils'
import type { IpcChannelMap } from '../../shared/ipc-channels'
import { getRepoPath } from '../paths'
import { searchRepo } from '../services/repo-search-service'
import type { AgentManager } from '../agent-manager'
import { createSpecQualityService } from '../services/spec-quality/factory'
import type { SpecQualityService } from '../services/spec-quality/spec-quality-service'
import type { SpecQualityResult, SpecIssue } from '../../shared/spec-quality/types'
import { runSdkStreaming } from '../sdk-streaming'
import { extractTasksFromPlan } from '../services/plan-extractor'
import { buildChatPrompt, getCopilotSdkOptions } from '../services/copilot-service'
import { generateSpec } from '../services/spec-generation-service'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { runOperationalChecks } from '../services/operational-checks-service'
import { resolveAgentRuntime } from '../agent-manager/backend-selector'

const log = createLogger('workbench')

export interface WorkbenchHandlerDeps {
  /** Optional override — composition root may pass a wired-up service for telemetry/logging. */
  specQualityService?: SpecQualityService
}

type CheckStatus = 'pass' | 'warn' | 'fail'
interface CheckField {
  status: CheckStatus
  message: string
}

/**
 * Folds a list of spec issues into a single CheckField.
 * Fails on any error (joining all messages), warns on the first warning,
 * passes with the given `passMessage` when no issues exist.
 */
function classifyIssues(issues: SpecIssue[], passMessage: string): CheckField {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  if (errors.length > 0) {
    return { status: 'fail', message: errors.map((i) => i.message).join('; ') }
  }
  if (warnings.length > 0) {
    return { status: 'warn', message: warnings[0]?.message ?? '' }
  }
  return { status: 'pass', message: passMessage }
}

const SCOPE_CODES = new Set(['TOO_MANY_FILES', 'TOO_MANY_STEPS', 'SPEC_TOO_LONG'] as const)
const FILES_CODES = new Set(['FILES_SECTION_NO_PATHS'] as const)

/** Maps a SpecQualityResult to the { clarity, scope, filesExist } shape the renderer expects. */
function mapQualityResult(result: SpecQualityResult): {
  clarity: CheckField
  scope: CheckField
  filesExist: CheckField
} {
  const scopeIssues = result.issues.filter((i) => SCOPE_CODES.has(i.code as 'TOO_MANY_FILES'))
  const filesIssues = result.issues.filter((i) =>
    FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )
  const clarityIssues = result.issues.filter(
    (i) =>
      !SCOPE_CODES.has(i.code as 'TOO_MANY_FILES') &&
      !FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )

  return {
    clarity: classifyIssues(clarityIssues, 'Spec is clear and actionable'),
    scope: classifyIssues(scopeIssues, 'Scope looks achievable in one session'),
    filesExist: classifyIssues(filesIssues, 'File paths look specific and plausible')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

type CheckSpecInput = {
  title: string
  repo: string
  spec: string
  specType?: string | undefined | null
}

function parseCheckSpecArgs(args: unknown[]): [CheckSpecInput] {
  if (args.length !== 1) {
    throw new Error(`expected [input]; got ${args.length} args`)
  }
  const [input] = args
  if (!isPlainObject(input)) {
    throw new Error(`input must be a plain object; got ${typeof input}`)
  }
  if (typeof input.title !== 'string') {
    throw new Error('input.title must be a string')
  }
  if (typeof input.repo !== 'string') {
    throw new Error('input.repo must be a string')
  }
  if (typeof input.spec !== 'string') {
    throw new Error('input.spec must be a string')
  }
  return [input as unknown as CheckSpecInput]
}

export function parseResearchRepoArgs(args: unknown[]): [{ query: string; repo: string }] {
  const [input] = args
  if (!isPlainObject(input)) {
    throw new Error('workbench:researchRepo input must be a plain object')
  }
  if (typeof input.query !== 'string' || input.query.trim() === '') {
    throw new Error('workbench:researchRepo input.query must be a non-empty string')
  }
  if (typeof input.repo !== 'string' || input.repo.trim() === '') {
    throw new Error('workbench:researchRepo input.repo must be a non-empty string')
  }
  return [input as { query: string; repo: string }]
}

export function parseChatStreamArgs(args: unknown[]): IpcChannelMap['workbench:chatStream']['args'] {
  const [input] = args
  if (!isPlainObject(input)) {
    throw new Error('workbench:chatStream input must be a plain object')
  }
  if (!Array.isArray(input.messages)) {
    throw new Error('workbench:chatStream input.messages must be an array')
  }
  if (!isPlainObject(input.formContext)) {
    throw new Error('workbench:chatStream input.formContext must be an object')
  }
  if (
    typeof (input.formContext as Record<string, unknown>).repo !== 'string' ||
    ((input.formContext as Record<string, unknown>).repo as string).trim() === ''
  ) {
    throw new Error('workbench:chatStream input.formContext.repo must be a non-empty string')
  }
  return [input as IpcChannelMap['workbench:chatStream']['args'][0]]
}

const MAX_PLAN_MARKDOWN_CHARS = 200 * 1024

function parseCheckOperationalArgs(args: unknown[]): [{ repo: string }] {
  const [input] = args
  if (!isPlainObject(input)) {
    throw new Error('workbench:checkOperational input must be a plain object')
  }
  if (typeof input.repo !== 'string' || input.repo.trim() === '') {
    throw new Error('workbench:checkOperational input.repo must be a non-empty string')
  }
  return [input as { repo: string }]
}

function parseGenerateSpecArgs(args: unknown[]): [{ title: string; repo: string; templateHint: string }] {
  const [input] = args
  if (!isPlainObject(input)) {
    throw new Error('workbench:generateSpec input must be a plain object')
  }
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('workbench:generateSpec input.title must be a non-empty string')
  }
  if (typeof input.repo !== 'string' || input.repo.trim() === '') {
    throw new Error('workbench:generateSpec input.repo must be a non-empty string')
  }
  if (typeof input.templateHint !== 'string') {
    throw new Error('workbench:generateSpec input.templateHint must be a string')
  }
  return [input as { title: string; repo: string; templateHint: string }]
}

export function registerWorkbenchHandlers(
  am?: AgentManager,
  deps: WorkbenchHandlerDeps = {}
): void {
  const specQualityService = deps.specQualityService ?? createSpecQualityService()
  const activeStreams = new Map<string, { close: () => void }>()

  // --- Fully implemented: Operational validation checks ---
  safeHandle('workbench:checkOperational', async (_e, input: { repo: string }) => {
    return runOperationalChecks(input.repo, am)
  }, parseCheckOperationalArgs)

  // --- Fully implemented: Repo research via grep ---
  safeHandle('workbench:researchRepo', async (_e, input: { query: string; repo: string }) => {
      const { query, repo } = input
      const repoPath = getRepoPath(repo)
      if (!repoPath) {
        return {
          content: `Error: No path configured for repo "${repo}"`,
          filesSearched: [],
          totalMatches: 0
        }
      }
      return searchRepo(repoPath, query)
  }, parseResearchRepoArgs)

  // NOTE: The non-streaming `workbench:chat` IPC handler was removed.
  // It is fully superseded by `workbench:chatStream`, which is the only
  // path the renderer uses. Removing the handler also removes a defense-
  // in-depth gap: the old non-streaming path did not pass the copilot
  // tool restrictions through to the SDK, so it would have run with
  // `bypassPermissions` and full Edit/Write/Bash access. Do not re-add
  // this channel without routing it through `getCopilotSdkOptions`.

  // --- AI-powered streaming chat ---
  safeHandle('workbench:chatStream', async (e, input) => {
    // Case-insensitive lookup — the renderer sends e.g. `repo: 'FLEET'` but
    // the underlying map is keyed by lowercase name.
    const repoPath = getRepoPath(input.formContext.repo)
    const streamId = randomUUID()

    // Fail fast if the repo is not configured: code-awareness depends on a
    // valid `cwd`, and silently falling back to `process.cwd()` (the FLEET app
    // directory) means the copilot would operate on the wrong codebase.
    if (!repoPath) {
      const message = `Repo "${input.formContext.repo}" is not configured — code-awareness unavailable. Add the repo in Settings → Repositories.`
      try {
        e.sender.send('workbench:chatChunk', {
          streamId,
          chunk: '',
          done: true,
          error: message
        })
      } catch {
        /* window may have closed */
      }
      return { streamId }
    }

    const prompt = buildChatPrompt(input.messages, input.formContext, repoPath)
    const { model: copilotModel } = resolveAgentRuntime('copilot')

    // Fire-and-forget: stream runs in background, pushes chunks to renderer
    runSdkStreaming(
      prompt,
      (chunk) => {
        try {
          e.sender.send('workbench:chatChunk', { streamId, chunk, done: false })
        } catch {
          /* window may have closed */
        }
      },
      activeStreams,
      streamId,
      undefined,
      getCopilotSdkOptions(repoPath, copilotModel, {
        onToolUse: (event) => {
          try {
            e.sender.send('workbench:chatChunk', {
              streamId,
              chunk: '',
              done: false,
              toolUse: { name: event.name, input: event.input }
            })
          } catch {
            /* window may have closed */
          }
        }
      })
    )
      .then((fullText) => {
        try {
          e.sender.send('workbench:chatChunk', { streamId, chunk: '', done: true, fullText })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) => {
        try {
          e.sender.send('workbench:chatChunk', {
            streamId,
            chunk: '',
            done: true,
            error: (err as Error).message
          })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) =>
        log.error(`[workbench] unhandled rejection in chatStream: ${getErrorMessage(err)}`)
      )

    return { streamId }
  }, parseChatStreamArgs)

  // --- Cancel active stream ---
  safeHandle('workbench:cancelStream', async (_e, streamId) => {
    const handle = activeStreams.get(streamId)
    if (handle) {
      handle.close()
      activeStreams.delete(streamId)
      return { ok: true }
    }
    return { ok: false }
  })

  // --- AI-powered spec generation ---
  type GenerateSpecInput = { title: string; repo: string; templateHint: string }
  safeHandle('workbench:generateSpec', async (_e, input: GenerateSpecInput) => {
    const spec = await generateSpec(input)
    return { spec }
  }, parseGenerateSpecArgs)

  // --- AI-powered spec checks ---
  safeHandle('workbench:checkSpec',
    async (_e, input: CheckSpecInput) => {
      const result = await specQualityService.validateFull(input.spec)
      return mapQualityResult(result)
    },
    parseCheckSpecArgs
  )

  // --- Plan extraction ---
  safeHandle('workbench:extractPlan', async (_e, markdown: string) => {
    if (markdown.length > MAX_PLAN_MARKDOWN_CHARS) {
      throw new Error(
        `Plan markdown too large: ${markdown.length} chars (max ${MAX_PLAN_MARKDOWN_CHARS})`
      )
    }
    const tasks = extractTasksFromPlan(markdown)
    return { tasks }
  })
}
