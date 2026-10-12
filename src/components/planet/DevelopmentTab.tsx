import { useMemo, useState } from 'react'
import { connectSite, expandSettlement } from '../../scene/aiDevelopment'
import { developmentView, type SiteRow } from '../../scene/territoryView'
import { useInfrastructureStore } from '../../state/infrastructureStore'
import { useLocationStore } from '../../state/locationStore'
import { usePlacementStore } from '../../state/placementStore'
import { usePlayerStore } from '../../state/playerStore'
import { useTerritoryStore } from '../../state/territoryStore'

// The planet screen's Development tab (both economy modes): the body's development sites, the buildings standing
// on them, the routes between them and the settlements they feed. Why a site can or cannot be built on is
// shown as TWO answers (the law's and the ground's), and a site's access says how much of what it makes gets out.

const LEGAL_TIP: Record<string, string> = {
  authorized: 'You may build here',
  treaty: 'Allowed by an agreement',
  'limited-right': 'A limited right: your provisional claim gives priority',
  contested: 'Allowed, but it is disputed: building here is a diplomatic incident',
  'needs-permission': 'The sovereign must give leave first',
  prohibited: 'Forbidden',
  'military-restricted': 'Armed force stands in the way for now',
}

function SiteLine({ s, playerId, onConnect, onFound }: { s: SiteRow; playerId: string | null; onConnect: (id: string) => void; onFound: (id: string) => void }) {
  const mine = s.owner !== null && playerId !== null
  const cutOff = s.access !== null && s.access < 0.99
  const tip = [
    `${s.kind} site · ${s.terrain ?? 'no ground'} · suitability ${Math.round(s.suitability * 100)}% · capacity ${s.capacity}`,
    s.holds ? `Holds: ${s.holds}` : '',
    s.forPlayer ? `Legal: ${s.forPlayer.legal} — ${LEGAL_TIP[s.forPlayer.legal] ?? ''}` : '',
    s.forPlayer?.physical ? `Physical: ${s.forPlayer.physical}` : s.forPlayer ? 'Physical: the ground allows it' : '',
    s.captured ? 'An enemy\'s ground forces hold this site: what stands here makes nothing for its owner while they do' : '',
    s.access !== null ? `Access: ${Math.round(s.access * 100)}% of its output reaches a hub` : '',
  ].filter(Boolean).join('\n')
  return (
    <div className="inspect-row" title={tip}>
      <span className="inspect-label">{s.id.slice(s.id.lastIndexOf('#') + 1)}{s.holds ? ` · ${s.holds}` : ''}</span>
      <span className="inspect-value">
        {s.owner ?? 'open'}
        {s.buildings.length > 0 && ` · ${s.buildings.map((b) => `${b.count}× ${b.id}`).join(', ')}`}
        {s.captured && <span className="econ-neg"> · held by the enemy</span>}
        {cutOff && !s.captured && <span className="econ-neg"> · {Math.round((s.access ?? 1) * 100)}% access</span>}
        {mine && cutOff && (
          <button type="button" className="detail-view-btn" title="Build the cheapest route to the nearest hub it can reach" onClick={() => onConnect(s.id)}>Connect</button>
        )}
        {s.kind === 'settlement' && !s.owner && s.forPlayer && (
          <button type="button" className="detail-view-btn" disabled={!['authorized', 'treaty', 'limited-right', 'contested'].includes(s.forPlayer.legal)} title={s.forPlayer.why} onClick={() => onFound(s.id)}>Found</button>
        )}
      </span>
    </div>
  )
}

export function DevelopmentTab({ bodyName }: { bodyName: string }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const placed = usePlacementStore((s) => s.placed)
  const established = useLocationStore((s) => s.established)
  const routes = useInfrastructureStore((s) => s.routes)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const [message, setMessage] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const view = useMemo(() => developmentView(bodyName, playerId), [bodyName, playerId, placed, established, routes, owners, version])

  const connect = (siteId: string) => {
    if (!playerId) return
    const r = connectSite(playerId, siteId)
    setMessage(r.ok ? 'Route started.' : r.reason)
    setVersion((v) => v + 1)
  }
  const found = (siteId: string) => {
    if (!playerId) return
    const r = expandSettlement(playerId, siteId)
    setMessage(r.ok ? 'Settlement founded.' : r.reason)
    setVersion((v) => v + 1)
  }

  const byKind = ['settlement', 'resource', 'industrial', 'infrastructure', 'strategic']
  return (
    <div className="development-tab">
      <div className="inspect-divider" />
      {view.settlements.length > 0 && (
        <>
          <div className="inspect-label" title="Cities grow from people, work and roads: a tier needs population, room and transport access together">Settlements</div>
          {view.settlements.map((s) => (
            <div key={s.id} className="inspect-row" title={s.next ? `Next: ${s.next}` : 'As large as this site can get'}>
              <span className="inspect-label">{s.id.slice(s.id.lastIndexOf('#') + 1)}</span>
              <span className="inspect-value">
                {s.tier} · {s.population}M{s.specializations.length > 0 ? ` · ${s.specializations.join(', ')}` : ''}
                {s.overcrowded && <span className="econ-neg"> · overcrowded</span>}
              </span>
            </div>
          ))}
          <div className="inspect-divider" />
        </>
      )}
      {byKind.map((kind) => {
        const rows = view.sites.filter((s) => s.kind === kind)
        if (rows.length === 0) return null
        return (
          <div key={kind}>
            <div className="inspect-label">{kind[0].toUpperCase() + kind.slice(1)} sites</div>
            {rows.map((s) => (
              <SiteLine key={s.id} s={s} playerId={playerId} onConnect={connect} onFound={found} />
            ))}
          </div>
        )
      })}
      {view.routes.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-label" title="Routes carry freight from sites to hubs; unpaid upkeep puts one in disrepair (half capacity)">Routes</div>
          {view.routes.map((r) => (
            <div key={r.id} className="inspect-row" title={r.between}>
              <span className="inspect-label">{r.kind} · {r.owner}</span>
              <span className="inspect-value">{r.cells} cells{r.working ? '' : ' · building'}{r.open ? '' : ' · private'}{r.disrepair ? ' · disrepair' : ''}</span>
            </div>
          ))}
        </>
      )}
      {message && <div className="inspect-status">{message}</div>}
    </div>
  )
}
