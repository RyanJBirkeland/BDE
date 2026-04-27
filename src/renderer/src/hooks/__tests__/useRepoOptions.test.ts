import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRepoOptions } from '../useRepoOptions'

describe('useRepoOptions', () => {
  beforeEach(() => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  })

  it('returns empty array while loading, then empty array when no repos configured', async () => {
    const { result } = renderHook(() => useRepoOptions())
    // Initially returns empty array while loading
    expect(result.current).toEqual([])

    // After settings load with no repos, stays empty
    await waitFor(() => {
      expect(result.current).toEqual([])
    })
  })

  it('loads repos from settings via IPC and maps to RepoOption shape', async () => {
    const configs = [
      {
        name: 'MyRepo',
        localPath: '/path/to/repo',
        githubOwner: 'myorg',
        githubRepo: 'myrepo',
        color: '#ff0000'
      },
      { name: 'OtherRepo', localPath: '/path/to/other' }
    ]
    vi.mocked(window.api.settings.getJson).mockResolvedValue(configs)

    const { result } = renderHook(() => useRepoOptions())

    await waitFor(() => {
      expect(result.current).toEqual([
        { label: 'MyRepo', owner: 'myorg', color: '#ff0000' },
        { label: 'OtherRepo', owner: '', color: 'var(--fleet-text-dim)' }
      ])
    })
  })

  it('returns empty array when settings returns null', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)

    const { result } = renderHook(() => useRepoOptions())

    await waitFor(() => {
      expect(result.current).toEqual([])
    })
  })

  it('returns empty array when settings returns an empty array', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([])

    const { result } = renderHook(() => useRepoOptions())

    // Initially empty while loading
    expect(result.current).toEqual([])

    await waitFor(() => {
      expect(result.current).toEqual([])
    })
  })

  it('returns empty array when IPC call throws', async () => {
    vi.mocked(window.api.settings.getJson).mockRejectedValue(new Error('IPC error'))

    const { result } = renderHook(() => useRepoOptions())

    // Initially empty while loading
    expect(result.current).toEqual([])

    await waitFor(() => {
      expect(result.current).toEqual([])
    })
  })
})
