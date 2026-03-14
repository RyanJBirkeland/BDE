import { useState, useEffect, useCallback } from 'react'
import DiffViewer from '../components/diff/DiffViewer'
import { parseDiff } from '../lib/diff-parser'
import type { DiffFile } from '../lib/diff-parser'

function DiffView(): React.JSX.Element {
  const [repos, setRepos] = useState<Record<string, string>>({})
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getRepoPaths().then((paths) => {
      setRepos(paths)
      const first = Object.keys(paths)[0]
      if (first) setSelectedRepo(first)
    })
  }, [])

  const loadDiff = useCallback(async () => {
    if (!selectedRepo || !repos[selectedRepo]) return
    const repoPath = repos[selectedRepo]
    setLoading(true)
    try {
      const [diffRaw, branchName] = await Promise.all([
        window.api.getDiff(repoPath),
        window.api.getBranch(repoPath)
      ])
      setFiles(parseDiff(diffRaw))
      setBranch(branchName)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load diff')
    } finally {
      setLoading(false)
    }
  }, [selectedRepo, repos])

  useEffect(() => {
    loadDiff()
  }, [loadDiff])

  // Auto-refresh every 60s
  useEffect(() => {
    const timer = setInterval(loadDiff, 60_000)
    return () => clearInterval(timer)
  }, [loadDiff])

  const repoNames = Object.keys(repos)

  const ghPrUrl = selectedRepo
    ? `https://github.com/RyanJBirkeland/${selectedRepo}/pull/new/${branch}`
    : null

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <div className="diff-view__repos">
          {repoNames.map((name) => (
            <button
              key={name}
              className={`diff-view__chip ${selectedRepo === name ? 'diff-view__chip--active' : ''}`}
              onClick={() => setSelectedRepo(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="diff-view__meta">
          {branch && <span className="diff-view__branch">{branch}</span>}
          {ghPrUrl && branch && (
            <a
              className="diff-view__pr-link"
              href={ghPrUrl}
              onClick={(e) => {
                e.preventDefault()
                window.open(ghPrUrl)
              }}
            >
              View PR &rarr;
            </a>
          )}
          <button
            className="diff-view__refresh"
            onClick={loadDiff}
            disabled={loading}
            title="Refresh diff"
          >
            &#x21bb;
          </button>
        </div>
      </div>
      {error && <div className="diff-view__error">{error}</div>}
      {loading ? (
        <div className="diff-view__loading">Loading diff&hellip;</div>
      ) : (
        <DiffViewer files={files} />
      )}
    </div>
  )
}

export default DiffView
