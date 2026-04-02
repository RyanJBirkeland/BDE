import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore, toast } from '../toasts'

describe('toasts store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('toast.success adds toast with type success', () => {
    toast.success('Done!')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('success')
    expect(toasts[0].message).toBe('Done!')
  })

  it('toast.error adds toast with type error', () => {
    toast.error('Oops')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toBe('Oops')
  })

  it('toast.info adds toast with type info', () => {
    toast.info('FYI')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('info')
  })

  it('removeToast removes toast by id', () => {
    toast.success('A')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('multiple toasts stack correctly', () => {
    toast.success('1')
    toast.error('2')
    toast.info('3')
    expect(useToastStore.getState().toasts).toHaveLength(3)
  })

  it('caps at MAX_TOASTS (4)', () => {
    toast.success('1')
    toast.success('2')
    toast.success('3')
    toast.success('4')
    toast.success('5')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(4)
    // First toast should have been evicted
    expect(toasts[0].message).toBe('2')
    expect(toasts[3].message).toBe('5')
  })

  it('auto-dismisses after default duration (3s)', () => {
    toast.success('Auto')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-dismisses after custom duration', () => {
    toast.success('Custom', 1000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
