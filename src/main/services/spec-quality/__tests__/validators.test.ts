import { describe, it, expect, vi } from 'vitest'
import { SpecParser } from '../spec-parser'
import { RequiredSectionsValidator } from '../validators/sync-validators'
import { FilePathsValidator } from '../validators/sync-validators'
import { NumberedStepsValidator } from '../validators/sync-validators'
import { BannedPhrasesValidator } from '../validators/sync-validators'
import { SizeWarningsValidator } from '../validators/sync-validators'
import { SpecQualityService } from '../spec-quality-service'
import type { IAsyncSpecValidator } from '../../../../shared/spec-quality/interfaces'
import type { ParsedSpec } from '../../../../shared/spec-quality/types'

const parser = new SpecParser()

const VALID_SPEC = `
## Overview
This task adds X to Y.

## Files to Change
- src/main/foo.ts
- src/renderer/src/bar.tsx

## Implementation Steps
1. Open src/main/foo.ts
2. Add the function doX()
3. Update src/renderer/src/bar.tsx to call doX()

## How to Test
Run \`npm test\` — all tests should pass.
`.trim()

describe('RequiredSectionsValidator', () => {
  const validator = new RequiredSectionsValidator()

  it('produces MISSING_SECTION_HOW_TO_TEST when "How to Test" is absent', () => {
    const spec = parser.parse(
      `
## Overview
Some overview.

## Files to Change
- src/main/foo.ts

## Implementation Steps
1. Do something
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'MISSING_SECTION_HOW_TO_TEST')).toBe(true)
    expect(issues.find((i) => i.code === 'MISSING_SECTION_HOW_TO_TEST')?.severity).toBe('error')
  })

  it('produces no issues when all required sections are present', () => {
    const spec = parser.parse(VALID_SPEC)
    const issues = validator.validate(spec)
    expect(issues).toHaveLength(0)
  })

  it('produces errors for all missing sections on empty spec', () => {
    const spec = parser.parse('')
    const issues = validator.validate(spec)
    const codes = issues.map((i) => i.code)
    expect(codes).toContain('MISSING_SECTION_OVERVIEW')
    expect(codes).toContain('MISSING_SECTION_FILES_TO_CHANGE')
    expect(codes).toContain('MISSING_SECTION_IMPLEMENTATION_STEPS')
    expect(codes).toContain('MISSING_SECTION_HOW_TO_TEST')
  })
})

describe('FilePathsValidator', () => {
  const validator = new FilePathsValidator()

  it('returns FILES_SECTION_NO_PATHS when "Files to Change" has no file paths', () => {
    const spec = parser.parse(
      `
## Overview
Something.

## Files to Change
You will need to change a few files.

## Implementation Steps
1. Do it

## How to Test
Run tests.
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'FILES_SECTION_NO_PATHS')).toBe(true)
    expect(issues.find((i) => i.code === 'FILES_SECTION_NO_PATHS')?.severity).toBe('error')
  })

  it('returns no issues when "Files to Change" contains src/foo/bar.ts', () => {
    const spec = parser.parse(
      `
## Files to Change
- src/foo/bar.ts
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'FILES_SECTION_NO_PATHS')).toBe(false)
  })

  it('skips validation when "Files to Change" section is absent', () => {
    const spec = parser.parse(
      `
## Overview
No files section here.
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues).toHaveLength(0)
  })
})

describe('NumberedStepsValidator', () => {
  const validator = new NumberedStepsValidator()

  it('returns STEPS_NOT_NUMBERED when "Implementation Steps" has only bullet points', () => {
    const spec = parser.parse(
      `
## Implementation Steps
- Do the first thing
- Do the second thing
- Do the third thing
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'STEPS_NOT_NUMBERED')).toBe(true)
    expect(issues.find((i) => i.code === 'STEPS_NOT_NUMBERED')?.severity).toBe('error')
  })

  it('returns no issues when steps are numbered', () => {
    const spec = parser.parse(
      `
## Implementation Steps
1. Do the first thing
2. Do the second thing
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues).toHaveLength(0)
  })

  it('skips validation when "Implementation Steps" section is absent', () => {
    const spec = parser.parse(`## Overview\nSomething.`)
    const issues = validator.validate(spec)
    expect(issues).toHaveLength(0)
  })
})

describe('BannedPhrasesValidator', () => {
  const validator = new BannedPhrasesValidator()

  it('returns STEPS_BANNED_PHRASE warning for a step containing "investigate"', () => {
    const spec = parser.parse(
      `
## Implementation Steps
1. Investigate the codebase to understand the structure
2. Add the function
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'STEPS_BANNED_PHRASE')).toBe(true)
    expect(issues.find((i) => i.code === 'STEPS_BANNED_PHRASE')?.severity).toBe('warning')
    expect(issues.find((i) => i.code === 'STEPS_BANNED_PHRASE')?.message).toContain('investigate')
  })

  it('returns no issues when steps are explicit and free of banned phrases', () => {
    const spec = parser.parse(
      `
## Implementation Steps
1. Open src/main/foo.ts
2. Add the function doX()
    `.trim()
    )

    const issues = validator.validate(spec)
    expect(issues).toHaveLength(0)
  })

  it('emits one warning per line even if multiple banned phrases appear on the same line', () => {
    const spec = parser.parse(
      `
## Implementation Steps
1. Research and investigate the options
    `.trim()
    )

    const issues = validator.validate(spec).filter((i) => i.code === 'STEPS_BANNED_PHRASE')
    expect(issues).toHaveLength(1)
  })
})

describe('SizeWarningsValidator', () => {
  const validator = new SizeWarningsValidator()

  it('returns SPEC_TOO_LONG warning when spec exceeds 500 words', () => {
    // Generate a spec with ~600 words
    const manyWords = Array(600).fill('word').join(' ')
    const spec = parser.parse(`## Overview\n${manyWords}`)

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'SPEC_TOO_LONG')).toBe(true)
    expect(issues.find((i) => i.code === 'SPEC_TOO_LONG')?.severity).toBe('warning')
  })

  it('returns no SPEC_TOO_LONG warning for a short spec', () => {
    const spec = parser.parse(VALID_SPEC)
    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'SPEC_TOO_LONG')).toBe(false)
  })

  it('returns TOO_MANY_FILES when "Files to Change" lists more than 10 files', () => {
    const files = Array.from({ length: 11 }, (_, i) => `- src/main/file${i}.ts`).join('\n')
    const spec = parser.parse(`## Files to Change\n${files}`)

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'TOO_MANY_FILES')).toBe(true)
  })

  it('returns TOO_MANY_STEPS when "Implementation Steps" has more than 15 steps', () => {
    const steps = Array.from({ length: 16 }, (_, i) => `${i + 1}. Step ${i + 1}`).join('\n')
    const spec = parser.parse(`## Implementation Steps\n${steps}`)

    const issues = validator.validate(spec)
    expect(issues.some((i) => i.code === 'TOO_MANY_STEPS')).toBe(true)
  })
})

describe('SpecQualityService.validateStructural', () => {
  const service = new SpecQualityService(
    parser,
    [
      new RequiredSectionsValidator(),
      new FilePathsValidator(),
      new NumberedStepsValidator(),
      new BannedPhrasesValidator(),
      new SizeWarningsValidator()
    ],
    []
  )

  it('returns valid: true for a fully valid spec', () => {
    const result = service.validateStructural(VALID_SPEC)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.prescriptivenessChecked).toBe(false)
  })

  it('returns valid: false when required sections are missing', () => {
    const result = service.validateStructural('## Overview\nSomething.')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns warnings without invalidating the result', () => {
    const manyWords = Array(510).fill('word').join(' ')
    const spec = `${VALID_SPEC}\n\n${manyWords}`
    const result = service.validateStructural(spec)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.code === 'SPEC_TOO_LONG')).toBe(true)
  })
})

describe('SpecQualityService.validateFull — async validator integration', () => {
  const syncValidators = [
    new RequiredSectionsValidator(),
    new FilePathsValidator(),
    new NumberedStepsValidator(),
    new BannedPhrasesValidator(),
    new SizeWarningsValidator()
  ]

  it('skips async validators when structural validation has errors', async () => {
    const mockAsyncValidator: IAsyncSpecValidator = {
      validate: vi.fn().mockResolvedValue([])
    }

    const service = new SpecQualityService(parser, syncValidators, [mockAsyncValidator])

    // Spec with missing required sections triggers structural errors
    const result = await service.validateFull('## Overview\nSomething.')

    expect(result.valid).toBe(false)
    expect(result.prescriptivenessChecked).toBe(false)
    expect(mockAsyncValidator.validate).not.toHaveBeenCalled()
  })

  it('sets prescriptivenessChecked to true after validateFull completes on a valid spec', async () => {
    const mockAsyncValidator: IAsyncSpecValidator = {
      validate: vi.fn().mockResolvedValue([])
    }

    const service = new SpecQualityService(parser, syncValidators, [mockAsyncValidator])

    const result = await service.validateFull(VALID_SPEC)

    expect(result.prescriptivenessChecked).toBe(true)
    expect(mockAsyncValidator.validate).toHaveBeenCalledOnce()
    // Verify it was called with a ParsedSpec
    const callArg = (mockAsyncValidator.validate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ParsedSpec
    expect(callArg.sections.length).toBeGreaterThan(0)
  })

  it('includes async issues in the final result', async () => {
    const mockAsyncValidator: IAsyncSpecValidator = {
      validate: vi.fn().mockResolvedValue([
        {
          code: 'STEP_REQUIRES_DESIGN_DECISION' as const,
          severity: 'warning' as const,
          message: 'Spec may require design decisions: Step 2 asks agent to choose an approach.'
        }
      ])
    }

    const service = new SpecQualityService(parser, syncValidators, [mockAsyncValidator])

    const result = await service.validateFull(VALID_SPEC)

    expect(result.prescriptivenessChecked).toBe(true)
    expect(result.warnings.some((w) => w.code === 'STEP_REQUIRES_DESIGN_DECISION')).toBe(true)
    // Warnings don't invalidate the result
    expect(result.valid).toBe(true)
  })
})
