/**
 * Returns current timestamp in ISO 8601 format.
 * Centralized for DRY compliance and test-time injection.
 */
export function nowIso(): string {
  return new Date().toISOString()
}

export const MS_PER_HOUR = 60 * 60 * 1000
export const MS_PER_DAY = 24 * MS_PER_HOUR
