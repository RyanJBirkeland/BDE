export const CLAUDE_MODELS = [
  { id: 'haiku', label: 'Haiku', modelId: 'claude-haiku-4-5-20251001' },
  { id: 'sonnet', label: 'Sonnet', modelId: 'claude-sonnet-4-6' },
  { id: 'opus', label: 'Opus', modelId: 'claude-opus-4-6' }
] as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']
export const DEFAULT_MODEL = CLAUDE_MODELS[1] // Sonnet
