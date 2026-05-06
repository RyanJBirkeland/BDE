import { describe, it, expect } from 'vitest'
import { parseRestoreParam } from '../parseRestoreParam'

describe('parseRestoreParam (T-49)', () => {
  it('returns valid view array round-tripped through encodeURIComponent', () => {
    const param = encodeURIComponent(JSON.stringify(['dashboard', 'sprint']))
    expect(parseRestoreParam(param, 'ide')).toEqual(['dashboard', 'sprint'])
  })

  it('drops invalid view keys silently and keeps valid ones', () => {
    const param = encodeURIComponent(JSON.stringify(['dashboard', 'not-a-view', 'sprint']))
    expect(parseRestoreParam(param, 'ide')).toEqual(['dashboard', 'sprint'])
  })

  it('falls back to provided view when payload contains only invalid keys', () => {
    const param = encodeURIComponent(JSON.stringify(['nope', 'still-nope']))
    expect(parseRestoreParam(param, 'ide')).toEqual(['ide'])
  })

  it('falls back to provided view when payload is not an array', () => {
    const param = encodeURIComponent(JSON.stringify({ view: 'dashboard' }))
    expect(parseRestoreParam(param, 'ide')).toEqual(['ide'])
  })

  it('falls back to provided view when JSON is malformed', () => {
    expect(parseRestoreParam('%7Bnot-json', 'ide')).toEqual(['ide'])
  })
})
