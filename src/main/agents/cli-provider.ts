/**
 * CLI Provider — spawns Claude via the `claude` CLI binary and converts
 * its stream-json stdout into an AsyncIterable<AgentEvent>.
 */
import { spawn, type ChildProcess } from 'child_process'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { AgentProvider, AgentHandle, AgentSpawnOptions, AgentEvent } from './types'
import { CLAUDE_MODELS, DEFAULT_MODEL } from '../../shared/models'
import { getAgentBinary, getAgentPermissionMode } from '../settings'

// Electron's main process has a stripped PATH — augment with common CLI install locations
const ELECTRON_PATH = [
  process.env.PATH,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  `${process.env.HOME}/.local/bin`,
  `${dirname(process.execPath)}`,
].filter(Boolean).join(':')

function modelToFlag(model?: string): string {
  const entry = CLAUDE_MODELS.find((m) => m.id === model)
  return entry?.modelId ?? DEFAULT_MODEL.modelId
}

/** Parse a single stream-json line into an AgentEvent, or null if not mappable. */
function parseStreamEvent(line: string): AgentEvent | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }

  // Unwrap stream_event wrapper if present
  if (parsed.type === 'stream_event' && parsed.event && typeof parsed.event === 'object') {
    parsed = parsed.event as Record<string, unknown>
  }

  const timestamp = Date.now()

  switch (parsed.type) {
    case 'system':
    case 'init':
      return { type: 'agent:started', model: (parsed.model as string) ?? '', timestamp }

    case 'assistant': {
      const message = parsed.message as Record<string, unknown> | undefined
      const content = (message?.content ?? parsed.content) as Array<Record<string, unknown>> | undefined
      if (!content?.length) return null

      // Process first meaningful block
      for (const block of content) {
        if (block.type === 'text') {
          return { type: 'agent:text', text: block.text as string, timestamp }
        }
        if (block.type === 'tool_use') {
          return {
            type: 'agent:tool_call',
            tool: block.name as string,
            summary: block.name as string,
            input: block.input,
            timestamp,
          }
        }
        if (block.type === 'thinking') {
          return {
            type: 'agent:thinking',
            tokenCount: 0,
            text: (block.thinking as string) ?? '',
            timestamp,
          }
        }
      }
      return null
    }

    case 'content_block_start': {
      const block = parsed.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        return {
          type: 'agent:tool_call',
          tool: (block.name as string) ?? 'unknown',
          summary: (block.name as string) ?? 'unknown',
          input: block.input,
          timestamp,
        }
      }
      if (block?.type === 'thinking') {
        return { type: 'agent:thinking', tokenCount: 0, text: '', timestamp }
      }
      return null
    }

    case 'content_block_delta': {
      const delta = parsed.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta') {
        return { type: 'agent:text', text: delta.text as string, timestamp }
      }
      if (delta?.type === 'thinking_delta') {
        return { type: 'agent:thinking', tokenCount: 0, text: (delta.thinking as string) ?? '', timestamp }
      }
      return null
    }

    case 'tool_result':
      return {
        type: 'agent:tool_result',
        tool: (parsed.tool as string) ?? 'unknown',
        success: !parsed.is_error,
        summary: typeof parsed.output === 'string' ? parsed.output : '',
        output: parsed.content,
        timestamp,
      }

    case 'result': {
      const usage = parsed.usage as Record<string, number> | undefined
      return {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
        tokensIn: usage?.input_tokens ?? 0,
        tokensOut: usage?.output_tokens ?? 0,
        durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : 0,
        timestamp,
      }
    }

    case 'error':
      return {
        type: 'agent:error',
        message: (parsed.message as string) ??
          ((parsed.error as Record<string, unknown>)?.message as string) ??
          'Unknown error',
        timestamp,
      }

    default:
      return null
  }
}

/** Convert a child process stdout into an async iterable of AgentEvents. */
async function* createEventStream(child: ChildProcess): AsyncGenerator<AgentEvent> {
  const queue: AgentEvent[] = []
  let resolve: (() => void) | null = null
  let closed = false
  let buffer = ''
  let hasResultEvent = false

  function enqueue(event: AgentEvent) {
    if (event.type === 'agent:completed') hasResultEvent = true
    queue.push(event)
    resolve?.()
    resolve = null
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()! // Keep incomplete last line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = parseStreamEvent(trimmed)
      if (event) enqueue(event)
    }
  })

  child.on('close', (code) => {
    closed = true

    // Flush remaining buffer
    if (buffer.trim()) {
      const event = parseStreamEvent(buffer.trim())
      if (event) {
        if (event.type === 'agent:completed') hasResultEvent = true
        queue.push(event)
      }
    }

    // Ensure a completed event if the stream didn't emit one
    if (!hasResultEvent) {
      queue.push({
        type: 'agent:completed',
        exitCode: code ?? -1,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        timestamp: Date.now(),
      })
    }

    resolve?.()
    resolve = null
  })

  child.on('error', (err: Error) => {
    enqueue({ type: 'agent:error', message: err.message, timestamp: Date.now() })
  })

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!
    } else if (closed) {
      break
    } else {
      await new Promise<void>((r) => { resolve = r })
    }
  }
}

export class CliProvider implements AgentProvider {
  async spawn(opts: AgentSpawnOptions): Promise<AgentHandle> {
    const bin = getAgentBinary()
    const permissionMode = getAgentPermissionMode()
    const id = opts.agentId ?? randomUUID()

    const child = spawn(bin, [
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--input-format', 'stream-json',
      '--model', modelToFlag(opts.model),
      '--permission-mode', permissionMode,
    ], {
      cwd: opts.workingDirectory,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: ELECTRON_PATH },
    })

    // Send initial prompt (prepend template prefix if present)
    const prompt = opts.templatePrefix
      ? `${opts.templatePrefix}\n\n${opts.prompt}`
      : opts.prompt

    child.stdin?.write(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    }) + '\n')

    child.unref()

    return {
      id,
      pid: child.pid,
      events: createEventStream(child),
      steer: async (message: string) => {
        if (!child.stdin || child.stdin.destroyed) {
          throw new Error('Agent stdin is closed')
        }
        child.stdin.write(JSON.stringify({
          type: 'user',
          message: { role: 'user', content: message },
        }) + '\n')
      },
      stop: async () => {
        child.kill('SIGTERM')
      },
    }
  }
}
