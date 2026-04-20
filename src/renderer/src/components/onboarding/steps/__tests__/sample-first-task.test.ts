import { describe, it, expect } from 'vitest'
import { SAMPLE_FIRST_TASK } from '../sample-first-task'
import { validateStructural, getValidationProfile } from '../../../../../../shared/spec-validation'

/**
 * Contract test — the sample spec that ships with the "Create your first task"
 * onboarding button must pass readiness validation for its declared specType.
 * The onboarding flow supplies the user's real repo; here we simulate that by
 * passing a non-empty placeholder repo alongside the template fields.
 */
describe('SAMPLE_FIRST_TASK', () => {
  it('passes structural readiness validation for its declared specType', () => {
    const result = validateStructural({
      title: SAMPLE_FIRST_TASK.title,
      repo: 'bde',
      spec: SAMPLE_FIRST_TASK.spec,
      specType: SAMPLE_FIRST_TASK.specType,
      status: 'queued'
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('has at least the minimum heading count the profile requires', () => {
    const profile = getValidationProfile(SAMPLE_FIRST_TASK.specType)
    const required = profile.specStructure.threshold ?? 2
    const headingCount = (SAMPLE_FIRST_TASK.spec.match(/^## /gm) ?? []).length

    expect(headingCount).toBeGreaterThanOrEqual(required)
  })
})
