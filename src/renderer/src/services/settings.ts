export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.getRepoPaths()
}
