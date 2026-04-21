import { describe, it, expect } from 'vitest'
import { classifyFailureReason, registerFailurePattern } from '../failure-classifier'

describe('classifyFailureReason', () => {
  describe('auth pattern matching', () => {
    it('matches invalid api key', () => {
      expect(classifyFailureReason('Error: invalid api key')).toBe('auth')
    })

    it('matches authentication failed', () => {
      expect(classifyFailureReason('authentication failed')).toBe('auth')
    })

    it('matches unauthorized', () => {
      expect(classifyFailureReason('unauthorized access')).toBe('auth')
    })

    it('matches token expired', () => {
      expect(classifyFailureReason('token expired')).toBe('auth')
    })

    it('matches invalid token', () => {
      expect(classifyFailureReason('invalid token provided')).toBe('auth')
    })

    it('matches snake_case invalid_api_key', () => {
      expect(classifyFailureReason('error: invalid_api_key')).toBe('auth')
    })

    it('matches snake_case token_expired', () => {
      expect(classifyFailureReason('token_expired at 2026-04-15')).toBe('auth')
    })

    it('matches snake_case invalid_token', () => {
      expect(classifyFailureReason('invalid_token in request')).toBe('auth')
    })

    it('matches snake_case authentication_failed', () => {
      expect(classifyFailureReason('authentication_failed for user')).toBe('auth')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('INVALID API KEY')).toBe('auth')
      expect(classifyFailureReason('Authentication Failed')).toBe('auth')
      expect(classifyFailureReason('UNAUTHORIZED')).toBe('auth')
    })
  })

  describe('no_commits pattern matching', () => {
    it('matches no commits', () => {
      expect(classifyFailureReason('no commits were created')).toBe('no_commits')
    })

    it('matches produced no commits', () => {
      expect(classifyFailureReason('agent produced no commits')).toBe('no_commits')
    })

    it('matches no output captured', () => {
      expect(classifyFailureReason('no output captured from build')).toBe('no_commits')
    })

    it('matches agent produced no commits', () => {
      expect(classifyFailureReason('agent produced no commits in branch')).toBe('no_commits')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('NO COMMITS')).toBe('no_commits')
      expect(classifyFailureReason('Produced No Commits')).toBe('no_commits')
    })
  })

  describe('timeout pattern matching', () => {
    it('matches exceeded maximum runtime', () => {
      expect(classifyFailureReason('exceeded maximum runtime limit')).toBe('timeout')
    })

    it('matches timeout', () => {
      expect(classifyFailureReason('timeout waiting for response')).toBe('timeout')
    })

    it('matches timed out', () => {
      expect(classifyFailureReason('timed out after 60s')).toBe('timeout')
    })

    it('matches watchdog', () => {
      expect(classifyFailureReason('watchdog killed process')).toBe('timeout')
    })

    it('matches max_turns_exceeded', () => {
      expect(classifyFailureReason('max_turns_exceeded in agent')).toBe('timeout')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('TIMEOUT')).toBe('timeout')
      expect(classifyFailureReason('Timed Out')).toBe('timeout')
      expect(classifyFailureReason('WATCHDOG')).toBe('timeout')
    })
  })

  describe('test_failure pattern matching', () => {
    it('matches npm test failed', () => {
      expect(classifyFailureReason('npm test failed with exit code 1')).toBe('test_failure')
    })

    it('matches test failed', () => {
      expect(classifyFailureReason('test failed: assertion error')).toBe('test_failure')
    })

    it('matches vitest failed', () => {
      expect(classifyFailureReason('vitest failed: 5 tests failed')).toBe('test_failure')
    })

    it('matches jest failed', () => {
      expect(classifyFailureReason('jest failed: test suite error')).toBe('test_failure')
    })

    it('matches tests failed', () => {
      expect(classifyFailureReason('tests failed in build')).toBe('test_failure')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('NPM TEST FAILED')).toBe('test_failure')
      expect(classifyFailureReason('Test Failed')).toBe('test_failure')
      expect(classifyFailureReason('VITEST FAILED')).toBe('test_failure')
    })
  })

  describe('compilation pattern matching', () => {
    it('matches compilation error', () => {
      expect(classifyFailureReason('compilation error in file.ts')).toBe('compilation')
    })

    it('matches compilation failed', () => {
      expect(classifyFailureReason('compilation failed at line 42')).toBe('compilation')
    })

    it('matches tsc failed', () => {
      expect(classifyFailureReason('tsc failed with error')).toBe('compilation')
    })

    it('matches typescript error', () => {
      expect(classifyFailureReason('typescript error: type mismatch')).toBe('compilation')
    })

    it('matches type error', () => {
      expect(classifyFailureReason('type error: argument not compatible')).toBe('compilation')
    })

    it('matches build failed', () => {
      expect(classifyFailureReason('build failed during npm run build')).toBe('compilation')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('COMPILATION ERROR')).toBe('compilation')
      expect(classifyFailureReason('TypeScript Error')).toBe('compilation')
      expect(classifyFailureReason('BUILD FAILED')).toBe('compilation')
    })
  })

  describe('spawn pattern matching', () => {
    it('matches spawn failed', () => {
      expect(classifyFailureReason('spawn failed for process')).toBe('spawn')
    })

    it('matches failed to spawn', () => {
      expect(classifyFailureReason('failed to spawn child process')).toBe('spawn')
    })

    it('matches enoent', () => {
      expect(classifyFailureReason('error: enoent: file not found')).toBe('spawn')
    })

    it('matches command not found', () => {
      expect(classifyFailureReason('command not found: npm')).toBe('spawn')
    })

    it('matches case-insensitively', () => {
      expect(classifyFailureReason('SPAWN FAILED')).toBe('spawn')
      expect(classifyFailureReason('Failed To Spawn')).toBe('spawn')
      expect(classifyFailureReason('ENOENT')).toBe('spawn')
    })
  })

  describe('unknown fallback', () => {
    it('returns unknown for empty string', () => {
      expect(classifyFailureReason('')).toBe('unknown')
    })

    it('returns unknown for undefined', () => {
      expect(classifyFailureReason(undefined)).toBe('unknown')
    })

    it('returns unknown for unrecognized message', () => {
      expect(classifyFailureReason('something went wrong')).toBe('unknown')
    })

    it('returns unknown for null (via undefined coercion)', () => {
      expect(classifyFailureReason(undefined)).toBe('unknown')
    })

    it('returns unknown for whitespace-only string', () => {
      expect(classifyFailureReason('   ')).toBe('unknown')
    })
  })

  describe('registerFailurePattern API', () => {
    it('allows registering custom failure patterns', () => {
      registerFailurePattern({
        type: 'custom',
        keywords: ['custom error pattern']
      })
      expect(classifyFailureReason('custom error pattern occurred')).toBe('custom')
    })

    it('matches multiple custom patterns in order of registration', () => {
      registerFailurePattern({
        type: 'first_custom',
        keywords: ['first pattern']
      })
      registerFailurePattern({
        type: 'second_custom',
        keywords: ['second pattern']
      })
      expect(classifyFailureReason('first pattern')).toBe('first_custom')
      expect(classifyFailureReason('second pattern')).toBe('second_custom')
    })
  })

  describe('pattern precedence', () => {
    it('matches first pattern found in order', () => {
      // Both 'timeout' and 'test failed' could match but it should find one consistently
      const msg = 'timeout during test execution'
      const result = classifyFailureReason(msg)
      expect(['timeout', 'test_failure']).toContain(result)
    })

    it('handles messages with multiple keywords', () => {
      // Message contains both 'timeout' and 'invalid token'
      const msg = 'timeout: invalid token'
      const result = classifyFailureReason(msg)
      expect(['timeout', 'auth']).toContain(result)
    })
  })

  describe('environmental failures', () => {
    it('classifies main-repo-dirty as environmental', () => {
      expect(
        classifyFailureReason(
          'setupWorktree failed: Main repo has uncommitted changes (pre-ffMergeMain) — refusing to proceed. Dirty paths: ?? docs/'
        )
      ).toBe('environmental')
    })

    it('classifies missing repo configuration as environmental', () => {
      expect(classifyFailureReason('Repo "bde" is not configured in BDE settings')).toBe(
        'environmental'
      )
    })

    it('classifies credential-unavailable as environmental', () => {
      expect(classifyFailureReason('Claude credential unavailable (needs-login)')).toBe(
        'environmental'
      )
    })

    it('classifies git network errors as environmental', () => {
      expect(
        classifyFailureReason('fatal: unable to access https://github.com/: Could not resolve host')
      ).toBe('environmental')
    })

    it('leaves unambiguous spec-level failures classified correctly (not environmental)', () => {
      expect(classifyFailureReason('npm test failed')).toBe('test_failure')
      expect(classifyFailureReason('TypeScript error: cannot find name')).toBe('compilation')
    })

    it('falls through to unknown for unmatched strings', () => {
      expect(classifyFailureReason('some unrelated message')).toBe('unknown')
    })
  })
})
