import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRepoOptions } from '../useRepoOptions'
import { REPO_OPTIONS } from '../../lib/constants'

describe('useRepoOptions', () => {
  beforeEach(() => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  })

  it('returns REPO_OPTIONS as the initial fallback value', () => {
    const { result } = renderHook(() => useRepoOptions())
    expect(result.current).toEqual(REPO_OPTIONS)
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
        { label: 'OtherRepo', owner: '', color: 'var(--bde-text-dim)' }
      ])
    })
  })

  it('keeps fallback when settings returns null', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)

    const { result } = renderHook(() => useRepoOptions())

    await waitFor(() => {
      expect(window.api.settings.getJson).toHaveBeenCalledWith('repos')
    })

    expect(result.current).toEqual(REPO_OPTIONS)
  })

  it('keeps fallback when settings returns an empty array', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([])

    const { result } = renderHook(() => useRepoOptions())

    await waitFor(() => {
      expect(window.api.settings.getJson).toHaveBeenCalledWith('repos')
    })

    expect(result.current).toEqual(REPO_OPTIONS)
  })

  it('keeps fallback when IPC call throws', async () => {
    vi.mocked(window.api.settings.getJson).mockRejectedValue(new Error('IPC error'))

    const { result } = renderHook(() => useRepoOptions())

    await waitFor(() => {
      expect(window.api.settings.getJson).toHaveBeenCalledWith('repos')
    })

    expect(result.current).toEqual(REPO_OPTIONS)
  })
})
