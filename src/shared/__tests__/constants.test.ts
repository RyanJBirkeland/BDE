import { describe, it, expect } from 'vitest'
import { DEFAULT_TASK_TEMPLATES } from '../constants'

describe('DEFAULT_TASK_TEMPLATES', () => {
  it('contains exactly 5 templates', () => {
    expect(DEFAULT_TASK_TEMPLATES).toHaveLength(5)
  })

  it('has the expected template names', () => {
    const names = DEFAULT_TASK_TEMPLATES.map((t) => t.name)
    expect(names).toEqual([
      'Bug Fix',
      'Feature (Renderer)',
      'Feature (Main Process)',
      'Refactor',
      'Test Coverage'
    ])
  })

  it('every template has a non-empty promptPrefix', () => {
    for (const template of DEFAULT_TASK_TEMPLATES) {
      expect(template.promptPrefix.length, `${template.name} promptPrefix is empty`).toBeGreaterThan(
        0
      )
    }
  })

  it('every template promptPrefix contains a testing/verification section', () => {
    for (const template of DEFAULT_TASK_TEMPLATES) {
      const hasTestSection =
        template.promptPrefix.includes('## How to Test') ||
        template.promptPrefix.includes('## How to Verify')
      expect(
        hasTestSection,
        `${template.name} is missing a ## How to Test or ## How to Verify section`
      ).toBe(true)
    }
  })

  it('every template promptPrefix references files to change or create', () => {
    for (const template of DEFAULT_TASK_TEMPLATES) {
      const hasFilesSection =
        template.promptPrefix.includes('## Files to Change') ||
        template.promptPrefix.includes('## Files to Create')
      expect(hasFilesSection, `${template.name} is missing a files section`).toBe(true)
    }
  })
})
