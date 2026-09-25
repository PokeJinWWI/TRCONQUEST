import { useMemo, useState } from 'react'
import { useArmyStore, canRecruitAt } from '../state/armyStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { atWar } from '../state/diplomacyStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import { usePlayerStore } from '../state/playerStore'
import { usePlayerResources } from '../hooks/usePlayerResources'
import { COUNTRIES } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { UNIT_TYPES } from '../data/groundData'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import type { ResourceCost } from '../data/shipyardData'
import {
  armiesAboard,
  armyStrength,
  armyCapacityOf,
  embarkableArmies,
  groundBattles,
  landingCheck,
  type ArmyUnit,
  type GroundBattle,
} from '../scene/armyLogic'
import { bodiesOwnedBy, controllerOf, isOccupied } from '../scene/territory'
import { missingResources } from '../scene/shipyardLogic'
import { armyInContact, groundSurface } from '../scene/groundLogic'
import { useGroundViewStore } from '../state/groundViewStore'
import { useViewStore } from '../state/viewStore'

// Everything the player sees of the ground war: the Military > Army panel, a
// body's Armies readout (Inspect panel, planet view), and a transport's cargo
// controls in the Ship panel. Rules live in scene/armyLogic.ts; this only
// reads the stores and calls their actions.

const RESOURCE_NAMES = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

function formatCost(cost: ResourceCost): string {
  return (Object.entries(cost) as [ResourceId, number][]).map(([id, n]) => `${n} ${RESOURCE_NAMES[id]}`).join(' · ')
}

function countryName(id: string): string {
  return ownerDisplay(id).name
}

// Nation colour — for territory (who owns or occupies a world). Armies are
// coloured by their relation to the player instead: see armyColor.
function countryColor(id: string): string {
  return ownerDisplay(id).color
}

// An army's colour: green if the player's, blue if allied, yellow if neutral,
// red if hostile (the same as their ships). Components using it call
// useRelationKey() so a war starting or ending recolours them.
function armyColor(ownerId: string): string {
  return relationColorOf(ownerId)
}

// Every ground battle going on, recomputed when armies, territory or wars
// change.
export function useGroundBattles(): GroundBattle[] {
  const armies = useArmyStore((s) => s.armies)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const bodyController = useTerritoryStore((s) => s.bodyController)
  const relationKey = useRelationKey()
  return useMemo(
    () => groundBattles(armies, bodyOwner, bodyController, atWar),
    // relationKey stands in for "wars changed" — atWar reads the live store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [armies, bodyOwner, bodyController, relationKey],
  )
}

export function StrengthBar({ value, max, color }: { value: number; max: number; color: string }) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <span className="army-bar-track">
      <span className="army-bar-fill" style={{ width: `${fraction * 100}%`, background: color }} />
    </span>
  )
}

function ArmyRow({ army }: { army: ArmyUnit }) {
  useRelationKey()
  const spec = ARMY_KINDS[army.kind]
  const training = army.location.kind === 'recruiting'
  const readyIn = training && army.location.kind === 'recruiting' ? army.location.readySimDays : 0
  const simDays = useGameTimeStore((s) => (training ? Math.floor(s.simDays) : 0))
  const strength = armyStrength(army)
  return (
    <div className="army-row">
      <span className="army-row-name" style={{ color: armyColor(army.ownerId) }}>
        {spec.name}
      </span>
      {training ? (
        <span className="army-row-status">Training · {Math.max(0, Math.ceil(readyIn - simDays))}d</span>
      ) : (
        <>
          <StrengthBar value={strength.strength} max={strength.max} color={armyColor(army.ownerId)} />
          <span className="army-row-value" title={army.units.map((u) => `${UNIT_TYPES[u.type].name} ${Math.ceil(u.strength)}/${u.maxStrength}`).join('\n')}>
            {army.units.length}u · {Math.ceil(strength.strength)}/{strength.max}
          </span>
        </>
      )}
    </div>
  )
}

export function GroundBattleSummary({ battle }: { battle: GroundBattle }) {
  useRelationKey()
  const attackerColor = armyColor(battle.attackerIds[0])
  return (
    <div className="ground-battle">
      <div className="ground-battle-title">Ground battle on {battle.bodyName}</div>
      <div className="army-row">
        <span className="army-row-name" style={{ color: armyColor(battle.defenderId) }}>
          {countryName(battle.defenderId)} (holding)
        </span>
        <StrengthBar value={battle.defenderStrength} max={battle.defenderMaxStrength} color={armyColor(battle.defenderId)} />
        <span className="army-row-value">{Math.ceil(battle.defenderStrength)}</span>
      </div>
      <div className="army-row">
        <span className="army-row-name" style={{ color: attackerColor }}>
          {battle.attackerIds.map(countryName).join(', ')} (invading)
        </span>
        <StrengthBar value={battle.attackerStrength} max={battle.attackerMaxStrength} color={attackerColor} />
        <span className="army-row-value">{Math.ceil(battle.attackerStrength)}</span>
      </div>
    </div>
  )
}

const RECRUITABLE: ArmyKind[] = (Object.keys(ARMY_KINDS) as ArmyKind[]).filter((k) => !!ARMY_KINDS[k].recruitCost)

function RecruitButton({ bodyName }: { bodyName: string }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const { amounts } = usePlayerResources()
  // Re-check whenever territory changes (occupation blocks recruiting).
  useTerritoryStore((s) => s.bodyController[bodyName])
  const [message, setMessage] = useState<string | null>(null)
  if (!playerId || !canRecruitAt(playerId, bodyName).ok) return null
  return (
    <div className="army-recruit">
      {RECRUITABLE.map((kind) => {
        const spec = ARMY_KINDS[kind]
        const missing = missingResources(spec.recruitCost!, amounts)
        return (
          <div key={kind}>
            <button
              type="button"
              className="detail-view-btn"
              disabled={missing.length > 0}
              title={missing.length > 0 ? `Need more ${missing.join(', ')}` : spec.description}
              onClick={() => {
                const r = useArmyStore.getState().recruitArmy(playerId, bodyName, kind, useGameTimeStore.getState().simDays)
                setMessage(r.ok ? `${spec.name} in training (${spec.recruitDays} days)` : r.reason)
              }}
            >
              Recruit {spec.name}
            </button>
            <div className="inspect-status">{formatCost(spec.recruitCost!)} · {spec.recruitDays} days</div>
          </div>
        )
      })}
      {message && <div className="inspect-status ok">{message}</div>}
    </div>
  )
}

// A body's ground forces: who holds it, any battle, every army on it, and
// (for the player's own worlds) recruiting.
export function BodyArmies({ bodyName }: { bodyName: string }) {
  const armies = useArmyStore((s) => s.armies)
  const ownerId = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const controllerId = useTerritoryStore((s) => s.bodyController[bodyName])
  const battles = useGroundBattles()
  const battle = battles.find((b) => b.bodyName === bodyName)
  const here = useMemo(
    () => armies.filter((a) => (a.location.kind === 'body' || a.location.kind === 'recruiting') && a.location.bodyName === bodyName),
    [armies, bodyName],
  )
  const byOwner = useMemo(() => {
    const groups = new Map<string, ArmyUnit[]>()
    for (const a of here) groups.set(a.ownerId, [...(groups.get(a.ownerId) ?? []), a])
    return [...groups.entries()]
  }, [here])
  const occupier = controllerId && controllerId !== ownerId ? controllerId : null

  return (
    <div className="body-armies">
      {occupier && (
        <div className="occupation-banner" style={{ borderColor: countryColor(occupier), color: countryColor(occupier) }}>
          Occupied by {countryName(occupier)}
        </div>
      )}
      {battle && <GroundBattleSummary battle={battle} />}
      {byOwner.length === 0 && <div className="inspect-status">No armies here.</div>}
      {byOwner.map(([owner, list]) => (
        <div key={owner} className="army-group">
          <div className="army-group-label" style={{ color: armyColor(owner) }}>
            {countryName(owner)}
          </div>
          {list.map((a) => (
            <ArmyRow key={a.id} army={a} />
          ))}
        </div>
      ))}
      {groundSurface(bodyName, useTerritoryStore.getState().bodyOwner) && (
        <button type="button" className="detail-view-btn" onClick={() => useViewStore.getState().enterGround(bodyName)}>
          Open ground map
        </button>
      )}
      <RecruitButton bodyName={bodyName} />
    </div>
  )
}

// Military > Army: the player's whole ground force, where it is, and where it
// can be raised.
export function ArmyPanel() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const armies = useArmyStore((s) => s.armies)
  const ships = useShipStore((s) => s.ships)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const bodyController = useTerritoryStore((s) => s.bodyController)
  const worlds = useEconomyStore((s) => s.worlds)
  const battles = useGroundBattles()
  if (!playerId) return null

  const mine = armies.filter((a) => a.ownerId === playerId)
  const whereOf = (a: ArmyUnit): string => {
    if (a.location.kind === 'embarked') {
      const shipId = a.location.shipId
      return `Aboard ${ships.find((s) => s.id === shipId)?.name ?? 'transport'}`
    }
    return a.location.bodyName
  }
  const byPlace = new Map<string, ArmyUnit[]>()
  for (const a of mine) byPlace.set(whereOf(a), [...(byPlace.get(whereOf(a)) ?? []), a])

  const myBattles = battles.filter((b) => b.defenderId === playerId || b.attackerIds.includes(playerId))
  const capital = COUNTRIES.find((c) => c.id === playerId)?.capitalBodyName
  const recruitSites = bodiesOwnedBy(playerId, bodyOwner).filter(
    (b) => (b === capital || !!worldByName(worlds, b)) && controllerOf(b, bodyOwner, bodyController) === playerId,
  )
  const lost = bodiesOwnedBy(playerId, bodyOwner).filter((b) => isOccupied(b, bodyOwner, bodyController))
  const held = Object.entries(bodyController).filter(([, c]) => c === playerId).map(([b]) => b)
  const strength = mine.filter((a) => a.location.kind !== 'recruiting').reduce((s, a) => s + armyStrength(a).strength, 0)

  return (
    <div className="army-panel">
      <div className="inspect-row">
        <span className="inspect-label">Armies</span>
        <span className="inspect-value">
          {mine.length} · strength {Math.round(strength)}
        </span>
      </div>
      {held.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Occupying</span>
          <span className="inspect-value">{held.join(', ')}</span>
        </div>
      )}
      {lost.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Occupied by enemy</span>
          <span className="inspect-value econ-neg">{lost.join(', ')}</span>
        </div>
      )}

      {myBattles.length > 0 && (
        <>
          <div className="inspect-divider" />
          {myBattles.map((b) => (
            <GroundBattleSummary key={b.bodyName} battle={b} />
          ))}
        </>
      )}

      <div className="inspect-divider" />
      {[...byPlace.entries()].map(([place, list]) => (
        <div key={place} className="army-group">
          <div className="army-group-label">{place}</div>
          {list.map((a) => (
            <ArmyRow key={a.id} army={a} />
          ))}
        </div>
      ))}
      {mine.length === 0 && <div className="inspect-status">You have no armies.</div>}

      <div className="inspect-divider" />
      <div className="army-group-label">Recruit</div>
      {recruitSites.map((b) => (
        <div key={b} className="army-group">
          <div className="inspect-row">
            <span className="inspect-label">{b}</span>
          </div>
          <RecruitButton bodyName={b} />
        </div>
      ))}
      <div className="ship-panel-hint">
        Load assault armies onto a Troop Transport (select it in orbit of the same world), clear the enemy's warships from a
        target world's orbit, then land to invade.
      </div>
    </div>
  )
}

// The Ship panel's section for a troop transport: what it carries, loading
// what's on the world below, and landing it (unloading at home, invading an
// enemy world).
export function TransportCargo({ ship }: { ship: ShipInstance }) {
  const armies = useArmyStore((s) => s.armies)
  const ships = useShipStore((s) => s.ships)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const bodyController = useTerritoryStore((s) => s.bodyController)
  useRelationKey()
  const [message, setMessage] = useState<string | null>(null)
  const capacity = armyCapacityOf(ship)
  if (capacity <= 0) return null

  const cargo = armiesAboard(armies, ship.id)
  const room = capacity - cargo.length
  const resting = !ship.order
  const loadable = resting ? embarkableArmies(ship, armies, (a) => armyInContact(a, armies, atWar)).slice(0, room) : []
  const landing = resting ? landingCheck(ship, armies, ships, bodyOwner, bodyController, atWar) : null

  return (
    <>
      <div className="inspect-divider" />
      <div className="inspect-row">
        <span className="inspect-label">Cargo</span>
        <span className="inspect-value">
          {cargo.length}/{capacity} armies
        </span>
      </div>
      {cargo.map((a) => (
        <ArmyRow key={a.id} army={a} />
      ))}
      {loadable.length > 0 && (
        <button
          type="button"
          className="detail-view-btn"
          onClick={() => {
            const r = useArmyStore.getState().embark(loadable.map((a) => a.id), ship.id)
            setMessage(r.ok ? `Loaded ${loadable.length} ${loadable.length === 1 ? 'army' : 'armies'}` : r.reason)
          }}
        >
          Load {loadable.length} {loadable.length === 1 ? 'army' : 'armies'}
        </button>
      )}
      {cargo.length > 0 && landing && (
        <button
          type="button"
          className={`detail-view-btn${landing.ok && landing.kind === 'invade' ? ' danger' : ''}`}
          disabled={!landing.ok}
          title={landing.ok ? undefined : landing.reason}
          onClick={() => {
            const r = useArmyStore.getState().land(ship.id)
            setMessage(r.ok ? (r.kind === 'invade' ? 'Invasion under way' : 'Armies unloaded') : r.reason)
          }}
        >
          {landing.ok ? (landing.kind === 'invade' ? `Invade ${landing.bodyName} (default site)` : `Unload at ${landing.bodyName}`) : 'Land armies'}
        </button>
      )}
      {cargo.length > 0 && landing?.ok && (
        <button
          type="button"
          className="detail-view-btn"
          title="Open the planetary map and click where to land"
          onClick={() => {
            useShipStore.getState().selectShip(null)
            useGroundViewStore.getState().setMode({ kind: 'drop', shipId: ship.id })
            useViewStore.getState().enterGround(landing.bodyName)
          }}
        >
          Choose landing site…
        </button>
      )}
      {cargo.length > 0 && landing && !landing.ok && <div className="inspect-status">{landing.reason}</div>}
      {message && <div className="inspect-status ok">{message}</div>}
    </>
  )
}
