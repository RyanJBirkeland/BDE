import { useState, useEffect } from 'react'

export function useGitHubStatus(): { configured: boolean } {
  const [configured, setConfigured] = useState(true) // optimistic default

  useEffect(() => {
    window.api.github
      .isConfigured()
      .then(setConfigured)
      .catch(() => setConfigured(false))
  }, [])

  return { configured }
}
