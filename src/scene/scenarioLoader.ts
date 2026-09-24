// Putting a pre-built scenario on the board — the one place both the
// Debug Console (dev builds) and the Sandbox panel load scenarios from. A
// scenario has two roles, the player's side and the enemy's; loading resolves
// each to an owner, and from there it's an ordinary fight:
//   - in a normal game, the player's nation against another nation, put at war
//     for the occasion (see scenarios.scenarioNations);
//   - in the sandbox, the player's own faction against the pirates, who are at
//     war with everyone by definition.
import { COUNTRIES } from '../data/countryData'
import { PIRATES_ID, SANDBOX_PLAYER_ID, isRogueFaction } from '../data/countryRoster'
import type { ArmyScenario } from '../data/armyScenarios'
import { scenarioNations, type Scenario } from '../data/scenarios'
import { useArmyStore } from '../state/armyStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useViewStore } from '../state/viewStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { pristineCombatState } from '../state/shipStore'
import { SOL_SYSTEM_ID, DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from './shipPhysics'
import { buildArmyScenario, type ArmyScenarioOwners } from './armyScenario'
import { simDaysToGroundStep } from './groundResolution'

// Which two owners a scenario's roles resolve to right now, or null if they
// can't yet (no nation picked, or no other nation to fight).
export function currentScenarioOwners(): ArmyScenarioOwners | null {
  const { selectedCountryId, sandbox } = usePlayerStore.getState()
  if (sandbox) return { player: SANDBOX_PLAYER_ID, enemy: PIRATES_ID }
  if (!selectedCountryId) return null
  return scenarioNations(selectedCountryId, COUNTRIES.map((c) => c.id))
}

// A war between two nations, forced if a truce would otherwise forbid it. A
// no-nation faction's hostility is fixed and needs no war (see
// diplomacyStore.rogueHostility).
function ensureWar(owners: ArmyScenarioOwners): void {
  if (isRogueFaction(owners.player) || isRogueFaction(owners.enemy)) return
  useDiplomacyStore.getState().forceWar(owners.player, owners.enemy, useGameTimeStore.getState().simDays)
}

// Spawn phases, so ships at one body don't all start at the same point in the
// orbit — cosmetic only.
const SPAWN_PHASE_OFFSETS_DEG = [0, 90, 180, 270]

let shipCounter = 0

// Loads a ship scenario. Clears every ship currently on the board first: a
// scenario is a clean, reproducible test bed, and a leftover ship would
// silently change the fight without it being obvious why the outcome doesn't
// match what was verified (see data/scenarios.ts).
export function loadShipScenario(scenario: Scenario, owners: ArmyScenarioOwners): void {
  ensureWar(owners)
  const { ships, removeShip, spawnShip } = useShipStore.getState()
  for (const ship of ships) removeShip(ship.id)
  scenario.ships.forEach((spec, i) => {
    const shipClass = resolveShipClass(spec.classId)
    if (!shipClass) return
    shipCounter += 1
    spawnShip({
      id: `ship-${Date.now()}-s${shipCounter}`,
      classId: shipClass.id,
      name: `${shipClass.name} ${shipCounter}`,
      ownerId: spec.role === 'player' ? owners.player : owners.enemy,
      location: {
        kind: 'orbiting',
        systemId: SOL_SYSTEM_ID,
        bodyName: scenario.bodyName,
        periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
        phaseDeg: SPAWN_PHASE_OFFSETS_DEG[i % SPAWN_PHASE_OFFSETS_DEG.length],
        inclinationDeg: 0,
      },
      order: null,
      hyperdriveReadySimDays: 0,
      warpReadySimDays: 0,
      warpEnabled: true,
      warpWhenReady: false,
      chaffAutoDeploy: true,
      pendingHyperdriveJump: null,
      followingShipId: null,
      combat: pristineCombatState(shipClass.combat),
      // Medium scenarios bake the WINNING stance in here directly (see
      // scenarios.ts) — loading one starts already-tuned.
      stance: spec.stance ?? 'balanced',
    })
  })
}

export type ArmyScenarioLoad = { ok: true; bodyName: string } | { ok: false; reason: string }

// Loads an army scenario: replaces every army on the board with the
// scenario's two forces and opens the world's planetary map on them. Ships
// are left alone. The scenario's ground is nobody's, so it needs no war
// between nations beyond the two owners' own.
export function loadArmyScenario(scenario: ArmyScenario, owners: ArmyScenarioOwners): ArmyScenarioLoad {
  const startStep = simDaysToGroundStep(useGameTimeStore.getState().simDays)
  const built = buildArmyScenario(scenario, owners, { startStep })
  if (!built) return { ok: false, reason: `No ground on ${scenario.battlefield.bodyName} fits this scenario` }
  ensureWar(owners)
  useArmyStore.getState().setArmies(built.armies, startStep)
  useViewStore.getState().enterGround(built.bodyName)
  return { ok: true, bodyName: built.bodyName }
}
