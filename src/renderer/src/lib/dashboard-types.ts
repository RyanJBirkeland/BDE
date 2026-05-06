import type { NeonAccent } from '../components/neon/types'

export interface FeedEvent {
  id: string
  label: string
  accent: NeonAccent
  timestamp: number
}

export interface DashboardStats {
  active: number
  queued: number
  blocked: number
  review: number
  done: number
  doneToday: number
  failed: number
  actualFailed: number
}

export interface ChartBar {
  value: number
  accent?: string | undefined
  label?: string | undefined
}
