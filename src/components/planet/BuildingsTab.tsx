import { Bi } from '../Bi'
import { useSeededBody } from '../../hooks/useSeededBody'
import { useEffect, useMemo, useRef, useState } from 'react'
import { areaView, type AreaDistrict, type AreaSite } from '../../scene/buildingsView'
import { useAbstractEconomyStore } from '../../state/abstractEconomyStore'
import { useBuildingDetailStore } from '../../state/buildingDetailStore'
import { useCivicDetailStore, useCivicStore } from '../../state/civicStore'
import { useEconomyStore } from '../../state/economyStore'
import { useStructureStore } from '../../state/structureStore'
import { useLocationStore } from '../../state/locationStore'
import { usePlacementStore } from '../../state/placementStore'
import { isAbstractEconomy } from '../../state/playerStore'
import type { SimpleBuildingId, SimpleDistrictId } from '../../data/simplisticEconomyData'
import { RECIPES, DISTRICT_LABELS, type DistrictType } from '../../economy/recipes'
import { useTerritoryStore } from '../../state/territoryStore'
import { SIMPLE_BUILDING_DEFS } from '../../data/simplisticEconomyData'
import { ForeignHoldingsRow } from './ForeignHoldings'
import { BuildingsPanel } from '../BuildingsPanel'
import { KEY_BUILDING_ICON } from '../../scene/keyBuildings'
import { PlanetIcon, buildingIconId } from './PlanetIcons'
import { StandaloneSection } from './StandaloneSection'

// The Buildings tab of a world (docs/territorial-design.md section 14): every settlement and site as a card, and in it each district that
// stands there (Core, Urban, Industrial, ...) with its own buildings. A building belongs to its place: two factories here are one Factory at
// level 2; two in another place are another Factory at level 2. Building needs no "where?" step: the place is the card you are looking at.
// Both economies use this tab.

// Complex icons are per building group, Simple's per building.
const iconOf = (id: string): string => buildingIconId(id)

const pct = (n: number) => `${Math.round(n * 100)}%`

function DistrictBlock({ d, s, bodyName, playerId, canAct, onMessage, highlight }: { d: AreaDistrict; s: AreaSite; bodyName: string; playerId: string | null; canAct: boolean; onMessage: (m: string | null) => void; highlight: string | null }) {
  const [picking, setPicking] = useState(false)
  const simple = isAbstractEconomy()
  const queueBuilding = useAbstractEconomyStore((st) => st.queueBuilding)
  const queueDistrictSimple = useAbstractEconomyStore((st) => st.queueDistrict)
  const queueConstruction = useEconomyStore((st) => st.queueConstruction)
  const queueDistrictComplex = useEconomyStore((st) => st.queueDistrict)
  const rows = s.canBuild.filter((b) => b.district === d.district)
  const canDevelopMore = s.canDevelop.some((x) => x.district === d.district)

  // Develops one more level of this district here. Returns false, with the reason shown, when it was refused.
  const develop = (): boolean => {
    if (!playerId) return false
    const r = simple ? queueDistrictSimple(playerId, bodyName, d.district as SimpleDistrictId, s.siteId) : queueDistrictComplex(bodyName, d.district as DistrictType, s.siteId)
    onMessage(r.ok ? null : r.reason)
    return r.ok
  }
  // Builds here. A district not yet developed at this place develops one level first.
  const build = (id: string, developed: boolean) => {
    if (!playerId) return
    if (!developed && !develop()) return
    const r = simple ? queueBuilding(playerId, bodyName, id as SimpleBuildingId, s.siteId) : queueConstruction(bodyName, id, { kind: 'state' }, s.siteId)
    onMessage(r.ok ? null : r.reason)
    if (r.ok) setPicking(false)
  }
  const openBuilding = (b: AreaDistrict['buildings'][number]) => {
    if (!b.buildingId) return
    useBuildingDetailStore.getState().openBuilding(bodyName, b.buildingId)
  }
  return (
    <div className="pl-site-district-block">
      <div className="pl-site-districts">
        <span className="pl-site-district" title={`${d.levels} developed level${d.levels === 1 ? '' : 's'} of ${d.label}: ${d.used} of ${d.slots} building slots used`}>
          <b>{d.label}</b> Lv {d.levels} <span className="abs-dim">· {d.used}/{d.slots} slots</span>
        </span>
        {canAct && canDevelopMore && (
          <button type="button" className="pl-develop" disabled={s.levelRoom <= 0} title={s.levelRoom > 0 ? `Develop another ${d.label} level at ${s.label}` : 'This site has no room for another level'} onClick={() => develop()}>
            + level
          </button>
        )}
        {canAct && rows.length > 0 && (
          <button type="button" className="pl-develop" onClick={() => setPicking(!picking)} title={`Build a ${d.label} building at ${s.label}${d.levels === 0 ? '. A level is developed first.' : ''}`}>
            {picking ? '− Close' : '+ Build'}
          </button>
        )}
      </div>
      <div className="pl-grid">
        {d.district === 'core' && s.civic.map((c) => (
          <button key={c.id} type="button" className="pl-tile pl-key-tile" title={`${c.name}\n${c.description}`} onClick={() => useCivicDetailStore.getState().openBuilding(bodyName, c.id)}>
            <PlanetIcon id={KEY_BUILDING_ICON[c.kind]} size={20} />
            <span className="pl-tile-name">{c.name}</span>
          </button>
        ))}
        {d.buildings.map((b) => (
          <button key={b.id} type="button" className={`pl-tile${highlight === b.id ? ' pl-highlight' : ''}`} disabled={!b.buildingId} title={`${b.name}: level ${b.count} at ${s.label}`} onClick={() => openBuilding(b)}>
            <PlanetIcon id={iconOf(b.id)} size={18} />
            <span className="pl-tile-name">{b.name} Lv {b.count}</span>
          </button>
        ))}
        {s.onOrder.filter((o) => o.what === 'building' && o.district === d.district).map((o, i) => (
          <div key={i} className="pl-tile queued" title="On order here">
            <span className="pl-tile-name">{o.name} …</span>
          </div>
        ))}
      </div>
      {picking && (
        <div className="pl-picker">
          {d.levels === 0 && <div className="abs-dim">Building here develops a new {d.label} level first.</div>}
          {rows.map((b) => (
            <button key={b.id} type="button" className="pl-pick" disabled={!!b.blocked} title={b.blocked ?? `Build a ${b.name} at ${s.label}`} onClick={() => build(b.id, b.developed)}>
              <PlanetIcon id={iconOf(b.id)} size={16} />
              <span>{b.name}</span>
              {b.blocked && <span className="abs-dim">{b.blocked}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SiteCard({ s, bodyName, playerId, onMessage, highlight }: { s: AreaSite; bodyName: string; playerId: string | null; onMessage: (m: string | null) => void; highlight: string | null }) {
  const canAct = s.mine || (!s.owner && !!playerId)
  // Every district the place could take that is not shown yet can be started with a first level.
  const shown = new Set(s.districts.map((d) => d.district))
  const empty: AreaDistrict[] = canAct ? s.canDevelop.filter((d) => !shown.has(d.district)).map((d) => ({ district: d.district, label: d.label, levels: 0, slots: 0, used: 0, buildings: [] })) : []
  const withCivic = s.civic.length > 0 && !shown.has('core') ? [{ district: 'core', label: 'Core', levels: 0, slots: 0, used: 0, buildings: [] } as AreaDistrict] : []
  const districts = [...s.districts, ...withCivic.filter((d) => !empty.some((e) => e.district === d.district))]
  return (
    <div className={`pl-district pl-site-card${s.captured ? ' captured' : ''}`} data-site={s.siteId}>
      <div className="pl-district-head" title={`${s.kind} site · ${s.terrain ?? 'no ground'} · suitability ${pct(s.suitability)}${s.holds ? ` · holds ${s.holds}` : ''}`}>
        <span className="pl-district-name">{s.label}</span>
        <span className="pl-district-slots">{s.owner ?? 'open ground'}</span>
        {s.captured && <span className="econ-neg"> held by the enemy</span>}
        {!s.captured && s.access !== null && s.access < 0.99 && <span className="econ-neg" title="Share of what is made here that reaches a hub"> {pct(s.access)} access</span>}
      </div>
      {districts.length === 0 && empty.length > 0 && <div className="abs-dim pl-land">Nothing developed here yet. Pick a district to start.</div>}
      {districts.map((d) => (
        <DistrictBlock key={d.district} d={d} s={s} bodyName={bodyName} playerId={playerId} canAct={canAct} onMessage={onMessage} highlight={highlight} />
      ))}
      {empty.map((d) => (
        <DistrictBlock key={d.district} d={d} s={s} bodyName={bodyName} playerId={playerId} canAct={canAct} onMessage={onMessage} highlight={highlight} />
      ))}
      {s.onOrder.filter((o) => o.what === 'level').map((o, i) => (
        <div key={i} className="abs-dim" title="On order here">{o.name} …</div>
      ))}
    </div>
  )
}

// What is not a card: the world's orders (cancel here), foreign firms, and, in Complex, ownership / methods / upgrades.
function Extras({ bodyName, playerId }: { bodyName: string; playerId: string | null }) {
  const simple = isAbstractEconomy()
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const controller = useTerritoryStore((s) => s.bodyController[bodyName] ?? s.bodyOwner[bodyName])
  const canAct = !!playerId && owner === playerId && controller === playerId
  const [manage, setManage] = useState(false)
  const world = useEconomyStore((s) => s.worlds.find((w) => w.id === bodyName))
  const country = useEconomyStore((s) => s.countries.find((c) => c.id === world?.ownerId))
  const cancelConstruction = useEconomyStore((s) => s.cancelConstruction)
  const simpleQueue = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner]?.queue : undefined))
  const teardowns = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner]?.teardowns : undefined))
  const cancelOrder = useAbstractEconomyStore((s) => s.cancelOrder)
  const orders: { id: string | number; name: string; pct: number }[] = simple
    ? (simpleQueue ?? []).filter((o) => o.bodyName === bodyName).map((o) => ({ id: o.id, name: o.building ? SIMPLE_BUILDING_DEFS[o.building]?.name ?? o.building : `${o.district} level`, pct: -1 }))
    : (world?.constructionQueue ?? []).map((o) => ({ id: o.id, name: o.district ? `${DISTRICT_LABELS[o.district]} level` : RECIPES[o.recipeId]?.label ?? o.recipeId, pct: o.progress / Math.max(1, o.cost) }))
  const cancel = (id: string | number) => {
    if (simple) {
      if (playerId) cancelOrder(playerId, id as number)
    } else if (world) cancelConstruction(world.id, id as string)
  }
  const tearing = simple ? (teardowns ?? []).filter((t) => t.bodyName === bodyName) : []
  return (
    <>
      {orders.length > 0 && (
        <div className="pl-queue">
          <div className="econ-subtitle"><Bi en="On order" /></div>
          {orders.map((o) => (
            <div key={o.id} className="abs-order">
              <span>{o.name}</span>
              {o.pct >= 0 && <span className="abs-order-bar"><span style={{ width: `${Math.min(100, o.pct * 100)}%` }} /></span>}
              {canAct && <button type="button" className="abs-x" title="Cancel this order" onClick={() => cancel(o.id)}>×</button>}
            </div>
          ))}
        </div>
      )}
      {tearing.map((t) => (
        <div key={t.id} className="pl-stop">
          <span>Deconstructing {t.building ? SIMPLE_BUILDING_DEFS[t.building]?.name ?? t.building : `a ${t.district} level`}</span>
          {canAct && <button type="button" className="laws-enact-btn" title="Stop it" onClick={() => playerId && cancelOrder(playerId, t.id)}><Bi en="Cancel deconstruction" /></button>}
        </div>
      ))}
      <div className="pl-foreign">
        <div className="abs-dim"><Bi en="Foreign embassies & firms" /></div>
        <ForeignHoldingsRow bodyName={bodyName} playerId={playerId} />
      </div>
      {!simple && world && (
        <>
          <button type="button" className="abs-world-toggle pl-manage" onClick={() => setManage(!manage)} title="Production methods, ownership, upgrades and demolition">
            <span>{manage ? '▾' : '▸'} Manage buildings (methods, ownership, upgrades)</span>
          </button>
          {manage && <BuildingsPanel subtab={null} worldName={world.name} world={world} country={country} />}
        </>
      )}
    </>
  )
}

export function BuildingsTab({ bodyName, playerId }: { bodyName: string; playerId: string | null }) {
  const placed = usePlacementStore((s) => s.placed)
  const levels = usePlacementStore((s) => s.levels)
  const established = useLocationStore((s) => s.established)
  const civic = useCivicStore((s) => s.civic[bodyName])
  const simpleQueue = useAbstractEconomyStore((s) => s.byCountry)
  const complexWorlds = useEconomyStore((s) => s.worlds)
  const ports = useStructureStore((s) => s.ports)
  const [message, setMessage] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const ready = useSeededBody(bodyName)
  const rootRef = useRef<HTMLDivElement>(null)
  const view = useMemo(() => (ready ? areaView(bodyName, playerId) : { bodyName, landLeft: null, sections: [], totals: [], ports: { rows: [], economy: 0 }, standalone: [], unplaced: [] }), [ready, bodyName, playerId, placed, levels, established, civic, simpleQueue, complexWorlds, ports])
  // A building chip jumps to the first place that holds it.
  useEffect(() => {
    if (!highlight) return
    const site = view.sections.flatMap((sec) => sec.sites).find((s) => s.buildings.some((b) => b.id === highlight))
    if (site) rootRef.current?.querySelector(`[data-site="${site.siteId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, view])
  return (
    <div className="pl-districts pl-area" ref={rootRef}>
      <div className="abs-dim pl-land">
        Each card is a place on {bodyName}; a building belongs to its place, so the same building in two places is two buildings.
        {view.landLeft !== null && <> Room for <b>{Math.max(0, view.landLeft)}</b> more district level{view.landLeft === 1 ? '' : 's'} on this world.</>}
      </div>
      {view.totals.length > 0 && (
        <details>
          <summary className="abs-dim" title="Each building over every place it stands in. Press one to find where.">Totals: {view.totals.length} buildings, {view.totals.reduce((n, t) => n + t.levels, 0)} levels</summary>
        <div className="pl-site-districts">
          {view.totals.map((t) => (
            <button key={t.id} type="button" className={`pl-develop${highlight === t.id ? ' active' : ''}`} onClick={() => setHighlight(highlight === t.id ? null : t.id)} title={`${t.name}: ${t.levels} level${t.levels === 1 ? '' : 's'} in ${t.places} place${t.places === 1 ? '' : 's'}`}>
              {t.name}: {t.levels}{t.places > 1 ? ` in ${t.places}` : ''}
            </button>
          ))}
        </div>
        </details>
      )}
      {message && <div className="econ-neg pl-message">{message}</div>}
      {view.sections.map((sec) => {
        const used = (s: AreaSite) => s.districts.some((d) => d.levels > 0 || d.buildings.length > 0) || s.buildings.length > 0 || s.onOrder.length > 0 || s.civic.some((c) => c.kind !== 'cityHall')
        const active = sec.sites.filter(used)
        const idle = sec.sites.filter((s) => !used(s))
        return (
          <div key={sec.kind}>
            <div className="econ-subtitle">{sec.title}</div>
            {active.map((s) => (
              <SiteCard key={s.siteId} s={s} bodyName={bodyName} playerId={playerId} onMessage={setMessage} highlight={highlight} />
            ))}
            {idle.length > 0 && (
              <details open={active.length === 0}>
                <summary className="abs-dim" title="Places you could build on but nothing is developed or built there yet">{idle.length} undeveloped</summary>
                {idle.map((s) => (
                  <SiteCard key={s.siteId} s={s} bodyName={bodyName} playerId={playerId} onMessage={setMessage} highlight={highlight} />
                ))}
              </details>
            )}
          </div>
        )
      })}
      <StandaloneSection bodyName={bodyName} playerId={playerId} extra={view.standalone.map((b) => ({ id: b.id, name: b.name, count: b.count, ...(b.buildingId ? { buildingId: b.buildingId } : {}) }))} />
      <Extras bodyName={bodyName} playerId={playerId} />
      {view.unplaced.length > 0 && (
        <div className="abs-dim" title="Buildings the world has that no site holds (built before sites existed, or that found no developed slot)">
          Not in any place: {view.unplaced.map((b) => `${b.count}× ${b.name}`).join(', ')}
        </div>
      )}
    </div>
  )
}
