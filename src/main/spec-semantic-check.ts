/**
 * Tier 2 semantic spec validation — AI-powered quality check.
 * Extracts the core logic from workbench.ts checkSpec handler
 * so it can be called from sprint-local.ts and queue-api handlers.
 */
import { spawn } from 'child_process'
import { buildAgentEnv } from './env-utils'

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

function runClaudePrint(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'text'], {
      env: buildAgentEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude CLI timed out'))
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`))
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

export async function checkSpecSemantic(input: {
  title: string
  repo: string
  spec: string
}): Promise<SemanticCheckSummary> {
  const prompt = `You are reviewing a coding agent spec for quality. Return ONLY valid JSON (no markdown fencing).

Title: "${input.title}"
Repo: ${input.repo}
Spec:
${input.spec}

Assess the spec on three dimensions. For each, return status ("pass", "warn", or "fail") and a brief message.

1. clarity: Is the spec clear and actionable? Can an AI agent execute it without ambiguity?
2. scope: Is this achievable by one agent in one session? Or too broad?
3. filesExist: Are file paths specific and plausible? (You cannot verify they exist, so check if they look like real paths.)

Return JSON: {"clarity":{"status":"...","message":"..."},"scope":{"status":"...","message":"..."},"filesExist":{"status":"...","message":"..."}}`

  let results: SemanticCheckResult
  try {
    const raw = await runClaudePrint(prompt)
    const parsed = JSON.parse(raw)
    results = {
      clarity: parsed.clarity ?? { status: 'warn', message: 'Unable to assess' },
      scope: parsed.scope ?? { status: 'warn', message: 'Unable to assess' },
      filesExist: parsed.filesExist ?? {
        status: 'warn',
        message: 'Unable to assess',
      },
    }
  } catch {
    // If Claude CLI is unavailable, degrade to pass-through (don't block queuing)
    return {
      passed: true,
      hasFails: false,
      hasWarns: true,
      results: {
        clarity: { status: 'warn', message: 'AI check unavailable — skipped' },
        scope: { status: 'warn', message: 'AI check unavailable — skipped' },
        filesExist: { status: 'warn', message: 'AI check unavailable — skipped' },
      },
      failMessages: [],
      warnMessages: ['Semantic checks skipped — Claude CLI unavailable'],
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
    warnMessages,
  }
}
