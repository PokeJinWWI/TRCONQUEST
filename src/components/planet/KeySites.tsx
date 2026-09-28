import { useMemo, useState } from 'react'
import { DEFENSE_DEFS, MILITARY_KINDS, type DefenseKind } from '../../data/defenseData'
import { RESOURCE_TYPES, type ResourceId } from '../../data/resourceData'
import { ownerDisplay } from '../../data/countryRoster'
import { canBuildDefense, useDefenseStore } from '../../state/defenseStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { holderOf } from '../../scene/groundLogic'
import { isActive, isMilitaryInstallation, withInstallationKeys } from '../../scene/defenseLogic'
import { keyNameOf } from '../../scene/keyNames'
import { KEY_BUILDING_ICON, keyBuildingsOf, type KeyBuilding } from '../../scene/keyBuildings'
import { PlanetIcon } from './PlanetIcons'
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
  return `${k.name}\n${k.description}\n${k.building ? 'Under construction.' : `Key node: ${k.place}${k.native ? ` ${k.native}` : ''} · held by ${holder}${k.captured ? ' (captured)' : ''}`}\n${k.role}\nTakes no district slot; can't be demolished.`
}

function KeyTile({ k }: { k: KeyBuilding }) {
  return (
    <div className={`pl-tile pl-key-tile${k.captured ? ' captured' : ''}${k.building ? ' queued' : ''}`} title={tooltip(k)}>
      <PlanetIcon id={KEY_BUILDING_ICON[k.kind]} size={22} />
      <span className="pl-tile-name">{k.name}</span>
      {k.captured && <span className="pl-key-flag" style={{ background: ownerDisplay(k.holder!).color }} />}
    </div>
  )
}

// The Civic group: one card, above the districts.
export function CivicDistrict({ bodyName }: { bodyName: string }) {
  const keys = useKeyBuildings(bodyName)
  if (keys.length === 0) return null
  const nodes = new Set(keys.filter((k) => !k.building).map((k) => k.node)).size
  return (
    <div className="pl-district pl-district-civic">
      <div className="pl-district-head" title="The buildings that are this world's key nodes in a ground war: hold them all to hold the world. They take no district slot and can't be demolished.">
        <PlanetIcon id="civic" size={20} />
        <span className="pl-district-name">Civic — key sites</span>
        <span className="pl-district-slots">{nodes} key node{nodes === 1 ? '' : 's'}</span>
      </div>
      <div className="pl-grid">
        {keys.map((k) => <KeyTile key={k.id} k={k} />)}
      </div>
    </div>
  )
}

// The Military district's tiles: the defenses standing (or building) here, the
// free slots, and a picker for a new one.
export function MilitaryTiles({ bodyName, playerId, canBuild, slots, grouped }: { bodyName: string; playerId: string | null; canBuild: boolean; slots: number; grouped: boolean }) {
  const installations = useDefenseStore((s) => s.installations)
  const build = useDefenseStore((s) => s.build)
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
    const res = build(playerId, bodyName, kind, useGameTimeStore.getState().simDays)
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
              <span className="pl-tile-name">{label}</span>
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
              {k.kind === 'landmark' ? `At ${k.place}` : k.place}{k.native ? ` ${k.native}` : ''} · held by{' '}
              <span style={{ color: k.holder ? ownerDisplay(k.holder).color : undefined }}>{k.holder ? ownerDisplay(k.holder).name : 'nobody'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
