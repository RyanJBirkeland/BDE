import { VIEW_REGISTRY } from '../../lib/view-registry'
import type { View } from '../../lib/view-types'

function isView(value: unknown): value is View {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VIEW_REGISTRY, value)
}

/**
 * Parses the `?restore=` URL parameter that carries a tear-off window's
 * remembered tab list. Invalid view keys are dropped silently; a malformed or
 * empty payload falls back to `[fallback]` so the window always opens with at
 * least one tab.
 */
export function parseRestoreParam(restoreParam: string, fallback: View): View[] {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(restoreParam))
    if (!Array.isArray(parsed)) return [fallback]
    const filtered = parsed.filter(isView)
    return filtered.length > 0 ? filtered : [fallback]
  } catch {
    return [fallback]
  }
}
