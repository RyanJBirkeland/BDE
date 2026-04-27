import { describe, it, expect, vi } from 'vitest'
import { createReposCache } from './repos-cache'
import type { SettingChangedEvent } from '../events/settings-events'
import type { RepoConfig } from '../paths'

function sampleRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: 'fleet',
    localPath: '/tmp/fleet',
    githubOwner: 'example',
    githubRepo: 'fleet',
    color: '#00ff88',
    ...overrides
  }
}

type FakeSubscription = {
  subscribe: (listener: (event: SettingChangedEvent) => void) => () => void
  emit: (event: SettingChangedEvent) => void
}

function fakeSubscription(): FakeSubscription {
  const listeners = new Set<(event: SettingChangedEvent) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    }
  }
}

describe('createReposCache', () => {
  it('reads repos once on first call and reuses the cached value', () => {
    const repos = [sampleRepo()]
    const readRepos = vi.fn(() => repos)
    const cache = createReposCache({ readRepos, subscribe: fakeSubscription().subscribe })

    expect(cache.getRepos()).toEqual(repos)
    expect(cache.getRepos()).toEqual(repos)

    expect(readRepos).toHaveBeenCalledTimes(1)

    cache.dispose()
  })

  it('returns [] when the underlying reader has no configured repos', () => {
    const readRepos = vi.fn(() => null)
    const cache = createReposCache({ readRepos, subscribe: fakeSubscription().subscribe })

    expect(cache.getRepos()).toEqual([])
    expect(cache.getRepos()).toEqual([])
    expect(readRepos).toHaveBeenCalledTimes(1)

    cache.dispose()
  })

  it('re-reads the settings value after a "repos" setting-changed event', () => {
    const first = [sampleRepo({ name: 'before' })]
    const second = [sampleRepo({ name: 'after' })]
    const readRepos = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const subscription = fakeSubscription()
    const cache = createReposCache({ readRepos, subscribe: subscription.subscribe })

    expect(cache.getRepos()).toEqual(first)
    expect(readRepos).toHaveBeenCalledTimes(1)

    subscription.emit({ key: 'repos', value: JSON.stringify(second) })

    expect(cache.getRepos()).toEqual(second)
    expect(readRepos).toHaveBeenCalledTimes(2)

    cache.dispose()
  })

  it('ignores setting-changed events for unrelated keys', () => {
    const repos = [sampleRepo()]
    const readRepos = vi.fn(() => repos)
    const subscription = fakeSubscription()
    const cache = createReposCache({ readRepos, subscribe: subscription.subscribe })

    expect(cache.getRepos()).toEqual(repos)
    subscription.emit({ key: 'mcp.enabled', value: 'true' })
    expect(cache.getRepos()).toEqual(repos)

    expect(readRepos).toHaveBeenCalledTimes(1)

    cache.dispose()
  })

  it('invalidate() forces the next read to hit the settings reader again', () => {
    const repos = [sampleRepo()]
    const readRepos = vi.fn(() => repos)
    const cache = createReposCache({ readRepos, subscribe: fakeSubscription().subscribe })

    cache.getRepos()
    cache.invalidate()
    cache.getRepos()

    expect(readRepos).toHaveBeenCalledTimes(2)

    cache.dispose()
  })

  it('dispose() unsubscribes so later setting-changed events do not invalidate the cache', () => {
    const readRepos = vi.fn(() => [sampleRepo()])
    const subscription = fakeSubscription()
    const cache = createReposCache({ readRepos, subscribe: subscription.subscribe })

    cache.getRepos()
    cache.dispose()

    subscription.emit({ key: 'repos', value: null })

    // After dispose the cache is cleared, so the next read re-hits readRepos,
    // but further events do not push additional reads.
    cache.getRepos()
    subscription.emit({ key: 'repos', value: null })
    cache.getRepos()

    expect(readRepos).toHaveBeenCalledTimes(2)
  })
})
