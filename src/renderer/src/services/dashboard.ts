export async function getCompletionsPerHour() {
  return window.api.dashboard?.completionsPerHour()
}

export async function getRecentEvents(count: number) {
  return window.api.dashboard?.recentEvents(count)
}

export async function getPrList() {
  return window.api.pr.getList()
}

export async function getDailySuccessRate(days: number) {
  return window.api.dashboard?.dailySuccessRate(days)
}

export async function getLoadAverage() {
  return window.api.system?.loadAverage()
}
