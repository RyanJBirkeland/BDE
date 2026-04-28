/**
 * Local-backend adapter — thin pass-through to `rbt-coding-agent`.
 *
 * FLEET calls `spawnLocalAgent` when the backend-selector picks `local`
 * for an agent type. The framework's own FLEET adapter already returns a
 * handle whose `messages` iterable emits `SDKWireMessage`-shaped objects,
 * so FLEET's downstream drain loop / event mapper / cost tracker consume
 * the stream without any translation on this side.
 *
 * Dynamic `import()` of the framework module keeps Electron's bundler
 * from eagerly resolving it at build time — the `file:` dependency is
 * a runtime concern only.
 */
import type { AgentHandle } from './types'
import type { Logger } from '../logger'

export interface LocalSpawnOptions {
  readonly prompt: string
  readonly cwd: string
  readonly model: string
  readonly endpoint: string
  readonly logger?: Logger | undefined
}

/**
 * Verifies that the handle returned by the local framework has the required
 * members before the cast to `AgentHandle`. A missing `messages` iterable,
 * `steer`, or `abort` would cause a runtime crash the first time the drain
 * loop consumes the handle — better to fail here with a clear error.
 */
function assertValidAgentHandle(handle: unknown): void {
  if (handle === null || typeof handle !== 'object') {
    throw new Error(
      'Local agent backend returned a non-object handle — expected an object with messages, steer, and abort.'
    )
  }
  const h = handle as Record<string, unknown>
  if (h.messages === null || typeof h.messages !== 'object' || !(Symbol.asyncIterator in (h.messages as object))) {
    throw new Error(
      'Local agent backend returned a handle with no async-iterable messages property.'
    )
  }
  if (typeof h.steer !== 'function') {
    throw new Error('Local agent backend returned a handle missing the required steer() method.')
  }
  if (typeof h.abort !== 'function') {
    throw new Error('Local agent backend returned a handle missing the required abort() method.')
  }
}

export async function spawnLocalAgent(opts: LocalSpawnOptions): Promise<AgentHandle> {
  let spawnBdeAgent: (typeof import('rbt-coding-agent/adapters/bde'))['spawnBdeAgent']
  try {
    ;({ spawnBdeAgent } = await import('rbt-coding-agent/adapters/bde'))
  } catch (err) {
    throw new Error(
      'The "local" agent backend requires the optional rbt-coding-agent package, ' +
        'which is not installed. Install it (sibling repo or npm) or switch the ' +
        'agent backend to another option in Settings. ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const previousBase = process.env.OPENAI_API_BASE
  process.env.OPENAI_API_BASE = opts.endpoint
  try {
    const handle = await spawnBdeAgent({
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: opts.model
    })
    assertValidAgentHandle(handle)
    return handle as AgentHandle
  } finally {
    if (previousBase === undefined) {
      delete process.env.OPENAI_API_BASE
    } else {
      process.env.OPENAI_API_BASE = previousBase
    }
  }
}
