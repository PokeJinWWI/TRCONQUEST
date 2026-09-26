import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useArmyStore } from '../state/armyStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { usePlayerStore } from '../state/playerStore'
import { atWar, useDiplomacyStore } from '../state/diplomacyStore'
import { playerFightLive, reapLostCargo } from '../scene/armyLogic'
import { groundSurface } from '../scene/groundLogic'
import { simDaysToGroundStep, stepGroundWar } from '../scene/groundResolution'
import { useDefenseStore } from '../state/defenseStore'
import { withFortressKeys } from '../scene/defenseLogic'
import { DEFENSE_DEFS } from '../data/defenseData'
import { engagedUnitIds, stepTerrainWar } from '../scene/terrainWar'
import { useTerrainStore } from '../state/terrainStore'
import { controllerOf } from '../scene/territory'
import { recordLoss } from '../scene/peace'
import { ARMY_LOSS_VALUE_PER_STRENGTH } from '../data/diplomacyData'
import { ownerDisplay } from '../data/countryRoster'
import { useCombatStore } from '../state/combatStore'
import { fightPace } from './fightPace'

function nameOf(countryId: string): string {
  return ownerDisplay(countryId).name
}

// A fight the player is in pulls the clock down from strategic to operational
// pace (a ground battle is unwatchable at six days a second), and once the
// last fight — ground or space — is over, a couple of days after the final
// shot, the clock goes back to strategic. It pulls down only when a fight
// STARTS (or starts again after a lull), never while one is going on, so the
// player can always switch pace mid-battle and it stays put. Never touches
// `paused`. Same preference as the space-combat switch to tactical time
// (combatStore.autoTacticalOnEngage).
export const GROUND_FIGHT_COOLDOWN_DAYS = 2

export function followGroundFightWithClock(fighting: boolean, simDays: number): void {
  const wasLive = fightPace.groundLive
  const newFight = fighting && simDays - fightPace.lastGroundFightSimDays >= GROUND_FIGHT_COOLDOWN_DAYS
  if (fighting) {
    fightPace.groundLive = true
    fightPace.lastGroundFightSimDays = simDays
  } else if (wasLive && simDays - fightPace.lastGroundFightSimDays >= GROUND_FIGHT_COOLDOWN_DAYS) {
    fightPace.groundLive = false
  }
  if (!useCombatStore.getState().autoTacticalOnEngage) return
  const time = useGameTimeStore.getState()
  if (newFight && time.mode === 'normal') time.setMode('operational')
  const ended = wasLive && !fightPace.groundLive
  if (ended && !fightPace.spaceLive && time.mode !== 'normal') time.setMode('normal')
}

// The node holders as they stand after this call's painting (so a battle opened
// now records who holds its key nodes).
function mergeHolders(
  holders: Record<string, Record<number, string>>,
  paints: Record<string, Record<number, string | null>>,
  owners: Record<string, string>,
): Record<string, Record<number, string>> {
  const out = { ...holders }
  for (const [body, changes] of Object.entries(paints)) {
    out[body] = { ...(out[body] ?? {}) }
    for (const [node, h] of Object.entries(changes)) {
      if (h === null || owners[body] === h) delete out[body][Number(node)]
      else out[body][Number(node)] = h
    }
  }
  return out
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
  const battlesBefore = useTerrainStore.getState().battles
  // Defense installations: active fortresses are extra key nodes; the war
  // damages and destroys installations (scene/defenseLogic.ts).
  const installations = useDefenseStore.getState().installations
  const world = {
    owners: territory.bodyOwner,
    controllers: territory.bodyController,
    nodeHolders: territory.nodeHolders,
    atWar,
    isAutonomous: (countryId: string) => countryId !== player,
    surfaceOf: (bodyName: string) => {
      const surface = groundSurface(bodyName, territory.bodyOwner)
      return surface && installations.length > 0 ? withFortressKeys(surface, installations, simDays) : surface
    },
  }
  const coarse = stepGroundWar({ ...world, armies: reaped, engagedUnitIds: engagedUnitIds(battlesBefore), installations }, from, simDays)
  if (coarse.installations && coarse.installations !== installations) useDefenseStore.getState().setInstallations(coarse.installations)
  for (const gone of coarse.destroyedInstallations ?? []) {
    const owner = territory.bodyOwner[gone.bodyName]
    useDiplomacyStore
      .getState()
      .pushEvent('installation-destroyed', owner ? [owner] : [], `${DEFENSE_DEFS[gone.kind].name} on ${gone.bodyName} was destroyed`, simDays)
  }

  // Fights that have come to close quarters move onto terrain maps, and the
  // ones already there are played out. Their units go back onto these armies.
  const terrain = stepTerrainWar(
    { armies: coarse.armies, battles: battlesBefore, owners: territory.bodyOwner, holders: coarse.paints ? mergeHolders(territory.nodeHolders, coarse.paints, territory.bodyOwner) : territory.nodeHolders, atWar, isAutonomous: world.isAutonomous, surfaceOf: world.surfaceOf },
    nowStep,
    (body, at, n) => `terrain-${body}-${at}-${n}`,
  )
  const step = { ...coarse, armies: terrain.armies, losses: [...coarse.losses, ...terrain.losses.map((l) => ({ ...l, bodyName: l.bodyName, unitType: l.unitType }))] }
  if (terrain.battles !== battlesBefore && (terrain.battles.length > 0 || battlesBefore.length > 0)) useTerrainStore.getState().setBattles(terrain.battles)
  followGroundFightWithClock(playerFightLive(step.armies, player), simDays)
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
