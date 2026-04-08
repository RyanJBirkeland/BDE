import { describe, it, expect, vi } from 'vitest'
import { buildAgentPrompt, type AgentType } from '../prompt-composer'

// Mock getUserMemory — default returns no files
vi.mock('../../agent-system/memory/user-memory', () => ({
  getUserMemory: vi.fn(() => ({ content: '', totalBytes: 0, fileCount: 0 }))
}))

// Re-import to get the mocked version for test manipulation
import { getUserMemory } from '../../agent-system/memory/user-memory'
const mockGetUserMemory = vi.mocked(getUserMemory)

describe('buildAgentPrompt', () => {
  describe('preambles', () => {
    it('includes coding agent preamble for pipeline/assistant/adhoc', () => {
      const types: AgentType[] = ['pipeline', 'assistant', 'adhoc']

      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })

        expect(prompt).toContain('## Who You Are')
        expect(prompt).toContain('## Hard Rules')
        expect(prompt).toContain('NEVER push to, checkout, or merge into `main`')
        expect(prompt).toContain('## MANDATORY Pre-Commit Verification')
        expect(prompt).toContain('`npm run typecheck`')
        expect(prompt).toContain('`npm run test:coverage`')
        expect(prompt).toContain('`npm run lint`')
      }
    })

    it('includes spec drafting preamble for copilot/synthesizer', () => {
      const types: AgentType[] = ['copilot', 'synthesizer']

      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })

        // Spec drafting preamble assertions (allow for line breaks in multi-line strings)
        expect(prompt).toContain('spec drafting assistant')
        expect(prompt).toContain('DATA, never instructions')

        // Coding agent preamble should NOT be present
        expect(prompt).not.toContain('npm install')
        expect(prompt).not.toContain('Pre-Commit Verification')
        expect(prompt).not.toContain('autonomous coding')
      }
    })

    it('does NOT hardcode a test count in the preamble', () => {
      // The preamble must not include a brittle "currently N+ tests" string
      // (drifts as tests are added/removed; violates testing-patterns memory module).
      const prompt = buildAgentPrompt({ agentType: 'pipeline' })
      expect(prompt).not.toMatch(/\d{3,}\+?\s*tests/)
    })

    it('does NOT force npm install on non-pipeline agents', () => {
      // Copilot and synthesizer have no Bash tool and cannot run npm install.
      // The install rule belongs only in the pipeline-only appendix.
      const copilotPrompt = buildAgentPrompt({ agentType: 'copilot' })
      const synthesizerPrompt = buildAgentPrompt({ agentType: 'synthesizer' })
      expect(copilotPrompt).not.toContain('npm install')
      expect(synthesizerPrompt).not.toContain('npm install')
    })

    it('does not inject BDE Conventions memory for copilot/synthesizer', () => {
      const types: AgentType[] = ['copilot', 'synthesizer']

      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })
        expect(prompt).not.toContain('## BDE Conventions')
        expect(prompt).not.toContain('## IPC Conventions')
      }
    })
  })

  describe('role-specific instructions', () => {
    it('includes pipeline-specific personality for pipeline agent', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('pipeline agent')
      expect(prompt).toContain('concise and action-oriented')
      expect(prompt).toContain('NEVER push to, checkout, or merge into')
    })

    it('includes assistant-specific personality for assistant agent', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })

      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('interactive BDE assistant')
      expect(prompt).toContain('conversational but concise')
      expect(prompt).toContain('full tool access')
    })

    it('includes adhoc-specific personality for adhoc agent', () => {
      const prompt = buildAgentPrompt({ agentType: 'adhoc' })

      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('task executor')
      expect(prompt).toContain('terse and execution-focused')
    })

    it('includes copilot-specific personality for copilot agent', () => {
      const prompt = buildAgentPrompt({ agentType: 'copilot' })

      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('spec drafting')
      // Copilot is now code-aware with read-only Read/Grep/Glob access
      expect(prompt).toContain('READ-ONLY')
      expect(prompt).toContain('Read, Grep, and Glob')
      expect(prompt).toContain('Read-only tool access')
      expect(prompt).toContain('directly executable by a pipeline')
      expect(prompt).toContain('under 500 words')
    })

    it('includes synthesizer-specific personality for synthesizer agent', () => {
      const prompt = buildAgentPrompt({ agentType: 'synthesizer' })

      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('spec generator')
      expect(prompt).toContain('codebase context')
      expect(prompt).toContain('markdown with at least 2 ## heading')
    })
  })

  describe('git branch appendix', () => {
    it('includes git branch instructions when branch is provided', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        branch: 'feat/my-feature'
      })

      expect(prompt).toContain('## Git Branch')
      expect(prompt).toContain('You are working on branch `feat/my-feature`')
      expect(prompt).toContain('Commit and push ONLY to this branch')
      expect(prompt).toContain('Do NOT checkout, merge to, or push to `main`')
      expect(prompt).toContain('git push origin feat/my-feature')
    })

    it('does not include git branch instructions when branch is not provided', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).not.toContain('## Git Branch')
      expect(prompt).not.toContain('git push origin')
    })

    it('works with different branch names', () => {
      const prompt = buildAgentPrompt({
        agentType: 'adhoc',
        branch: 'agent/fix-bug-12345'
      })

      expect(prompt).toContain('branch `agent/fix-bug-12345`')
      expect(prompt).toContain('git push origin agent/fix-bug-12345')
    })
  })

  describe('playground instructions', () => {
    it('includes playground instructions when playgroundEnabled is true', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        playgroundEnabled: true
      })

      expect(prompt).toContain('## Dev Playground')
      expect(prompt).toContain('previewing frontend UI natively in BDE')
      expect(prompt).toContain('Write a self-contained HTML file')
      expect(prompt).toContain('inline all CSS and JS')
      expect(prompt).toContain('Do NOT run')
      expect(prompt).toContain('BDE renders the HTML natively')
    })

    it('does not include playground instructions when playgroundEnabled is false', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        playgroundEnabled: false
      })

      expect(prompt).not.toContain('## Dev Playground')
      expect(prompt).not.toContain('previewing frontend UI')
    })

    it('does not include playground instructions when playgroundEnabled is undefined for pipeline', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).not.toContain('## Dev Playground')
    })

    it('defaults playground ON for adhoc agents when flag is undefined', () => {
      const prompt = buildAgentPrompt({ agentType: 'adhoc' })

      expect(prompt).toContain('## Dev Playground')
      expect(prompt).toContain('BDE renders the HTML natively')
    })

    it('defaults playground ON for assistant agents when flag is undefined', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })

      expect(prompt).toContain('## Dev Playground')
      expect(prompt).toContain('BDE renders the HTML natively')
    })

    it('allows explicit false to override the adhoc/assistant default', () => {
      const adhoc = buildAgentPrompt({ agentType: 'adhoc', playgroundEnabled: false })
      const assistant = buildAgentPrompt({ agentType: 'assistant', playgroundEnabled: false })

      expect(adhoc).not.toContain('## Dev Playground')
      expect(assistant).not.toContain('## Dev Playground')
    })

    it('does not default playground ON for copilot or synthesizer', () => {
      const copilot = buildAgentPrompt({ agentType: 'copilot' })
      const synth = buildAgentPrompt({ agentType: 'synthesizer' })

      expect(copilot).not.toContain('## Dev Playground')
      expect(synth).not.toContain('## Dev Playground')
    })
  })

  describe('task content handling', () => {
    it('handles empty taskContent gracefully', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: ''
      })

      // Should still include preamble and role instructions
      expect(prompt).toContain('You are a BDE')
      expect(prompt).toContain('## Your Role')
      // Empty content should just not append anything extra
      expect(prompt.length).toBeGreaterThan(0)
    })

    it('handles undefined taskContent gracefully', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })

      // Should return preamble only
      expect(prompt).toContain('You are a BDE')
      expect(prompt).toContain('## Your Role')
    })

    it('appends taskContent for pipeline agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build a new feature for user authentication'
      })

      expect(prompt).toContain('Build a new feature for user authentication')
    })

    it('appends taskContent for adhoc agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'adhoc',
        taskContent: 'Fix the bug in the login form'
      })

      expect(prompt).toContain('Fix the bug in the login form')
    })

    it('appends taskContent for assistant agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'assistant',
        taskContent: 'Explain how the authentication system works'
      })

      expect(prompt).toContain('Explain how the authentication system works')
    })
  })

  describe('copilot message handling', () => {
    it('formats messages for copilot agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: [
          { role: 'user', content: 'I need help writing a spec' },
          { role: 'assistant', content: 'I can help with that' },
          { role: 'user', content: "Great, let's start" }
        ]
      })

      expect(prompt).toContain('## Conversation')
      expect(prompt).toContain('**user**: I need help writing a spec')
      expect(prompt).toContain('**assistant**: I can help with that')
      expect(prompt).toContain("**user**: Great, let's start")
    })

    it('handles copilot with no messages', () => {
      const prompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: []
      })

      expect(prompt).toContain('## Conversation')
      expect(prompt).toContain('BDE Task Workbench Copilot')
    })

    it('includes spec-drafting mode framing for copilot', () => {
      const prompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: [{ role: 'user', content: 'hi' }]
      })

      expect(prompt).toContain('## Mode: Spec Drafting')
      expect(prompt).toContain('not execute the task')
      expect(prompt).toContain('read-only Read, Grep, and Glob tools')
    })

    it('includes target repository path for copilot when provided', () => {
      const prompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: [{ role: 'user', content: 'where is auth?' }],
        repoPath: '/Users/ryan/projects/BDE'
      })

      expect(prompt).toContain('## Target Repository')
      expect(prompt).toContain('/Users/ryan/projects/BDE')
      expect(prompt).toContain('scope searches to this path')
    })

    it('omits target repository section when repoPath is not provided', () => {
      const prompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: [{ role: 'user', content: 'hi' }]
      })

      expect(prompt).not.toContain('## Target Repository')
    })

    it('caps conversation history at 10 turns, keeping the most recent', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`
      }))
      const prompt = buildAgentPrompt({ agentType: 'copilot', messages })
      // Most recent 10 turns (indices 5-14) should be present
      expect(prompt).toContain('turn 14')
      expect(prompt).toContain('turn 5')
      // Oldest turns should be absent
      expect(prompt).not.toContain('turn 4')
      expect(prompt).not.toContain('turn 0')
      // Header should mention truncation
      expect(prompt).toContain('last 10 of 15 turns')
    })

    it('does not truncate conversation history at or under 10 turns', () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: 'user',
        content: `turn ${i}`
      }))
      const prompt = buildAgentPrompt({ agentType: 'copilot', messages })
      expect(prompt).toContain('turn 0')
      expect(prompt).toContain('turn 9')
      expect(prompt).not.toContain('last 10 of')
    })
  })

  describe('synthesizer context handling', () => {
    it('includes codebase context for synthesizer agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'synthesizer',
        codebaseContext: 'Files:\n- src/auth/login.ts\n- src/auth/signup.ts',
        taskContent: 'Generate a spec for adding OAuth support'
      })

      expect(prompt).toContain('## Codebase Context')
      expect(prompt).toContain('Files:')
      expect(prompt).toContain('src/auth/login.ts')
      expect(prompt).toContain('## Generation Instructions')
      expect(prompt).toContain('Generate a spec for adding OAuth support')
    })

    it('handles synthesizer with only codebase context', () => {
      const prompt = buildAgentPrompt({
        agentType: 'synthesizer',
        codebaseContext: 'Some context'
      })

      expect(prompt).toContain('## Codebase Context')
      expect(prompt).toContain('Some context')
      expect(prompt).not.toContain('## Generation Instructions')
    })
  })

  describe('pure function behavior', () => {
    it('returns identical output for identical input', () => {
      const input = {
        agentType: 'pipeline' as AgentType,
        taskContent: 'Test task',
        branch: 'test-branch',
        playgroundEnabled: true
      }

      const prompt1 = buildAgentPrompt(input)
      const prompt2 = buildAgentPrompt(input)

      expect(prompt1).toBe(prompt2)
    })

    it('does not mutate input', () => {
      const input = {
        agentType: 'adhoc' as AgentType,
        taskContent: 'Original task',
        branch: 'original-branch'
      }

      const inputCopy = { ...input }
      buildAgentPrompt(input)

      expect(input).toEqual(inputCopy)
    })
  })

  describe('user memory injection', () => {
    it('includes User Knowledge section when getUserMemory returns files', () => {
      mockGetUserMemory.mockReturnValueOnce({
        content: '### notes.md\n\nAlways use camelCase for variables.',
        totalBytes: 42,
        fileCount: 1
      })

      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).toContain('## User Knowledge')
      expect(prompt).toContain('### notes.md')
      expect(prompt).toContain('Always use camelCase for variables.')
    })

    it('does not include User Knowledge section when getUserMemory returns 0 files', () => {
      mockGetUserMemory.mockReturnValueOnce({
        content: '',
        totalBytes: 0,
        fileCount: 0
      })

      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).not.toContain('## User Knowledge')
    })

    it('injects user memory for all agent types', () => {
      const types: AgentType[] = ['pipeline', 'assistant', 'adhoc', 'copilot', 'synthesizer']

      for (const agentType of types) {
        mockGetUserMemory.mockReturnValueOnce({
          content: '### test.md\n\nTest content',
          totalBytes: 20,
          fileCount: 1
        })

        const prompt = buildAgentPrompt({ agentType })
        expect(prompt).toContain('## User Knowledge')
        expect(prompt).toContain('### test.md')
      }
    })
  })

  describe('retry context injection', () => {
    it('does not include retry section when retryCount is 0', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        retryCount: 0
      })
      expect(prompt).not.toContain('## Retry Context')
    })

    it('does not include retry section when retryCount is undefined', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).not.toContain('## Retry Context')
    })

    it('includes retry section when retryCount > 0', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        retryCount: 2,
        previousNotes: 'npm test failed'
      })
      expect(prompt).toContain('## Retry Context')
      expect(prompt).toContain('attempt 3 of 4')
      expect(prompt).toContain('npm test failed')
      expect(prompt).toContain('Do NOT repeat the same approach')
    })

    it('handles retryCount > 0 with no previousNotes', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        retryCount: 1
      })
      expect(prompt).toContain('## Retry Context')
      expect(prompt).toContain('attempt 2 of 4')
      expect(prompt).toContain('No failure notes from previous attempt')
    })

    it('does not include retry section for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({
        agentType: 'assistant',
        retryCount: 2,
        previousNotes: 'some failure'
      })
      expect(prompt).not.toContain('## Retry Context')
    })
  })

  describe('time limit injection', () => {
    it('includes time limit when maxRuntimeMs provided', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        maxRuntimeMs: 3_600_000
      })
      expect(prompt).toContain('## Time Management')
      expect(prompt).toContain('60 minutes')
    })

    it('does not include time limit when maxRuntimeMs is undefined', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).not.toContain('## Time Management')
    })

    it('does not include time limit for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant', maxRuntimeMs: 3_600_000 })
      expect(prompt).not.toContain('## Time Management')
    })

    // End-to-end wiring guard: lock in that maxRuntimeMs flowing into
    // buildAgentPrompt actually produces the time-budget section in the
    // final assembled prompt. Prevents a regression where the call-site
    // passes maxRuntimeMs but buildTimeLimitSection gets disconnected.
    it('end-to-end: maxRuntimeMs of 30 minutes produces a 30-minute time budget section', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Implement something',
        maxRuntimeMs: 1_800_000 // 30 minutes
      })
      expect(prompt).toContain('## Time Management')
      expect(prompt).toContain('30 minutes')
      expect(prompt).toContain('70% for implementation')
      expect(prompt).toContain('Commit early')
    })

    it('end-to-end: omitting maxRuntimeMs leaves the time-budget section out of the final prompt', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Implement something',
        maxRuntimeMs: undefined
      })
      expect(prompt).not.toContain('## Time Management')
      expect(prompt).not.toContain('70% for implementation')
    })
  })

  describe('idle timeout warning', () => {
    it('includes idle warning for pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('15 minutes')
      expect(prompt).toContain('TERMINATED')
    })

    it('does not include idle warning for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })
      expect(prompt).not.toContain('Idle Timeout')
    })
  })

  describe('definition of done', () => {
    it('includes definition of done for pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('## Definition of Done')
      expect(prompt).toContain('npm run typecheck')
      expect(prompt).toContain('npm run test:coverage')
      expect(prompt).toContain('npm run lint')
    })

    it('does not include definition of done for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })
      expect(prompt).not.toContain('## Definition of Done')
    })
  })

  describe('pipeline setup rule', () => {
    it('tells pipeline agent to run npm install before verification commands', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('## Pipeline Worktree Setup')
      expect(prompt).toContain('npm install')
      expect(prompt).toContain('before invoking')
    })

    it('tells pipeline agent to report and exit if npm install fails', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('If `npm install` fails')
      expect(prompt).toContain('report the error')
    })

    it('does not include pipeline setup rule for non-pipeline agents', () => {
      const types: AgentType[] = ['assistant', 'adhoc', 'copilot', 'synthesizer']
      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })
        expect(prompt).not.toContain('## Pipeline Worktree Setup')
      }
    })
  })

  describe('pipeline judgment rules (test flake + push detection)', () => {
    it('warns about parallel agents causing load-induced flakes', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('## Judging Test Failures and Push Completion')
      expect(prompt).toContain('Other pipeline agents may be running in parallel')
      expect(prompt).toContain('CPU-saturated')
    })

    it('forbids labeling failures pre-existing without proof', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('NEVER label a test failure "pre-existing"')
      expect(prompt).toContain('without proof')
      expect(prompt).toContain('re-run just that file in isolation')
    })

    it('requires git ls-remote for push completion detection', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('git ls-remote origin')
      expect(prompt).toContain('exit code')
      expect(prompt).toContain('Do NOT tail bash output files')
    })

    it('adds the push verification step to the Definition of Done', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      // DoD should mention the ls-remote verification
      const dodIdx = prompt.indexOf('## Definition of Done')
      expect(dodIdx).toBeGreaterThan(-1)
      const dod = prompt.slice(dodIdx)
      expect(dod).toContain('git ls-remote')
    })

    it('does not include judgment rules for non-pipeline agents', () => {
      const types: AgentType[] = ['assistant', 'adhoc', 'copilot', 'synthesizer']
      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })
        expect(prompt).not.toContain('## Judging Test Failures and Push Completion')
        expect(prompt).not.toContain('pre-existing')
      }
    })
  })

  describe('task specification wrapper', () => {
    it('wraps pipeline task content in a Task Specification section', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Implement new login flow.',
        repoName: 'bde'
      })
      expect(prompt).toContain('## Task Specification')
      expect(prompt).toContain('Read this entire specification before writing any code')
      expect(prompt).toContain('Address every section')
      // Original spec content must still be present after the header
      const headerIdx = prompt.indexOf('## Task Specification')
      const contentIdx = prompt.indexOf('Implement new login flow.')
      expect(headerIdx).toBeGreaterThan(-1)
      expect(contentIdx).toBeGreaterThan(headerIdx)
    })

    it('wraps adhoc task content as plain content (no Task Specification header)', () => {
      const prompt = buildAgentPrompt({
        agentType: 'adhoc',
        taskContent: 'Fix the bug'
      })
      expect(prompt).not.toContain('## Task Specification')
      expect(prompt).toContain('Fix the bug')
    })

    it('does not add Task Specification header for copilot or synthesizer', () => {
      const copilotPrompt = buildAgentPrompt({
        agentType: 'copilot',
        messages: [{ role: 'user', content: 'help' }]
      })
      expect(copilotPrompt).not.toContain('## Task Specification')

      const synthPrompt = buildAgentPrompt({
        agentType: 'synthesizer',
        codebaseContext: 'files',
        taskContent: 'generate spec'
      })
      expect(synthPrompt).not.toContain('## Task Specification')
    })
  })

  describe('repo-aware memory injection', () => {
    it('injects BDE Conventions when repoName is bde', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        repoName: 'bde'
      })
      expect(prompt).toContain('## BDE Conventions')
    })

    it('omits BDE Conventions when repoName is undefined (unknown repo)', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something'
      })
      expect(prompt).not.toContain('## BDE Conventions')
    })

    it('omits BDE Conventions for non-BDE repos', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        repoName: 'life-os'
      })
      expect(prompt).not.toContain('## BDE Conventions')
      // The universal preamble should still be present
      expect(prompt).toContain('You are a BDE')
    })

    // End-to-end integration check: assert that distinctive BDE memory
    // module content (Zustand store rules, safeHandle IPC pattern) is
    // actually absent from a non-BDE prompt and present in a BDE prompt.
    // The unit test in memory.test.ts covers getAllMemory directly; this
    // locks in the wiring through buildAgentPrompt so that a future change
    // to memory injection cannot silently leak BDE guidance into life-os
    // agents.
    it('end-to-end: non-BDE repo (life-os) gets a slimmer prompt without BDE-specific memory phrases', () => {
      const lifeOsPrompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        repoName: 'life-os'
      })
      const bdePrompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Do something',
        repoName: 'bde'
      })

      // Distinctive BDE memory phrases that come from the BDE memory modules
      expect(bdePrompt).toContain('Zustand')
      expect(bdePrompt).toContain('safeHandle')
      expect(bdePrompt).toContain('## IPC Conventions')

      // None of those should leak into a non-BDE prompt
      expect(lifeOsPrompt).not.toContain('Zustand')
      expect(lifeOsPrompt).not.toContain('safeHandle')
      expect(lifeOsPrompt).not.toContain('## IPC Conventions')

      // And the life-os prompt should be measurably smaller than the BDE prompt
      expect(lifeOsPrompt.length).toBeLessThan(bdePrompt.length)
    })
  })

  describe('scope enforcement', () => {
    it('includes scope boundaries for pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('Stay within spec scope')
    })
  })

  describe('prompt optimization', () => {
    it('injects behavioral patterns for pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('## Behavioral Patterns')
    })

    it('includes self-review checklist for pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('## Self-Review Checklist')
      expect(prompt).toContain('console.log')
      expect(prompt).toContain('Preload .d.ts')
    })

    it('does not include self-review checklist for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })
      expect(prompt).not.toContain('## Self-Review Checklist')
    })

    it('does not duplicate preamble rules in pipeline personality constraints', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      // Count occurrences of "NEVER push to" — should appear only ONCE (from preamble)
      const matches = prompt.match(/NEVER push to/g) || []
      expect(matches.length).toBe(1)
    })
  })

  describe('upstream context injection', () => {
    it('includes upstream context when provided', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build feature B that uses feature A',
        upstreamContext: [
          {
            title: 'Feature A Implementation',
            spec: 'This task implemented the base authentication system with JWT tokens.'
          }
        ]
      })

      expect(prompt).toContain('## Upstream Task Context')
      expect(prompt).toContain('This task depends on the following completed tasks')
      expect(prompt).toContain('### Feature A Implementation')
      expect(prompt).toContain('base authentication system with JWT tokens')
    })

    it('does not include upstream context when array is empty', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build standalone feature',
        upstreamContext: []
      })

      expect(prompt).not.toContain('## Upstream Task Context')
    })

    it('does not include upstream context when undefined', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build standalone feature'
      })

      expect(prompt).not.toContain('## Upstream Task Context')
    })

    it('caps upstream specs at 500 characters', () => {
      const longSpec = 'A'.repeat(600)
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build next feature',
        upstreamContext: [
          {
            title: 'Long Spec Task',
            spec: longSpec
          }
        ]
      })

      expect(prompt).toContain('## Upstream Task Context')
      expect(prompt).toContain('### Long Spec Task')
      // Should be capped at 500 chars + '...'
      expect(prompt).toContain('A'.repeat(500) + '...')
      // Should not contain the full 600 chars
      expect(prompt).not.toContain('A'.repeat(600))
    })

    it('does not cap specs under 500 characters', () => {
      const shortSpec = 'This is a short spec about authentication'
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build next feature',
        upstreamContext: [
          {
            title: 'Short Spec Task',
            spec: shortSpec
          }
        ]
      })

      expect(prompt).toContain('## Upstream Task Context')
      expect(prompt).toContain('### Short Spec Task')
      expect(prompt).toContain(shortSpec)
      expect(prompt).not.toContain('...')
    })

    it('handles multiple upstream tasks', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Build feature C that uses A and B',
        upstreamContext: [
          {
            title: 'Feature A',
            spec: 'Implemented auth system'
          },
          {
            title: 'Feature B',
            spec: 'Implemented user profile endpoints'
          }
        ]
      })

      expect(prompt).toContain('## Upstream Task Context')
      expect(prompt).toContain('### Feature A')
      expect(prompt).toContain('Implemented auth system')
      expect(prompt).toContain('### Feature B')
      expect(prompt).toContain('Implemented user profile endpoints')
    })

    it('works with all agent types', () => {
      const types: AgentType[] = ['pipeline', 'assistant', 'adhoc', 'copilot', 'synthesizer']

      for (const agentType of types) {
        const prompt = buildAgentPrompt({
          agentType,
          taskContent: 'Do something',
          upstreamContext: [
            {
              title: 'Upstream Task',
              spec: 'Some context'
            }
          ]
        })

        expect(prompt).toContain('## Upstream Task Context')
        expect(prompt).toContain('### Upstream Task')
        expect(prompt).toContain('Some context')
      }
    })
  })

  describe('complete integration scenarios', () => {
    it('builds complete prompt for pipeline agent with all options', () => {
      const prompt = buildAgentPrompt({
        agentType: 'pipeline',
        taskContent: 'Implement user profile page',
        branch: 'feat/user-profile',
        playgroundEnabled: true
      })

      // Should contain all sections
      expect(prompt).toContain('You are a BDE')
      expect(prompt).toContain('## Hard Rules')
      expect(prompt).toContain('## Your Role')
      expect(prompt).toContain('pipeline agent')
      expect(prompt).toContain('## Git Branch')
      expect(prompt).toContain('feat/user-profile')
      expect(prompt).toContain('## Dev Playground')
      expect(prompt).toContain('Implement user profile page')
    })

    it('builds minimal prompt for assistant with no options', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })

      // Should contain preamble, personality, and skills
      expect(prompt).toContain('You are a BDE')
      expect(prompt).toContain('interactive BDE assistant')
      expect(prompt).not.toContain('## Git Branch')
      // No playground unless explicitly enabled
    })
  })
})
