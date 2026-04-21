export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  const [, owner, repo, numberText] = match
  if (!owner || !repo || !numberText) return null
  return { owner, repo, number: parseInt(numberText, 10) }
}
