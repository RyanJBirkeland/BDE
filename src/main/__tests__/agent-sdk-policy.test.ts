/**
 * Agent SDK-options policy guardrail.
 *
 * Locks down the per-agent-type SDK-options invariants that keep each agent
 * confined to the shape it is supposed to have — read-only, text-only,
 * capped-budget, spec-drafting, etc. Any drift in how an agent's options
 * object is assembled surfaces here as a failing assertion, not a silent
 * regression in production.
 *
 * One file so the whole policy is grep-able in a single place. Each block
 * documents the agent type's purpose and the invariant being asserted —
 * treat this as the executable version of the "agent types" section in
 * `docs/BDE_FEATURES.md`.
 */
import { describe, it, expect, vi } from 'vitest'

import {
  COPILOT_ALLOWED_TOOLS,
  COPILOT_DISALLOWED_TOOLS,
  COPILOT_MAX_BUDGET_USD,
  COPILOT_MAX_TURNS,
  getCopilotSdkOptions
} from '../services/copilot-service'
import { PIPELINE_DISALLOWED_TOOLS } from '../agent-manager/turn-budget'
import { REVIEWER_CHAT_MAX_BUDGET_USD } from '../handlers/review-assistant'
import { DEFAULT_CONFIG } from '../agent-manager/types'

describe('agent SDK options policy', () => {
  describe('pipeline', () => {
    // Pipeline agents are autonomous — they execute a spec without a human in
    // the loop. The SDK settings they run with are the single line of defense
    // between a broken spec and an expensive runaway. Every pattern in the
    // disallow list corresponds to a class of reconnaissance Bash that burns
    // turns for zero value once the spec has already named the files to
    // touch. If a new recon pattern surfaces, add it to
    // `PIPELINE_DISALLOWED_TOOLS` — do NOT scatter if-chains elsewhere.
    it('disallows every git-recon Bash pattern the agent does not need', () => {
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git log:*)')
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git status:*)')
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git ls-remote:*)')
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git diff:*)')
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git reflog:*)')
      expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git log --grep:*)')
    })
  })

  describe('copilot', () => {
    // Copilot is the spec-drafting helper in Task Workbench. It must be
    // read-only against the target repo — editing files, executing shell,
    // fetching URLs, or spawning sub-agents are all out of scope. A prompt
    // injection that asked the copilot to patch the repo would be denied at
    // the SDK boundary because those tools simply are not granted.
    it('only grants read-only repo-exploration tools', () => {
      expect([...COPILOT_ALLOWED_TOOLS]).toEqual(['Read', 'Grep', 'Glob'])
    })

    it('explicitly denies every mutating or escape-path tool', () => {
      expect(COPILOT_DISALLOWED_TOOLS).toContain('Edit')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('Write')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('Bash')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('WebFetch')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('WebSearch')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('Task')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('TodoWrite')
      expect(COPILOT_DISALLOWED_TOOLS).toContain('SlashCommand')
    })

    it('caps turn count and dollar spend for the chat loop', () => {
      // Without caps, an open-ended chat with Read+Grep+Glob could chain
      // indefinitely and rack up real cost if the model gets stuck in a
      // tool-use loop. These are safety ceilings, not targets.
      expect(COPILOT_MAX_TURNS).toBe(8)
      expect(COPILOT_MAX_BUDGET_USD).toBe(0.5)
    })

    it('assembles the SDK options with every invariant applied together', () => {
      // The pure helper is the single entry point for every copilot IPC
      // path. If someone adds a new call site and forgets to use it, the
      // matching unit test for that path should catch it — but exercising
      // the helper here protects against drift in the helper itself.
      const options = getCopilotSdkOptions('/tmp/repo', DEFAULT_CONFIG.defaultModel)
      expect(options.settingSources).toEqual([])
      expect(options.tools).toEqual(['Read', 'Grep', 'Glob'])
      expect(options.disallowedTools).toEqual([...COPILOT_DISALLOWED_TOOLS])
      expect(options.maxTurns).toBe(COPILOT_MAX_TURNS)
      expect(options.maxBudgetUsd).toBe(COPILOT_MAX_BUDGET_USD)
      expect(options.model).toBe(DEFAULT_CONFIG.defaultModel)
      expect(options.cwd).toBe('/tmp/repo')
    })
  })

  describe('reviewer-chat', () => {
    // The reviewer's interactive chat runs on a completed agent's worktree.
    // It must match the pipeline's spend ceiling — the session is
    // user-triggered and open-ended, and nothing else caps its cost.
    it('caps dollar spend at the pipeline default', () => {
      expect(REVIEWER_CHAT_MAX_BUDGET_USD).toBe(2.0)
    })
  })

  describe('synthesizer', () => {
    // Synthesizer generates a full task spec in a single turn from
    // pre-gathered codebase context. It must not load CLAUDE.md — the
    // composed prompt already contains the relevant BDE conventions and
    // loading project settings wastes tokens every call. Asserted here by
    // capturing the exact options object passed to runSdkStreaming.
    it('passes settingSources:[] to every SDK call', async () => {
      const capturedOptions = synthesizerCapturedOptions
      capturedOptions.length = 0

      const { synthesizeSpec, reviseSpec } = await import('../services/spec-synthesizer')

      await synthesizeSpec(
        {
          templateName: 'Feature',
          repo: 'bde',
          repoPath: '/tmp/repo',
          answers: {}
        },
        () => {},
        'synthesize-policy-test'
      )
      await reviseSpec(
        {
          repo: 'bde',
          repoPath: '/tmp/repo',
          currentSpec: 'existing',
          revisionNotes: 'tighten'
        },
        () => {},
        'revise-policy-test'
      )

      expect(capturedOptions.length).toBe(2)
      for (const options of capturedOptions) {
        expect(options.settingSources).toEqual([])
      }
    })
  })
})

// Top-level mocks for the synthesizer block. vitest hoists these — they must
// live outside the `describe` tree to run before any import of the mocked
// modules. `synthesizerCapturedOptions` is declared first so the factory can
// close over it.
const synthesizerCapturedOptions: Array<Record<string, unknown>> = []

vi.mock('../sdk-streaming', () => ({
  runSdkStreaming: async (
    _prompt: string,
    _onChunk: (chunk: string) => void,
    _streams: Map<string, { close: () => void }>,
    _id: string,
    _timeout: number,
    options: Record<string, unknown>
  ) => {
    synthesizerCapturedOptions.push(options)
    return 'synthesized spec'
  },
  runSdkOnce: async () => 'unused'
}))

vi.mock('../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-sonnet-4-5' })
}))
