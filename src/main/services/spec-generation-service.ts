/**
 * Spec generation service — AI-powered task spec creation.
 */
import { runSdkStreaming, type SdkStreamingOptions } from '../sdk-streaming'
import { resolveAgentRuntime } from '../agent-manager/backend-selector'
import { buildQuickSpecPrompt, getTemplateScaffold } from './spec-template-service'

/** Active streaming handles, keyed by streamId. */
const activeStreams = new Map<string, { close: () => void }>()

/**
 * Run a single-turn SDK query (non-streaming). Returns the text response.
 */
async function runSdkPrint(
  prompt: string,
  timeoutMs: number,
  options: SdkStreamingOptions
): Promise<string> {
  return runSdkStreaming(prompt, () => {}, activeStreams, `print-${Date.now()}`, timeoutMs, options)
}

/**
 * Build the prompt for spec generation from title, repo, and template hint.
 */
export function buildSpecGenerationPrompt(input: {
  title: string
  repo: string
  templateHint: string
}): string {
  const scaffold = getTemplateScaffold(input.templateHint)
  return buildQuickSpecPrompt(input.title, input.repo, input.templateHint, scaffold)
}

/**
 * Generate a task spec using AI. Returns the generated markdown spec.
 */
export async function generateSpec(input: {
  title: string
  repo: string
  templateHint: string
}): Promise<string> {
  const prompt = buildSpecGenerationPrompt(input)
  const { model } = resolveAgentRuntime('synthesizer')
  try {
    const result = await runSdkPrint(prompt, 120_000, { model })
    return result || `# ${input.title}\n\n(No spec generated)`
  } catch (err) {
    return `# ${input.title}\n\nError generating spec: ${(err as Error).message}`
  }
}
