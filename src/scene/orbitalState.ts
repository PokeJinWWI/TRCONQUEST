// Orbital control, read from the live game: armed ships orbiting a body plus working defense platforms
// (scene/orbits.orbitalControl is the rule). Nothing is stored: control is recomputed whenever asked.
import { FACILITY_SPECS } from '../data/orbitalData'
import { useStarbaseStore } from '../state/starbaseStore'
import { isStarbaseActive, starbaseFirepower } from './starbaseLogic'
import { STATION_FIREPOWER_PER_STRENGTH } from '../data/starbaseData'
import { atWar } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { orbitedBody } from './armyLogic'
import { bodyOfZone, facilityWorking, orbitalAccess, orbitalControl, type OrbitalControl } from './orbits'

export function orbitalForcesAt(bodyName: string): Record<string, number> {
  const forces: Record<string, number> = {}
  for (const ship of useShipStore.getState().ships) {
    if (orbitedBody(ship) !== bodyName) continue
    const weapons = resolveShipClass(ship.classId)?.combat.weapons.length ?? 0
    if (weapons > 0) forces[ship.ownerId] = (forces[ship.ownerId] ?? 0) + weapons
  }
  const now = useGameTimeStore.getState().simDays
  for (const f of useOrbitalStore.getState().facilities) {
    const power = FACILITY_SPECS[f.kind].power
    // A platform over a world an enemy has occupied is cut off from its owner's support and adds no strength.
    const occupier = useTerritoryStore.getState().bodyController[bodyName]
    const cutOff = !!occupier && occupier !== f.ownerId && atWar(occupier, f.ownerId)
    if (power > 0 && bodyOfZone(f.zone) === bodyName && facilityWorking(f, now) && !cutOff) forces[f.ownerId] = (forces[f.ownerId] ?? 0) + power
  }
  // Working stations circling the body add their guns (a station's firepower is its armed strength, like a ship's weapons).
  for (const sb of useStarbaseStore.getState().starbases) {
    if (!sb.zone || bodyOfZone(sb.zone) !== bodyName || !isStarbaseActive(sb, now)) continue
    const occupier = useTerritoryStore.getState().bodyController[bodyName]
    if (!!occupier && occupier !== sb.ownerId && atWar(occupier, sb.ownerId)) continue
    const power = Math.round(starbaseFirepower(sb) / STATION_FIREPOWER_PER_STRENGTH)
    if (power > 0) forces[sb.ownerId] = (forces[sb.ownerId] ?? 0) + power
  }
  return forces
}

export function orbitalControlNow(bodyName: string): OrbitalControl {
  return orbitalControl(orbitalForcesAt(bodyName), atWar)
}

// What the force over a body lets `nationId` do there (reinforce, resupply, evacuate, land).
export function orbitalAccessNow(nationId: string, bodyName: string): { ok: true } | { ok: false; reason: string } {
  return orbitalAccess(nationId, orbitalControlNow(bodyName), atWar)
}
