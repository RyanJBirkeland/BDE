import { describe, it, expect } from 'vitest'
import { assemblePrompt, migrateHistory } from '../prompt-assembly'
import type { PromptTemplate, RecentTask } from '../launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-1',
  name: 'Test',
  icon: '🧪',
  accent: 'cyan',
  description: 'Test template',
  questions: [
    { id: 'scope', label: 'Scope?', type: 'choice', choices: ['All', 'Some'] },
    { id: 'focus', label: 'Focus?', type: 'text' }
  ],
  promptTemplate: 'Audit {{scope}} focusing on {{focus}}.',
  order: 0
}

describe('assemblePrompt', () => {
  it('replaces all {{variable}} placeholders with answers', () => {
    const result = assemblePrompt(mockTemplate, { scope: 'Entire repo', focus: 'naming' })
    expect(result).toBe('Audit Entire repo focusing on naming.')
  })

  it('replaces multiple occurrences of the same variable', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: '{{scope}} first, then {{scope}} again.'
    }
    const result = assemblePrompt(template, { scope: 'All' })
    expect(result).toBe('All first, then All again.')
  })

  it('leaves unanswered optional placeholders as empty string', () => {
    const result = assemblePrompt(mockTemplate, { scope: 'All' })
    expect(result).toBe('Audit All focusing on .')
  })

  it('trims leading/trailing whitespace from result', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: '  {{scope}}  '
    }
    const result = assemblePrompt(template, { scope: 'All' })
    expect(result).toBe('All')
  })

  it('collapses triple+ newlines left by empty optional fields', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: 'Line one.\n\n{{focus}}\n\nLine three.'
    }
    const result = assemblePrompt(template, { focus: '' })
    expect(result).toBe('Line one.\n\nLine three.')
  })

  it('handles empty answers object', () => {
    const result = assemblePrompt(mockTemplate, {})
    expect(result).toBe('Audit  focusing on .')
  })
})

describe('migrateHistory', () => {
  it('converts string[] to RecentTask[]', () => {
    const old = ['Fix the bug', 'Add feature']
    const result = migrateHistory(old)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      prompt: 'Fix the bug',
      repo: '',
      model: '',
      timestamp: 0
    })
    expect(result[1]).toEqual({
      prompt: 'Add feature',
      repo: '',
      model: '',
      timestamp: 0
    })
  })

  it('returns RecentTask[] as-is if already migrated', () => {
    const already: RecentTask[] = [
      { prompt: 'Fix bug', repo: 'BDE', model: 'sonnet', timestamp: 1000 }
    ]
    const result = migrateHistory(already)
    expect(result).toEqual(already)
  })

  it('returns empty array for null/undefined', () => {
    expect(migrateHistory(null)).toEqual([])
    expect(migrateHistory(undefined)).toEqual([])
  })

  it('returns empty array for invalid data', () => {
    expect(migrateHistory('not an array' as unknown)).toEqual([])
    expect(migrateHistory(42 as unknown)).toEqual([])
  })

  it('filters out non-string entries in legacy array', () => {
    const mixed = ['valid', 42, null, 'also valid'] as unknown as string[]
    const result = migrateHistory(mixed)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('valid')
    expect(result[1].prompt).toBe('also valid')
  })
})
