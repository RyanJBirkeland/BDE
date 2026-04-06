import { describe, it, expect } from 'vitest'
import { buildChatPrompt } from '../../handlers/workbench'

describe('workbench handlers', () => {
  describe('buildChatPrompt', () => {
    it('includes constraint instructions in system prompt', () => {
      const prompt = buildChatPrompt([{ role: 'user', content: 'Hello' }], {
        title: 'Test',
        repo: 'BDE',
        spec: ''
      })
      // Copilot is now code-aware (Phase 2): read-only Read/Grep/Glob access
      expect(prompt).toContain('code-aware spec drafting assistant')
      expect(prompt).toContain('Read-only tool access')
      expect(prompt).toContain('NEVER use Edit, Write, Bash')
      // Positive guidance constraint preserved from Phase 1
      expect(prompt).toContain('directly executable by a pipeline')
    })

    it('includes spec-drafting mode framing and target repo when provided', () => {
      const prompt = buildChatPrompt(
        [{ role: 'user', content: 'Hello' }],
        { title: 'Test', repo: 'BDE', spec: '' },
        '/Users/test/projects/BDE'
      )
      expect(prompt).toContain('## Mode: Spec Drafting')
      expect(prompt).toContain('## Target Repository')
      expect(prompt).toContain('/Users/test/projects/BDE')
    })

    it('includes conversation history', () => {
      const prompt = buildChatPrompt(
        [
          { role: 'user', content: 'What files?' },
          { role: 'assistant', content: 'Found 3 files' },
          { role: 'user', content: 'Show me' }
        ],
        { title: 'Test', repo: 'BDE', spec: 'Do stuff' }
      )
      expect(prompt).toContain('What files?')
      expect(prompt).toContain('Found 3 files')
      expect(prompt).toContain('Show me')
      expect(prompt).toContain('Do stuff')
    })

    it('handles empty spec gracefully', () => {
      const prompt = buildChatPrompt([{ role: 'user', content: 'Hi' }], {
        title: 'Test',
        repo: 'BDE',
        spec: ''
      })
      expect(prompt).toContain('(no spec yet)')
    })
  })
})
