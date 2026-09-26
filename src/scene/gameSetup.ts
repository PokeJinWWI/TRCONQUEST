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
import { bodiesOwnedBy } from './territory'
import { spawnOwnedShip } from './shipyardLogic'
import { groundSurface, musterNode } from './groundLogic'
import { placeInstallation } from './defenseLogic'
import { useDefenseStore } from '../state/defenseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { DEFENSE_DEFS, type DefenseKind } from '../data/defenseData'

export function setUpNewGame(): void {
  const { ships } = useShipStore.getState()
  for (const country of COUNTRIES) {
    if (ships.some((s) => s.ownerId === country.id)) continue
    for (const classId of STARTING_NAVY) spawnOwnedShip(classId, country.id, country.capitalStarId, country.capitalBodyName)
  }
  seedStartingArmies()
  seedStartingDefenses()
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
        { id: `def-start-${country.id}-${kind}`, bodyName: country.capitalBodyName, kind, node, integrity: DEFENSE_DEFS[kind].integrity, builtBy: country.id, readySimDays: simDays },
      ]
    }
  }
  useDefenseStore.getState().setInstallations(installations)
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
