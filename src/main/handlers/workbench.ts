/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { safeHandle } from '../ipc-utils'
import { getRepoPath } from '../git'
import { searchRepo } from '../services/repo-search-service'
import type { AgentManager } from '../agent-manager'
import { createSpecQualityService } from '../services/spec-quality/factory'
import type { SpecQualityResult } from '../../shared/spec-quality/types'
import { runSdkStreaming } from '../sdk-streaming'
import { extractTasksFromPlan } from '../services/plan-extractor'
import { buildChatPrompt, getCopilotSdkOptions } from '../services/copilot-service'
import { generateSpec } from '../services/spec-generation-service'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { runOperationalChecks } from '../services/operational-checks-service'
import { resolveAgentRuntime } from '../agent-manager/backend-selector'

const log = createLogger('workbench')

/** Module-level singleton — created once, reused across all checkSpec calls. */
const specQualityService = createSpecQualityService()

type CheckStatus = 'pass' | 'warn' | 'fail'
interface CheckField {
  status: CheckStatus
  message: string
}

/** Maps a SpecQualityResult to the { clarity, scope, filesExist } shape the renderer expects. */
function mapQualityResult(result: SpecQualityResult): {
  clarity: CheckField
  scope: CheckField
  filesExist: CheckField
} {
  // clarity — blocked by any error; warned by prescriptiveness issue; otherwise pass
  const SCOPE_CODES = new Set(['TOO_MANY_FILES', 'TOO_MANY_STEPS', 'SPEC_TOO_LONG'] as const)
  const FILES_CODES = new Set(['FILES_SECTION_NO_PATHS'] as const)

  const scopeIssues = result.issues.filter((i) => SCOPE_CODES.has(i.code as 'TOO_MANY_FILES'))
  const filesIssues = result.issues.filter((i) =>
    FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )
  const clarityIssues = result.issues.filter(
    (i) =>
      !SCOPE_CODES.has(i.code as 'TOO_MANY_FILES') &&
      !FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )

  const clarityErrors = clarityIssues.filter((i) => i.severity === 'error')
  const clarityWarnings = clarityIssues.filter((i) => i.severity === 'warning')

  let clarity: CheckField
  if (clarityErrors.length > 0) {
    const messages = clarityErrors.map((i) => i.message).join('; ')
    clarity = { status: 'fail', message: messages }
  } else if (clarityWarnings.length > 0) {
    clarity = { status: 'warn', message: clarityWarnings[0]?.message ?? '' }
  } else {
    clarity = { status: 'pass', message: 'Spec is clear and actionable' }
  }

  const scopeErrors = scopeIssues.filter((i) => i.severity === 'error')
  const scopeWarnings = scopeIssues.filter((i) => i.severity === 'warning')
  let scope: CheckField
  if (scopeErrors.length > 0) {
    scope = { status: 'fail', message: scopeErrors.map((i) => i.message).join('; ') }
  } else if (scopeWarnings.length > 0) {
    scope = { status: 'warn', message: scopeWarnings[0]?.message ?? '' }
  } else {
    scope = { status: 'pass', message: 'Scope looks achievable in one session' }
  }

  const filesErrors = filesIssues.filter((i) => i.severity === 'error')
  const filesWarnings = filesIssues.filter((i) => i.severity === 'warning')
  let filesExist: CheckField
  if (filesErrors.length > 0) {
    filesExist = { status: 'fail', message: filesErrors.map((i) => i.message).join('; ') }
  } else if (filesWarnings.length > 0) {
    filesExist = { status: 'warn', message: filesWarnings[0]?.message ?? '' }
  } else {
    filesExist = { status: 'pass', message: 'File paths look specific and plausible' }
  }

  return { clarity, scope, filesExist }
}

/** Active streaming handles, keyed by streamId. */
const activeStreams = new Map<string, { close: () => void }>()

export function registerWorkbenchHandlers(am?: AgentManager): void {
  // --- Fully implemented: Operational validation checks ---
  safeHandle('workbench:checkOperational', async (_e, input: { repo: string }) => {
    return runOperationalChecks(input.repo, am)
  })

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
  })

  // NOTE: The non-streaming `workbench:chat` IPC handler was removed.
  // It is fully superseded by `workbench:chatStream`, which is the only
  // path the renderer uses. Removing the handler also removes a defense-
  // in-depth gap: the old non-streaming path did not pass the copilot
  // tool restrictions through to the SDK, so it would have run with
  // `bypassPermissions` and full Edit/Write/Bash access. Do not re-add
  // this channel without routing it through `getCopilotSdkOptions`.

  // --- AI-powered streaming chat ---
  safeHandle('workbench:chatStream', async (e, input) => {
    // Case-insensitive lookup — the renderer sends e.g. `repo: 'BDE'` but
    // the underlying map is keyed by lowercase name.
    const repoPath = getRepoPath(input.formContext.repo)
    const streamId = `copilot-${Date.now()}`

    // Fail fast if the repo is not configured: code-awareness depends on a
    // valid `cwd`, and silently falling back to `process.cwd()` (the BDE app
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
  })

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
  })

  // --- AI-powered spec checks ---
  type CheckSpecInput = {
    title: string
    repo: string
    spec: string
    specType?: string | undefined | null
  }
  safeHandle('workbench:checkSpec', async (_e, input: CheckSpecInput) => {
    const result = await specQualityService.validateFull(input.spec)
    return mapQualityResult(result)
  })

  // --- Plan extraction ---
  safeHandle('workbench:extractPlan', async (_e, markdown: string) => {
    const tasks = extractTasksFromPlan(markdown)
    return { tasks }
  })
}
