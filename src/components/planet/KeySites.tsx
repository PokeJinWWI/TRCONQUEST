import { NamedBi } from '../NativeName'
import { keyNodeId } from '../../state/placeNameStore'
import { Bi } from '../Bi'
import { useEffect, useMemo, useState } from 'react'
import { DEFENSE_DEFS, MILITARY_KINDS, type DefenseKind } from '../../data/defenseData'
import { RESOURCE_TYPES, type ResourceId } from '../../data/resourceData'
import { ownerDisplay } from '../../data/countryRoster'
import { canBuildDefense, useDefenseStore } from '../../state/defenseStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { holderOf } from '../../scene/groundLogic'
import { isActive, isMilitaryInstallation, withInstallationKeys } from '../../scene/defenseLogic'
import { keyNameOf } from '../../scene/keyNames'
import { nativeOfName } from '../../data/nativeNames'
import { KEY_BUILDING_ICON, keyBuildingsOf, type KeyBuilding } from '../../scene/keyBuildings'
import { PlanetIcon } from './PlanetIcons'
import { chooseDefenseSite } from '../../scene/standalone'
import { useCivicDetailStore, useCivicStore } from '../../state/civicStore'
import { ensureSeeded } from '../../scene/seedPlacementOrders'
import type { CivicBuilding } from '../../scene/civic'
import { useGroundKeySurface } from '../../hooks/useGroundKeySurface'

// The planet screen's key sites (both economy modes): the Civic group — the
// buildings that ARE the world's key nodes (scene/keyBuildings.ts) — and the
// Military district's tiles (the world's planetary defenses, built through
// state/defenseStore.ts).

const RESOURCE_NAME = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

export function useKeyBuildings(bodyName: string): KeyBuilding[] {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const holders = useTerritoryStore((s) => s.nodeHolders)
  const installations = useDefenseStore((s) => s.installations)
  const day = useGameTimeStore((s) => Math.floor(s.simDays))
  // Terrain + the economy's spaceports; keyBuildingsOf adds the installations.
  const surface = useGroundKeySurface(bodyName, false)
  return useMemo(() => (surface ? keyBuildingsOf(surface, installations, day, owners, holders) : []), [surface, owners, holders, installations, day])
}

function tooltip(k: KeyBuilding): string {
  const holder = k.holder ? ownerDisplay(k.holder).name : 'nobody'
  return `${k.name}\n${k.description}\n${k.building ? 'Under construction.' : `Key node: ${k.place} · held by ${holder}${k.captured ? ' (captured)' : ''}`}\n${k.role}\nTakes no district slot; can't be demolished.`
}

// The civic buildings (the Senate House, the landmarks, each city's municipal government building, a colony's station): REAL
// buildings in the Core district. Seeded the first time the world is looked at (scene/seedPlacementOrders.ensureSeeded); click one
// to open it. Spaceports are not here: they are ordinary Urban buildings.
export function useCivicBuildings(bodyName: string): CivicBuilding[] {
  const list = useCivicStore((s) => s.civic[bodyName])
  useEffect(() => {
    if (!list) ensureSeeded(bodyName)
  }, [bodyName, list])
  return list ?? []
}

function CivicTile({ bodyName, c, holder }: { bodyName: string; c: CivicBuilding; holder: { id?: string; captured: boolean } }) {
  return (
    <button type="button" className={`pl-tile pl-key-tile${holder.captured ? ' captured' : ''}`} title={`${c.name}\n${c.description}\nKey node: ${c.place}\n${c.role}`} onClick={() => useCivicDetailStore.getState().openBuilding(bodyName, c.id)}>
      <PlanetIcon id={KEY_BUILDING_ICON[c.kind]} size={22} />
      <span className="pl-tile-name">{c.name}</span>
      {holder.captured && holder.id && <span className="pl-key-flag" style={{ background: ownerDisplay(holder.id).color }} />}
    </button>
  )
}

function useCivicHolders(bodyName: string) {
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  return (c: CivicBuilding) => {
    const holder = holders?.[c.node] ?? owner
    return { id: holder, captured: !!holder && !!owner && holder !== owner }
  }
}

// The tiles of the Core district's civic buildings, for the Core district's grid.
export function CivicTiles({ bodyName }: { bodyName: string }) {
  const list = useCivicBuildings(bodyName)
  const holderOf = useCivicHolders(bodyName)
  return (
    <>
      {list.map((c) => (
        <CivicTile key={c.id} bodyName={bodyName} c={c} holder={holderOf(c)} />
      ))}
    </>
  )
}

// Simple mode's Core card: the same civic buildings (government takes no district levels there, so the card is display-only).
export function CoreCard({ bodyName }: { bodyName: string }) {
  const list = useCivicBuildings(bodyName)
  if (list.length === 0) return null
  return (
    <div className="pl-district pl-district-c-core">
      <div className="pl-district-head" title="Government buildings: the seat of government, its landmarks and each city's municipal building. They take no slot, cost nothing to keep and cannot be demolished; the node they stand on is a key node in a ground war.">
        <PlanetIcon id="civic" size={20} />
        <span className="pl-district-name"><Bi en="Core District" /></span>
        <span className="pl-district-slots">{list.length} building{list.length === 1 ? '' : 's'}</span>
      </div>
      <div className="pl-grid">
        <CivicTiles bodyName={bodyName} />
      </div>
    </div>
  )
}

// The Military district's tiles: the defenses standing (or building) here, the
// free slots, and a picker for a new one.
export function MilitaryTiles({ bodyName, playerId, canBuild, slots, grouped }: { bodyName: string; playerId: string | null; canBuild: boolean; slots: number; grouped: boolean }) {
  const installations = useDefenseStore((s) => s.installations)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const holders = useTerritoryStore((s) => s.nodeHolders)
  const simDays = useGameTimeStore((s) => Math.floor(s.simDays))
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const here = installations.filter((i) => i.bodyName === bodyName && isMilitaryInstallation(i))
  const free = Math.max(0, slots - here.length)
  const surface = useGroundKeySurface(bodyName, false)
  const named = surface ? withInstallationKeys(surface, installations, Infinity) : null
  const doBuild = (kind: DefenseKind) => {
    if (!playerId) return
    // The ground map opens with it in hand: click where it should stand.
    const res = chooseDefenseSite(playerId, bodyName, kind)
    setMessage(res.ok ? null : res.reason)
    if (res.ok) setPicking(false)
  }
  return (
    <>
      {message && <div className="econ-neg pl-message">{message}</div>}
      <div className="pl-grid">
        {here.map((i) => {
          const def = DEFENSE_DEFS[i.kind]
          const holder = holderOf(bodyName, i.node, owners, holders)
          const captured = !!holder && holder !== owners[bodyName]
          const building = !isActive(i, simDays)
          const label = i.name ?? (named && i.kind === 'fortress' ? keyNameOf(named, { node: i.node, kind: 'fortress' }).label : def.name)
          return (
            <div key={i.id} className={`pl-tile${building ? ' queued' : ''}${captured ? ' captured' : ''}`}
              title={`${label}\n${def.description}\n${building ? `Under construction — ready in ${Math.ceil(i.readySimDays - simDays)} days` : `Integrity ${Math.round(i.integrity)} / ${def.integrity}`} · held by ${holder ? ownerDisplay(holder).name : 'nobody'}${captured ? ' (captured)' : ''}`}>
              <PlanetIcon id={i.kind} size={22} />
              <span className="pl-tile-name">
                <NamedBi en={label} nativeKey={keyNodeId(bodyName, i.node)} builtIn={nativeOfName(label)} />
              </span>
              {captured && <span className="pl-key-flag" style={{ background: ownerDisplay(holder!).color }} />}
              <span className="pl-tile-bar"><span style={{ width: `${Math.max(0, Math.min(1, i.integrity / def.integrity)) * 100}%` }} /></span>
            </div>
          )
        })}
        {Array.from({ length: grouped ? Math.min(1, free) : free }, (_, n) =>
          canBuild ? (
            <button key={`free-${n}`} type="button" className="pl-tile empty" title="Build a defense here" onClick={() => setPicking(!picking)}>
              <span className="pl-plus">+</span>
              {grouped && <span className="pl-tile-name">{free} free</span>}
            </button>
          ) : (
            <div key={`free-${n}`} className="pl-tile empty" title="Empty slot">{grouped && <span className="pl-tile-name">{free} free</span>}</div>
          ),
        )}
      </div>
      {picking && canBuild && playerId && (
        <div className="pl-picker">
          {MILITARY_KINDS.map((kind) => {
            const def = DEFENSE_DEFS[kind]
            const check = canBuildDefense(playerId, bodyName, kind, installations)
            const cost = Object.entries(def.cost) as [ResourceId, number][]
            return (
              <button key={kind} type="button" className="pl-pick" disabled={!check.ok} title={check.ok ? def.description : `${def.description}\n\n${(check as { reason: string }).reason}`} onClick={() => doBuild(kind)}>
                <PlanetIcon id={kind} size={18} />
                <span>{def.name}</span>
                <span className="abs-dim">{cost.map(([r, n]) => `${n} ${RESOURCE_NAME[r]}`).join(' ')} · {def.buildDays}d</span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

// The Defense tab's list of key sites: every key node's building, who holds it.
export function KeySitesList({ bodyName }: { bodyName: string }) {
  const keys = useKeyBuildings(bodyName)
  if (keys.length === 0) return <div className="abs-dim">No key sites — nobody has settled this world.</div>
  return (
    <div className="pl-def-list">
      {keys.map((k) => (
        <div key={k.id} className={`pl-def${k.building ? ' building' : ''}`} title={tooltip(k)}>
          <PlanetIcon id={KEY_BUILDING_ICON[k.kind]} size={26} />
          <div className="pl-def-body">
            <div className="pl-def-name">
              {k.name}
              {k.building && <span className="abs-dim"> · under construction</span>}
              {k.captured && <span className="econ-neg"> · captured</span>}
            </div>
            <div className="abs-dim">
              {k.kind === 'landmark' ? 'At ' : ''}
              <NamedBi en={k.place} nativeKey={keyNodeId(bodyName, k.node)} builtIn={k.native} /> · held by{' '}
              <span style={{ color: k.holder ? ownerDisplay(k.holder).color : undefined }}>{k.holder ? ownerDisplay(k.holder).name : 'nobody'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
