import { describe, it, expect } from 'vitest'
import { buildAgentPrompt, classifyTask } from '../agent-manager/prompt-composer'
import type { BuildPromptInput } from '../agent-manager/prompt-composer'

describe('buildAgentPrompt', () => {
  const baseInput: BuildPromptInput = {
    agentType: 'pipeline',
    taskContent: '## Overview\nBuild feature X\n## Plan\nStep 1...',
    branch: 'agent/build-feature-x-abc12345'
  }

  it('includes task content in pipeline prompt', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('Build feature X')
    expect(prompt).toContain('Step 1')
  })

  it('includes branch name in pipeline prompt', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('agent/build-feature-x-abc12345')
  })

  it('includes "do not push to main" warning', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('NEVER push to')
    expect(prompt).toContain('main')
  })

  it('includes npm install reminder in universal preamble', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('npm install')
  })

  it('includes coding agent preamble for coding agent types', () => {
    const types = ['pipeline', 'assistant', 'adhoc'] as const
    for (const agentType of types) {
      const prompt = buildAgentPrompt({ ...baseInput, agentType })
      expect(prompt).toContain('You are a BDE')
    }
  })

  it('includes spec drafting preamble for spec drafting agents', () => {
    const types = ['copilot', 'synthesizer'] as const
    for (const agentType of types) {
      const prompt = buildAgentPrompt({ ...baseInput, agentType })
      expect(prompt).toContain('BDE Task Workbench Copilot')
      expect(prompt).toContain('read-only spec drafting')
    }
  })

  it('produces different output for assistant vs pipeline', () => {
    const pipeline = buildAgentPrompt({ ...baseInput, agentType: 'pipeline' })
    const assistant = buildAgentPrompt({ ...baseInput, agentType: 'assistant' })
    expect(pipeline).not.toBe(assistant)
  })

  it('produces different output for adhoc type', () => {
    const adhoc = buildAgentPrompt({ ...baseInput, agentType: 'adhoc' })
    expect(adhoc).toContain(baseInput.taskContent)
  })

  it('includes branch appendix when branch is provided', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'do stuff',
      branch: 'agent/my-branch'
    })
    expect(prompt).toContain('## Git Branch')
    expect(prompt).toContain('agent/my-branch')
    expect(prompt).toContain('git push origin agent/my-branch')
  })

  it('omits branch appendix when no branch provided', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'do stuff'
    })
    expect(prompt).not.toContain('## Git Branch')
  })

  it('includes playground instructions when playgroundEnabled', () => {
    const prompt = buildAgentPrompt({
      ...baseInput,
      playgroundEnabled: true
    })
    expect(prompt).toContain('## Dev Playground')
    expect(prompt).toContain('.html')
  })

  it('omits playground section when not enabled', () => {
    const prompt = buildAgentPrompt({
      ...baseInput,
      playgroundEnabled: false
    })
    const playgroundSectionCount = (prompt.match(/## Dev Playground/g) || []).length
    expect(playgroundSectionCount).toBe(0)
  })

  it('handles copilot type with form context and messages', () => {
    const prompt = buildAgentPrompt({
      agentType: 'copilot',
      taskContent: 'Help me write a spec',
      messages: [{ role: 'user', content: 'What should the spec cover?' }],
      formContext: { title: 'Feature X', repo: 'BDE', spec: 'Draft spec content' }
    })
    expect(prompt).toContain('## Task Context')
    expect(prompt).toContain('Feature X')
    expect(prompt).toContain('BDE')
    expect(prompt).toContain('Draft spec content')
    expect(prompt).toContain('## Conversation')
    expect(prompt).toContain('What should the spec cover?')
  })

  it('handles copilot without spec in formContext', () => {
    const prompt = buildAgentPrompt({
      agentType: 'copilot',
      messages: [{ role: 'user', content: 'hello' }],
      formContext: { title: 'My Task', repo: 'BDE', spec: '' }
    })
    expect(prompt).toContain('(no spec yet)')
  })

  it('handles copilot without formContext', () => {
    const prompt = buildAgentPrompt({
      agentType: 'copilot',
      messages: [{ role: 'user', content: 'hello' }]
    })
    expect(prompt).not.toContain('## Task Context')
    expect(prompt).toContain('## Conversation')
  })

  it('handles synthesizer type with codebase context', () => {
    const prompt = buildAgentPrompt({
      agentType: 'synthesizer',
      taskContent: 'Generate spec',
      codebaseContext: 'file tree here...'
    })
    expect(prompt).toContain('## Codebase Context')
    expect(prompt).toContain('file tree here...')
    expect(prompt).toContain('## Generation Instructions')
    expect(prompt).toContain('Generate spec')
  })

  it('handles synthesizer without taskContent', () => {
    const prompt = buildAgentPrompt({
      agentType: 'synthesizer',
      codebaseContext: 'file tree here...'
    })
    expect(prompt).toContain('## Codebase Context')
    expect(prompt).not.toContain('## Generation Instructions')
  })

  it('pipeline role contains personality text', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('pipeline agent')
  })

  it('assistant role mentions interactive assistant', () => {
    const prompt = buildAgentPrompt({ ...baseInput, agentType: 'assistant' })
    expect(prompt).toContain('interactive BDE assistant')
  })

  it('copilot role mentions spec drafting', () => {
    const prompt = buildAgentPrompt({
      agentType: 'copilot',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(prompt).toContain('spec drafting')
  })

  it('truncates pipeline taskContent at 2000 chars', () => {
    const longSpec = 'x'.repeat(3000)
    const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: longSpec, branch: 'b' })
    expect(prompt).toContain('x'.repeat(2000))
    expect(prompt).not.toContain('x'.repeat(2001))
    expect(prompt).toContain('[spec truncated at 2000 chars')
  })

  it('does not truncate pipeline taskContent under 2000 chars', () => {
    const shortSpec = 'y'.repeat(100)
    const prompt = buildAgentPrompt({ agentType: 'pipeline', taskContent: shortSpec, branch: 'b' })
    expect(prompt).toContain('y'.repeat(100))
    expect(prompt).not.toContain('[spec truncated')
  })
})

describe('classifyTask', () => {
  it('classifies fix keywords', () => {
    expect(classifyTask('Bug fix: null pointer in login')).toBe('fix')
    expect(classifyTask('fix: crash on startup')).toBe('fix')
    expect(classifyTask('fixes #42 — wrong error message')).toBe('fix')
  })

  it('classifies refactor keywords', () => {
    expect(classifyTask('Refactor auth module to use hooks')).toBe('refactor')
    expect(classifyTask('Cleanup the sprint pipeline code')).toBe('refactor')
  })

  it('classifies doc keywords', () => {
    expect(classifyTask('Add JSDoc comments to all IPC handlers')).toBe('doc')
    expect(classifyTask('Update README with setup instructions')).toBe('doc')
  })

  it('classifies audit keywords', () => {
    expect(classifyTask('Audit the token usage in agent pipeline')).toBe('audit')
    expect(classifyTask('Investigate slow dashboard refresh')).toBe('audit')
  })

  it('defaults to generate for unrecognized content', () => {
    expect(classifyTask('Add OAuth login screen')).toBe('generate')
    expect(classifyTask('Implement sprint dependency graph')).toBe('generate')
    expect(classifyTask('')).toBe('generate')
  })

  it('pipeline prompt includes output budget hint', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Refactor the auth module',
      branch: 'chore/refactor'
    })
    expect(prompt).toContain('## Output Budget')
    expect(prompt).toContain('refactor')
    expect(prompt).toContain('4,000')
  })

  it('pipeline prompt classifies generate with 8K cap', () => {
    const prompt = buildAgentPrompt({
      agentType: 'pipeline',
      taskContent: 'Add a new dashboard widget',
      branch: 'feat/widget'
    })
    expect(prompt).toContain('generate')
    expect(prompt).toContain('8,000')
  })

  it('non-pipeline agents do not get output budget hint', () => {
    const prompt = buildAgentPrompt({
      agentType: 'adhoc',
      taskContent: 'Refactor the auth module'
    })
    expect(prompt).not.toContain('## Output Budget')
  })
})
