// One-time setup when a game starts (the player picks a nation): every
// nation — the player's and every other one — gets its starting navy at its
// capital, a garrison on every body it owns (standing on its key nodes), and
// a couple of assault armies at its capital's spaceport, ready to embark. Guarded per nation (ships and armies
// separately), so re-running it (a second pick in the same session) never
// doubles anyone's forces.
import { COUNTRIES } from '../data/countryData'
import { STARTING_NAVY } from '../data/startingForces'
import { STARTING_ASSAULT_ARMIES, startingGarrisonCount } from '../data/armyData'
import { useShipStore } from '../state/shipStore'
import { useArmyStore } from '../state/armyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { economyModel } from '../state/playerStore'
import { bodiesOwnedBy } from './territory'
import { spawnOwnedShip, seedMilitaryStockpile } from './shipyardLogic'
import { resolveShipClass } from '../state/shipClassResolver'
import { seedColonies, seedOutpostWorlds } from './colonies'
import { groundSurface, musterNode } from './groundLogic'
import { RING_ANCHORS } from '../data/earthEconomicGeography'
import { seedRuralStructures } from './ruralOrders'
import { placeInstallation } from './defenseLogic'
import { resyncMilitarySlots, useDefenseStore } from '../state/defenseStore'
import { LANDMARKS } from '../data/landmarks'
import { useGameTimeStore } from '../state/gameTimeStore'
import { DEFENSE_DEFS, type DefenseKind } from '../data/defenseData'
import { useStarbaseStore } from '../state/starbaseStore'
import { RING_OF_HEAVEN_MODULES } from '../data/starbaseData'
import { starbaseMaxIntegrity } from './starbaseLogic'
import { useDiplomacyStore, relationIn } from '../state/diplomacyStore'
import { usePlacementStore } from '../state/placementStore'

export function setUpNewGame(): void {
  // A real game: each world's starting districts and buildings are assigned to its sites the first time that matters.
  usePlacementStore.getState().setAutoSeed(true)
  const { ships } = useShipStore.getState()
  for (const country of COUNTRIES) {
    if (ships.some((s) => s.ownerId === country.id)) continue
    const warshipIds: string[] = []
    for (const classId of STARTING_NAVY) {
      const id = spawnOwnedShip(classId, country.id, country.capitalStarId, country.capitalBodyName)
      if (id && resolveShipClass(classId)?.role === 'warship') warshipIds.push(id)
    }
    mergeIntoOneFleet(warshipIds)
  }
  seedStartingArmies()
  seedStartingDefenses()
  seedColonies(useGameTimeStore.getState().simDays)
  seedRingOfHeaven()
  seedRuralStructures('Earth', 'earth', 'spaceElevatorAnchor', RING_ANCHORS)
  seedStartingRelations()
  // Complex mode runs the generated empires' economies too (economy/empireSeed.ts),
  // and the military shipyard draws real goods from the capital stockpile, so each
  // nation opens with a standing war-materials reserve + targets (scene/shipyardLogic).
  if (economyModel() === 'complex') {
    seedOutpostWorlds()
    useEconomyStore.getState().seedEmpires()
    for (const country of COUNTRIES) seedMilitaryStockpile(country.id)
  }
}

// Earth, the old imperial core, eyes the breakaway inner worlds warily: it
// starts a little cool toward Mars and Venus (no war, just mutual distrust).
// Guarded so a re-setup doesn't keep stacking the penalty.
function seedStartingRelations(): void {
  const diplomacy = useDiplomacyStore.getState()
  for (const other of ['imperial-state-of-mars', 'republic-of-venus']) {
    if (relationIn(diplomacy.relations, 'earth', other).opinion === 0) diplomacy.adjustOpinion('earth', other, -15)
  }
  // Jinshan broke away from the Command: colder than Earth is toward Mars or Venus (an opinion is one shared figure per pair).
  if (relationIn(diplomacy.relations, 'earth', 'republic-of-jinshan').opinion === 0) diplomacy.adjustOpinion('earth', 'republic-of-jinshan', -25)
}

// Earth begins with the "Ring of Heaven": a pre-built orbital ring circling Earth over its equator, a relic of the old empire's power. A
// shipyard, guns and missiles, a trade hub, solar arrays and three space-elevator tethers, all working from day 0 (tests/stations.test.ts).
// Guarded so a reset/re-setup doesn't duplicate it.
function seedRingOfHeaven(): void {
  const starbases = useStarbaseStore.getState().starbases
  if (starbases.some((sb) => sb.ownerId === 'earth')) return
  useStarbaseStore.getState().addStarbase({
    starId: 'sol',
    zone: 'Earth~low',
    name: 'Ring of Heaven',
    ownerId: 'earth',
    integrity: 9999,
    readySimDays: 0,
    tier: 'orbital-ring',
    modules: RING_OF_HEAVEN_MODULES,
  })
  // Full hit points for the modules it carries.
  const ring = useStarbaseStore.getState().starbases.find((sb) => sb.zone === 'Earth~low')
  if (ring) useStarbaseStore.setState((st) => ({ starbases: st.starbases.map((sb) => (sb.id === ring.id ? { ...sb, integrity: starbaseMaxIntegrity(sb) } : sb)) }))
}

// The starting warships sail as one fleet: as separate fleets, "attack
// together" sent the warp-driven frigates ahead of the reaction-drive
// cruisers, to arrive alone and die.
function mergeIntoOneFleet(shipIds: string[]): void {
  const store = useShipStore.getState()
  const fleetOf = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)?.fleetId
  const lead = shipIds.length > 0 ? fleetOf(shipIds[0]) : undefined
  if (!lead) return
  for (const id of shipIds.slice(1)) {
    const from = fleetOf(id)
    if (from && from !== lead) store.mergeFleets(lead, from)
  }
}

// Every capital starts fortified: a Fortress and a Defense Battery, ready now
// (scene/defenseLogic.ts). Guarded per nation like the armies.
export const STARTING_DEFENSES: DefenseKind[] = ['fortress', 'defenseBattery']
export function seedStartingDefenses(simDays = useGameTimeStore.getState().simDays): void {
  const { bodyOwner } = useTerritoryStore.getState()
  let installations = useDefenseStore.getState().installations
  for (const country of COUNTRIES) {
    if (installations.some((i) => i.builtBy === country.id)) continue
    const surface = groundSurface(country.capitalBodyName, bodyOwner)
    if (!surface) continue
    for (const kind of STARTING_DEFENSES) {
      const node = placeInstallation(surface, installations, kind)
      if (node === null) continue
      installations = [
        ...installations,
        {
          id: `def-start-${country.id}-${kind}`,
          bodyName: country.capitalBodyName,
          kind,
          node,
          integrity: DEFENSE_DEFS[kind].integrity,
          builtBy: country.id,
          readySimDays: simDays,
          // The capital's fortress is its nation's landmark (Olympus Castle…).
          name: kind === 'fortress' ? LANDMARKS[country.id]?.fortress.name : undefined,
        },
      ]
    }
  }
  useDefenseStore.getState().setInstallations(installations)
  resyncMilitarySlots()
}

export function seedStartingArmies(): void {
  const { armies, addArmy } = useArmyStore.getState()
  const { bodyOwner } = useTerritoryStore.getState()
  const { worlds } = useEconomyStore.getState()
  for (const country of COUNTRIES) {
    if (armies.some((a) => a.ownerId === country.id)) continue
    for (const body of bodiesOwnedBy(country.id, bodyOwner)) {
      const surface = groundSurface(body, bodyOwner)
      if (!surface) continue
      const count = startingGarrisonCount(body === country.capitalBodyName, !!worldByName(worlds, body))
      // Garrisons stand on the key nodes, capital first, round-robin.
      const keys = surface.keySlots.map((k) => k.node)
      for (let i = 0; i < count; i++) {
        addArmy({
          ownerId: country.id,
          kind: 'garrison',
          location: { kind: 'body', bodyName: body },
          anchorNode: keys.length > 0 ? keys[i % keys.length] : musterNode(surface),
        })
      }
    }
    const capital = groundSurface(country.capitalBodyName, bodyOwner)
    for (let i = 0; i < STARTING_ASSAULT_ARMIES; i++) {
      addArmy({
        ownerId: country.id,
        kind: 'assault',
        location: { kind: 'body', bodyName: country.capitalBodyName },
        anchorNode: capital ? musterNode(capital) : undefined,
      })
    }
  }
}
