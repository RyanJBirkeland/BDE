/**
 * OAuth token validation with caching to avoid filesystem reads on every
 * drain tick (F-t1-sysprof-5).
 *
 * Extracted from index.ts to reduce file size and isolate OAuth concerns.
 */

import { readFile, stat } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { homedir as home } from 'node:os'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../env-utils'
import type { Logger } from './types'

/**
 * How long to cache a successful token check (ms).
 * Short enough to still run the 45-min proactive refresh on cache expiry.
 */
export const OAUTH_CHECK_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * How long to cache a failed token check (ms).
 * Short enough to recover quickly if the user fixes the token.
 */
export const OAUTH_CHECK_FAIL_CACHE_TTL_MS = 30_000 // 30 seconds

let _oauthCheckResult: boolean | null = null
let _oauthCheckExpiry = 0

/**
 * Invalidate the OAuth token check cache.
 * Call after a forced refresh so the next drain cycle re-validates.
 */
export function invalidateCheckOAuthTokenCache(): void {
  _oauthCheckResult = null
  _oauthCheckExpiry = 0
}

/**
 * Check whether the OAuth token file exists and contains a valid token.
 * Returns true if the drain loop should proceed, false if it should skip.
 * Results are cached for OAUTH_CHECK_CACHE_TTL_MS to avoid a file read on
 * every drain tick (drain runs every ~5s; token validity changes at most once
 * per hour).
 */
export async function checkOAuthToken(logger: Logger): Promise<boolean> {
  const now = Date.now()
  if (_oauthCheckResult !== null && now < _oauthCheckExpiry) {
    return _oauthCheckResult
  }
  try {
    const tokenPath = joinPath(home(), '.bde', 'oauth-token')
    const token = (await readFile(tokenPath, 'utf-8')).trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[oauth-checker] OAuth token auto-refreshed from Keychain')
        _oauthCheckResult = true
        _oauthCheckExpiry = Date.now() + OAUTH_CHECK_CACHE_TTL_MS
        return true
      } else {
        logger.warn(
          '[oauth-checker] OAuth token file missing/empty and keychain refresh failed — skipping drain cycle'
        )
        _oauthCheckResult = false
        _oauthCheckExpiry = Date.now() + OAUTH_CHECK_FAIL_CACHE_TTL_MS
        return false
      }
    }

    // Proactively refresh if token file is older than 45 minutes
    // (Claude OAuth tokens expire after ~1 hour)
    try {
      const stats = await stat(tokenPath)
      const ageMs = Date.now() - stats.mtimeMs
      if (ageMs > 45 * 60 * 1000) {
        logger.info('[oauth-checker] Token file older than 45min — proactively refreshing')
        const refreshed = await refreshOAuthTokenFromKeychain()
        if (refreshed) {
          invalidateOAuthToken()
          logger.info('[oauth-checker] OAuth token proactively refreshed from Keychain')
        }
      }
    } catch {
      /* stat failed — continue with existing token */
    }

    _oauthCheckResult = true
    _oauthCheckExpiry = Date.now() + OAUTH_CHECK_CACHE_TTL_MS
    return true
  } catch {
    logger.warn('[oauth-checker] Cannot read OAuth token file — skipping drain cycle')
    _oauthCheckResult = false
    _oauthCheckExpiry = Date.now() + OAUTH_CHECK_FAIL_CACHE_TTL_MS
    return false
  }
}
