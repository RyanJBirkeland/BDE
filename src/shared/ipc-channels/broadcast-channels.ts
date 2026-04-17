import type { AgentEvent, ChatChunk, PrListPayload, SprintTask } from '../types'

/**
 * Type-safe broadcast channel registry.
 * Maps channel names to payload types for push events sent from main → renderer.
 */
export interface BroadcastChannels {
  // Agent events
  // `agent:event` is the *payload type key* used by `broadcastCoalesced` —
  // nothing should call `broadcast('agent:event', …)` directly. The renderer
  // only listens to `agent:event:batch`; calling `broadcast` on the single
  // channel drops the event. All emission goes through
  // `agent-event-mapper.emitAgentEvent`, which routes into the batch path.
  'agent:event': { agentId: string; event: AgentEvent }
  'agent:event:batch': Array<{ agentId: string; event: AgentEvent }>

  // Agent manager
  'agent-manager:circuit-breaker-open': {
    consecutiveFailures: number
    openUntil: number
  }

  // Manager warnings (e.g. Keychain repeated failures)
  'manager:warning': { message: string }

  // Filesystem
  'fs:dirChanged': string

  // GitHub
  'github:error': {
    kind:
      | 'no-token'
      | 'token-expired'
      | 'rate-limit'
      | 'billing'
      | 'permission'
      | 'not-found'
      | 'validation'
      | 'server'
      | 'network'
      | 'unknown'
    message: string
    status?: number
  }

  // Pull requests
  'pr:listUpdated': PrListPayload

  // Repository discovery
  'repos:cloneProgress': {
    owner: string
    repo: string
    line: string
    done: boolean
    error?: string
    localPath?: string
  }

  // Code review streaming
  'review:chatChunk': ChatChunk

  // Sprint tasks
  'sprint:externalChange': void
  'sprint:mutation': { type: 'created' | 'updated' | 'deleted'; task: SprintTask }

  // Synthesizer streaming
  'synthesizer:chunk': {
    streamId: string
    chunk: string
    done: boolean
    fullText?: string
    filesAnalyzed?: string[]
    error?: string
  }

  // Task terminal
  'task-terminal:resolution-error': { error: string }

  // Workbench streaming
  'workbench:chatChunk': {
    streamId: string
    chunk: string
    done: boolean
    fullText?: string
    error?: string
    toolUse?: { name: string; input: Record<string, unknown> }
  }

  // Tearoff window tab/drag events (pushed via webContents.send from tearoff-manager.ts)
  'tearoff:confirmClose': { windowId: string }
  'tearoff:tabReturned': { windowId: string; view: string }
  'tearoff:tabRemoved': { windowId: string; sourcePanelId: string; sourceTabIndex: number }
  'tearoff:dragIn': { viewKey: string; x: number; y: number }
  'tearoff:dragMove': { x: number; y: number }
  'tearoff:dragDone': void
  'tearoff:dragCancel': void
  'tearoff:crossWindowDrop': { view: string; targetPanelId: string; zone: string }
}
