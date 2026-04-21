/**
 * Copilot service — AI-assisted spec drafting with read-only code access.
 */
import { buildAgentPrompt } from '../lib/prompt-composer'
import type { SdkStreamingOptions } from '../sdk-streaming'

/**
 * Read-only tools the copilot may use against the target repo.
 * Anything not in this list (Edit, Write, Bash, etc.) is unavailable.
 */
export const COPILOT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'] as const

/**
 * Defense-in-depth: tools the copilot must NEVER run, even if the SDK
 * defaults shift. Pairs with COPILOT_ALLOWED_TOOLS for read-only enforcement.
 * The denylist is intentionally broad — anything that mutates files, executes
 * commands, fetches the network, spawns subagents, or escapes the chat loop
 * must be explicitly listed here, not just absent from the allowlist.
 */
export const COPILOT_DISALLOWED_TOOLS = [
  'Edit',
  'Write',
  'Bash',
  'KillBash',
  'BashOutput',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'ExitPlanMode',
  'TodoWrite',
  'SlashCommand'
] as const

/**
 * Hard ceiling on per-turn copilot spend. With `maxTurns: 8` the copilot can
 * chain Read/Grep many times — without a dollar cap, a prompt-injected loop
 * could rack up real cost. The SDK aborts the query if exceeded.
 */
export const COPILOT_MAX_BUDGET_USD = 0.5

/** Maximum turns for the copilot — enough to chain Grep → Read → answer. */
export const COPILOT_MAX_TURNS = 8

/**
 * Build the chat prompt for copilot sessions with form context.
 */
export function buildChatPrompt(
  messages: Array<{ role: string; content: string }>,
  formContext: { title: string; repo: string; spec: string },
  repoPath?: string
): string {
  return buildAgentPrompt({
    agentType: 'copilot',
    messages,
    formContext,
    repoPath,
    repoName: formContext.repo
  })
}

/**
 * Build the SDK options used for every copilot invocation. Centralized so
 * that all IPC paths (streaming and non-streaming) get the same restricted
 * tool list, dollar ceiling, turn limit, and routed model. NEVER bypass
 * this helper — in particular, never call `runSdkStreaming` for the
 * copilot without a `model` resolved through `resolveAgentRuntime`.
 */
export function getCopilotSdkOptions(
  repoPath: string | undefined,
  model: string,
  extras?: Pick<SdkStreamingOptions, 'onToolUse'>
): SdkStreamingOptions {
  return {
    cwd: repoPath,
    tools: [...COPILOT_ALLOWED_TOOLS],
    disallowedTools: [...COPILOT_DISALLOWED_TOOLS],
    maxTurns: COPILOT_MAX_TURNS,
    maxBudgetUsd: COPILOT_MAX_BUDGET_USD,
    model,
    // Spec-drafting agents skip CLAUDE.md — they receive BDE conventions via
    // their prompt (SPEC_DRAFTING_PREAMBLE) and loading the project settings
    // file costs tokens without adding value.
    settingSources: [],
    ...(extras?.onToolUse ? { onToolUse: extras.onToolUse } : {})
  }
}
