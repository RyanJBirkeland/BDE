import { isValidTransition, VALID_TRANSITIONS } from '../task-transitions'

describe('task-transitions', () => {
  it('allows backlog → queued', () => {
    expect(isValidTransition('backlog', 'queued')).toBe(true)
  })
  it('allows queued → active', () => {
    expect(isValidTransition('queued', 'active')).toBe(true)
  })
  it('allows active → review', () => {
    expect(isValidTransition('active', 'review')).toBe(true)
  })
  it('allows active → failed', () => {
    expect(isValidTransition('active', 'failed')).toBe(true)
  })
  it('rejects done → active', () => {
    expect(isValidTransition('done', 'active')).toBe(false)
  })
  it('rejects backlog → done (skipping steps)', () => {
    expect(isValidTransition('backlog', 'done')).toBe(false)
  })
  it('allows any status → cancelled', () => {
    expect(isValidTransition('backlog', 'cancelled')).toBe(true)
    expect(isValidTransition('active', 'cancelled')).toBe(true)
    expect(isValidTransition('queued', 'cancelled')).toBe(true)
  })
  it('allows review → queued (revision request)', () => {
    expect(isValidTransition('review', 'queued')).toBe(true)
  })
  it('allows review → done (merge)', () => {
    expect(isValidTransition('review', 'done')).toBe(true)
  })
  it('allows failed → queued (retry)', () => {
    expect(isValidTransition('failed', 'queued')).toBe(true)
  })
  it('allows error → queued (retry)', () => {
    expect(isValidTransition('error', 'queued')).toBe(true)
  })
  it('allows blocked → queued (unblock)', () => {
    expect(isValidTransition('blocked', 'queued')).toBe(true)
  })
  it('allows queued → blocked (auto-block on dep check)', () => {
    expect(isValidTransition('queued', 'blocked')).toBe(true)
  })

  it('exports VALID_TRANSITIONS map', () => {
    expect(VALID_TRANSITIONS).toBeDefined()
    expect(VALID_TRANSITIONS['backlog']).toBeInstanceOf(Set)
  })

  it('returns false for unknown from-status', () => {
    expect(isValidTransition('unknown-status', 'queued')).toBe(false)
  })

  it('cancelled has no outbound transitions', () => {
    expect(isValidTransition('cancelled', 'queued')).toBe(false)
    expect(isValidTransition('cancelled', 'active')).toBe(false)
  })
})
