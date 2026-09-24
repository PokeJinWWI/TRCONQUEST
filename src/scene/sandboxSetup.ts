// Starting the sandbox: a game with no nations. Nobody owns any territory,
// there are no wars to declare or economies to run, and no empire plays
// against the player — the only ships and armies that exist are the ones the
// player puts there, owned by the four sandbox factions (see
// data/countryRoster.ts): the player's own, and friendly, neutral and hostile
// ones. Everything downstream is unchanged, because a faction is just an owner
// whose hostility is fixed (diplomacyStore.rogueHostility).
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { DROP_SPREAD_CELLS, UNIT_TYPES } from '../data/groundData'
import { useArmyStore } from '../state/armyStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { cellsToRad, groundSurface, landedUnits, musterNode } from './groundLogic'
import { passableFor, terrainAt } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

// Where the sandbox opens: Earth is unowned, continental ground with a mix of
// terrain — a good place to put two forces in front of each other.
export const SANDBOX_START_SYSTEM = 'sol'
export const SANDBOX_START_BODY = 'Earth'

export function startSandbox(): void {
  // Unowned everywhere: no world is anybody's to invade, garrison or cede.
  useTerritoryStore.setState({ bodyOwner: {}, bodyController: {}, nodeHolders: {} })
  useDiplomacyStore.getState().reset()
  useArmyStore.getState().reset()
  useViewStore.getState().enterSystem(SANDBOX_START_SYSTEM, SANDBOX_START_BODY)
  usePlayerStore.getState().startSandbox()
}

// --- Putting things on the board ----------------------------------------------

// A sandbox army goes down this many map cells from every unit already on the
// world: out of contact (and out of artillery range), so nothing fights until
// somebody moves — the player places a force, then decides what to do.
export const SANDBOX_SPAWN_SPACING_CELLS = 3

// Puts an army of `kind` on a world for any owner, on the nearest walkable
// ground to the world's muster point that keeps clear of everyone else (or at
// `node` if given). Null if the body has no surface (a star) or there's no
// room. No cost, no rules — it's the sandbox.
export function spawnSandboxArmy(ownerId: string, kind: ArmyKind, bodyName: string, node?: number): string | null {
  const { bodyOwner } = useTerritoryStore.getState()
  const surface = groundSurface(bodyName, bodyOwner)
  if (!surface) return null
  const { armies, addArmy } = useArmyStore.getState()
  let anchor = node
  if (anchor === undefined) {
    const types = ARMY_KINDS[kind].units
    const mesh = surfaceMesh()
    const others = landedUnits(armies, bodyName)
    // The new army spreads around its anchor (see groundLogic.placeUnits), so
    // the anchor keeps the spacing plus that spread from what's already there.
    const clear = cellsToRad(SANDBOX_SPAWN_SPACING_CELLS + DROP_SPREAD_CELLS * 1.05)
    const from = nodePoint(musterNode(surface))
    const amphibious = types.every((t) => UNIT_TYPES[t].amphibious)
    const found = Array.from({ length: mesh.count.fine }, (_, i) => i)
      .filter((i) => types.every((t) => passableFor(terrainAt(surface, i), t)) && (amphibious || surface.landComponent[i] === surface.mainland))
      .sort((a, b) => arc(nodePoint(a), from) - arc(nodePoint(b), from) || a - b)
      .find((i) => others.every((o) => arc(o.unit.position!, nodePoint(i)) > clear))
    if (found === undefined) return null
    anchor = found
  }
  return addArmy({ ownerId, kind, location: { kind: 'body', bodyName }, anchorNode: anchor })
}

// Removes every ship / every army on the board.
export function clearSandboxShips(): void {
  const { ships, removeShip } = useShipStore.getState()
  for (const ship of ships) removeShip(ship.id)
}

export function clearSandboxArmies(): void {
  useArmyStore.getState().reset()
}
