import { describe, it, expect, vi } from 'vitest'
import { assertHandlersRegistered } from './handler-registration'

describe('assertHandlersRegistered', () => {
  it('passes when the mock recorded exactly the expected channels', () => {
    const mock = vi.fn()
    mock('foo:one', () => {})
    mock('foo:two', () => {})

    expect(() => assertHandlersRegistered(mock, ['foo:one', 'foo:two'])).not.toThrow()
  })

  it('is order-independent', () => {
    const mock = vi.fn()
    mock('foo:two', () => {})
    mock('foo:one', () => {})

    expect(() => assertHandlersRegistered(mock, ['foo:one', 'foo:two'])).not.toThrow()
  })

  it('tolerates additional args after the handler function (e.g. parseArgs validator)', () => {
    const mock = vi.fn()
    mock('foo:one', () => {})
    mock(
      'foo:two',
      () => {},
      () => {} // parseArgs validator
    )

    expect(() => assertHandlersRegistered(mock, ['foo:one', 'foo:two'])).not.toThrow()
  })

  it('throws when an expected channel was not registered', () => {
    const mock = vi.fn()
    mock('foo:one', () => {})

    expect(() => assertHandlersRegistered(mock, ['foo:one', 'foo:missing'])).toThrow()
  })

  it('throws when an unexpected channel was registered', () => {
    const mock = vi.fn()
    mock('foo:one', () => {})
    mock('foo:surprise', () => {})

    expect(() => assertHandlersRegistered(mock, ['foo:one'])).toThrow()
  })

  it('throws when the handler slot is not a function', () => {
    const mock = vi.fn()
    mock('foo:one', 'not a function')

    expect(() => assertHandlersRegistered(mock, ['foo:one'])).toThrow()
  })
})
