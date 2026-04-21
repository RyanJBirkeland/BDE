import { buildAgentEnv, getClaudeCliPath } from '../../../env-utils'
import type { IAsyncSpecValidator } from '../../../../shared/spec-quality/interfaces'
import type { ParsedSpec, SpecIssue } from '../../../../shared/spec-quality/types'

const PROMPT_TEMPLATE = `You are reviewing implementation steps for a coding task. Your job is to determine if any step requires the agent to make a design decision, choose between multiple approaches, or reason about architecture — rather than execute a concrete, specific instruction.

Steps to review:
<steps>
{stepsContent}
</steps>

Respond with JSON only. Format:
{"requiresDesignDecision": boolean, "reason": "one sentence explanation if true, empty string if false"}

A step REQUIRES design decision if it says things like "choose the best approach", "decide how to", "consider whether", "figure out", "investigate", "research", "evaluate options".
A step does NOT require design decision if it says "add function X to file Y", "update the import in Z.ts", "run npm test".`

interface AiResponse {
  requiresDesignDecision: boolean
  reason: string
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
      pathToClaudeCodeExecutable: getClaudeCliPath(),
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      // Validation check only — implementation context from CLAUDE.md is irrelevant.
      settingSources: []
    }
  })

  let fullText = ''
  try {
    for await (const msg of queryHandle) {
      if (typeof msg !== 'object' || msg === null) continue
      const message = msg as Record<string, unknown>
      if (message.type === 'assistant') {
        const assistantMessage = message.message as Record<string, unknown> | undefined
        const content = assistantMessage?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const contentBlock = block as Record<string, unknown>
            if (contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
              fullText += contentBlock.text
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

export class PrescriptivenessValidator implements IAsyncSpecValidator {
  async validate(spec: ParsedSpec): Promise<SpecIssue[]> {
    const section = spec.sections.find(
      (s) => s.heading.replace(/^#{2,3}\s+/, '').toLowerCase() === 'implementation steps'
    )

    // If no Implementation Steps section, skip — RequiredSectionsValidator handles this
    if (section === undefined || section.content.trim() === '') {
      return []
    }

    try {
      const prompt = PROMPT_TEMPLATE.replace('{stepsContent}', section.content)
      const raw = await runSdkQuery(prompt)

      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const response = JSON.parse(cleaned) as AiResponse

      if (response.requiresDesignDecision) {
        return [
          {
            code: 'STEP_REQUIRES_DESIGN_DECISION',
            severity: 'error',
            message: `Spec requires design decisions that will cause agent thrash: ${response.reason}. Rewrite Implementation Steps as concrete directives, not open-ended investigations.`
          }
        ]
      }
      return []
    } catch (err) {
      console.warn('[PrescriptivenessValidator] AI check failed:', err)
      // Conservative fallback: surface a warning so the user knows the check didn't run,
      // rather than silently passing a spec that may contain exploration language.
      return [
        {
          code: 'PRESCRIPTIVENESS_CHECK_FAILED',
          severity: 'warning',
          message: 'Could not validate implementation step clarity — review manually before queuing'
        }
      ]
    }
  }
}
