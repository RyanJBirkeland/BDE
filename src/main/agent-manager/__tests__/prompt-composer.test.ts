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
  describe('universal preamble', () => {
    it('includes universal preamble for all agent types', () => {
      const types: AgentType[] = ['pipeline', 'assistant', 'adhoc', 'copilot', 'synthesizer']

      for (const agentType of types) {
        const prompt = buildAgentPrompt({ agentType })

        expect(prompt).toContain('You are a BDE (Birkeland Development Environment) agent')
        expect(prompt).toContain('## Who You Are')
        expect(prompt).toContain('## Hard Rules')
        expect(prompt).toContain('NEVER push to, checkout, or merge into `main`')
        expect(prompt).toContain('npm install')
        expect(prompt).toContain('## MANDATORY Pre-Commit Verification')
        expect(prompt).toContain('`npm run typecheck`')
        expect(prompt).toContain('`npm test`')
        expect(prompt).toContain('`npm run lint`')
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
      expect(prompt).toContain('Full tool access')
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
      expect(prompt).toContain('No tool access')
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

    it('does not include playground instructions when playgroundEnabled is undefined', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline' })

      expect(prompt).not.toContain('## Dev Playground')
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
      expect(prompt).toContain('You are a BDE')
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
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something', maxRuntimeMs: 3_600_000 })
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
      expect(prompt).toContain('npm test')
      expect(prompt).toContain('npm run lint')
    })

    it('does not include definition of done for non-pipeline agents', () => {
      const prompt = buildAgentPrompt({ agentType: 'assistant' })
      expect(prompt).not.toContain('## Definition of Done')
    })
  })

  describe('npm install preamble', () => {
    it('tells agent npm install is mandatory first action', () => {
      const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: 'Do something' })
      expect(prompt).toContain('FIRST action')
      expect(prompt).toContain('npm install')
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
