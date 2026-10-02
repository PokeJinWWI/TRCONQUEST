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
import { spawnOwnedShip } from './shipyardLogic'
import { resolveShipClass } from '../state/shipClassResolver'
import { seedColonies } from './colonies'
import { groundSurface, musterNode } from './groundLogic'
import { placeInstallation } from './defenseLogic'
import { resyncMilitarySlots, useDefenseStore } from '../state/defenseStore'
import { LANDMARKS } from '../data/landmarks'
import { useGameTimeStore } from '../state/gameTimeStore'
import { DEFENSE_DEFS, type DefenseKind } from '../data/defenseData'

export function setUpNewGame(): void {
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
  // Complex mode runs the generated empires' economies too (economy/empireSeed.ts).
  if (economyModel() === 'complex') useEconomyStore.getState().seedEmpires()
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
