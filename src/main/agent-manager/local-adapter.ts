/**
 * Local-backend adapter — thin pass-through to `rbt-coding-agent`.
 *
 * BDE calls `spawnLocalAgent` when the backend-selector picks `local`
 * for an agent type. The framework's own BDE adapter already returns a
 * handle whose `messages` iterable emits `SDKWireMessage`-shaped objects,
 * so BDE's downstream drain loop / event mapper / cost tracker consume
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
    return handle as unknown as AgentHandle
  } finally {
    if (previousBase === undefined) {
      delete process.env.OPENAI_API_BASE
    } else {
      process.env.OPENAI_API_BASE = previousBase
    }
  }
}
