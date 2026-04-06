import { describe, it, expect } from 'vitest'
import { parseGitHubRemote } from '../git-remote'

describe('parseGitHubRemote', () => {
  it('parses https URL with .git', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('parses https URL without .git', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('parses https URL with trailing slash', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo/')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('parses SSH URL', () => {
    expect(parseGitHubRemote('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('parses SSH URL without .git', () => {
    expect(parseGitHubRemote('git@github.com:owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('parses ssh:// URL form', () => {
    expect(parseGitHubRemote('ssh://git@github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
  })

  it('handles hyphens, dots and underscores in names', () => {
    expect(parseGitHubRemote('https://github.com/my-org/my.cool_repo.git')).toEqual({
      owner: 'my-org',
      repo: 'my.cool_repo'
    })
  })

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubRemote('https://gitlab.com/owner/repo.git')).toBeNull()
    expect(parseGitHubRemote('git@gitlab.com:owner/repo.git')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(parseGitHubRemote('')).toBeNull()
    expect(parseGitHubRemote(null)).toBeNull()
    expect(parseGitHubRemote(undefined)).toBeNull()
    expect(parseGitHubRemote('not a url')).toBeNull()
    expect(parseGitHubRemote('https://github.com/owner')).toBeNull()
  })
})
