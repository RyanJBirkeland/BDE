import './KPIStrip.css'
import React, { useMemo } from 'react'
import { MicroSpark } from './primitives/MicroSpark'
import { formatDurationMs } from '../../lib/format'
import type { ChartBar } from '../../lib/dashboard-types'
import type { DailySuccessRate } from '../../../../shared/ipc-channels'

interface KPIStripProps {
  successRate7dAvg: number | null
  successRateWeekDelta: number | null
  avgDuration: number | null
  tokenAvg: string | null
  tokenTrendData: ChartBar[]
  avgCostPerTask: number | null
  failureRate: number | null
  successTrendData: DailySuccessRate[]
}

interface KPICell {
  label: string
  value: string
  delta: string | null
  deltaGood: boolean
  sparkAccent: string
  sparkPoints: number[]
}

function buildKPICells(props: KPIStripProps): KPICell[] {
  const successPoints = props.successTrendData.map((d) => d.successRate ?? 0)
  const tokenPoints = props.tokenTrendData.map((d) => d.value)

  const successDelta =
    props.successRateWeekDelta != null
      ? `${props.successRateWeekDelta >= 0 ? '+' : ''}${props.successRateWeekDelta.toFixed(1)}%`
      : null

  const durationMs = props.avgDuration
  const durationStr = durationMs != null ? formatDurationMs(durationMs) : '--'
  const avgTokenStr = props.tokenAvg ?? '--'
  const costStr =
    props.avgCostPerTask != null ? `$${props.avgCostPerTask.toFixed(2)}` : '--'
  const failureStr =
    props.failureRate != null ? `${props.failureRate}%` : '--'
  const successStr =
    props.successRate7dAvg != null ? `${Math.round(props.successRate7dAvg)}%` : '--'

  return [
    {
      label: 'Success rate',
      value: successStr,
      delta: successDelta,
      deltaGood: (props.successRateWeekDelta ?? 0) >= 0,
      sparkAccent: 'done',
      sparkPoints: successPoints
    },
    {
      label: 'Avg duration',
      value: durationStr,
      delta: null,
      deltaGood: true,
      sparkAccent: 'running',
      sparkPoints: props.tokenTrendData.map((d) => d.value * 0.001) // proxy until duration series available
    },
    {
      label: 'Tokens / run',
      value: avgTokenStr,
      delta: null,
      deltaGood: true,
      sparkAccent: 'queued',
      sparkPoints: tokenPoints
    },
    {
      label: 'Cost / task',
      value: costStr,
      delta: null,
      deltaGood: true,
      sparkAccent: 'review',
      sparkPoints: props.tokenTrendData.map((d) => d.value * 0.000004) // proxy cost series
    },
    {
      label: 'Failure rate',
      value: failureStr,
      // failure rate delta is inverse of success — lower is better
      delta:
        props.successRateWeekDelta != null
          ? `${(-props.successRateWeekDelta) >= 0 ? '+' : ''}${(-props.successRateWeekDelta).toFixed(1)}%`
          : null,
      deltaGood: (props.successRateWeekDelta ?? 0) >= 0,
      sparkAccent: 'failed',
      sparkPoints: successPoints.map((s) => 100 - s)
    }
  ]
}

export function KPIStrip(props: KPIStripProps): React.JSX.Element {
  const {
    successRate7dAvg,
    successRateWeekDelta,
    avgDuration,
    tokenAvg,
    tokenTrendData,
    avgCostPerTask,
    failureRate,
    successTrendData
  } = props
  const cells = useMemo(
    () =>
      buildKPICells({
        successRate7dAvg,
        successRateWeekDelta,
        avgDuration,
        tokenAvg,
        tokenTrendData,
        avgCostPerTask,
        failureRate,
        successTrendData
      }),
    [
      successRate7dAvg,
      successRateWeekDelta,
      avgDuration,
      tokenAvg,
      tokenTrendData,
      avgCostPerTask,
      failureRate,
      successTrendData
    ]
  )

  return (
    <div className="kpi-strip">
      {cells.map((cell) => {
        const trendSuffix = cell.delta
          ? `, ${cell.deltaGood ? 'up' : 'down'} ${cell.delta} this week`
          : ''
        const cellLabel = `${cell.label}: ${cell.value}${trendSuffix}`
        return (
          <div
            key={cell.label}
            className="kpi-strip__cell"
            aria-label={cellLabel}
          >
            <span className="fleet-eyebrow">{cell.label}</span>
            <div className="kpi-strip__value-row">
              <span className="kpi-strip__value">{cell.value}</span>
              {cell.delta && (
                <span
                  className="kpi-strip__delta"
                  style={{ color: cell.deltaGood ? 'var(--st-done)' : 'var(--st-failed)' }}
                >
                  {cell.delta}
                </span>
              )}
            </div>
            <MicroSpark accent={cell.sparkAccent} points={cell.sparkPoints} />
          </div>
        )
      })}
    </div>
  )
}
