import { describe, it, expect } from 'vitest'
import { statusToDotKind } from '../task-status'

describe('statusToDotKind', () => {
  it('maps active status to running', () => {
    expect(statusToDotKind('active')).toBe('running')
  })

  it('maps review status to review', () => {
    expect(statusToDotKind('review')).toBe('review')
  })

  it('maps approved status to review (treated like a review-stage state)', () => {
    expect(statusToDotKind('approved')).toBe('review')
  })

  it('maps done status to done', () => {
    expect(statusToDotKind('done')).toBe('done')
  })

  it('maps failed status to failed', () => {
    expect(statusToDotKind('failed')).toBe('failed')
  })

  it('maps error status to failed', () => {
    expect(statusToDotKind('error')).toBe('failed')
  })

  it('maps cancelled status to failed', () => {
    expect(statusToDotKind('cancelled')).toBe('failed')
  })

  it('maps blocked status to blocked', () => {
    expect(statusToDotKind('blocked')).toBe('blocked')
  })

  it('upgrades active to review when prStatus is open', () => {
    expect(statusToDotKind('active', 'open')).toBe('review')
  })

  it('upgrades active to review when prStatus is branch_only', () => {
    expect(statusToDotKind('active', 'branch_only')).toBe('review')
  })

  it('falls back to queued for unrecognised statuses', () => {
    expect(statusToDotKind('unknown')).toBe('queued')
  })

  it('falls back to queued for empty string', () => {
    expect(statusToDotKind('')).toBe('queued')
  })
})
