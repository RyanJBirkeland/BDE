export type ModelKey = 'haiku' | 'sonnet' | 'opus'

export const MODEL_PRICING: Record<ModelKey, { input: number; output: number }> = {
  haiku: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  sonnet: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  opus: { input: 15 / 1_000_000, output: 75 / 1_000_000 },
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
  cacheReadTokens = 0,
  cacheCreateTokens = 0
): number {
  const p = MODEL_PRICING[modelKey]
  const inputRate = p.input
  const outputRate = p.output
  const cacheReadRate = inputRate * 0.1
  const cacheCreateRate = inputRate * 1.25
  return (
    input * inputRate +
    output * outputRate +
    cacheReadTokens * cacheReadRate +
    cacheCreateTokens * cacheCreateRate
  )
}
