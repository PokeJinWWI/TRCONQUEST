import { useSeededBody } from '../../hooks/useSeededBody'
import { useMemo, useState } from 'react'
import { areaView, type AreaSite } from '../../scene/areaView'
import { useAbstractEconomyStore } from '../../state/abstractEconomyStore'
import { useCivicDetailStore, useCivicStore } from '../../state/civicStore'
import { useEconomyStore } from '../../state/economyStore'
import { useLocationStore } from '../../state/locationStore'
import { usePlacementStore } from '../../state/placementStore'
import { isAbstractEconomy } from '../../state/playerStore'
import type { SimpleBuildingId, SimpleDistrictId } from '../../data/simplisticEconomyData'
import type { DistrictType } from '../../economy/recipes'
import { KEY_BUILDING_ICON } from '../../scene/keyBuildings'
import { PlanetIcon } from './PlanetIcons'

// The Districts & Buildings tab BY AREA (docs/territorial-design.md section 12): each settlement and site of the world as a card holding its own districts,
// its buildings, its civic buildings and what is on order there. Building here needs no "where?" step: the site is the place you are
// looking at. The master list by district is the other view; both build through the same rules.

const pct = (n: number) => `${Math.round(n * 100)}%`

function SiteCard({ s, bodyName, playerId, onMessage }: { s: AreaSite; bodyName: string; playerId: string | null; onMessage: (m: string | null) => void }) {
  const [building, setBuilding] = useState(false)
  const simple = isAbstractEconomy()
  const queueBuilding = useAbstractEconomyStore((st) => st.queueBuilding)
  const queueDistrictSimple = useAbstractEconomyStore((st) => st.queueDistrict)
  const queueConstruction = useEconomyStore((st) => st.queueConstruction)
  const queueDistrictComplex = useEconomyStore((st) => st.queueDistrict)

  const develop = (district: string) => {
    if (!playerId) return
    if (simple) {
      const r = queueDistrictSimple(playerId, bodyName, district as SimpleDistrictId, s.siteId)
      onMessage(r.ok ? null : r.reason)
    } else {
      queueDistrictComplex(bodyName, district as DistrictType, s.siteId)
      onMessage(null)
    }
  }
  const build = (id: string) => {
    if (!playerId) return
    if (simple) {
      const r = queueBuilding(playerId, bodyName, id as SimpleBuildingId, s.siteId)
      onMessage(r.ok ? null : r.reason)
    } else {
      queueConstruction(bodyName, id, { kind: 'state' }, s.siteId)
      onMessage(null)
    }
    setBuilding(false)
  }
  const mineOrOpen = s.mine || (!s.owner && !!playerId)
  return (
    <div className={`pl-district pl-site-card${s.captured ? ' captured' : ''}`}>
      <div className="pl-district-head" title={`${s.kind} site · ${s.terrain ?? 'no ground'} · suitability ${pct(s.suitability)}${s.holds ? ` · holds ${s.holds}` : ''}`}>
        <span className="pl-district-name">{s.label}</span>
        <span className="pl-district-slots">{s.owner ?? 'open ground'}</span>
        {s.captured && <span className="econ-neg"> held by the enemy</span>}
        {!s.captured && s.access !== null && s.access < 0.99 && <span className="econ-neg" title="Share of what is made here that reaches a hub"> {pct(s.access)} access</span>}
      </div>
      {s.districts.length > 0 && (
        <div className="pl-site-districts">
          {s.districts.map((d) => (
            <span key={d.district} className="pl-site-district" title={`${d.levels} developed level${d.levels === 1 ? '' : 's'}: ${d.used} of ${d.slots} building slots used`}>
              {d.label} Lv {d.levels} <span className="abs-dim">{d.used}/{d.slots}</span>
            </span>
          ))}
        </div>
      )}
      <div className="pl-grid">
        {s.civic.map((c) => (
          <button key={c.id} type="button" className="pl-tile pl-key-tile" title={`${c.name}\n${c.description}`} onClick={() => useCivicDetailStore.getState().openBuilding(bodyName, c.id)}>
            <PlanetIcon id={KEY_BUILDING_ICON[c.kind]} size={20} />
            <span className="pl-tile-name">{c.name}</span>
          </button>
        ))}
        {s.buildings.map((b) => (
          <div key={b.id} className="pl-tile" title={`${b.count} × ${b.name}`}>
            <PlanetIcon id={b.id} size={18} />
            <span className="pl-tile-name">{b.name}{b.count > 1 ? ` ×${b.count}` : ''}</span>
          </div>
        ))}
        {s.onOrder.map((o, i) => (
          <div key={i} className="pl-tile queued" title="On order here">
            <span className="pl-tile-name">{o.name} …</span>
          </div>
        ))}
      </div>
      {mineOrOpen && (
        <div className="pl-site-actions">
          {s.canDevelop.map((d) => (
            <button key={d.district} type="button" className="pl-develop" disabled={s.levelRoom <= 0} title={s.levelRoom > 0 ? `Develop another ${d.label} level at ${s.label}` : 'This site has no room for another level'} onClick={() => develop(d.district)}>
              + {d.label} level
            </button>
          ))}
          {s.canBuild.length > 0 && (
            <button type="button" className="pl-develop" onClick={() => setBuilding(!building)} title="Build here">
              + Build
            </button>
          )}
        </div>
      )}
      {building && (
        <div className="pl-picker">
          {s.canBuild.map((b) => (
            <button key={`${b.district}-${b.id}`} type="button" className="pl-pick" disabled={!!b.blocked} title={b.blocked ?? `Build a ${b.name} at ${s.label}`} onClick={() => build(b.id)}>
              <PlanetIcon id={b.id} size={16} />
              <span>{b.name}</span>
              {b.blocked && <span className="abs-dim">{b.blocked}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AreaView({ bodyName, playerId }: { bodyName: string; playerId: string | null }) {
  const placed = usePlacementStore((s) => s.placed)
  const levels = usePlacementStore((s) => s.levels)
  const established = useLocationStore((s) => s.established)
  const civic = useCivicStore((s) => s.civic[bodyName])
  const simpleQueue = useAbstractEconomyStore((s) => s.byCountry)
  const complexWorlds = useEconomyStore((s) => s.worlds)
  const [message, setMessage] = useState<string | null>(null)
  const ready = useSeededBody(bodyName)
  const view = useMemo(() => (ready ? areaView(bodyName, playerId) : { bodyName, sections: [], unplaced: [] }), [ready, bodyName, playerId, placed, levels, established, civic, simpleQueue, complexWorlds])
  return (
    <div className="pl-districts pl-area">
      {message && <div className="econ-neg pl-message">{message}</div>}
      {view.sections.map((sec) => (
        <div key={sec.kind}>
          <div className="econ-subtitle">{sec.title}</div>
          {sec.sites.map((s) => (
            <SiteCard key={s.siteId} s={s} bodyName={bodyName} playerId={playerId} onMessage={setMessage} />
          ))}
        </div>
      ))}
      {view.unplaced.length > 0 && (
        <div className="abs-dim" title="Buildings the world has that no site holds (built before sites existed, or that found no developed slot)">
          Not on any site: {view.unplaced.map((b) => `${b.count}× ${b.name}`).join(', ')}
        </div>
      )}
    </div>
  )
}
