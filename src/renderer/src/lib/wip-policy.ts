export function canLaunchTask(activeCount: number, maxConcurrent: number): boolean {
  return activeCount < maxConcurrent
}
