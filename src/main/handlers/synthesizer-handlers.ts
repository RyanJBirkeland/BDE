/**
 * Spec Synthesizer IPC handlers — AI-powered spec generation and revision.
 */
import { safeHandle } from '../ipc-utils'
import { synthesizeSpec, reviseSpec, cancelSynthesis } from '../services/spec-synthesizer'

/**
 * Register all synthesizer IPC handlers.
 * Follows the same streaming pattern as workbench:chatStream.
 */
export function registerSynthesizerHandlers(): void {
  // --- Generate spec from template + answers ---
  safeHandle('synthesizer:generate', async (e, request) => {
    const streamId = `synthesizer-gen-${Date.now()}`

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

    return { streamId }
  })

  // --- Revise existing spec ---
  safeHandle('synthesizer:revise', async (e, request) => {
    const streamId = `synthesizer-rev-${Date.now()}`

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

    return { streamId }
  })

  // --- Cancel active stream ---
  safeHandle('synthesizer:cancel', async (_e, streamId) => {
    const ok = cancelSynthesis(streamId)
    return { ok }
  })
}
