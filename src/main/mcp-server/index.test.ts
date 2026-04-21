import { describe, it, expect } from 'vitest'
import { translateCancelError } from './index'
import { TaskTransitionError } from '../services/sprint-service'
import { McpDomainError, McpErrorCode } from './errors'

describe('translateCancelError', () => {
  it('maps TaskTransitionError to McpDomainError with InvalidTransition kind', () => {
    const source = new TaskTransitionError('Invalid transition: done → cancelled', {
      taskId: 't1',
      fromStatus: 'done',
      toStatus: 'cancelled'
    })

    const translated = translateCancelError(source)

    expect(translated).toBeInstanceOf(McpDomainError)
    const domainError = translated as McpDomainError
    expect(domainError.kind).toBe(McpErrorCode.InvalidTransition)
    expect(domainError.message).toContain('Invalid transition')
    expect(domainError.data).toEqual({
      taskId: 't1',
      fromStatus: 'done',
      toStatus: 'cancelled'
    })
  })

  it('passes unknown errors through unchanged', () => {
    const err = new Error('disk full')
    expect(translateCancelError(err)).toBe(err)
  })
})
