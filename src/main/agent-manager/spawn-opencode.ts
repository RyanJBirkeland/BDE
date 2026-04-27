/**
 * opencode CLI agent spawn adapter.
 *
 * Spawns `opencode run "<prompt>" --format json [--dir <cwd>] [-m <model>] [-s <sessionId>]`
 * as a child process, pipes stdout line-by-line through the opencode wire translator,
 * and returns an AgentHandle whose `messages` iterable yields SDKWireMessage objects.
 */
import type { AgentHandle, SteerResult } from './types'
import type { Logger } from '../logger'
import { spawn } from 'node:child_process'
import { translateOpencodeEvent, extractOpencodeSessionId } from './opencode-wire'

export interface OpencodeSpawnOptions {
  readonly prompt: string
  readonly cwd: string
  readonly model: string
  readonly sessionId?: string
  readonly executable?: string
  readonly logger?: Logger
}

export async function spawnOpencode(opts: OpencodeSpawnOptions): Promise<AgentHandle> {
  const executable = opts.executable ?? 'opencode'
  const args = buildArgs(opts)
  const child = spawn(executable, args, {
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stderr.setMaxListeners(5)

  // Pre-seed so handle.sessionId is correct before the first event arrives on resume turns.
  let capturedSessionId = opts.sessionId ?? ''

  wireStderr(child, opts.logger, () => handle)

  const handle: AgentHandle = {
    messages: streamTranslatedMessages(child, opts.logger, (sessionId) => {
      if (!capturedSessionId) capturedSessionId = sessionId
    }),
    get sessionId() {
      return capturedSessionId
    },
    abort() {
      child.kill('SIGTERM')
    },
    async steer(_message: string): Promise<SteerResult> {
      return { delivered: false, error: 'steer not supported for opencode backend' }
    }
  }

  return handle
}

function buildArgs(opts: OpencodeSpawnOptions): string[] {
  const args = ['run', opts.prompt, '--format', 'json', '--dir', opts.cwd, '--model', opts.model]
  if (opts.sessionId) {
    args.push('--session', opts.sessionId)
  }
  return args
}

function wireStderr(
  child: ReturnType<typeof spawn>,
  logger: Logger | undefined,
  getHandle: () => AgentHandle
): void {
  let stderrBuffer = ''

  // stdio config guarantees stderr is non-null
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
    const lines = stderrBuffer.split('\n')
    stderrBuffer = lines.pop() ?? ''
    for (const line of lines) {
      forwardStderrLine(line, logger, getHandle)
    }
  })

  child.stderr!.on('end', () => {
    forwardStderrLine(stderrBuffer, logger, getHandle)
    stderrBuffer = ''
  })
}

function forwardStderrLine(
  line: string,
  logger: Logger | undefined,
  getHandle: () => AgentHandle
): void {
  const trimmed = line.trim()
  if (!trimmed) return
  logger?.warn(`[opencode stderr] ${trimmed}`)
  const handle = getHandle()
  if (handle.onStderr) {
    handle.onStderr(trimmed)
  }
}

async function* streamTranslatedMessages(
  child: ReturnType<typeof spawn>,
  logger: Logger | undefined,
  onSessionId: (id: string) => void
): AsyncIterable<unknown> {
  let buffer = ''

  // stdio config guarantees stdout is non-null
  for await (const chunk of child.stdout!) {
    buffer += (chunk as Buffer).toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      yield* translateLine(line, logger, onSessionId)
    }
  }

  for (const line of buffer.split('\n')) {
    yield* translateLine(line, logger, onSessionId)
  }
}

function* translateLine(
  line: string,
  logger: Logger | undefined,
  onSessionId: (id: string) => void
): Iterable<unknown> {
  if (!line.trim()) return

  captureSessionIdIfPresent(line, onSessionId)

  const messages = translateOpencodeEvent(line)
  if (messages.length === 0) {
    logger?.warn(`[opencode] unrecognized line: ${line.slice(0, 120)}`)
    return
  }

  for (const message of messages) {
    yield message
  }
}

function captureSessionIdIfPresent(line: string, onSessionId: (id: string) => void): void {
  const sessionId = extractOpencodeSessionId(line)
  if (sessionId) {
    onSessionId(sessionId)
  }
}
