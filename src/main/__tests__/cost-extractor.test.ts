import { describe, it, expect, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { extractAgentCost } from '../cost-extractor'

const TEST_DIR = join(tmpdir(), `bde-cost-extractor-test-${process.pid}`)

const RESULT_EVENT = {
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0.247836,
  duration_ms: 94521,
  num_turns: 12,
  usage: {
    input_tokens: 48230,
    output_tokens: 6541,
    cache_read_input_tokens: 22100,
    cache_creation_input_tokens: 3800
  },
  result: 'Done — created the component and tests.',
  session_id: 'abc-123'
}

function writeLog(name: string, lines: string[]): string {
  const filePath = join(TEST_DIR, name)
  writeFileSync(filePath, lines.join('\n'), 'utf-8')
  return filePath
}

describe('extractAgentCost', () => {
  mkdirSync(TEST_DIR, { recursive: true })

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('extracts cost from a log with a result event at the end', () => {
    const logPath = writeLog('success.jsonl', [
      JSON.stringify({ type: 'system', content: 'init' }),
      JSON.stringify({ type: 'assistant', content: 'working...' }),
      JSON.stringify(RESULT_EVENT)
    ])

    const cost = extractAgentCost(logPath)

    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBe(0.247836)
    expect(cost!.tokensIn).toBe(48230)
    expect(cost!.tokensOut).toBe(6541)
    expect(cost!.cacheRead).toBe(22100)
    expect(cost!.cacheCreate).toBe(3800)
    expect(cost!.durationMs).toBe(94521)
    expect(cost!.numTurns).toBe(12)
  })

  it('returns null when no result event exists (agent crashed)', () => {
    const logPath = writeLog('crashed.jsonl', [
      JSON.stringify({ type: 'system', content: 'init' }),
      JSON.stringify({ type: 'assistant', content: 'working...' })
    ])

    expect(extractAgentCost(logPath)).toBeNull()
  })

  it('finds the last result event when multiple exist', () => {
    const earlier = { ...RESULT_EVENT, total_cost_usd: 0.1, num_turns: 5 }
    const logPath = writeLog('multi-result.jsonl', [
      JSON.stringify(earlier),
      JSON.stringify({ type: 'assistant', content: 'more work' }),
      JSON.stringify(RESULT_EVENT)
    ])

    const cost = extractAgentCost(logPath)
    expect(cost!.costUsd).toBe(0.247836)
    expect(cost!.numTurns).toBe(12)
  })

  it('skips non-JSON lines gracefully', () => {
    const logPath = writeLog('mixed.jsonl', [
      'this is not json',
      '--- some separator ---',
      JSON.stringify(RESULT_EVENT)
    ])

    const cost = extractAgentCost(logPath)
    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBe(0.247836)
  })

  it('handles trailing empty lines', () => {
    const logPath = writeLog('trailing.jsonl', [
      JSON.stringify(RESULT_EVENT),
      '',
      '',
      ''
    ])

    const cost = extractAgentCost(logPath)
    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBe(0.247836)
  })
})
