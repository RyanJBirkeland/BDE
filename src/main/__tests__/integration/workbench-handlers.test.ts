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
      expect(prompt).toContain('text-only spec drafting')
      expect(prompt).toContain('Cannot open URLs')
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
