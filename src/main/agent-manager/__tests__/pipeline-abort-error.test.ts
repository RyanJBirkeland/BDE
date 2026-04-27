import { describe, it, expect } from 'vitest'
import { PipelineAbortError } from '../pipeline-abort-error'

describe('PipelineAbortError', () => {
  it('is an instance of PipelineAbortError', () => {
    const err = new PipelineAbortError('Task has no content')
    expect(err instanceof PipelineAbortError).toBe(true)
  })

  it('is an instance of Error', () => {
    const err = new PipelineAbortError('Task has no content')
    expect(err instanceof Error).toBe(true)
  })

  it('carries the provided message', () => {
    const err = new PipelineAbortError('Task has no content')
    expect(err.message).toBe('Task has no content')
  })

  it('has undefined cause when constructed with message only', () => {
    const err = new PipelineAbortError('Task has no content')
    expect(err.cause).toBeUndefined()
  })

  it('carries the original error as cause when provided', () => {
    const original = new Error('original failure')
    const err = new PipelineAbortError('phase 1 failed', original)
    expect(err.cause).toBe(original)
  })

  it('is distinguishable from a plain Error', () => {
    const plain = new Error('something')
    expect(plain instanceof PipelineAbortError).toBe(false)
  })

  it('has name set to PipelineAbortError', () => {
    const err = new PipelineAbortError('msg')
    expect(err.name).toBe('PipelineAbortError')
  })
})
