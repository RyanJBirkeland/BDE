import { ipcConventions } from './ipc-conventions'
import { testingPatterns } from './testing-patterns'
import { architectureRules } from './architecture-rules'

/**
 * Consolidate all BDE convention modules into a single markdown string.
 *
 * Memory modules document patterns and conventions that all BDE agents should
 * internalize: IPC handler patterns (safeHandle usage, registration), testing
 * standards (coverage thresholds, test organization), and architecture rules
 * (process boundaries, Zustand patterns, IPC surface minimalism).
 *
 * This function is called by `buildAgentPrompt()` for all BDE agents.
 * The returned text is injected into agent prompts under the "## BDE Conventions" section.
 *
 * @returns Markdown string with all memory modules concatenated (separated by "---")
 */
export function getAllMemory(): string {
  return [ipcConventions, testingPatterns, architectureRules].join('\n\n---\n\n')
}
