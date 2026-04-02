import { useState, useEffect } from 'react'
import { formatElapsed } from '../../lib/format'

type ElapsedTimeProps = {
  startedAtMs: number
}

export function ElapsedTime({ startedAtMs }: ElapsedTimeProps) {
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [startedAtMs])

  return <>{formatElapsed(startedAtMs)}</>
}
