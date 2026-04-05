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
      <NeonCard className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Success Rate by Spec Type</h3>
        <div className="text-gray-500 text-sm">Loading...</div>
      </NeonCard>
    )
  }

  if (data.length === 0) {
    return (
      <NeonCard className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Success Rate by Spec Type</h3>
        <div className="text-gray-500 text-sm">No completed tasks yet</div>
      </NeonCard>
    )
  }

  return (
    <NeonCard className="p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Success Rate by Spec Type</h3>
      <div className="space-y-3">
        {data.map((item, i) => {
          const displayName = item.spec_type === null ? 'Unknown' : item.spec_type
          const percentage = Math.round(item.success_rate * 100)

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-300 capitalize">
                    {displayName}
                  </span>
                  <span className="text-xs text-gray-400">
                    {item.done}/{item.total} ({percentage}%)
                  </span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </NeonCard>
  )
}
