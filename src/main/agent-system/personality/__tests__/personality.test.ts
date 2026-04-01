import { describe, it, expect } from 'vitest'
import { pipelinePersonality } from '../pipeline-personality'
import { assistantPersonality } from '../assistant-personality'

describe('Personality System', () => {
  describe('pipeline personality', () => {
    it('should have concise voice', () => {
      expect(pipelinePersonality.voice).toContain('concise')
      expect(pipelinePersonality.voice).toContain('action-oriented')
    })

    it('should frame role as pipeline agent', () => {
      expect(pipelinePersonality.roleFrame).toContain('pipeline agent')
      expect(pipelinePersonality.roleFrame).toContain('sprint task')
    })

    it('should include git constraints', () => {
      expect(pipelinePersonality.constraints.some(c => c.includes('NEVER push to main'))).toBe(true)
      expect(pipelinePersonality.constraints.some(c => c.includes('Run tests'))).toBe(true)
    })

    it('should include reporting patterns', () => {
      expect(pipelinePersonality.patterns.some(p => p.includes('what you did'))).toBe(true)
    })
  })

  describe('assistant personality', () => {
    it('should have conversational voice', () => {
      expect(assistantPersonality.voice).toContain('conversational')
      expect(assistantPersonality.voice).toContain('concise')
    })

    it('should frame role as interactive assistant', () => {
      expect(assistantPersonality.roleFrame).toContain('interactive')
      expect(assistantPersonality.roleFrame).toContain('BDE assistant')
    })

    it('should include full tool access', () => {
      expect(assistantPersonality.constraints.some(c => c.includes('Full tool access'))).toBe(true)
    })

    it('should include BDE-specific patterns', () => {
      expect(assistantPersonality.patterns.some(p => p.includes('sprint tasks'))).toBe(true)
      expect(assistantPersonality.patterns.some(p => p.includes('Dev Playground'))).toBe(true)
    })
  })
})
