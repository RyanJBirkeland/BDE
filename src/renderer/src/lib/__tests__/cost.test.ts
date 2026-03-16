import { describe, it, expect } from 'vitest'
import { calcCost, resolveModel, MODEL_PRICING } from '../cost'

describe('resolveModel', () => {
  it('resolves haiku model string', () => {
    expect(resolveModel('claude-haiku-4-5')).toBe('haiku')
  })

  it('resolves opus model string', () => {
    expect(resolveModel('claude-opus-4-6')).toBe('opus')
  })

  it('resolves sonnet model string', () => {
    expect(resolveModel('claude-sonnet-4-6')).toBe('sonnet')
  })

  it('defaults to sonnet for unknown model', () => {
    expect(resolveModel('gpt-4')).toBe('sonnet')
  })

  it('is case-insensitive', () => {
    expect(resolveModel('Claude-Haiku')).toBe('haiku')
    expect(resolveModel('OPUS')).toBe('opus')
  })
})

describe('calcCost', () => {
  it('calculates correct cost for sonnet', () => {
    const cost = calcCost(1_000_000, 1_000_000, 'sonnet')
    // input: 1M * 3/1M = $3, output: 1M * 15/1M = $15
    expect(cost).toBeCloseTo(18, 5)
  })

  it('calculates correct cost for haiku', () => {
    const cost = calcCost(1_000_000, 1_000_000, 'haiku')
    // input: 1M * 1/1M = $1, output: 1M * 5/1M = $5
    expect(cost).toBeCloseTo(6, 5)
  })

  it('calculates correct cost for opus', () => {
    const cost = calcCost(1_000_000, 1_000_000, 'opus')
    // input: 1M * 15/1M = $15, output: 1M * 75/1M = $75
    expect(cost).toBeCloseTo(90, 5)
  })

  it('returns 0 for 0 tokens', () => {
    expect(calcCost(0, 0, 'sonnet')).toBe(0)
  })

  it('handles small token counts', () => {
    const cost = calcCost(100, 50, 'sonnet')
    const expected = 100 * MODEL_PRICING.sonnet.input + 50 * MODEL_PRICING.sonnet.output
    expect(cost).toBeCloseTo(expected, 10)
  })
})
