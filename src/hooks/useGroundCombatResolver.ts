import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useArmyStore } from '../state/armyStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { usePlayerStore } from '../state/playerStore'
import { atWar, useDiplomacyStore } from '../state/diplomacyStore'
import { reapLostCargo } from '../scene/armyLogic'
import { groundSurface } from '../scene/groundLogic'
import { simDaysToGroundStep, stepGroundWar } from '../scene/groundResolution'
import { controllerOf } from '../scene/territory'
import { recordLoss } from '../scene/peace'
import { ARMY_LOSS_VALUE_PER_STRENGTH } from '../data/diplomacyData'
import { ownerDisplay } from '../data/countryRoster'

function nameOf(countryId: string): string {
  return ownerDisplay(countryId).name
}

// One step of the ground war up to `simDays` — the hook's body, exported so a
// headless run (tests) can drive it without React.
export function resolveGroundWar(simDays: number): void {
  const armyState = useArmyStore.getState()
  const liveShipIds = new Set(useShipStore.getState().ships.map((s) => s.id))
  const reaped = reapLostCargo(armyState.armies, liveShipIds)

  // First run (or a clock that went backwards, e.g. a scenario reload):
  // start the ground clock here rather than simulating from day 0.
  const nowStep = simDaysToGroundStep(simDays)
  const from = armyState.resolvedThroughStep > 0 && armyState.resolvedThroughStep <= nowStep ? armyState.resolvedThroughStep : nowStep

  const territory = useTerritoryStore.getState()
  const player = usePlayerStore.getState().selectedCountryId
  const step = stepGroundWar(
    {
      armies: reaped,
      owners: territory.bodyOwner,
      controllers: territory.bodyController,
      nodeHolders: territory.nodeHolders,
      atWar,
      isAutonomous: (countryId) => countryId !== player,
      surfaceOf: (bodyName) => groundSurface(bodyName, territory.bodyOwner),
    },
    from,
    simDays,
  )
  if (step.armies !== armyState.armies || step.resolvedThroughStep !== armyState.resolvedThroughStep) {
    useArmyStore.getState().setArmies(step.armies, step.resolvedThroughStep)
  }
  for (const [body, changes] of Object.entries(step.paints)) useTerritoryStore.getState().paintNodes(body, changes)

  // Losses count toward war score and exhaustion, charged to the wars with
  // whoever brought them down (or whoever holds that ground).
  for (const loss of step.losses) {
    const holder = controllerOf(loss.bodyName, territory.bodyOwner, territory.bodyController)
    recordLoss(loss.ownerId, holder ? [...loss.killers, holder] : loss.killers, loss.maxStrength * ARMY_LOSS_VALUE_PER_STRENGTH)
  }

  for (const o of step.occupations) {
    const before = useTerritoryStore.getState()
    const owner = before.bodyOwner[o.bodyName]
    const loser = controllerOf(o.bodyName, before.bodyOwner, before.bodyController)
    useTerritoryStore.getState().occupyBody(o.bodyName, o.countryId)
    const text =
      owner === o.countryId
        ? `${nameOf(o.countryId)} liberated ${o.bodyName}`
        : `${nameOf(o.countryId)} occupied ${o.bodyName}${loser ? ` from ${nameOf(loser)}` : ''}`
    useDiplomacyStore.getState().pushEvent('body-occupied', [o.countryId, ...(loser ? [loser] : [])], text, o.simDays)
  }
}

// Runs every ground war off the game clock: armies lost with destroyed
// transports, recruits reporting for duty, units moving and fighting on the
// planetary maps, ground changing hands, and worlds falling when their key
// nodes do. All the rules are in the pure scene/groundResolution.stepGroundWar;
// this only reads the stores, steps, and writes back. Subscribes to simDays
// the same way the other resolvers do, so it runs whichever view is mounted.
export function useGroundCombatResolver() {
  useEffect(() => {
    resolveGroundWar(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveGroundWar(state.simDays))
  }, [])
}
