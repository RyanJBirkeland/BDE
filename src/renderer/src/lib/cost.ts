export type ModelKey = 'haiku' | 'sonnet' | 'opus'

/**
 * Anthropic per-token pricing (USD).
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 * PRICING_VERSION: 2025-06-20
 */
export const PRICING_VERSION = '2025-06-20'

export const MODEL_PRICING: Record<
  ModelKey,
  { input: number; output: number; cacheRead?: number; cacheWrite?: number }
> = {
  haiku: {
    input: 0.8 / 1_000_000,
    output: 4.0 / 1_000_000,
    cacheRead: 0.08 / 1_000_000,
    cacheWrite: 1.0 / 1_000_000
  },
  sonnet: {
    input: 3.0 / 1_000_000,
    output: 15.0 / 1_000_000,
    cacheRead: 0.3 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000
  },
  opus: {
    input: 15.0 / 1_000_000,
    output: 75.0 / 1_000_000,
    cacheRead: 1.5 / 1_000_000,
    cacheWrite: 18.75 / 1_000_000
  }
}

export function resolveModel(model: string): ModelKey {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('opus')) return 'opus'
  return 'sonnet'
}

export function calcCost(
  input: number,
  output: number,
  modelKey: ModelKey,
  cacheRead = 0,
  cacheCreate = 0
): number {
  const p = MODEL_PRICING[modelKey]
  return (
    input * p.input +
    output * p.output +
    cacheRead * (p.cacheRead ?? p.input) +
    cacheCreate * (p.cacheWrite ?? p.input)
  )
}
