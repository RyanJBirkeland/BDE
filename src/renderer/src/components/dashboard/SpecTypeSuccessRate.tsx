import { useEffect, useState } from 'react'
import { NeonCard } from '../neon/NeonCard'
import type { SpecTypeSuccessRate as SpecTypeSuccessRateData } from '../../../../shared/types'

export function SpecTypeSuccessRate(): React.JSX.Element {
  const [data, setData] = useState<SpecTypeSuccessRateData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        const result = await window.api.sprint.getSuccessRateBySpecType()
        setData(result)
      } catch (err) {
        console.error('Failed to fetch success rate by spec type:', err)
      } finally {
        setLoading(false)
      }
    }

    void fetchData()
    const interval = setInterval(() => void fetchData(), 60000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <NeonCard>
        <h3 className="spec-rate__title">Success Rate by Spec Type</h3>
        <div className="spec-rate__empty">Loading...</div>
      </NeonCard>
    )
  }

  if (data.length === 0) {
    return (
      <NeonCard>
        <h3 className="spec-rate__title">Success Rate by Spec Type</h3>
        <div className="spec-rate__empty">No completed tasks yet</div>
      </NeonCard>
    )
  }

  return (
    <NeonCard>
      <h3 className="spec-rate__title">Success Rate by Spec Type</h3>
      <div className="spec-rate__list">
        {data.map((item, i) => {
          const displayName = item.spec_type === null ? 'Unknown' : item.spec_type
          const percentage = Math.round(item.success_rate * 100)

          return (
            <div key={i} className="spec-rate__row">
              <div className="spec-rate__info">
                <span className="spec-rate__label">{displayName}</span>
                <span className="spec-rate__value">
                  {item.done}/{item.total} ({percentage}%)
                </span>
              </div>
              <div className="spec-rate__track">
                <div className="spec-rate__bar" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </NeonCard>
  )
}
