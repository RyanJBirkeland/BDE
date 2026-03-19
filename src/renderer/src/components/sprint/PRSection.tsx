import { useState } from 'react'
import { PRList } from './PRList'

const STORAGE_KEY = 'bde-sprint-pr-collapsed'

export function PRSection() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // ignore
    }
  }

  return (
    <div className={`pr-section ${collapsed ? 'pr-section--collapsed' : ''}`}>
      <div className="pr-section__header" onClick={toggle}>
        <span className="pr-section__chevron">{'\u25BE'}</span>
        Open Pull Requests
      </div>
      <div className="pr-section__body">
        <PRList />
      </div>
    </div>
  )
}
