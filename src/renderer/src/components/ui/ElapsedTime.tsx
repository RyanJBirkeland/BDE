import { useNow } from '../../hooks/useNow'
import { formatElapsed } from '../../lib/format'

type ElapsedTimeProps = {
  startedAtMs: number
}

/**
 * Displays a live-updating elapsed-time string. Subscribes to the shared
 * 10-second `useNow` clock instead of registering its own per-instance timer,
 * so many on-screen ElapsedTime components share a single tick.
 */
export function ElapsedTime({ startedAtMs }: ElapsedTimeProps): React.JSX.Element {
  // Re-render when the shared clock advances; the value itself isn't needed.
  useNow()
  return <>{formatElapsed(startedAtMs)}</>
}
