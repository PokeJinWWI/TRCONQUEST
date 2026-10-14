import { Bi } from '../Bi'
import { useSeededBody } from '../../hooks/useSeededBody'
import { useMemo, useState } from 'react'
import { siteChoicesForBuilding, siteChoicesForLevel, type SiteChoice } from '../../scene/siteChoices'
import { RECIPES, isRural } from '../../economy/recipes'
import { useLensStore } from '../../state/lensStore'
import type { BuildingRef } from '../../scene/placement'

// The "where?" step of building (docs/territorial-design.md section 12): every site of the world that the building, or the district level, could
// go on, best first. A site the law or the ground rules out is listed with its reason (kept apart: "legal" and "ground"), never hidden.
export interface SiteRequest {
  bodyName: string
  builderId: string
  title: string
  // A building (Simple building id or Complex recipe id), or a district level.
  ref?: BuildingRef
  district?: string
}

const pct = (n: number) => `${Math.round(n * 100)}%`

function Row({ c, picked, onPick }: { c: SiteChoice; picked: boolean; onPick: () => void }) {
  const tip = [c.why, `Legal: ${c.legal}`, c.physical ? `Ground: ${c.physical}` : 'Ground: it fits', `Suitability ${pct(c.suitability)} · ${pct(c.access)} of its output reaches a hub`].join('\n')
  return (
    <button type="button" className={`pl-chooser-row${picked ? ' picked' : ''}${c.allowed ? '' : ' blocked'}`} disabled={!c.allowed} title={tip} onClick={onPick}>
      <span className="pl-chooser-name">{c.label}{c.best ? ' ★' : ''}</span>
      <span className="pl-chooser-meta">
        {c.owner ? c.owner : 'open ground'} · {c.room} · access {pct(c.access)}
      </span>
      {!c.allowed && <span className="econ-neg pl-chooser-why">{c.why}</span>}
    </button>
  )
}

export function SiteChooser({ request, onChoose, onCancel }: { request: SiteRequest; onChoose: (siteId: string) => void; onCancel: () => void }) {
  const ready = useSeededBody(request.bodyName)
  const choices = useMemo(
    () => (!ready ? [] : request.ref ? siteChoicesForBuilding(request.builderId, request.bodyName, request.ref) : siteChoicesForLevel(request.builderId, request.bodyName, request.district ?? '')),
    [ready, request.builderId, request.bodyName, request.ref?.id, request.ref?.mode, request.district],
  )
  const [picked, setPicked] = useState<string | null>(choices.find((c) => c.best)?.siteId ?? null)
  // A rural structure (a space-elevator anchor) stands on a node of its own, not on a site: it is placed with the build lens on the ground map.
  if (request.ref && isRural(request.ref.id)) {
    const label = RECIPES[request.ref.id]?.label ?? request.title
    return (
      <div className="pl-chooser" role="dialog" aria-label={request.title}>
        <div className="pl-chooser-title">{label}: where?</div>
        <div className="abs-dim">It stands on the ground map, outside any district{RECIPES[request.ref.id]?.allowSea ? ', on land or on a platform at sea,' : ''} on the equator, beneath the ring. Pick it up with the build lens (⚙) and click a spot.</div>
        <div className="pl-chooser-actions">
          <button type="button" className="laws-enact-btn" onClick={() => { useLensStore.getState().arm({ kind: 'building', id: request.ref!.id, name: label }); onCancel() }}>
            Arm the build lens
          </button>
          <button type="button" className="laws-enact-btn" onClick={onCancel}>
            <Bi en="Cancel" />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="pl-chooser" role="dialog" aria-label={request.title}>
      <div className="pl-chooser-title">{request.title}: where?</div>
      {choices.length === 0 && <div className="abs-dim">{request.bodyName} has no site this can go on.</div>}
      <div className="pl-chooser-list">
        {choices.map((c) => (
          <Row key={c.siteId} c={c} picked={picked === c.siteId} onPick={() => setPicked(c.siteId)} />
        ))}
      </div>
      <div className="pl-chooser-actions">
        <button type="button" className="laws-enact-btn" disabled={!picked} onClick={() => picked && onChoose(picked)}>
          <Bi en="Build here" />
        </button>
        <button type="button" className="laws-enact-btn" onClick={onCancel}>
          <Bi en="Cancel" />
        </button>
      </div>
    </div>
  )
}
