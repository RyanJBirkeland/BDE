/**
 * Tier 2 semantic spec validation — AI-powered quality check.
 * Uses the Agent SDK for reliable Claude API access.
 */
import { buildAgentEnv } from './env-utils'
import { getValidationProfile, type SpecType } from '../shared/spec-validation'

export interface SemanticCheckResult {
  clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
  scope: { status: 'pass' | 'warn' | 'fail'; message: string }
  filesExist: { status: 'pass' | 'warn' | 'fail'; message: string }
}

export interface SemanticCheckSummary {
  passed: boolean
  hasFails: boolean
  hasWarns: boolean
  results: SemanticCheckResult
  failMessages: string[]
  warnMessages: string[]
}

async function runSdkQuery(prompt: string): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnv()

  const queryHandle = sdk.query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 1,
      env: env as Record<string, string>,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true
    }
  })

  let fullText = ''
  try {
    for await (const msg of queryHandle) {
      if (typeof msg !== 'object' || msg === null) continue
      const m = msg as Record<string, unknown>
      if (m.type === 'assistant') {
        const message = m.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              fullText += b.text
            }
          }
        }
      }
    }
  } finally {
    queryHandle.return()
  }

  return fullText.trim()
}

export async function checkSpecSemantic(input: {
  title: string
  repo: string
  spec: string
  specType?: SpecType | null
}): Promise<SemanticCheckSummary> {
  const profile = getValidationProfile(input.specType ?? null)
  const runClarity = profile.clarity.behavior !== 'skip'
  const runScope = profile.scope.behavior !== 'skip'
  const runFiles = profile.filesExist.behavior !== 'skip'

  const typeContext = input.specType
    ? `\nTask type: ${input.specType}. Adjust expectations accordingly — ${input.specType} tasks may have different structure/scope requirements than feature tasks.`
    : ''

  const prompt = `You are reviewing a coding agent spec for quality. Return ONLY valid JSON (no markdown fencing).

Title: "${input.title}"
Repo: ${input.repo}
Spec:
${input.spec}${typeContext}

Assess the spec on three dimensions. For each, return status ("pass", "warn", or "fail") and a brief message.

1. clarity: Is the spec clear and actionable? Can an AI agent execute it without ambiguity?
2. scope: Is this achievable by one agent in one session? Or too broad?
3. filesExist: Are file paths specific and plausible? (You cannot verify they exist, so check if they look like real paths.)

Return JSON: {"clarity":{"status":"...","message":"..."},"scope":{"status":"...","message":"..."},"filesExist":{"status":"...","message":"..."}}`

  let results: SemanticCheckResult
  try {
    const raw = await runSdkQuery(prompt)
    const parsed = JSON.parse(raw)
    results = {
      clarity: parsed.clarity ?? { status: 'warn', message: 'Unable to assess' },
      scope: parsed.scope ?? { status: 'warn', message: 'Unable to assess' },
      filesExist: parsed.filesExist ?? {
        status: 'warn',
        message: 'Unable to assess'
      }
    }
    if (!runClarity) {
      results.clarity = { status: 'pass', message: 'Skipped (not required for this task type)' }
    }
    if (!runScope) {
      results.scope = { status: 'pass', message: 'Skipped (not required for this task type)' }
    }
    if (!runFiles) {
      results.filesExist = { status: 'pass', message: 'Skipped (not required for this task type)' }
    }
  } catch {
    // If SDK is unavailable, degrade to pass-through (don't block queuing)
    return {
      passed: true,
      hasFails: false,
      hasWarns: true,
      results: {
        clarity: { status: 'warn', message: 'AI check unavailable — skipped' },
        scope: { status: 'warn', message: 'AI check unavailable — skipped' },
        filesExist: { status: 'warn', message: 'AI check unavailable — skipped' }
      },
      failMessages: [],
      warnMessages: ['Semantic checks skipped — Claude SDK unavailable']
    }
  }

  const failMessages: string[] = []
  const warnMessages: string[] = []
  for (const [key, check] of Object.entries(results)) {
    if (check.status === 'fail') failMessages.push(`${key}: ${check.message}`)
    if (check.status === 'warn') warnMessages.push(`${key}: ${check.message}`)
  }

  return {
    passed: failMessages.length === 0,
    hasFails: failMessages.length > 0,
    hasWarns: warnMessages.length > 0,
    results,
    failMessages,
    warnMessages
  }
}
