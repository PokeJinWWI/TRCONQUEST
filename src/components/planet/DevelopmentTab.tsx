import { NamedBi, NativeNameInput } from '../NativeName'
import { Bi } from '../Bi'
import { useMemo, useState } from 'react'
import { useSeededBody } from '../../hooks/useSeededBody'
import { connectSite } from '../../scene/aiDevelopment'
import { syncCivicHalls } from '../../scene/seedPlacementOrders'
import { ruralRows } from '../../scene/territoryView'
import { useColonyStore } from '../../state/colonyStore'
import { MICRO_COLONY_LAND } from '../../data/colonyData'
import { OWN_SETTLEMENT_MIN_SEPARATION_CELLS } from '../../data/locationData'
import { useStructureStore } from '../../state/structureStore'
import { developmentView, type AreaRow } from '../../scene/territoryView'
import { useCivicStore } from '../../state/civicStore'
import { PlanetIcon } from './PlanetIcons'
import { useInfrastructureStore } from '../../state/infrastructureStore'
import { useLocationStore, siteNativeBuiltIn } from '../../state/locationStore'
import { useEconomyStore, worldByName } from '../../state/economyStore'
import { useBuildingDetailStore } from '../../state/buildingDetailStore'
import { RECIPES } from '../../economy/recipes'
import { SIMPLE_BUILDING_DEFS } from '../../data/simplisticEconomyData'
import { usePlacementStore } from '../../state/placementStore'
import { usePlayerStore } from '../../state/playerStore'
import { useTerritoryStore } from '../../state/territoryStore'

// The planet screen's Development tab (both economy modes): the world's AREAS (scene/areas.ts: every connected patch of one
// district kind is one place, named, with its civic buildings, key nodes and buildings), what stands outside them, and the
// routes between them. An area's access says how much of what it makes gets out.

const HOLDS_LABEL: Record<string, string> = {
  ironOre: 'iron ore', rareMetals: 'rare metals', exoticMatter: 'exotic matter', hardwood: 'hardwood', timber: 'timber', phosphate: 'phosphate', coal: 'coal', oil: 'oil', sulfur: 'sulfur', hyperium: 'hyperium',
}

// A name that turns into a text box on click; Enter or the tick saves, an empty name goes back to the generated one.
function RenamableName({ id, name, canRename }: { id: string; name: string; canRename: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const builtIn = siteNativeBuiltIn(id)
  const shown = <NamedBi en={name} nativeKey={id} builtIn={builtIn} />
  if (!editing) {
    return canRename ? (
      <button type="button" className="good-flow-link" style={{ width: 'auto', textAlign: 'left' }} title="Click to rename it" onClick={() => { setDraft(name); setEditing(true) }}>{shown}</button>
    ) : shown
  }
  const commit = () => {
    useLocationStore.getState().renameSite(id, draft)
    syncCivicHalls(id.slice(0, id.lastIndexOf('#')))
    setEditing(false)
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
    e.stopPropagation()
  }
  return (
    <span>
      <input className="ground-key-name-input" autoFocus value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
      <NativeNameInput nativeKey={id} builtIn={builtIn} onKeyDown={keys} />
      <button type="button" className="ground-key-rename" onClick={commit} title="Save (an empty name goes back to the generated one)">✓</button>
    </span>
  )
}

// A building standing on a site. Complex: opens that building's window; Simple has no per-building window, so it is plain text.
function BuildingChip({ bodyName, id, count }: { bodyName: string; id: string; count: number }) {
  const worlds = useEconomyStore((st) => st.worlds)
  const complexLabel = RECIPES[id]?.label
  const simpleLabel = (SIMPLE_BUILDING_DEFS as Record<string, { name: string } | undefined>)[id]?.name
  const label = `${complexLabel ?? simpleLabel ?? id}${count > 1 ? ` ×${count}` : ''}`
  const world = complexLabel ? worldByName(worlds, bodyName) : undefined
  const building = world?.buildings.find((b) => b.recipeId === id)
  if (!world || !building) return <>{label}</>
  return (
    <button type="button" className="good-flow-link" style={{ width: 'auto' }} title={`Open ${complexLabel}`} onClick={() => useBuildingDetailStore.getState().openBuilding(world.id, building.id)}>
      <span className="good-flow-name">{label}</span>
    </button>
  )
}

const KIND_TITLE: Record<string, string> = { settlement: 'Urban areas', industrial: 'Industrial areas', resource: 'Mining areas', agricultural: 'Farmland' }
const KIND_CARD: Record<string, string> = { settlement: 'urban', industrial: 'industrial', resource: 'mining', agricultural: 'agricultural', infrastructure: 'generator' }
const pct = (n: number) => `${Math.round(n * 100)}%`

// One area of the world: a connected patch of one district kind (scene/areas.ts), with what stands in it.
function AreaCard({ a, bodyName, onConnect }: { a: AreaRow; bodyName: string; onConnect: (id: string) => void }) {
  const cutOff = a.access !== null && a.access < 0.99
  const head = a.urban ? `${a.urban.tier} · ${a.urban.population}M` : `${a.cells} cell${a.cells === 1 ? '' : 's'}`
  return (
    <div className={`pl-district pl-district-${KIND_CARD[a.kind] ?? 'urban'}${a.captured ? ' pl-area-captured' : ''}`}>
      <div className="pl-district-head" title={a.seeds > 1 ? `${a.seeds} places that have grown into one` : undefined}>
        <span className="pl-district-name"><RenamableName id={a.id} name={a.name} canRename={a.mine} /></span>
        <span className="pl-district-level">{head}</span>
        <span className="pl-district-slots">{a.owner ?? 'nobody'}</span>
      </div>
      {(a.urban || a.holds || a.captured || cutOff) && (
        <div className="pl-output">
          {a.urban?.specializations.map((sp) => <span key={sp} className="pl-output-chip">{sp}</span>)}
          {a.holds && <span className="pl-output-chip" title="What lies in this ground">{a.holds.split(', ').map((h) => HOLDS_LABEL[h] ?? h).join(', ')}</span>}
          {a.urban?.filling != null && <span className="pl-output-chip" title="People are still moving in: a new settlement fills over about ten years">filling <b>{a.urban.filling}%</b></span>}
          {a.urban?.overcrowded && <span className="pl-output-chip pl-chip-warn">overcrowded</span>}
          {a.captured && <span className="pl-output-chip pl-chip-warn" title="An enemy's ground forces hold part of this area: what stands there makes nothing for its owner">held by the enemy</span>}
          {cutOff && !a.captured && <span className="pl-output-chip pl-chip-warn" title="Share of its output that reaches a hub">{pct(a.access!)} access</span>}
          {a.mine && cutOff && a.worstPart && (
            <button type="button" className="pl-develop" title="Build the cheapest route to the nearest hub it can reach" onClick={() => onConnect(a.worstPart!)}><Bi en="Connect" /></button>
          )}
        </div>
      )}
      {(a.keyNodes.length > 0 || a.civic.length > 0 || a.buildings.length > 0) && (
        <div className="pl-grid">
          {a.civic.map((c) => (
            <div key={c} className="pl-tile pl-key-tile" title={c}>
              <PlanetIcon id="cityHall" size={18} />
              <span className="pl-tile-name">{c}</span>
            </div>
          ))}
          {a.keyNodes.map((k) => (
            <div key={k} className="pl-tile pl-key-tile" title={`${k}: a key node of the ground map. Hold every key node to hold the world.`}>
              <span className="pl-plus">◆</span>
              <span className="pl-tile-name">{k}</span>
            </div>
          ))}
          {a.buildings.map((b) => (
            <div key={b.id} className="pl-tile">
              <PlanetIcon id={b.id} size={18} />
              <span className="pl-tile-name"><BuildingChip bodyName={bodyName} id={b.id} count={b.count} /></span>
            </div>
          ))}
        </div>
      )}
      {a.urban?.next && <div className="abs-dim pl-area-next">Next: {a.urban.next}</div>}
    </div>
  )
}

export function DevelopmentTab({ bodyName }: { bodyName: string }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const placed = usePlacementStore((s) => s.placed)
  const established = useLocationStore((s) => s.established)
  const names = useLocationStore((s) => s.names)
  const civic = useCivicStore((s) => s.civic[bodyName])
  const routes = useInfrastructureStore((s) => s.routes)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const [message, setMessage] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const colony = useColonyStore((s) => s.colonies[bodyName])
  const ruralLedger = useStructureStore((s) => s.rural[bodyName])
  // The body's starting settlements and buildings are assigned to sites the first time it is looked at.
  const ready = useSeededBody(bodyName)
  const view = useMemo(() => developmentView(bodyName, playerId), [bodyName, playerId, placed, established, names, civic, routes, owners, version, ready])

  const connect = (siteId: string) => {
    if (!playerId) return
    const r = connectSite(playerId, siteId)
    setMessage(r.ok ? 'Route started.' : r.reason)
    setVersion((v) => v + 1)
  }

  const rural = useMemo(() => ruralRows(bodyName), [bodyName, ruralLedger, placed, established, names, version])
  const urban = view.areas.filter((a) => a.urban)
  const kinds = ['settlement', 'industrial', 'resource', 'agricultural']
  return (
    <div className="pl-districts development-tab">
      <div className="pl-stat-grid">
        <div className="pl-stat" title="Connected urban ground: towns that grow into each other become one"><span><Bi en="Urban areas" /></span><b>{urban.length}</b></div>
        <div className="pl-stat"><span><Bi en="Urban people" /></span><b>{urban.reduce((n, a) => n + (a.urban?.population ?? 0), 0)}M</b></div>
        <div className="pl-stat"><span><Bi en="Other areas" /></span><b>{view.areas.length - urban.length}</b></div>
      </div>
      {colony && colony.stage === 'micro' && owners[bodyName] === playerId && (
        <div className="abs-dim pl-land" title="A micro-colony can develop only this many district levels until an armed patrol holds its orbit long enough (see the Control tab)">
          Micro-colony: districts are limited to {MICRO_COLONY_LAND} levels until the colony is promoted. New towns beside your own settlements may be founded {OWN_SETTLEMENT_MIN_SEPARATION_CELLS} cells apart; elsewhere sites keep their distance.
        </div>
      )}
      <div className="abs-dim pl-land">Every connected patch of one kind of district is one area. Found new ones anywhere with the build lens.</div>
      {message && <div className="econ-neg pl-message">{message}</div>}
      {kinds.map((kind) => {
        const rows = view.areas.filter((a) => a.kind === kind)
        if (rows.length === 0) return null
        return (
          <div key={kind}>
            <div className="econ-subtitle">{KIND_TITLE[kind] ?? kind}</div>
            {rows.map((a) => <AreaCard key={a.id} a={a} bodyName={bodyName} onConnect={connect} />)}
          </div>
        )
      })}
      {view.standalone.length > 0 && (
        <div>
          <div className="econ-subtitle" title="Buildings that stand on their own ground, in no area: a spaceport can go anywhere"><Bi en="Standalone buildings" /></div>
          <div className="pl-district">
            <div className="pl-grid">
              {view.standalone.map((b) => (
                <div key={b.id} className="pl-tile">
                  <PlanetIcon id={b.id} size={18} />
                  <span className="pl-tile-name"><BuildingChip bodyName={bodyName} id={b.id} count={b.count} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {rural.length > 0 && (
        <div>
          <div className="econ-subtitle" title="Buildings that stand on their own ground, outside any district. One inside an area counts as part of it; a platform at sea can be reached only from orbit."><Bi en="Outside the districts" /></div>
          <div className="pl-district">
            {rural.map((r) => (
              <div key={r.id} className="inspect-row" title={r.sea ? 'A platform at sea: no army can reach it, only orbital control takes it' : 'A key node of the ground map'}>
                <span className="inspect-label">{r.name}</span>
                <span className="inspect-value">{r.where}{r.sea ? ' · at sea' : ''}{r.seeded ? ' · relic of the old works' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {view.routes.length > 0 && (
        <div>
          <div className="econ-subtitle" title="Routes carry freight from areas to hubs; unpaid upkeep puts one in disrepair (half capacity)"><Bi en="Routes" /></div>
          <div className="pl-district">
            {view.routes.map((r) => (
              <div key={r.id} className="inspect-row" title={r.between}>
                <span className="inspect-label">{r.kind} · {r.owner}</span>
                <span className="inspect-value">{r.cells} cells{r.working ? '' : ' · building'}{r.open ? '' : ' · private'}{r.disrepair ? ' · disrepair' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
