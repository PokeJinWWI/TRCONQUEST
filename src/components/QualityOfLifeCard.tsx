import { Bi } from './Bi'
import { useMemo } from 'react'
import { useSeededBody } from '../hooks/useSeededBody'
import { nationQualityOfLifeNow, qualityOfLifeNow } from '../scene/qualityOfLifeNow'
import type { QolIndicator } from '../scene/qualityOfLife'
import { useThrottledSimDays } from '../hooks/useThrottledSimDays'

// Quality of life: shown beside the standard of living, never part of it. One row per indicator with a bar; hover for the reason.
function Rows({ rows }: { rows: QolIndicator[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className="inspect-row" title={r.note}>
          <span className="inspect-label">{r.label}</span>
          <span className="inspect-value">
            {r.value === null ? <span className="abs-dim">{r.id === 'rights' ? 'not yet in the game' : 'n/a'}</span> : (
              <span className={r.value < 0.4 ? 'econ-neg' : undefined}>{Math.round(r.value * 100)}%</span>
            )}
          </span>
        </div>
      ))}
    </>
  )
}

export function QualityOfLifeCard({ bodyName }: { bodyName: string }) {
  const day = Math.floor(useThrottledSimDays() / 30)
  // Read after the body's starting settlements have been assigned to their sites.
  const ready = useSeededBody(bodyName)
  const rows = useMemo(() => (ready ? qualityOfLifeNow(bodyName) : null), [bodyName, day, ready])
  if (!rows) return null
  return (
    <div className="qol-card">
      <div className="inspect-divider" />
      <div className="inspect-label" title="How pleasant this world is to live on, apart from what its people can buy. Shown beside the standard of living; it is not part of it."><Bi en="Quality of life" /></div>
      <Rows rows={rows} />
    </div>
  )
}

export function NationQualityOfLifeCard({ nationId }: { nationId: string }) {
  const day = Math.floor(useThrottledSimDays() / 30)
  const rows = useMemo(() => nationQualityOfLifeNow(nationId), [nationId, day])
  return (
    <div className="qol-card">
      <div className="inspect-divider" />
      <div className="inspect-label" title="The nation's worlds averaged by population. Shown beside the standard of living; it is not part of it."><Bi en="Quality of life (nation)" /></div>
      <Rows rows={rows} />
    </div>
  )
}
