import { useCallback, useEffect, useState } from 'react'
import { invokeTool } from '../lib/rpc'

interface SessionWithTokens {
  key: string
  model: string
  displayName: string
  updatedAt: number
  totalTokens: number
  contextTokens: number
}

// Claude Sonnet 4.6 pricing
const INPUT_COST_PER_TOKEN = 3 / 1_000_000
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000

function calcCost(input: number, output: number): number {
  return input * INPUT_COST_PER_TOKEN + output * OUTPUT_COST_PER_TOKEN
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

function isWithinHours(updatedAt: number, hours: number): boolean {
  const cutoff = Date.now() - hours * 60 * 60 * 1000
  return updatedAt >= cutoff
}

export default function CostView(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionWithTokens[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    try {
      const data = (await invokeTool('sessions_list')) as {
        sessions: SessionWithTokens[]
        count: number
      }
      setSessions(data.sessions ?? [])
    } catch {
      // silently fail — will retry
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 30_000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const sessionsWithCost = sessions
    .map((s) => {
      const inputTokens = s.contextTokens ?? 0
      const outputTokens = Math.max(0, (s.totalTokens ?? 0) - inputTokens)
      return {
        ...s,
        inputTokens,
        outputTokens,
        cost: calcCost(inputTokens, outputTokens)
      }
    })
    .sort((a, b) => b.cost - a.cost)

  const todaySessions = sessionsWithCost.filter((s) => isWithinHours(s.updatedAt, 24))
  const weekSessions = sessionsWithCost.filter((s) => isWithinHours(s.updatedAt, 24 * 7))

  const todayCost = todaySessions.reduce((sum, s) => sum + s.cost, 0)
  const weekCost = weekSessions.reduce((sum, s) => sum + s.cost, 0)

  if (loading) {
    return (
      <div className="cost-view">
        <div className="cost-view__loading">Loading cost data...</div>
      </div>
    )
  }

  return (
    <div className="cost-view">
      <div className="cost-view__header">
        <h2 className="cost-view__title">Cost Tracker</h2>
      </div>

      <div className="cost-view__cards">
        <div className="cost-card">
          <span className="cost-card__label">Today&apos;s Cost</span>
          <span className="cost-card__value">{formatCost(todayCost)}</span>
        </div>
        <div className="cost-card">
          <span className="cost-card__label">This Week</span>
          <span className="cost-card__value">{formatCost(weekCost)}</span>
        </div>
        <div className="cost-card">
          <span className="cost-card__label">Total Sessions</span>
          <span className="cost-card__value">{sessions.length}</span>
        </div>
      </div>

      {sessionsWithCost.length === 0 ? (
        <div className="cost-view__empty">No sessions found</div>
      ) : (
        <div className="cost-view__table-wrap">
          <table className="cost-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Model</th>
                <th className="cost-table__num">Input Tokens</th>
                <th className="cost-table__num">Output Tokens</th>
                <th className="cost-table__num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessionsWithCost.map((s) => (
                <tr key={s.key}>
                  <td className="cost-table__session">
                    <span className="cost-table__key">{s.displayName || s.key}</span>
                  </td>
                  <td className="cost-table__model">{s.model}</td>
                  <td className="cost-table__num">{s.inputTokens.toLocaleString()}</td>
                  <td className="cost-table__num">{s.outputTokens.toLocaleString()}</td>
                  <td className="cost-table__num cost-table__cost">{formatCost(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
