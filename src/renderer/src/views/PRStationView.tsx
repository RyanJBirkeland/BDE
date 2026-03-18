import { useState } from 'react'
import { FileCode2 } from 'lucide-react'
import { PRStationList } from '../components/pr-station/PRStationList'
import type { PullRequest } from '../lib/github-api'

export default function PRStationView() {
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null)

  return (
    <div className="pr-station">
      <div className="pr-station__list-panel">
        <PRStationList selectedPr={selectedPr} onSelectPr={setSelectedPr} />
      </div>
      <div className="pr-station__detail-panel">
        {selectedPr ? (
          <div className="pr-station__detail-placeholder">
            <FileCode2 size={32} strokeWidth={1} />
            <span className="pr-station__detail-title">
              #{selectedPr.number} — {selectedPr.title}
            </span>
            <span className="pr-station__detail-hint">Detail panel coming soon</span>
          </div>
        ) : (
          <div className="pr-station__empty-detail">
            <FileCode2 size={32} strokeWidth={1} />
            <span>Select a PR to view details</span>
          </div>
        )}
      </div>
    </div>
  )
}
