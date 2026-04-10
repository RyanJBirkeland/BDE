/**
 * UI and window management IPC channels.
 */

/** Window shell integration */
export interface WindowChannels {
  'window:openExternal': {
    args: [url: string]
    result: void
  }
  'playground:openInBrowser': {
    args: [html: string]
    result: string
  }
}

/** Tear-off window management */
export interface TearoffChannels {
  'tearoff:create': {
    args: [
      {
        view: string
        screenX: number
        screenY: number
        sourcePanelId: string
        sourceTabIndex: number
      }
    ]
    result: { windowId: string }
  }
  'tearoff:closeConfirmed': {
    args: [{ action: 'return' | 'close'; remember: boolean }]
    result: void
  }
  'tearoff:startCrossWindowDrag': {
    args: [{ windowId: string; viewKey: string }]
    result: { targetFound: boolean }
  }
}

/** Dev Playground operations */
export interface PlaygroundChannels {
  'playground:show': {
    args: [input: { filePath: string; rootPath: string }]
    result: void
  }
}

/** Dashboard analytics */
export interface CompletionBucket {
  hour: string
  successCount: number
  failedCount: number
}

export interface DashboardEvent {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
  task_title: string | null
}

export interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

export interface DashboardChannels {
  'agent:completionsPerHour': { args: []; result: CompletionBucket[] }
  'agent:recentEvents': { args: [limit?: number]; result: DashboardEvent[] }
  'dashboard:dailySuccessRate': { args: [days?: number]; result: DailySuccessRate[] }
}
