import { describe, it, expect } from 'vitest'
import { pipelinePersonality } from '../pipeline-personality'
import { assistantPersonality } from '../assistant-personality'
import { copilotPersonality } from '../copilot-personality'
import { synthesizerPersonality } from '../synthesizer-personality'
import { adhocPersonality } from '../adhoc-personality'

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

    it('should include pipeline-specific constraints', () => {
      expect(pipelinePersonality.constraints.some((c) => c.includes('NEVER commit secrets'))).toBe(
        true
      )
      expect(pipelinePersonality.constraints.some((c) => c.includes('Stay within spec scope'))).toBe(true)
    })

    it('should include reporting patterns', () => {
      expect(pipelinePersonality.patterns.some((p) => p.includes('what you did'))).toBe(true)
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
      expect(assistantPersonality.constraints.some((c) => c.includes('Full tool access'))).toBe(
        true
      )
    })

    it('should include BDE-specific patterns', () => {
      expect(assistantPersonality.patterns.some((p) => p.includes('sprint tasks'))).toBe(true)
      expect(assistantPersonality.patterns.some((p) => p.includes('Dev Playground'))).toBe(true)
    })
  })

  describe('copilot personality', () => {
    it('should have structured and question-driven voice', () => {
      expect(copilotPersonality.voice).toContain('structured')
      expect(copilotPersonality.voice).toContain('question-driven')
    })

    it('should frame role as spec drafting assistant', () => {
      expect(copilotPersonality.roleFrame).toContain('spec drafting assistant')
      expect(copilotPersonality.roleFrame).toContain('Task Workbench')
    })

    it('should constrain to text-only responses', () => {
      expect(copilotPersonality.constraints.some((c) => c.includes('text responses only'))).toBe(
        true
      )
      expect(copilotPersonality.constraints.some((c) => c.includes('500 words'))).toBe(true)
    })

    it('should include spec-drafting patterns', () => {
      expect(copilotPersonality.patterns.some((p) => p.includes('clarifying questions'))).toBe(true)
      expect(copilotPersonality.patterns.some((p) => p.includes('heading structure'))).toBe(true)
    })
  })

  describe('synthesizer personality', () => {
    it('should have analytical and thorough voice', () => {
      expect(synthesizerPersonality.voice).toContain('analytical')
      expect(synthesizerPersonality.voice).toContain('thorough')
    })

    it('should frame role as single-turn spec generator', () => {
      expect(synthesizerPersonality.roleFrame).toContain('single-turn spec generator')
      expect(synthesizerPersonality.roleFrame).toContain('codebase context')
    })

    it('should constrain to single turn and markdown output', () => {
      expect(synthesizerPersonality.constraints.some((c) => c.includes('Single turn only'))).toBe(
        true
      )
      expect(synthesizerPersonality.constraints.some((c) => c.includes('markdown'))).toBe(true)
    })

    it('should include spec-generation patterns', () => {
      expect(synthesizerPersonality.patterns.some((p) => p.includes('existing patterns'))).toBe(
        true
      )
      expect(
        synthesizerPersonality.patterns.some((p) => p.includes('testing considerations'))
      ).toBe(true)
    })
  })

  describe('adhoc personality', () => {
    it('should have terse and execution-focused voice', () => {
      expect(adhocPersonality.voice).toContain('terse')
      expect(adhocPersonality.voice).toContain('execution-focused')
    })

    it('should frame role as user-spawned task executor', () => {
      expect(adhocPersonality.roleFrame).toContain('user-spawned task executor')
      expect(adhocPersonality.roleFrame).toContain('full tool access')
    })

    it('should include tool access and branch constraints', () => {
      expect(adhocPersonality.constraints.some((c) => c.includes('Full tool access'))).toBe(true)
      expect(adhocPersonality.constraints.some((c) => c.includes('never to main'))).toBe(true)
    })

    it('should include execution-first patterns', () => {
      expect(adhocPersonality.patterns.some((p) => p.includes('Execute first'))).toBe(true)
      expect(adhocPersonality.patterns.some((p) => p.includes('Commit frequently'))).toBe(true)
    })
  })

  describe('adhoc vs assistant differentiation', () => {
    it('should have different voice styles', () => {
      expect(adhocPersonality.voice).not.toEqual(assistantPersonality.voice)
      expect(adhocPersonality.voice).toContain('terse')
      expect(assistantPersonality.voice).toContain('conversational')
    })

    it('should have different role frames', () => {
      expect(adhocPersonality.roleFrame).not.toEqual(assistantPersonality.roleFrame)
      expect(adhocPersonality.roleFrame).toContain('task executor')
      expect(assistantPersonality.roleFrame).toContain('assistant')
    })

    it('should have different patterns', () => {
      expect(adhocPersonality.patterns).not.toEqual(assistantPersonality.patterns)
      expect(adhocPersonality.patterns.some((p) => p.includes('Execute first'))).toBe(true)
      expect(assistantPersonality.patterns.some((p) => p.includes('sprint tasks'))).toBe(true)
    })
  })
})
