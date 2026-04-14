export async function getCompletionsPerHour(): ReturnType<
  NonNullable<typeof window.api.dashboard>['completionsPerHour']
> {
  return window.api.dashboard?.completionsPerHour()
}

export async function getRecentEvents(
  count: number
): ReturnType<NonNullable<typeof window.api.dashboard>['recentEvents']> {
  return window.api.dashboard?.recentEvents(count)
}

export async function getPrList(): ReturnType<typeof window.api.pr.getList> {
  return window.api.pr.getList()
}

export async function getDailySuccessRate(
  days: number
): ReturnType<NonNullable<typeof window.api.dashboard>['dailySuccessRate']> {
  return window.api.dashboard?.dailySuccessRate(days)
}

export async function getLoadAverage(): ReturnType<
  NonNullable<typeof window.api.system>['loadAverage']
> {
  return window.api.system?.loadAverage()
}
