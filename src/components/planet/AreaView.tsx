import { useSeededBody } from '../../hooks/useSeededBody'
import { useMemo, useState } from 'react'
import { areaView, type AreaSite } from '../../scene/areaView'
import { useAbstractEconomyStore } from '../../state/abstractEconomyStore'
import { useCivicDetailStore, useCivicStore } from '../../state/civicStore'
import { useEconomyStore } from '../../state/economyStore'
import { useLocationStore } from '../../state/locationStore'
import { usePlacementStore } from '../../state/placementStore'
import { isAbstractEconomy } from '../../state/playerStore'
import { freeLandOfWorld } from '../../economy/districts'
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

  // Develops one more level of a district here. Returns false (with the reason shown) when it was refused.
  const develop = (district: string): boolean => {
    if (!playerId) return false
    if (simple) {
      const r = queueDistrictSimple(playerId, bodyName, district as SimpleDistrictId, s.siteId)
      onMessage(r.ok ? null : r.reason)
      return r.ok
    }
    // Complex refuses without a word, so the reason is worked out here, from the same figure it checks.
    const left = freeLandOfWorld(useEconomyStore.getState().worlds.find((w) => w.id === bodyName) ?? { districtCapacity: {}, districts: {}, land: 0, constructionQueue: [] } as never)
    if (left <= 0) {
      onMessage(`${bodyName} has no land left for another district level.`)
      return false
    }
    queueDistrictComplex(bodyName, district as DistrictType, s.siteId)
    onMessage(null)
    return true
  }
  // Builds here. A building whose district is not yet developed at this place develops one level first.
  const build = (id: string, district: string, developed: boolean) => {
    if (!playerId) return
    if (!developed && !develop(district)) return
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
      {s.districts.length > 0 ? (
        <div className="pl-site-districts">
          {s.districts.map((d) => (
            <span key={d.district} className="pl-site-district" title={`${d.levels} developed level${d.levels === 1 ? '' : 's'} of ${d.label}: ${d.used} of ${d.slots} building slots used`}>
              {d.label}: level {d.levels} <span className="abs-dim">· {d.used}/{d.slots} slots used</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="abs-dim pl-land">No districts here yet. Building something develops the district it needs.</div>
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
      {mineOrOpen && s.canBuild.length > 0 && (
        <div className="pl-site-actions">
          <button type="button" className="pl-develop" onClick={() => setBuilding(!building)} title={`Build something at ${s.label}. If its district is not developed here yet, one level is developed first.`}>
            {building ? '− Close' : '+ Build here'}
          </button>
          {s.canDevelop.length > 0 && s.districts.length > 0 && s.canDevelop.map((d) => (
            <button key={d.district} type="button" className="pl-develop" disabled={s.levelRoom <= 0} title={s.levelRoom > 0 ? `Develop another ${d.label} level at ${s.label}` : 'This site has no room for another level'} onClick={() => develop(d.district)}>
              + {d.label} level
            </button>
          ))}
        </div>
      )}
      {building && (
        <div className="pl-picker">
          {[...new Set(s.canBuild.map((b) => b.district))].map((district) => {
            const rows = s.canBuild.filter((b) => b.district === district)
            const label = s.canDevelop.find((d) => d.district === district)?.label ?? district
            return (
              <div key={district}>
                <div className="abs-dim">{label}{rows[0].developed ? '' : ' (develops a level first)'}</div>
                {rows.map((b) => (
                  <button key={`${district}-${b.id}`} type="button" className="pl-pick" disabled={!!b.blocked} title={b.blocked ?? (b.developed ? `Build a ${b.name} at ${s.label}` : `Develop a ${label} level at ${s.label}, then build a ${b.name}`)} onClick={() => build(b.id, district, b.developed)}>
                    <PlanetIcon id={b.id} size={16} />
                    <span>{b.name}</span>
                    {b.blocked && <span className="abs-dim">{b.blocked}</span>}
                  </button>
                ))}
              </div>
            )
          })}
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
  const view = useMemo(() => (ready ? areaView(bodyName, playerId) : { bodyName, landLeft: null, sections: [], standalone: [], unplaced: [] }), [ready, bodyName, playerId, placed, levels, established, civic, simpleQueue, complexWorlds])
  return (
    <div className="pl-districts pl-area">
      <div className="abs-dim pl-land">
        Each card is a place on {bodyName}. Press <b>+ Build here</b> on any of yours: the district it needs is developed for you.
        {view.landLeft !== null && <> Room for <b>{Math.max(0, view.landLeft)}</b> more district level{view.landLeft === 1 ? '' : 's'} on this world.</>}
      </div>
      {message && <div className="econ-neg pl-message">{message}</div>}
      {view.sections.map((sec) => {
        const used = (s: AreaSite) => s.districts.length > 0 || s.buildings.length > 0 || s.onOrder.length > 0 || s.civic.some((c) => c.kind !== 'cityHall')
        const active = sec.sites.filter(used)
        const idle = sec.sites.filter((s) => !used(s))
        return (
          <div key={sec.kind}>
            <div className="econ-subtitle">{sec.title}</div>
            {active.map((s) => (
              <SiteCard key={s.siteId} s={s} bodyName={bodyName} playerId={playerId} onMessage={setMessage} />
            ))}
            {idle.length > 0 && (
              <details open={active.length === 0}>
                <summary className="abs-dim" title="Places you could build on but nothing is developed or built there yet">{idle.length} undeveloped</summary>
                {idle.map((s) => (
                  <SiteCard key={s.siteId} s={s} bodyName={bodyName} playerId={playerId} onMessage={setMessage} />
                ))}
              </details>
            )}
          </div>
        )
      })}
      {view.standalone.length > 0 && (
        <div>
          <div className="econ-subtitle" title="Buildings that stand on their own ground, in no area: a spaceport can go anywhere">Standalone buildings</div>
          <div className="pl-district">
            <div className="pl-grid">
              {view.standalone.map((b) => (
                <div key={b.id} className="pl-tile" title={`${b.count} × ${b.name}`}>
                  <PlanetIcon id={b.id} size={18} />
                  <span className="pl-tile-name">{b.name}{b.count > 1 ? ` ×${b.count}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {view.unplaced.length > 0 && (
        <div className="abs-dim" title="Buildings the world has that no site holds (built before sites existed, or that found no developed slot)">
          Not on any site: {view.unplaced.map((b) => `${b.count}× ${b.name}`).join(', ')}
        </div>
      )}
    </div>
  )
}
