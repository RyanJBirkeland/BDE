/**
 * Spec Synthesizer IPC handlers — AI-powered spec generation and revision.
 */
import { randomUUID } from 'node:crypto'
import { safeHandle } from '../ipc-utils'
import { synthesizeSpec, reviseSpec, cancelSynthesis } from '../services/spec-synthesizer'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import type { SynthesizeRequest, ReviseRequest } from '../../shared/types'

const log = createLogger('synthesizer')

const MAX_FIELD_CHARS = 10_000

function validateSynthesizeRequest(request: unknown): request is SynthesizeRequest {
  if (!request || typeof request !== 'object') return false
  const r = request as Record<string, unknown>
  if (typeof r.templateName !== 'string' || r.templateName.length > 500) return false
  if (typeof r.repo !== 'string' || r.repo.length === 0) return false
  if (typeof r.repoPath !== 'string' || r.repoPath.length === 0) return false
  if (!r.answers || typeof r.answers !== 'object' || Array.isArray(r.answers)) return false
  if (r.customPrompt !== undefined && typeof r.customPrompt !== 'string') return false
  if (typeof r.customPrompt === 'string' && r.customPrompt.length > MAX_FIELD_CHARS) return false
  return true
}

function validateReviseRequest(request: unknown): request is ReviseRequest {
  if (!request || typeof request !== 'object') return false
  const r = request as Record<string, unknown>
  if (typeof r.currentSpec !== 'string' || r.currentSpec.length === 0) return false
  if (r.currentSpec.length > MAX_FIELD_CHARS) return false
  if (typeof r.instruction !== 'string' || r.instruction.length === 0) return false
  if (r.instruction.length > MAX_FIELD_CHARS) return false
  if (typeof r.repo !== 'string' || r.repo.length === 0) return false
  if (typeof r.repoPath !== 'string' || r.repoPath.length === 0) return false
  return true
}

/**
 * Register all synthesizer IPC handlers.
 * Follows the same streaming pattern as workbench:chatStream.
 */
export function registerSynthesizerHandlers(): void {
  // --- Generate spec from template + answers ---
  safeHandle('synthesizer:generate', async (e, request) => {
    if (!validateSynthesizeRequest(request)) {
      log.warn('[synthesizer] generate: invalid request payload rejected')
      throw new Error('Invalid synthesizer:generate request payload')
    }
    const streamId = randomUUID()

    // Fire-and-forget: stream runs in background, pushes chunks to renderer
    synthesizeSpec(
      request,
      (chunk) => {
        try {
          e.sender.send('synthesizer:chunk', { streamId, chunk, done: false })
        } catch {
          /* window may have closed */
        }
      },
      streamId
    )
      .then((result) => {
        try {
          e.sender.send('synthesizer:chunk', {
            streamId,
            chunk: '',
            done: true,
            fullText: result.spec,
            filesAnalyzed: result.filesAnalyzed
          })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) => {
        try {
          e.sender.send('synthesizer:chunk', {
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
        log.error(`[synthesizer] unhandled rejection in generate: ${getErrorMessage(err)}`)
      )

    return { streamId }
  })

  // --- Revise existing spec ---
  safeHandle('synthesizer:revise', async (e, request) => {
    if (!validateReviseRequest(request)) {
      log.warn('[synthesizer] revise: invalid request payload rejected')
      throw new Error('Invalid synthesizer:revise request payload')
    }
    const streamId = randomUUID()

    // Fire-and-forget: stream runs in background, pushes chunks to renderer
    reviseSpec(
      request,
      (chunk) => {
        try {
          e.sender.send('synthesizer:chunk', { streamId, chunk, done: false })
        } catch {
          /* window may have closed */
        }
      },
      streamId
    )
      .then((result) => {
        try {
          e.sender.send('synthesizer:chunk', {
            streamId,
            chunk: '',
            done: true,
            fullText: result.spec,
            filesAnalyzed: result.filesAnalyzed
          })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) => {
        try {
          e.sender.send('synthesizer:chunk', {
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
        log.error(`[synthesizer] unhandled rejection in revise: ${getErrorMessage(err)}`)
      )

    return { streamId }
  })

  // --- Cancel active stream ---
  safeHandle('synthesizer:cancel', async (_e, streamId) => {
    const ok = cancelSynthesis(streamId)
    return { ok }
  })
}
