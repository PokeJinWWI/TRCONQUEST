import { useEffect } from 'react'
import { ownerDisplay } from '../data/countryRoster'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useArmyStore } from '../state/armyStore'
import { useColonyStore } from '../state/colonyStore'
import { atWar, useDiplomacyStore } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { landForBody } from '../scene/bodyLand'
import { stepColonies } from '../scene/colonyLogic'
import { controllerOf } from '../scene/territory'
import { resolveFoundings } from '../scene/colonies'

// One pass over every colony at `simDays`: Colony Ships founding, the patrol clocks, and micro-colonies
// becoming planetary colonies (their land limit lifted). Exported so a headless
// run (tests) can drive it without React.
export function resolveColonies(simDays: number): void {
  resolveFoundings(simDays)
  const { colonies, setColonies } = useColonyStore.getState()
  if (!Object.values(colonies).some((c) => c.stage === 'micro')) return
  const { bodyOwner, bodyController, nodeHolders } = useTerritoryStore.getState()
  const step = stepColonies(
    colonies,
    {
      ownerOf: (b) => bodyOwner[b],
      controllerOf: (b) => controllerOf(b, bodyOwner, bodyController),
      groundHeldByOthers: (b) => Object.values(nodeHolders[b] ?? {}).some((holder) => holder !== bodyOwner[b]),
      ships: useShipStore.getState().ships,
      armies: useArmyStore.getState().armies,
      atWar,
    },
    simDays,
  )
  if (step.colonies !== colonies) setColonies(step.colonies)
  for (const body of step.promoted) {
    const economy = useAbstractEconomyStore.getState()
    const world = economy.worlds[body]
    if (world) economy.setLand(body, Math.max(world.land ?? 0, landForBody(body)))
    const owner = bodyOwner[body]
    if (owner) useDiplomacyStore.getState().pushEvent('colony-promoted', [owner], `${ownerDisplay(owner).name}'s colony on ${body} became a planetary colony`, simDays, { bodyName: body })
  }
}

export function useColonyResolver() {
  useEffect(() => {
    resolveColonies(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveColonies(state.simDays))
  }, [])
}
